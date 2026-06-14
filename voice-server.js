#!/usr/bin/env node
/**
 * NEXUS Voice Bridge v2 — SSE + HTTP POST only (no WebSocket)
 *
 * Endpoints:
 *   GET  /voice/sse           — SSE stream (receives responses)
 *   POST /voice/transcript    — Send a transcript (STT text or manual)
 *   POST /voice/send-response — I call this to push a response
 *   GET  /voice/status        — Server health
 *   GET  /voice/transcripts   — Pending transcripts (for me)
 *   POST /voice/transcripts/clear — Clear pending
 */

const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT, 10) || 3002;
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN;
const MODEL = process.env.GATEWAY_MODEL || 'openclaw';

if (!GATEWAY_TOKEN) {
  console.error('[voice-server] FATAL: GATEWAY_TOKEN environment variable is not set.');
  console.error('[voice-server] Set it before starting, e.g. `GATEWAY_TOKEN=... node voice-server.js`');
  process.exit(1);
}

// SSE clients
const sseClients = new Map(); // id -> { res }

// Pending transcripts
const pendingTranscripts = [];
const MAX_TRANSCRIPTS = 50;

function broadcastSSE(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const [id, client] of sseClients) {
    try {
      client.res.write(data);
    } catch (e) {
      sseClients.delete(id);
    }
  }
}

function forwardToGateway(text, lang) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `Tu es NEXUS, un assistant vocal intelligent. Réponds de façon concise et naturelle, comme une conversation vocale. La langue est le ${lang}. Garde tes réponses courtes (max 3 phrases).`,
        },
        { role: 'user', content: text },
      ],
      max_tokens: 300,
      stream: false,
    });

    const gateway = new URL(GATEWAY_URL);
    const opts = {
      hostname: gateway.hostname,
      port: gateway.port || (gateway.protocol === 'https:' ? 443 : 80),
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + GATEWAY_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 60000,
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.message?.content;
          if (content) resolve(content);
          else reject(new Error('No content in Gateway response'));
        } catch (e) {
          reject(new Error('Parse error: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Gateway timeout'));
    });
    req.write(body);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // === SSE endpoint ===
  if (path === '/voice/sse') {
    const id = crypto.randomUUID().slice(0, 8);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send connected event
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId: id })}\n\n`);

    sseClients.set(id, { res });

    // Keepalive
    const keepalive = setInterval(() => {
      try {
        res.write(':keepalive\n\n');
      } catch (e) {
        clearInterval(keepalive);
        sseClients.delete(id);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      sseClients.delete(id);
    });

    console.log(`[voice] SSE client connected: ${id} (total: ${sseClients.size})`);
    return;
  }

  // === POST transcript from dashboard ===
  if (path === '/voice/transcript' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const text = data.text || '';
        const lang = data.language || 'fr-FR';

        // Store
        const entry = {
          id: crypto.randomUUID().slice(0, 8),
          text,
          timestamp: new Date().toISOString(),
          language: lang,
        };
        pendingTranscripts.push(entry);
        if (pendingTranscripts.length > MAX_TRANSCRIPTS) pendingTranscripts.shift();

        console.log(`[voice] Transcript: "${text}"`);

        // Ack to the client immediately
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: entry.id }));

        // Notify SSE clients we're thinking
        broadcastSSE({ type: 'thinking' });

        // Forward to Gateway (async — don't block the response)
        forwardToGateway(text, lang)
          .then((responseText) => {
            broadcastSSE({
              type: 'response',
              text: responseText,
              language: 'fr-FR',
              sender: 'assistant',
              timestamp: new Date().toISOString(),
            });
            console.log(`[voice] Response sent to ${sseClients.size} clients`);
          })
          .catch((err) => {
            console.error('[voice] Gateway error:', err.message);
            broadcastSSE({
              type: 'error',
              text: "Désolé, je n'ai pas pu traiter votre demande. Veuillez réessayer.",
            });
          });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // === POST send-response (I call this) ===
  if (path === '/voice/send-response' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        broadcastSSE({
          type: 'response',
          text: data.text || '',
          language: data.language || 'fr-FR',
          sender: data.sender || 'assistant',
          timestamp: new Date().toISOString(),
        });
        console.log(`[voice] Response broadcasted: "${(data.text || '').slice(0, 60)}..."`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, clients: sseClients.size }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // === Status ===
  if (path === '/voice/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'running',
        sseClients: sseClients.size,
        pendingTranscripts: pendingTranscripts.length,
      })
    );
    return;
  }

  // === Transcripts list ===
  if (path === '/voice/transcripts' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ transcripts: [...pendingTranscripts], clients: sseClients.size }));
    return;
  }

  // === Clear transcripts ===
  if (path === '/voice/transcripts/clear' && req.method === 'POST') {
    pendingTranscripts.length = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[voice-server] NEXUS Voice Bridge v2 running on port ${PORT}`);
  console.log(`[voice-server] SSE:     http://127.0.0.1:${PORT}/voice/sse`);
  console.log(`[voice-server] Submit:  POST http://127.0.0.1:${PORT}/voice/transcript`);
  console.log(`[voice-server] Send:    POST http://127.0.0.1:${PORT}/voice/send-response`);
});

process.on('SIGTERM', () => {
  console.log('[voice-server] Shutting down...');
  server.close();
});
