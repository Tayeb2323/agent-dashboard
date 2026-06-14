const CONFIG = {
  apiBase: 'https://openclawdz.duckdns.org',
  agents: [
    { id: 'master',    label: '@master',  emoji: '🎓', desc: 'Coordination & documentation' },
    { id: 'moulay',    label: '@moulay',  emoji: '🧑‍🎓', desc: 'Suivi Moulay (thèse)' },
    { id: 'mahmoud',   label: '@mahmoud', emoji: '👨‍🎓', desc: 'Suivi Mahmoud (thèse)' },
    { id: 'besma',     label: '@besma',   emoji: '👩‍🎓', desc: 'Suivi Besma (workstream)' },
    { id: 'aimu',      label: '@aimu',    emoji: '🤖', desc: 'Développement AIMU' },
    { id: 'vrdpo',     label: '@vrdpo',   emoji: '⚖️', desc: 'Juridique VRDPO' },
    { id: 'grant',     label: '@grant',   emoji: '💰', desc: 'Gestion Grants' },
    { id: 'executor',  label: '@executor',emoji: '⚡', desc: 'Exécution lourde (Gemini)' },
  ],
  students: [
    { id: 'moulay',  label: 'Moulay',  emoji: '🧑‍🎓' },
    { id: 'mahmoud', label: 'Mahmoud', emoji: '👨‍🎓' },
    { id: 'besma',   label: 'Besma',   emoji: '👩‍🎓' },
  ],
  refreshInterval: 60,
};
