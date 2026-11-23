// The world's personalisation: its name, the agents' display names, setup on first launch and Settings →
// Personalisation. Loaded before village.js.
//
// - Settings are saved per instance by helper/serve.py in data/settings.json (never in Git), as one versioned
//   record: { version, setupDone, worldName, ownerName, agents: { <id>: <display name> }, tourDone, draft }.
// - Only display labels change. Every agent keeps its ID, folder, role, instructions, permissions, tasks and
//   history; signs and messages show the new label. The names written in the code are the shipped defaults.
// - Labels are trimmed, limited in length and always shown as plain text. A blank label falls back to the default.
// - First launch: when the instance has no completed setup record. An existing install (it already has village
//   data in this browser) is marked set up with its current names and goes straight in.
// - Setup and saving never start an agent job.
'use strict';
(() => {
  const VERSION = 1;
  const DEFAULT_WORLD = 'Kingdom One';
  const LIMIT = { world: 40, owner: 30, agent: 24 };
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

  function load() {
    try {
      const x = new XMLHttpRequest(); x.open('GET', 'api/settings?' + Date.now(), false); x.send();
      if (x.status === 200) { const j = JSON.parse(x.responseText); if (j && typeof j === 'object') return { ok: true, s: j }; }
      if (x.status === 404) return { ok: true, s: null };  // no record yet
    } catch (e) { /* the settings server isn't reachable */ }
    return { ok: false, s: null };
  }
  const got = load();
  let settings = got.s && got.s.version ? got.s : null;

  function save(rec) {  // one record, written whole: a repeated or retried save never makes a second world
    const body = JSON.stringify({ ...rec, version: VERSION, updatedAt: new Date().toISOString() });
    return fetch('api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      .then((r) => r.json().then((j) => { if (!r.ok) throw new Error(j.error || 'save failed'); settings = j.settings; return j.settings; }));
  }

  // ---------- labels ----------
  let defaults = null;        // { world, agents: [{ key, name, role }] }, from village.js
  let map = [];               // [regex, label] for every label that differs from its default
  const COMMON = /^(Money|Studio|Inbox|Media sorter|Hub scout)$/;  // also ordinary words: only replace as a name
  function build() {
    map = [];
    if (!defaults) return;
    const pairs = [[defaults.world, worldName()], ...defaults.agents.map((a) => [a.name, agentName(a.key)])];
    pairs.sort((a, b) => b[0].length - a[0].length);
    for (const [from, to] of pairs) {
      if (!from || from === to) continue;
      const e = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = COMMON.test(from) ? new RegExp(`(^|[\\s"(])${e}(?=:|'s|’s|$|[\\s,.!?)])`, 'g') : new RegExp(`(^|[^A-Za-z])${e}(?![A-Za-z])`, 'g');
      map.push([re, to]);
    }
  }
  const relabel = (text) => {
    if (!map.length || text == null) return text;
    let s = String(text);
    for (const [re, to] of map) s = s.replace(re, (m, pre) => pre + to);
    return s;
  };
  const worldName = () => (settings && clean(settings.worldName, LIMIT.world)) || defaults?.world || DEFAULT_WORLD;
  function agentName(key) {
    const d = defaults && defaults.agents.find((a) => a.key === key);
    return (settings && settings.agents && clean(settings.agents[key], LIMIT.agent)) || (d ? d.name : key);
  }


  // ---------- connections (setup step 4 and Settings → Connections) ----------
  // A list of what the Chief wants the agents to work with. Adding one records it only: nothing is fetched, called
  // or logged in to. Each kind gets wired up in a later slice, and the Chief approves it before any agent uses it.
  // Kingdom never stores a password, key or token: an API key stays in an environment variable named here.
  const KINDS = {
    local: { label: 'A tool on this computer', field: 'Address', ph: 'http://127.0.0.1:8080',
      help: 'Something running here, such as a tool you or your agents built. The address starts with http://127.0.0.1: or http://localhost:.' },
    repo: { label: 'An online repository', field: 'Repository link', ph: 'https://github.com/owner/project',
      help: "A project on GitHub, GitLab or Codeberg, yours or someone else's. Read-only: agents can read it, never change it." },
    account: { label: 'An account (Gmail, Calendar, Drive…)', field: 'Service', options: ['Gmail', 'Google Calendar', 'Google Drive', 'Google Sheets', 'Outlook', 'Slack', 'Notion', 'Xero', 'Other'],
      help: "Goes through a connector on your own Claude account (claude.ai → Settings → Connectors). Kingdom never asks for your password. Sending anything, and anything that moves money (Xero), always waits for you." },
    social: { label: 'Social media', field: 'Network', options: ['X', 'LinkedIn', 'Instagram', 'Facebook', 'YouTube', 'TikTok', 'Other'],
      help: 'Agents may only draft posts and replies. Posting is always done by you.' },
    api: { label: 'A custom API', field: 'Base address', ph: 'https://api.example.com',
      help: "Any web service with an API. Don't paste a key: if it needs one, put the key in an environment variable on this computer and write that variable's name here. Check whether it charges per use first." },
  };
  const LOCAL_RE = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}(\/[^\s?#]*)?$/;
  const REPO_RE = /^https:\/\/(github\.com|gitlab\.com|codeberg\.org)\/[\w.-]+\/[\w.-]+\/?$/;
  const API_RE = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:\d{2,5})?(\/[^\s?#]*)?$/i;
  const ENV_RE = /^[A-Z][A-Z0-9_]{1,40}$/;
  const SECRET_RE = /(sk-|ghp_|gho_|github_pat_|xox[abprs]-|AIza|AKIA|Bearer\s)|(?=[A-Za-z0-9_+-]*\d)(?=[A-Za-z0-9_+-]*[A-Za-z])[A-Za-z0-9_+-]{32,}|[?&](key|token|secret|password|api_key)=|\/\/[^/]*@/i;
  const MAX_CONN = 30;
  function checkConn(c) {
    const k = KINDS[c.kind]; if (!k) return 'Pick what kind of connection it is.';
    if ([c.name, c.detail, c.env].some((v) => v && SECRET_RE.test(v))) return 'That looks like a password, key or token. Kingdom never stores those: leave it out.';
    if (!c.detail) return `Fill in the ${k.field.toLowerCase()}.`;
    if (c.kind === 'local' && !LOCAL_RE.test(c.detail)) return 'A tool on this computer has an address starting http://127.0.0.1: or http://localhost:';
    if (c.kind === 'repo' && !REPO_RE.test(c.detail)) return 'Use the link to the repository itself, like https://github.com/owner/project';
    if (c.kind === 'api' && !API_RE.test(c.detail)) return 'Use the https:// base address, with no key or ? in it.';
    if (k.options && !k.options.includes(c.detail)) return `Pick a ${k.field.toLowerCase()}.`;
    if (c.env && !ENV_RE.test(c.env)) return 'An environment variable name is capitals, digits and _, like WEATHER_API_KEY.';
    return '';
  }
  let localTools = [];  // the tools already in helper/tools.json, from the brain helper (if it's running)
  fetch(`http://127.0.0.1:${(+location.port || 8765) + 1}/requests`).then((r) => r.json()).then((j) => { localTools = Object.values(j.tools || {}); }).catch(() => {});

  // What Claude says about each account connection (the brain helper asks Claude Code which connectors are added and signed in)
  const BRAIN_URL = `http://127.0.0.1:${(+location.port || 8765) + 1}`;
  const claude = { state: 'idle', items: {}, page: 'https://claude.ai/settings/connectors', note: '' };
  const editors = new Set();
  function checkClaude(fresh) {
    claude.state = 'checking'; editors.forEach((r) => r());
    return fetch(`${BRAIN_URL}/connectors${fresh ? '?fresh=1' : ''}`).then((r) => r.json()).then((j) => {
      Object.assign(claude, { state: j.checked ? 'ok' : 'unknown', items: j.items || {}, page: j.page || claude.page });
    }).catch(() => { claude.state = 'off'; }).finally(() => editors.forEach((r) => r()));
  }
  const btn = (label, onclick, go) => el('button', { class: go ? 'go' : '', onclick: (e) => { if (e.isTrusted) onclick(e); } }, label);

  // The catalogue in setup and Settings → Connections: small tiles by category, each with a Connect button.
  const CATALOG = [
    ['Email & calendar', [['account', 'Gmail', 'Gm'], ['account', 'Google Calendar', 'Ca'], ['account', 'Outlook', 'Ou']]],
    ['Files & notes', [['account', 'Google Drive', 'Dr'], ['account', 'Google Sheets', 'Sh'], ['account', 'Notion', 'No']]],
    ['Money', [['account', 'Xero', 'Xe']]],
    ['Team chat', [['account', 'Slack', 'Sl']]],
    ['Social media (drafts only)', [['social', 'LinkedIn', 'Li'], ['social', 'X', 'X'], ['social', 'Instagram', 'In'], ['social', 'Facebook', 'Fb'], ['social', 'YouTube', 'Yt'], ['social', 'TikTok', 'Tt']]],
    ['Knowledge & media (bolt-ons)', [['bolton', 'library', 'Kb'], ['bolton', 'ytdl', 'Dl'], ['bolton', 'ollama', 'Lm']]],
    ['Projects & your own', [['repo', 'A repository', 'Gh'], ['local', 'A tool on this computer', 'Pc'], ['api', 'A custom API', 'Ap'], ['account', 'Other', '+']]],
  ];
  // Brand colours for the tool tiles. A logo file in logos/<slug>.svg is used when it's listed in HAVE_LOGOS
  // (bundled with the game, never fetched from the internet); otherwise the tile shows its letters on the brand colour.
  const BRAND = { Gmail: ['#EA4335', 'gmail'], 'Google Calendar': ['#4285F4', 'googlecalendar'], Outlook: ['#0078D4', 'outlook'],
    'Google Drive': ['#1FA463', 'googledrive'], 'Google Sheets': ['#34A853', 'googlesheets'], Notion: ['#2f2f2f', 'notion'], Xero: ['#13B5EA', 'xero'],
    Slack: ['#4A154B', 'slack'], LinkedIn: ['#0A66C2', 'linkedin'], X: ['#111111', 'x'], Instagram: ['#E4405F', 'instagram'], Facebook: ['#0866FF', 'facebook'],
    YouTube: ['#FF0000', 'youtube'], TikTok: ['#111111', 'tiktok'] };
  const HAVE_LOGOS = new Set(['facebook', 'gmail', 'googlecalendar', 'googledrive', 'googlesheets', 'instagram', 'linkedin', 'notion', 'slack', 'tiktok', 'x', 'xero', 'youtube']);
  const ICON = { library: 'M5 4h4v16H5zM11 4h4v16h-4zM17 5l3 .8-3.2 14-3-.8z', ytdl: 'M8 5l11 7-11 7z', ollama: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
    repo: 'M6 4v10M18 8c0 5-12 3-12 8M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', local: 'M3 4h18v12H3zM8 20h8M12 16v4',
    api: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4', Other: 'M12 5v14M5 12h14' };
  const ICON_BG = { library: '#3f7d5a', ytdl: '#d9643f', ollama: '#5a5f73', repo: '#24292f', local: '#1f6f8b', api: '#7a4fa0', Other: '#6b6250' };
  function logo(k, d, mono) {
    const b = BRAND[d], key = k === 'bolton' ? d : k === 'account' && d === 'Other' ? 'Other' : k;
    if (b) {
      const box = el('div', { class: 'mono', 'aria-hidden': 'true', style: `background:${b[0]}` }, mono || d.slice(0, 2));
      if (HAVE_LOGOS.has(b[1])) box.replaceChildren(el('img', { src: `logos/${b[1]}.svg`, alt: '' }));
      return box;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', ICON[key] || ICON.Other); svg.append(path);
    return el('div', { class: 'mono ico', 'aria-hidden': 'true', style: `background:${ICON_BG[key] || '#2b8a8a'}` }, svg);
  }
  // Faces: the cast draws portraits after the page loads, so a face slot shows an initial until its portrait is ready.
  const faceCache = {};
  function faceSrc(key) {
    if (faceCache[key]) return faceCache[key];
    const c = window.__castPortraits && window.__castPortraits[key]; if (!c) return '';
    try { return (faceCache[key] = c.toDataURL ? c.toDataURL() : c.src || ''); } catch (e) { return ''; }
  }
  function faceSlot(key, big) {
    const s = el('span', { class: 'face' + (big ? ' big' : ''), 'data-face': key, 'aria-hidden': 'true' }, (agentName(key) || '?').slice(0, 1));
    const src = faceSrc(key); if (src) { s.replaceChildren(el('img', { src, alt: '' })); s.classList.add('got'); }
    return s;
  }
  setInterval(() => {  // fills any face shown before its portrait was ready (cheap: only unfilled slots on screen)
    if (!window.__castPortraits) return;
    document.querySelectorAll('[data-face]:not(.got)').forEach((s) => { const src = faceSrc(s.dataset.face); if (src) { s.replaceChildren(el('img', { src, alt: '' })); s.classList.add('got'); } });
  }, 400);
  // Who would use each tool, from what their job needs. Pre-ticked when you turn a tool on; you can change it.
  const MAIL = [['inbox', 'drafts replies and sorts mail'], ['keeper', 'spots follow-ups and deadlines'], ['steward', 'looks after personal mail'], ['vizier', 'briefs you on what came in']];
  const SOCIAL = [['inbox', 'drafts posts and replies'], ['merchant', 'drafts business posts']];
  const SUGGEST = { Gmail: MAIL, Outlook: MAIL,
    'Google Calendar': [['keeper', 'tracks meetings and deadlines'], ['steward', 'plans personal appointments'], ['vizier', 'plans your day']],
    'Google Drive': [['librarian', 'finds and files documents'], ['merchant', 'finds proposals and quotes'], ['engineer', 'reads technical documents']],
    'Google Sheets': [['money', 'reads the numbers'], ['merchant', 'tracks clients and quotes'], ['keeper', 'keeps trackers up to date']],
    Notion: [['librarian', 'reads your notes'], ['keeper', 'reads your task boards']],
    Xero: [['money', 'reads invoices, bills and cash'], ['merchant', 'checks how the business is doing']],
    Slack: [['inbox', 'reads team messages'], ['keeper', 'picks up requests']],
    YouTube: [['youtube', 'drafts video posts'], ...SOCIAL],
    repo: [['engineer', 'reads the code'], ['scholar', 'researches projects']], local: [['engineer', 'uses tools built here']], api: [['engineer', 'builds on it'], ['scholar', 'looks things up']] };
  function suggestFor(k, d) {
    const list = SUGGEST[d] || (k === 'social' ? SOCIAL : SUGGEST[k]) || [];
    return list.filter(([key]) => defaults && defaults.agents.some((a) => a.key === key));
  }
  // The "i" on every tile: what it is, what agents may do with it, and what you need.
  const ACCOUNT_INFO = {
    Gmail: ['Your email.', 'Read and search your mail. If you allow it, save new drafts for you to check. Never send, change or delete.'],
    Outlook: ['Your Microsoft email.', 'Read and search your mail. If you allow it, save new drafts for you to check. Never send, change or delete.'],
    'Google Calendar': ['Your calendar.', 'See your events and free time. Never book, move or cancel anything.'],
    'Google Drive': ['Your files.', 'Find and read documents. Never change, share or delete them.'],
    'Google Sheets': ['Your spreadsheets.', 'Read the numbers in your sheets. Never edit them.'],
    Notion: ['Your notes and boards.', 'Read pages and databases. Never edit them.'],
    Xero: ['Your accounts.', 'Read invoices, bills, cash and reports. Never pay, send or change anything.'],
    Slack: ['Your team chat.', 'Read channels and messages. Never post.'],
    Other: ['Any other connector in your Claude account.', 'Read only. Anything that would change something waits for your Approve.'] };
  function toolInfo(k, d) {
    const inClaude = `${d === 'Other' ? 'The service' : d} added and signed in, in your Claude account. The Connect button walks you through it.`;
    if (k === 'account') { const a = ACCOUNT_INFO[d] || ACCOUNT_INFO.Other; return [a[0], a[1], inClaude, ['Open Claude connectors', 'https://claude.ai/settings/connectors']]; }
    if (k === 'social') return [`Your ${d} account.`, 'Draft posts and replies for you. You always do the posting yourself.', 'Nothing to install. Drafts appear on your to-do list.', null];
    if (k === 'bolton') {
      const i = BOLTON_INFO[d];
      const can = { library: 'Look things up and say where it came from. They never add to it: you decide what goes in.',
        ytdl: 'Download and transcribe a video once you approve it on your to-do list.', ollama: 'Write quick first drafts for free, so less of your Claude plan is used.' }[d];
      const need = d === 'ollama' ? 'Ollama (free) and a small model. Connect shows the two steps.' : 'Docker Desktop (free) and a few minutes. Connect shows the steps.';
      const link = { library: 'https://github.com/your first business-Dan/kingdom-library#readme', ytdl: 'https://github.com/your first business-Dan/kingdom-youtube#readme', ollama: 'https://ollama.com' }[d];
      return [i.what, can, need, ['Full guide', link]];
    }
    if (k === 'repo') return ['A project on GitHub, GitLab or Codeberg.', 'Read the code, issues and releases. Never change anything.', 'The link to the repository. Public ones for now.', null];
    if (k === 'local') return ['A tool running on this computer, such as one your agents built.', 'Read from it. Anything that would change something waits for your Approve.', 'Its address, like http://127.0.0.1:8080.', null];
    return ['Any web service with an API.', 'Read from it, up to 30 times a day. Anything that would change something waits for your Approve.', "Its address, and the name of an environment variable holding its key if it needs one. Free or already-paid services only.", null];
  }
  const who = (c) => ((c.agents || []).includes('*') ? 'all agents' : (c.agents || []).map((k) => agentName(k)).join(', '));
  const BOLTON_INFO = {
    library: { name: 'Kingdom Library', what: 'Your knowledge base: what agents look things up in, and where videos and documents you add end up.',
      install: ['Install Docker Desktop (free for personal use) and start it.', 'Get the library: git clone https://github.com/your first business-Dan/kingdom-library', 'In that folder run: docker compose up -d', 'Come back and press Check again.'] },
    ytdl: { name: 'YouTube downloader', what: 'Downloads videos and playlists, transcribes them and sends what they teach into the library.',
      install: ['Install Docker Desktop and start it (an NVIDIA graphics card makes transcribing much faster, but it isn\'t required).', 'Get the downloader: git clone https://github.com/your first business-Dan/kingdom-youtube', 'In that folder run: docker compose up -d', 'Come back and press Check again.'] },
    ollama: { name: 'Local model (Ollama)', what: 'A free model on your own computer for quick first drafts, so less of your Claude plan is used.',
      install: ['Install Ollama from ollama.com (free).', 'Get a small model: ollama pull qwen3:4b', 'Come back and press Check again.'] },
  };
  // How to grow the library: shown on the library and downloader tiles once connected, and from Settings.
  const INGEST = [
    ['YouTube videos and playlists', [
      'Open the YouTube downloader at http://localhost:8080 and paste a video or playlist link.',
      'Tick Transcribe and Analyze (and Playlist for a whole playlist). Analyze is what files it in the library: it needs Ollama with a vision model (ollama pull qwen3-vl:8b-instruct). Transcribe alone only keeps the transcript.',
      'Press Download. When it finishes, what the video teaches is filed in the library under What\'s new, with timestamps back to the video.',
      'Or ask an agent here, for example "download and transcribe <link>": it asks first, and runs only when you click Approve on the to-do list.']],
    ['Documents, notes and other knowledge bases', [
      'Put a folder or .zip in the import folder inside your kingdom-library folder: Markdown, text, HTML, CSV, JSON or PDF. Obsidian vaults and Open Knowledge Format bundles work too.',
      'In the library (http://localhost:8090) open Libraries, then Import a library, and give the path /import/<its name>. It arrives unreviewed, in its own section.',
      'One item from a script: POST /api/v1/ingest (described at http://localhost:8090/docs).']],
    ['What happens next', [
      'With Ollama running, the library tidies new material: names, tags, principles and tips. Without it, everything is still searchable.',
      'Your agents read the library when a task needs it and cite what they use. They never write to it: you decide what goes in.']],
  ];
  function ingestGuide() {
    const more = el('div', { hidden: '' }, ...INGEST.map(([h, items]) => el('div', {}, el('div', { class: 'gh' }, h), el('ul', {}, ...items.map((x) => el('li', {}, x))))));
    const card = (icon, title, line, link) => el('div', { class: 'gcard' }, el('div', { class: 'gi', 'aria-hidden': 'true' }, icon),
      el('div', {}, el('b', {}, title), el('div', {}, line), ...(link ? [el('a', { class: 'lnk', href: link[1], target: '_blank', rel: 'noopener' }, link[0] + ' ↗')] : [])));
    const toggle = btn('More detail', (e) => { more.hidden = !more.hidden; e.target.textContent = more.hidden ? 'More detail' : 'Less detail'; });
    return el('div', { class: 'guide' }, el('b', {}, 'How to add knowledge'),
      el('div', { class: 'gcards' },
        card('\u25B6', 'Videos', 'Paste a YouTube link in the downloader. Tick Analyze.', ['Open downloader', 'http://localhost:8080']),
        card('\u{1F4C4}', 'Documents', 'Drop files in the library\'s import folder, then Libraries \u2192 Import.', ['Open library', 'http://localhost:8090']),
        card('\u{1F50E}', 'Agents use it', 'They look things up themselves and say where it came from.', null)),
      el('div', {}, toggle), more);
  }
  const boltons = { state: 'idle', items: {} };
  function checkBoltons() {
    boltons.state = 'checking'; editors.forEach((r) => r());
    return fetch(`${BRAIN_URL}/bolton`).then((r) => r.json()).then((j) => { if (!j.boltons) throw new Error('old helper'); boltons.items = j.boltons; boltons.state = 'ok'; })
      .catch(() => { boltons.state = 'off'; }).finally(() => editors.forEach((r) => r()));
  }
  // Claude itself: the AI helper needs Claude Code signed in on your subscription, and accounts need Claude's connectors.
  const helper = { state: 'idle', plan: '' };
  function checkHelper() {
    return fetch(`${BRAIN_URL}/status`).then((r) => r.json()).then((j) => { helper.state = 'on'; helper.plan = j.plan || ''; })
      .catch(() => { helper.state = 'off'; }).finally(() => editors.forEach((r) => r()));
  }
  const copyBtn = (text) => btn('Copy', (e) => { const b = e.target; (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => { b.textContent = 'Copied'; }).catch(() => { b.textContent = 'Select it'; }); });
  const cmd = (text) => el('div', { class: 'cmd' }, el('code', {}, text), copyBtn(text));
  function claudeCard() {
    if (helper.state === 'on') return el('div', { class: 'cc ok' }, el('b', {}, '✓ Claude is ready.'), ` Agents think on your Claude ${helper.plan ? helper.plan.toUpperCase() + ' ' : ''}subscription. Accounts below connect through Claude's own connectors.`);
    if (helper.state !== 'off') return el('div', { class: 'cc' }, 'Checking for Claude…');
    return el('div', { class: 'cc warn' }, el('b', {}, 'Claude isn\'t connected yet.'),
      el('p', {}, "Agents think with Claude Code on your own Claude subscription (Pro or Max), through the AI helper. Without it they answer from a script. You'll need:"),
      el('ol', {}, el('li', {}, 'A Claude account with Pro or Max, and the Claude app: ', el('a', { href: 'https://claude.ai/download', target: '_blank', rel: 'noopener' }, 'download Claude Desktop'), ' (sign in there).'),
        el('li', {}, 'Claude Code, in PowerShell:', cmd('irm https://claude.ai/install.ps1 | iex'), 'then run claude once and sign in with your Claude account (no API key).'),
        el('li', {}, 'The AI helper, from this folder:', cmd('python helper\\brain.py'))),
      el('div', { class: 'bar' }, el('a', { class: 'lnk', href: 'claude://', title: 'Opens Claude Desktop if it is installed' }, 'Open Claude Desktop'), btn('Check again', () => { checkHelper(); checkClaude(true); checkBoltons(); }, true)));
  }

  function connEditor(list, onChange) {  // list is edited in place; onChange() after every change
    const node = el('div', {}), err = el('div', { class: 'err' });
    const kind = el('select', { 'aria-label': 'Kind of connection' }, el('option', { value: '' }, ''), ...Object.entries(KINDS).map(([v, k]) => el('option', { value: v }, k.label)));
    const name = el('input', { maxlength: 40, placeholder: 'Name (optional)' });
    const env = el('input', { maxlength: 41, placeholder: 'Key variable name, if it needs one (optional)' });
    const auth = el('select', { 'aria-label': 'How the key is sent' }, el('option', { value: 'bearer' }, 'Authorization: Bearer <key>'),
      el('option', { value: 'header' }, 'X-API-Key: <key> header'), el('option', { value: 'query' }, '?api_key=<key> in the address'));
    const help = el('p', { class: 'role' });
    let detail = el('input');
    const fields = el('div', { class: 'form' });
    let choosing = null, openBolton = null, openInfo = null;
    function shape(preset) {
      const k = KINDS[kind.value]; err.textContent = '';
      if (!k) { fields.replaceChildren(); help.textContent = ''; return; }
      detail = k.options ? el('select', { 'aria-label': k.field }, el('option', { value: '' }, `${k.field}…`), ...k.options.map((o) => el('option', { value: o }, o)))
        : el('input', { maxlength: 200, placeholder: k.ph, 'aria-label': k.field });
      if (preset) detail.value = preset;
      help.textContent = k.help;
      fields.replaceChildren(el('div', { class: 'fh' }, el('b', {}, k.label), btn('Cancel', () => { kind.value = ''; shape(); render(); })), help,
        el('label', {}, k.field), detail, el('label', {}, 'Name'), name,
        ...(kind.value === 'api' ? [el('label', {}, 'Key variable'), env, el('label', {}, 'How the key is sent'), auth] : []),
        el('div', { class: 'bar' }, btn('Add', add, true)));
      setTimeout(() => { try { detail.focus(); fields.scrollIntoView({ block: 'nearest' }); } catch (e) { /* */ } }, 0);
    }
    const changed = () => { render(); onChange && onChange(); };
    function push(c) {
      c.name = c.name || (c.kind === 'repo' ? c.detail.split('/').slice(-2).join('/') : c.detail);
      c.id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); c.added = new Date().toISOString();
      c.on = false; c.agents = []; c.free = false; c.drafts = false;
      list.push(c); return c;
    }
    function add() {
      if (list.length >= MAX_CONN) { err.textContent = `That's the most for now (${MAX_CONN}).`; return; }
      const d = clean(detail.value, 200).replace(/\/$/, '');
      const c = { kind: kind.value, detail: d, name: clean(name.value, 40), env: kind.value === 'api' ? clean(env.value, 41) : '', auth: auth.value };
      const bad = checkConn(c); if (bad) { err.textContent = bad; return; }
      if (list.some((x) => x.kind === c.kind && x.detail === c.detail)) { err.textContent = "That's already on the list."; return; }
      push(c); name.value = ''; env.value = ''; kind.value = ''; shape();
      choosing = c.id; render();
      const saved = Promise.resolve(onChange && onChange());
      if (c.kind === 'account') saved.then(() => checkClaude(true), () => checkClaude(true));
    }
    function connectTile(k, d) {  // a tile's Connect: add it if new, then pick who may use it
      err.textContent = '';
      if (k === 'bolton') { openBolton = openBolton === d ? null : d; if (boltons.state === 'idle') checkBoltons(); render(); return; }
      if (k === 'repo' || k === 'local' || k === 'api' || (k === 'account' && d === 'Other')) { kind.value = k; shape(k === 'account' ? 'Other' : ''); render(); return; }
      let c = list.find((x) => x.kind === k && x.detail === d);
      let saved = Promise.resolve();
      if (!c) { if (list.length >= MAX_CONN) { err.textContent = `That's the most for now (${MAX_CONN}).`; render(); return; } c = push({ kind: k, detail: d, name: '', env: '', auth: 'bearer' }); saved = Promise.resolve(onChange && onChange()); }
      choosing = c.id; render();
      if (k === 'account') saved.then(() => checkClaude(true), () => checkClaude(true));
    }
    function infoPanel(k, d) {
      const label = k === 'bolton' ? BOLTON_INFO[d].name : d, [what, can, need, link] = toolInfo(k, d), sug = suggestFor(k, d);
      const row = (icon, head, text) => el('div', { class: 'ir' }, el('span', { class: 'ii', 'aria-hidden': 'true' }, icon), el('div', {}, el('div', { class: 'il' }, head), el('div', {}, text)));
      return el('div', { class: 'ch info' }, el('div', { class: 'fh' }, el('span', { class: 'ih' }, logo(k, d), el('b', {}, label)), btn('Close', () => { openInfo = null; render(); })),
        row('\u{1F4CC}', 'What it is', what), row('\u{1F916}', 'What agents may do', can), row('\u{1F9F0}', 'What you need', need),
        ...(sug.length ? [row('\u2B50', 'Suggested for', sug.map(([key, why]) => `${agentName(key)}, who ${why}`).join('. ') + '.')] : []),
        ...(link ? [el('div', { class: 'bar' }, el('a', { class: 'lnk', href: link[1], target: '_blank', rel: 'noopener' }, link[0] + ' \u2197'))] : []));
    }
    function claudeLine(c) {  // the Claude side of an account: added? signed in? with buttons that do the next step
      if (c.kind !== 'account') return [];
      const it = claude.items[c.id];
      const line = (text, ...b) => el('div', { class: 'cl' }, el('span', {}, text), ...b);
      if (claude.state === 'checking') return [line('Checking your Claude connectors…')];
      if (claude.state === 'off') return [line("The AI helper isn't running, so Kingdom can't check Claude. Start it (see the Claude card above), then:", btn('Check again', () => checkClaude(true)))];
      if (!it) return [line('Not checked with Claude yet.', btn('Check with Claude', () => checkClaude(true)))];
      if (it.status === 'connected') return [line(it.reads ? `✓ Connected in your Claude account (${it.reads} read-only tools).` : 'Connected in Claude, but it has no read-only tools agents may use.')];
      if (it.status === 'missing') return [line(`Not in your Claude account yet. In Claude open Settings → Connectors, add ${c.detail === 'Other' ? c.name : c.detail} and sign in, then come back:`,
        el('a', { class: 'lnk', href: claude.page, target: '_blank', rel: 'noopener' }, 'Add in Claude ↗'), el('a', { class: 'lnk', href: 'claude://', title: 'Opens Claude Desktop if it is installed' }, 'Open Claude Desktop'),
        btn('Check again', () => checkClaude(true)))];
      return [line(`Added in Claude, but Claude Code still needs you to sign in to it (${it.status}).`,
        btn('Sign in…', () => {
          claude.note = 'Opening Claude Code…'; render();
          fetch(`${BRAIN_URL}/connectors/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ server: it.server }) })
            .then((r) => r.json()).then((j) => { claude.note = j.ok ? `A Claude Code window opened. Type /mcp, choose ${it.server}, then Authenticate and finish in the browser. Then press Check again.` : `Couldn't open it: ${j.error}`; })
            .catch(() => { claude.note = "The AI helper isn't running."; }).finally(render);
        }), btn('Check again', () => checkClaude(true)))];
    }
    function chooser(c) {
      const sug = suggestFor(c.kind, c.detail), why = Object.fromEntries(sug);
      const sel = new Set((c.agents || []).length ? c.agents : sug.map((x) => x[0]));
      const free = el('input', { type: 'checkbox' }); free.checked = !!c.free;
      const mail = c.kind === 'account' && ['Gmail', 'Outlook'].includes(c.detail);
      const drafts = el('input', { type: 'checkbox' }); drafts.checked = !!c.drafts;
      const msg = el('div', { class: 'err' }), grid = el('div', { class: 'ags' });
      const all = btn('All agents', () => { if (sel.has('*')) sel.clear(); else { sel.clear(); sel.add('*'); } paint(); });
      function paint() {
        all.className = 'allb' + (sel.has('*') ? ' on' : ''); all.setAttribute('aria-pressed', String(sel.has('*')));
        grid.replaceChildren(...defaults.agents.map((a) => {
          const on = sel.has('*') || sel.has(a.key);
          return el('button', { class: 'ag' + (on ? ' on' : ''), 'aria-pressed': String(on), title: why[a.key] ? `Suggested: ${why[a.key]}` : a.what || '', onclick: (e) => {
            if (!e.isTrusted) return;
            if (sel.has('*')) { sel.clear(); defaults.agents.forEach((x) => sel.add(x.key)); }
            if (sel.has(a.key)) sel.delete(a.key); else sel.add(a.key);
            paint();
          } }, faceSlot(a.key), el('span', { class: 'agn' }, agentName(a.key)), el('span', { class: 'agr' }, a.role), ...(why[a.key] ? [el('span', { class: 'sug' }, '\u2B50 Suggested')] : []));
        }));
      }
      paint();
      return el('div', { class: 'ch' }, el('div', { class: 'fh' }, el('span', { class: 'ih' }, logo(c.kind, c.detail), el('b', {}, `Who may use ${c.name}?`)), all),
        ...(sug.length ? [el('div', { class: 'role' }, '\u2B50 ' + sug.map(([key, w]) => `${agentName(key)} ${w}`).join(' \u00b7 '))] : []), grid,
        ...(c.kind === 'api' ? [el('label', { class: 'ck' }, free, ' This API is free, or on a plan I already pay for (no pay-per-use).')] : []),
        ...(mail ? [el('label', { class: 'ck' }, drafts, ` They may save new drafts in my ${c.detail} drafts folder (never send, change or delete).`)] : []),
        el('div', { class: 'bar' }, btn('Not now', () => { choosing = null; render(); }), btn('Turn on for these', () => {
          const picked = sel.has('*') ? ['*'] : [...sel];
          if (!picked.length) { msg.textContent = 'Pick at least one agent.'; return; }
          if (c.kind === 'api' && !free.checked) { msg.textContent = 'Kingdom One only uses free APIs or ones you already pay for.'; return; }
          Object.assign(c, { on: true, agents: picked, free: c.kind === 'api' ? true : c.free, drafts: mail && drafts.checked });
          choosing = null; changed();
        }, true)), msg);
    }
    function boltonPanel(k) {
      const info = BOLTON_INFO[k], st = boltons.items[k];
      const head = el('div', { class: 'fh' }, el('b', {}, info.name), btn('Close', () => { openBolton = null; render(); }));
      if (boltons.state === 'off') return el('div', { class: 'ch' }, head, el('p', { class: 'role' }, "The AI helper isn't running, or needs restarting to use bolt-ons, so Kingdom can't look for it. Start or restart it (see the Claude card above), then press Check again."), el('div', { class: 'bar' }, btn('Check again', checkBoltons, true)));
      if (!st) return el('div', { class: 'ch' }, head, el('p', { class: 'role' }, 'Looking for it on this computer…'));
      if (st.connected) return el('div', { class: 'ch' }, head, el('p', { class: 'role' }, `✓ Connected. ${info.what}`), ...(k !== 'ollama' ? [ingestGuide()] : []));
      if (st.running) return el('div', { class: 'ch' }, head, el('p', { class: 'role' }, `${info.what} It's running on this computer.`),
        el('div', { class: 'bar' }, btn('Connect it', () => {
          fetch(`${BRAIN_URL}/bolton/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: k }) })
            .then((r) => r.json()).then((j) => { if (j.boltons) boltons.items = j.boltons; else err.textContent = j.error || "Couldn't connect it."; })
            .catch(() => { err.textContent = "The AI helper isn't running."; }).finally(render);
        }, true)));
      return el('div', { class: 'ch' }, head, el('p', { class: 'role' }, `${info.what} It isn't installed or running yet. To install it:`),
        el('ol', { class: 'steps' }, ...info.install.map((x) => { const m = x.match(/^(.*?:\s)(git clone .+|docker compose up -d|ollama pull .+)$/); return el('li', {}, ...(m ? [m[1], cmd(m[2])] : [x])); })),
        el('p', { class: 'role' }, 'Docker Desktop: docker.com/products/docker-desktop. Everything runs on this computer, free.'),
        el('div', { class: 'bar' }, btn('Check again', checkBoltons, true)));
    }
    function tileState(k, d) {
      if (k === 'bolton') { const st = boltons.items[d]; return st ? (st.connected ? ['Connected', 'on'] : st.running ? ['Ready to connect', 'mid'] : ['Not installed', '']) : ['', '']; }
      const c = list.find((x) => x.kind === k && x.detail === d);
      if (!c) return ['', ''];
      if (c.on) return ['On', 'on'];
      if (k === 'account') { const it = claude.items[c.id]; if (it && it.status === 'missing') return ['Add in Claude', 'mid']; }
      return ['Added, off', 'mid'];
    }
    function render() {
      const rows = list.map((c) => {
        const k = KINDS[c.kind];
        const state = c.on ? `On for ${who(c)}${c.drafts ? ' · may save drafts' : ''}` : 'Off';
        const row = el('div', { class: 'cn' + (c.on ? ' on' : '') },
          logo(c.kind, c.detail), el('div', { class: 'cnt' }, el('b', {}, c.name), ` · ${k ? k.label : c.kind}`, el('br'),
            el('span', { class: 'role' }, c.detail + (c.env ? ` · key kept in ${c.env}` : '') + ` · ${state}`), ...claudeLine(c)),
          el('div', { class: 'cnb' }, c.on ? btn('Turn off', () => { c.on = false; changed(); }) : btn('Turn on…', () => { choosing = c.id; render(); }, true),
            btn('Remove', () => { list.splice(list.indexOf(c), 1); if (choosing === c.id) choosing = null; changed(); })));
        return choosing === c.id ? [row, chooser(c)] : [row];
      }).flat();
      const cats = CATALOG.map(([cat, items]) => el('div', { class: 'cat' }, el('div', { class: 'catn' }, cat),
        el('div', { class: 'tiles' }, ...items.map(([k, d, mono]) => {
          const label = k === 'bolton' ? BOLTON_INFO[d].name : d;
          const [st, cls] = tileState(k, d);
          const id = k + ':' + d;
          return el('div', { class: 'tile ' + cls }, el('button', { class: 'ib', title: `What is ${label}?`, 'aria-label': `More about ${label}`, 'aria-expanded': String(openInfo === id),
            onclick: (e) => { if (!e.isTrusted) return; openInfo = openInfo === id ? null : id; render(); } }, 'i'), logo(k, d, mono), el('div', { class: 'tn' }, label),
            el('div', { class: 'ts' }, st || '\u00a0'), btn(st === 'On' || st === 'Connected' ? 'Settings' : 'Connect', () => connectTile(k, d), !(st === 'On' || st === 'Connected')));
        })), ...(openInfo && items.some(([k, d]) => k + ':' + d === openInfo) ? [infoPanel(...openInfo.split(/:(.*)/s).slice(0, 2))] : []),
        ...(cat.startsWith('Knowledge') && openBolton ? [boltonPanel(openBolton)] : [])));
      const here = localTools.length ? [el('p', { class: 'role' }, `Already working on this computer: ${localTools.join(', ')}.`)] : [];
      node.replaceChildren(claudeCard(), ...(rows.length ? [el('label', {}, 'Your connections'), ...rows] : []),
        ...(claude.note ? [el('p', { class: 'role cl' }, claude.note)] : []), ...(kind.value ? [fields] : []), err,
        el('label', {}, 'Connect a tool'), ...cats, ...here);
    }
    editors.add(render);
    render();
    if (helper.state === 'idle') checkHelper();
    if (boltons.state === 'idle') checkBoltons();
    if (list.some((c) => c.kind === 'account') && claude.state === 'idle') checkClaude(false);
    return { node, render };
  }
  function connNote() {
    const more = el('p', { class: 'role', hidden: '' }, CONN_NOTE);
    const chip = (icon, text) => el('span', { class: 'nchip' }, el('span', { 'aria-hidden': 'true' }, icon), text);
    return el('div', { class: 'note' }, el('div', { class: 'nchips' }, chip('\u{1F512}', 'Off until you turn it on'), chip('\u{1F441}', 'Agents only read'),
      chip('\u270B', 'Changes wait for your Approve'), chip('\u270E', 'Social media: drafts only')),
      btn('How it stays safe', (e) => { more.hidden = !more.hidden; e.target.textContent = more.hidden ? 'How it stays safe' : 'Hide'; }), more);
  }
  const CONN_NOTE = "Nothing is used until you turn it on and pick who may use it. Agents only read: accounts through your own Claude connectors (never sending, paying or posting), repositories through their free public APIs, tools on this computer directly, and an API you've said is free or already paid for (30 reads a day). Anything that would change something waits on your to-do list for your Approve click. Social media is drafts only. Tools your agents build appear here once you approve them.";

  // ---------- panels ----------
  const css = `
  .wz { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: rgba(10,12,18,.72); font: 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #f5efe2; }
  .wz-card { width: min(720px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto; background: rgba(18,20,28,.97); border: 1px solid rgba(232,196,106,.5); border-radius: 14px; padding: 22px 24px; box-sizing: border-box; }
  .wz h2 { margin: 0 0 6px; color: #e8c46a; font-size: 20px; }
  .wz p { margin: 0 0 14px; color: #c9c1ae; line-height: 1.45; }
  .wz label { display: block; font-size: 12px; color: #c9c1ae; margin: 10px 0 4px; }
  .wz select { width: 100%; box-sizing: border-box; background: #1b1e28; border: 1px solid rgba(232,196,106,.4); border-radius: 8px; color: #f5efe2; padding: 7px 9px; font: 14px system-ui, sans-serif; }
  .wz .cn { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: rgba(255,255,255,.05); border-radius: 8px; padding: 8px 10px; margin: 6px 0; font-size: 13px; line-height: 1.4; word-break: break-word; }
  .wz .cn .role { padding: 0; }
  .wz .cn.on { border-left: 3px solid #5fc0bd; }
  .wz .cnt { min-width: 0; flex: 1; }
  .wz .cnb { display: flex; flex-direction: column; gap: 4px; }
  .wz .cl { font-size: 12px; color: #e8c46a; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .wz .cl button, .wz .cnb button { padding: 3px 8px; font-size: 12px; }
  .wz .ch { background: rgba(95,192,189,.08); border: 1px solid rgba(95,192,189,.35); border-radius: 8px; padding: 8px 10px; margin: -2px 0 6px; }
  .wz .cks { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; }
  .wz label.ck { display: flex; gap: 6px; align-items: center; margin: 3px 0; font-size: 12.5px; color: #f5efe2; }
  .wz label.ck input { width: auto; }
  .wz .cc { background: rgba(95,192,189,.10); border: 1px solid rgba(95,192,189,.4); border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.45; margin-bottom: 10px; }
  .wz .cc.warn { background: rgba(225,173,1,.10); border-color: rgba(225,173,1,.5); }
  .wz .cc p { margin: 6px 0; color: #c9c1ae; } .wz .cc ol, .wz ol.steps { margin: 6px 0 4px; padding-left: 20px; display: grid; gap: 6px; font-size: 13px; color: #f5efe2; }
  .wz .cmd { display: flex; gap: 6px; align-items: center; margin-top: 4px; } .wz .cmd code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; background: rgba(0,0,0,.35); border: 1px solid rgba(232,196,106,.25); border-radius: 6px; padding: 4px 8px; font: 12px ui-monospace, Consolas, monospace; color: #f5efe2; }
  .wz .cmd button { padding: 3px 8px; font-size: 12px; }
  .wz a.lnk { font: 600 12px system-ui, sans-serif; color: #f5efe2; background: rgba(255,255,255,.08); border: 1px solid rgba(232,196,106,.3); border-radius: 8px; padding: 3px 8px; text-decoration: none; }
  .wz .cat { margin: 8px 0 4px; } .wz .catn { font: 600 11px system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #e8c46a; margin-bottom: 6px; }
  .wz .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
  .wz .tile { background: rgba(255,255,255,.05); border: 1px solid rgba(232,196,106,.22); border-radius: 10px; padding: 8px; display: grid; gap: 4px; justify-items: center; text-align: center; aspect-ratio: 1 / 1.05; align-content: center; }
  .wz .tile.on { border-color: #5fc0bd; background: rgba(95,192,189,.10); } .wz .tile.mid { border-color: rgba(225,173,1,.6); }
  .wz .mono { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #2b8a8a; color: #fbf6ec; font: 700 13px system-ui, sans-serif; }
  .wz .tile.on .mono { background: #3f7d5a; } .wz .tn { font: 600 12px/1.2 system-ui, sans-serif; } .wz .ts { font-size: 10.5px; color: #c9c1ae; min-height: 1.2em; }
  .wz .tile button { padding: 3px 8px; font-size: 11.5px; }
  .wz .fh { display: flex; justify-content: space-between; align-items: center; gap: 8px; } .wz .fh button { padding: 3px 8px; font-size: 12px; }
  .coach { position: fixed; z-index: 58; width: min(440px, calc(100vw - 32px)); box-sizing: border-box; display: grid; gap: 10px; background: rgba(18,20,28,.97);
    border: 2px solid #e8c46a; border-radius: 16px; padding: 14px 16px; color: #f5efe2; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 10px 36px rgba(0,0,0,.55); transition: left .25s, top .25s; }
  .coach .chead { display: flex; gap: 10px; align-items: center; } .coach .ctitle { font: 700 17px system-ui, sans-serif; color: #e8c46a; } .coach .cname { font-size: 12px; color: #c9c1ae; }
  .coach .face { flex: none; width: 34px; height: 34px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: #2b8a8a; border: 2px solid rgba(232,196,106,.7); font: 700 14px system-ui, sans-serif; color: #fbf6ec; box-sizing: border-box; }
  .coach .face.big { width: 48px; height: 48px; } .coach .face img { width: 100%; height: 100%; object-fit: cover; }
  .coach .cdots { display: flex; gap: 4px; } .coach .cdots span { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,.12); } .coach .cdots span.done { background: rgba(232,196,106,.55); } .coach .cdots span.on { background: #e1ad01; }
  .coach .chint { font: 600 13.5px system-ui, sans-serif; color: #e1ad01; }
  .coach .cbar { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
  .coach button { font: 600 13px system-ui, sans-serif; color: #f5efe2; background: rgba(255,255,255,.08); border: 1px solid rgba(232,196,106,.3); border-radius: 8px; padding: 7px 12px; cursor: pointer; }
  .coach button.go { background: #2b8a8a; border-color: #5fc0bd; } .coach button.quiet { margin-right: auto; background: none; border-color: transparent; color: #c9c1ae; }
  .coach .cv { display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; background: rgba(255,255,255,.05); border-radius: 12px; padding: 12px; }
  .coach .cv.col { flex-direction: column; align-items: stretch; gap: 8px; }
  .coach .kc { display: inline-grid; place-items: center; min-width: 34px; height: 34px; padding: 0 8px; box-sizing: border-box; border-radius: 7px; font: 700 14px system-ui, sans-serif; color: #1b1406;
    background: linear-gradient(#fbf6ec, #e2d6bd); border: 1px solid #b9a77f; box-shadow: 0 3px 0 #8f7d57; }
  .coach .kc.wide { min-width: 70px; } .coach .kgrid { display: grid; grid-template-columns: repeat(3, 34px); gap: 5px; }
  .coach .kor { color: #c9c1ae; font-size: 13px; } .coach .kcol { display: grid; justify-items: center; gap: 5px; text-align: center; } .coach .cap { font-size: 11.5px; color: #c9c1ae; max-width: 110px; }
  .coach .kcol b { font-size: 12.5px; } .coach .tag { font: 700 10px system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #e8c46a; writing-mode: vertical-rl; transform: rotate(180deg); }
  .coach .srow { display: flex; gap: 10px; align-items: center; font-size: 14px; } .coach .ico { font-size: 18px; width: 22px; text-align: center; }
  .coach .st { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font: 700 12px system-ui, sans-serif; box-sizing: border-box; }
  .coach .st.you { background: #e1ad01; color: #1b1406; border: 1.5px solid #fbf6ec; } .coach .st.free { background: rgba(18,20,28,.6); color: #fbf6ec; font-size: 8px; border: 1px solid rgba(255,255,255,.25); }
  .coach .st.busy { background: #2b8a8a; position: relative; } .coach .st.busy::after { content: ''; width: 11px; height: 11px; border-radius: 50%; border: 2px solid #fbf6ec; border-right-color: transparent; animation: coachspin 1s linear infinite; box-sizing: border-box; }
  @keyframes coachspin { to { transform: rotate(360deg); } }
  .coach .tprev { gap: 6px; } .coach .tin { display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,.3); border: 1px solid #4b5a5c; border-radius: 8px; padding: 6px 8px; color: #8d8778; font-size: 13px; }
  .coach .trow { display: flex; gap: 8px; align-items: center; background: rgba(0,0,0,.2); border-radius: 8px; padding: 6px 8px; font-size: 13px; } .coach .tt { flex: 1; min-width: 0; display: grid; gap: 3px; justify-items: start; }
  .coach .pill { font: 600 10.5px system-ui, sans-serif; border-radius: 999px; padding: 1px 7px; } .coach .pill.busy { background: rgba(124,196,192,.2); color: #7cc4c0; } .coach .pill.you { background: rgba(232,196,106,.2); color: #e8c46a; } .coach .pill.free { background: rgba(255,255,255,.08); color: #c9c1ae; }
  .coach .fake { font: 600 11.5px system-ui, sans-serif; background: #2b8a8a; color: #fff; border-radius: 6px; padding: 3px 8px; }
  .coach-spot { position: fixed; z-index: 57; border-radius: 12px; pointer-events: none; outline: 3px solid #e1ad01; box-shadow: 0 0 0 9999px rgba(8,10,16,.5); animation: coachpulse 1.4s ease-in-out infinite; transition: all .25s; }
  .coach-dim { position: fixed; inset: 0; z-index: 56; background: rgba(8,10,16,.5); pointer-events: none; }
  @keyframes coachpulse { 50% { outline-color: rgba(225,173,1,.35); } }
  @media (prefers-reduced-motion: reduce) { .coach-spot, .coach .st.busy::after { animation: none; } .coach, .coach-spot { transition: none; } }
  .wz .guide { background: rgba(255,255,255,.04); border: 1px solid rgba(232,196,106,.3); border-radius: 10px; padding: 10px 12px; margin: 8px 0; display: grid; gap: 8px; font-size: 13px; }
  .wz .guide .gh { font-weight: 600; color: #e8c46a; } .wz .guide ul { margin: 4px 0 0; padding-left: 18px; display: grid; gap: 4px; color: #e9e2d2; }
  .wz .mono img { width: 18px; height: 18px; filter: brightness(0) invert(1); } .wz .mono.ico svg { width: 18px; height: 18px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .wz .tile { position: relative; } .wz .tile .ib { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; padding: 0; border-radius: 50%; font: italic 700 11px Georgia, serif; line-height: 18px; }
  .wz .cn > .mono { flex: none; }
  .wz .ch.info { display: grid; gap: 8px; margin: 8px 0; } .wz .ih { display: flex; gap: 8px; align-items: center; }
  .wz .ir { display: grid; grid-template-columns: 26px 1fr; gap: 8px; font-size: 13px; line-height: 1.4; } .wz .ii { font-size: 17px; text-align: center; } .wz .il { font: 600 11px system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #e8c46a; }
  .wz .face { flex: none; width: 34px; height: 34px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: #2b8a8a; border: 2px solid rgba(232,196,106,.7); font: 700 14px system-ui, sans-serif; color: #fbf6ec; box-sizing: border-box; }
  .wz .face.big { width: 56px; height: 56px; font-size: 20px; } .wz .face img { width: 100%; height: 100%; object-fit: cover; }
  .wz .swatches { display: flex; gap: 8px; margin: 10px 0 4px; } .wz button.sw { width: 30px; height: 30px; border-radius: 50%; padding: 0; border: 3px solid transparent; } .wz button.sw.on { border-color: #fbf6ec; box-shadow: 0 0 0 2px #e8c46a; }
  .wz button.lk img { width: 110px; height: 90px; object-fit: contain; } .wz .bsum { display: flex; gap: 16px; align-items: center; margin: 8px 0; } .wz .bsum p { margin: 4px 0; }
  .wz .ags { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; margin: 8px 0; }
  .wz button.ag { display: grid; justify-items: center; gap: 2px; padding: 8px 6px; text-align: center; background: rgba(255,255,255,.04); border-color: rgba(232,196,106,.2); opacity: .72; }
  .wz button.ag.on { opacity: 1; background: rgba(95,192,189,.16); border-color: #5fc0bd; } .wz button.ag.on .face { border-color: #5fc0bd; }
  .wz .agn { font-size: 12.5px; } .wz .agr { font: 400 10.5px/1.25 system-ui, sans-serif; color: #c9c1ae; } .wz .sug { font: 600 10px system-ui, sans-serif; color: #e1ad01; }
  .wz button.allb.on { background: #2b8a8a; border-color: #5fc0bd; }
  .wz .team { display: grid; gap: 6px; } .wz .grp { margin-top: 10px; } .wz .grp .role { padding: 0 0 4px; }
  .wz .agcards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
  .wz .agc { display: flex; gap: 10px; align-items: flex-start; background: rgba(255,255,255,.05); border: 1px solid rgba(232,196,106,.22); border-radius: 10px; padding: 10px; }
  .wz .agt { min-width: 0; flex: 1; display: grid; gap: 3px; } .wz .agr2 { font: 600 13px system-ui, sans-serif; color: #e8c46a; } .wz .agw { font-size: 12px; line-height: 1.35; color: #e9e2d2; }
  .wz .agb { font-size: 11px; color: #c9c1ae; } .wz .agc input { padding: 5px 8px; font-size: 13px; margin-top: 4px; }
  .wz .gcards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
  .wz .gcard { display: flex; gap: 8px; background: rgba(255,255,255,.05); border-radius: 10px; padding: 10px; font-size: 12.5px; line-height: 1.4; } .wz .gcard .lnk { display: inline-block; margin-top: 6px; }
  .wz .gi { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: rgba(232,196,106,.18); font-size: 15px; }
  .wz .note { display: grid; gap: 6px; justify-items: start; margin: 10px 0; } .wz .nchips { display: flex; flex-wrap: wrap; gap: 6px; }
  .wz .nchip { display: inline-flex; gap: 6px; align-items: center; background: rgba(95,192,189,.10); border: 1px solid rgba(95,192,189,.35); border-radius: 999px; padding: 4px 10px; font-size: 12px; }
  .wz .note button { padding: 3px 8px; font-size: 12px; }
  .wz .sec { background: rgba(255,255,255,.05); border: 1px solid rgba(232,196,106,.22); border-radius: 12px; padding: 10px 12px; margin: 10px 0; display: grid; gap: 6px; }
  .wz .sec .fh button { padding: 3px 10px; font-size: 12px; } .wz .kv { display: flex; gap: 12px; font-size: 13.5px; } .wz .kv span { width: 70px; color: #c9c1ae; }
  .wz .chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
  .wz .chip { display: flex; gap: 8px; align-items: center; background: rgba(0,0,0,.2); border-radius: 10px; padding: 6px 8px; font-size: 12.5px; min-width: 0; }
  .wz .chip > div:last-child { min-width: 0; } .wz .chip.new { outline: 1px solid #e1ad01; } .wz .chip.on { outline: 1px solid #5fc0bd; }
  .wz .form { background: rgba(255,255,255,.04); border: 1px solid rgba(232,196,106,.3); border-radius: 10px; padding: 10px 12px; margin: 8px 0; }
  .wz input { width: 100%; box-sizing: border-box; background: rgba(0,0,0,.35); border: 1px solid rgba(232,196,106,.4); border-radius: 8px; color: #f5efe2; padding: 7px 9px; font: 14px system-ui, sans-serif; }
  .wz .row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; align-items: end; }
  .wz .role { font-size: 11.5px; color: #c9c1ae; padding-bottom: 8px; }
  .wz .bar { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; flex-wrap: wrap; }
  .wz button { font: 600 13px system-ui, sans-serif; color: #f5efe2; background: rgba(255,255,255,.08); border: 1px solid rgba(232,196,106,.3); border-radius: 8px; padding: 7px 12px; cursor: pointer; }
  .wz button.go { background: #2b8a8a; border-color: #5fc0bd; }
  .wz .err { color: #e08a72; font-size: 12.5px; margin-top: 10px; min-height: 1em; }
  .wz .sum { background: rgba(255,255,255,.05); border-radius: 8px; padding: 10px 12px; font-size: 13px; line-height: 1.5; }
  .wz .dots { font-size: 11px; color: #c9c1ae; margin-bottom: 8px; letter-spacing: .08em; }
  @media (max-width: 520px) { .wz .row { grid-template-columns: 1fr; } .wz .role { padding-bottom: 0; } }`;
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); } for (const k of kids) e.append(k); return e; };

  function form(rec) {  // the fields, shared by setup and Settings → Personalisation
    const world = el('input', { maxlength: LIMIT.world, placeholder: defaults.world, autocomplete: 'off' }); world.value = rec.worldName || '';
    const owner = el('input', { maxlength: LIMIT.owner, placeholder: 'Optional', autocomplete: 'off' }); owner.value = rec.ownerName || '';
    const agents = {};
    const grid = el('div', { class: 'team' });
    const GROUPS = [['Your chief of staff', 'Takes your orders and hands them to the right director.', (a) => a.key === 'vizier'],
      ['Directors', 'Each runs one area of your work or life.', (a) => a.key !== 'vizier' && !a.boss],
      ['Workers', 'Taken on when a director needs an extra pair of hands. Their director gives them every task and checks the work.', (a) => !!a.boss]];
    for (const [head, sub, test] of GROUPS) {
      const list = defaults.agents.filter(test); if (!list.length) continue;
      const g = el('div', { class: 'agcards' });
      for (const a of list) {
        const i = el('input', { maxlength: LIMIT.agent, placeholder: a.name, 'aria-label': `Name for the ${a.role}` }); i.value = (rec.agents || {})[a.key] || '';
        agents[a.key] = i;
        const boss = a.boss && defaults.agents.find((x) => x.key === a.boss);
        g.append(el('div', { class: 'agc' }, faceSlot(a.key, true), el('div', { class: 'agt' }, el('div', { class: 'agr2' }, a.role),
          ...(a.what ? [el('div', { class: 'agw' }, a.what)] : []), ...(boss ? [el('div', { class: 'agb' }, `Works for the ${boss.role}`)] : []), i)));
      }
      grid.append(el('div', { class: 'grp' }, el('div', { class: 'catn' }, head), el('div', { class: 'role' }, sub)), g);
    }
    const read = () => ({ worldName: clean(world.value, LIMIT.world), ownerName: clean(owner.value, LIMIT.owner),
      agents: Object.fromEntries(Object.entries(agents).map(([k, i]) => [k, clean(i.value, LIMIT.agent)]).filter(([, v]) => v)) });
    return { world, owner, grid, read };
  }
  function summary(r, go) {
    const sec = (title, step, ...kids) => el('div', { class: 'sec' }, el('div', { class: 'fh' }, el('div', { class: 'catn' }, title), ...(go ? [btn('Edit', () => go(step))] : [])), ...kids);
    const kv = (k, v) => el('div', { class: 'kv' }, el('span', {}, k), el('b', {}, v));
    const team = el('div', { class: 'chips' }, ...defaults.agents.map((a) => el('div', { class: 'chip' + (r.agents[a.key] ? ' new' : '') }, faceSlot(a.key),
      el('div', {}, el('b', {}, r.agents[a.key] || a.name), el('div', { class: 'agr' }, a.role)))));
    const conns = r.connections || [], bolts = Object.entries(boltons.items || {}).filter(([, v]) => v.connected);
    const tools = conns.length || bolts.length ? el('div', { class: 'chips' },
      ...bolts.map(([k]) => el('div', { class: 'chip on' }, logo('bolton', k), el('div', {}, el('b', {}, BOLTON_INFO[k] ? BOLTON_INFO[k].name : k), el('div', { class: 'agr' }, 'Connected')))),
      ...conns.map((c) => el('div', { class: 'chip' + (c.on ? ' on' : '') }, logo(c.kind, c.detail), el('div', {}, el('b', {}, c.name), el('div', { class: 'agr' }, c.on ? `On for ${who(c)}` : 'Added, off')))))
      : el('p', { class: 'role' }, 'None yet. Add them any time in Settings.');
    return el('div', {}, sec('Your world', 1, kv('Name', r.worldName || defaults.world), kv('You', r.ownerName || 'Not set'), kv('Theme', 'Moroccan oasis')),
      sec('Your team', 2, team), sec('Your tools', 3, tools));
  }

  function wizard(onDone) {
    const box = el('div', { class: 'wz', role: 'dialog', 'aria-modal': 'true' }), card = el('div', { class: 'wz-card' }); box.append(card);
    const draft = { worldName: '', ownerName: '', agents: {}, connections: [], ...((settings && settings.draft) || {}) };
    if (!Array.isArray(draft.connections)) draft.connections = [];
    let step = Math.min(Math.max((settings && settings.draft && settings.draft.step) || 0, 0), 5);
    const ce = connEditor(draft.connections, () => keepDraft());
    const f = form(draft);
    const err = el('div', { class: 'err' });
    function keepDraft() { Object.assign(draft, f.read(), { step }); return save({ ...(settings || {}), setupDone: false, draft }).catch(() => {}); }
    const finish = (rec) => {
      err.textContent = 'Saving…';
      save({ setupDone: true, worldName: rec.worldName, ownerName: rec.ownerName, agents: rec.agents, connections: rec.connections || [], tourDone: false, draft: null })
        .then(() => { box.remove(); onDone(); })
        .catch((e) => { err.textContent = `Couldn't save (${e.message}). Nothing was created twice: try again.`; });
    };
    const nav = (back, next, nextLabel = 'Next') => el('div', { class: 'bar' },
      ...(back ? [el('button', { onclick: () => { keepDraft(); step--; show(); } }, 'Back')] : []),
      el('button', { class: 'go', onclick: next }, nextLabel));
    function show() {
      const dots = el('div', { class: 'dots' }, `STEP ${step + 1} OF 6`);
      const views = [
        () => [el('h2', {}, `Welcome to ${defaults.world}.`), el('p', {}, 'Set up a world for your personal life, work and projects. You can change these settings later, in Settings.'),
          el('div', { class: 'bar' }, el('button', { onclick: () => finish({ worldName: '', ownerName: '', agents: {} }) }, 'Use defaults'),
            el('button', { class: 'go', onclick: () => { step = 1; keepDraft(); show(); } }, 'Set up my world'))],
        () => [el('h2', {}, 'What would you like to call your world?'), el('p', {}, 'It shows on the map, the signs and the help. Leave it blank to keep the default.'),
          el('label', {}, 'World name'), f.world, el('label', {}, 'Your name (optional)'), f.owner, nav(true, () => { step = 2; keepDraft(); show(); })],
        () => [el('h2', {}, 'Meet your team.'), el('p', {}, 'Give anyone a new name, or keep theirs. Only the name changes.'),
          f.grid, nav(true, () => { step = 3; keepDraft(); show(); })],
        () => [el('h2', {}, 'Connect your tools.'), el('p', {}, 'Optional. Press Connect on a tool, or i to see what it does. You can change this later in Settings.'),
          ce.node, connNote(), nav(true, () => { step = 4; keepDraft(); show(); })],
        () => [el('h2', {}, 'Make it yours.'), el('p', {}, "Houses and workshops are signed with their owner's name, so they follow the names you chose. The doors still lead to the same places."),
          el('div', { class: 'sum' }, 'Theme: Moroccan oasis. More themes will come later in Settings → Appearance.'), nav(true, () => { step = 5; keepDraft(); show(); })],
        () => [el('h2', {}, `Welcome to ${f.read().worldName || defaults.world}`), el('p', {}, 'Confirm your preferences. You can change any of them later in Settings.'),
          summary({ ...f.read(), connections: draft.connections }, (n) => { keepDraft(); step = n; show(); }),
          nav(true, () => finish({ ...f.read(), connections: draft.connections }), 'Enter my world')],
      ];
      if (step === 3) ce.render();
      card.replaceChildren(dots, ...views[step](), err);
      const first = card.querySelector('input'); if (first) setTimeout(() => first.focus(), 0);
    }
    for (const type of ['keydown', 'keyup']) box.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(box); show();
  }


  // ---------- build on an empty plot (feedback round 2) ----------
  // Four short steps, all pictures and taps: how it looks (only the look), its name, who works there, and
  // which of your connected tools it uses. Saved in settings.buildings; the town is rebuilt on reload.
  function buildMenu(o) {
    const box = el('div', { class: 'wz', role: 'dialog', 'aria-modal': 'true' }), card = el('div', { class: 'wz-card' }); box.append(card);
    const old = o.existing || null;
    const rec = { id: old ? old.id : 'b' + Date.now().toString(36), plot: o.plot, look: old ? old.look : o.looks[0].id, colour: old ? old.colour : o.colours[0],
      name: old ? old.name : '', purpose: old ? old.purpose || '' : '', agents: old ? [...old.agents] : [], tools: old ? [...old.tools] : [] };
    const conns = ((settings && settings.connections) || []);
    const err = el('div', { class: 'err' });
    let step = 0;
    const close = () => box.remove();
    const nav = (back, next, label = 'Next') => el('div', { class: 'bar' },
      back ? btn('Back', () => { step--; show(); }) : btn('Cancel', close),
      ...(old && step === 0 ? [btn('Remove this building', () => {
        if (!confirm(`Remove ${old.name}? The plot goes back to empty. Nobody's work is deleted.`)) return;
        err.textContent = 'Saving…';
        save({ ...(settings || {}), buildings: ((settings && settings.buildings) || []).filter((b) => b.id !== old.id) })
          .then(() => { err.textContent = 'Removed. Rebuilding your town…'; setTimeout(() => location.reload(), 500); })
          .catch((e) => { err.textContent = `Couldn't save (${e.message}). Try again.`; });
      })] : []),
      btn(label, next, true));
    const lookTile = (lk) => el('button', { class: 'ag lk' + (rec.look === lk.id ? ' on' : ''), 'aria-pressed': String(rec.look === lk.id), onclick: (e) => { if (!e.isTrusted) return; rec.look = lk.id; show(); } },
      el('img', { src: lk.src(rec.colour), alt: '', width: '110', height: '90' }), el('span', { class: 'agn' }, lk.label));
    function show() {
      const dots = el('div', { class: 'dots' }, `STEP ${step + 1} OF 5`);
      const views = [
        () => [el('h2', {}, old ? `Change ${old.name}` : 'Build here'), el('p', {}, 'Pick a look and a colour. It only changes how the building looks.'),
          el('div', { class: 'ags' }, ...o.looks.map(lookTile)),
          el('div', { class: 'swatches' }, ...o.colours.map((c) => el('button', { class: 'sw' + (rec.colour === c ? ' on' : ''), title: 'Colour', 'aria-label': 'Colour ' + c, style: `background:${c}`, onclick: (e) => { if (!e.isTrusted) return; rec.colour = c; show(); } }))),
          nav(false, () => { step = 1; show(); })],
        () => {
          const n = el('input', { maxlength: '40', autocomplete: 'off', placeholder: 'For example: your first business office' }); n.value = rec.name;
          const pu = el('input', { maxlength: '80', autocomplete: 'off', placeholder: 'One line, optional' }); pu.value = rec.purpose;
          const read = () => { rec.name = clean(n.value, 40); rec.purpose = clean(pu.value, 80); };
          return [el('h2', {}, 'What is it called?'), el('p', {}, 'The name of the building, or the project that works there. It goes on its sign and the map.'),
            el('label', {}, 'Name'), n, el('label', {}, 'What happens here'), pu,
            nav(true, () => { read(); if (!rec.name) { err.textContent = 'Give it a name first.'; return; } err.textContent = ''; step = 2; show(); })];
        },
        () => {
          const grid = el('div', { class: 'ags' }, ...defaults.agents.map((a) => {
            const on = rec.agents.includes(a.key);
            return el('button', { class: 'ag' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: (e) => {
              if (!e.isTrusted) return; rec.agents = on ? rec.agents.filter((k) => k !== a.key) : [...rec.agents, a.key]; show();
            } }, faceSlot(a.key), el('span', { class: 'agn' }, agentName(a.key)), el('span', { class: 'agr' }, a.role));
          }));
          return [el('h2', {}, 'Who works here?'), el('p', {}, 'Tap the people who should work in this building. They keep their own house too, and drop by here.'), grid,
            nav(true, () => { step = 3; show(); })];
        },
        () => {
          const tiles = conns.map((c) => {
            const on = rec.tools.includes(c.id);
            return el('button', { class: 'ag' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: (e) => {
              if (!e.isTrusted) return; rec.tools = on ? rec.tools.filter((k) => k !== c.id) : [...rec.tools, c.id]; show();
            } }, logo(c.kind, c.detail), el('span', { class: 'agn' }, c.name), el('span', { class: 'agr' }, c.on ? 'On' : 'Off for now'));
          });
          return [el('h2', {}, 'Which tools does it use?'), el('p', {}, tiles.length ? 'Tap the tools this building works with. This only records it: who may use a tool is still set in Settings → Connections.' : 'No tools are connected yet. You can connect them later in Settings → Connections, then come back here.'),
            ...(tiles.length ? [el('div', { class: 'ags' }, ...tiles)] : []), nav(true, () => { step = 4; show(); })];
        },
        () => {
          const lk = o.looks.find((x) => x.id === rec.look) || o.looks[0];
          const people = rec.agents.map(agentName).join(', ') || 'Nobody yet';
          const tools = rec.tools.map((id) => (conns.find((c) => c.id === id) || {}).name).filter(Boolean).join(', ') || 'None yet';
          return [el('h2', {}, `Build ${rec.name}?`), el('div', { class: 'bsum' }, el('img', { src: lk.src(rec.colour), alt: '', width: '150', height: '122' }),
            el('div', {}, el('b', {}, rec.name), el('p', { class: 'role' }, rec.purpose || lk.label), el('p', {}, `\u{1F465} ${people}`), el('p', {}, `\u{1F9F0} ${tools}`))),
            nav(true, () => {
              err.textContent = 'Building…';
              const list = ((settings && settings.buildings) || []).filter((b) => b.id !== rec.id && b.plot !== rec.plot);
              save({ ...(settings || {}), buildings: [...list, { ...rec, added: (old && old.added) || new Date().toISOString() }] })
                .then(() => { err.textContent = 'Built. Your town is being rebuilt…'; setTimeout(() => location.reload(), 600); })
                .catch((e) => { err.textContent = `Couldn't save (${e.message}). Try again.`; });
            }, old ? 'Save changes' : 'Build it')];
        },
      ];
      card.replaceChildren(dots, ...views[step](), err);
      const first = card.querySelector('input'); if (first) setTimeout(() => first.focus(), 0);
    }
    for (const type of ['keydown', 'keyup']) box.addEventListener(type, (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    document.body.append(box); show();
  }

  function personalisation() {
    const box = el('div', { class: 'wz', role: 'dialog', 'aria-modal': 'true' }), card = el('div', { class: 'wz-card' }); box.append(card);
    const f = form(settings || {}), err = el('div', { class: 'err' });
    const done = (rec, msg) => { err.textContent = 'Saving…'; save({ ...(settings || {}), ...rec, setupDone: true, draft: null }).then(() => { err.textContent = msg; setTimeout(() => location.reload(), 600); }).catch((e) => { err.textContent = `Couldn't save (${e.message}). Try again.`; }); };
    card.append(el('h2', {}, 'Settings → Personalisation'), el('p', {}, 'Names shown in your world. IDs, roles, instructions, permissions and tasks stay the same.'),
      el('label', {}, 'World name'), f.world, el('label', {}, 'Your name (optional)'), f.owner, el('label', {}, 'Agents'), f.grid,
      el('div', { class: 'bar' },
        el('button', { onclick: () => { if (confirm('Restore the default world and agent names? Only the display names change.')) done({ worldName: '', ownerName: '', agents: {} }, 'Defaults restored. Reloading…'); } }, 'Restore display defaults'),
        el('button', { onclick: () => { box.remove(); connectionsPanel(); } }, 'Connections…'),
        el('button', { onclick: () => { box.remove(); tour(true); } }, 'Show me around'),
        el('button', { onclick: () => box.remove() }, 'Cancel'),
        el('button', { class: 'go', onclick: () => done(f.read(), 'Saved. Reloading your world…') }, 'Save')), err);
    for (const type of ['keydown', 'keyup']) box.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(box);
  }

  function connectionsPanel() {
    const box = el('div', { class: 'wz', role: 'dialog', 'aria-modal': 'true' }), card = el('div', { class: 'wz-card' }); box.append(card);
    const list = ((settings && settings.connections) || []).map((c) => ({ ...c }));
    const msg = el('div', { class: 'err' });
    const ce = connEditor(list, () => { msg.textContent = 'Saving…'; return save({ ...(settings || {}), connections: list }).then(() => { msg.textContent = 'Saved.'; }).catch((e) => { msg.textContent = `Couldn't save (${e.message}). Try again.`; }); });
    const guideBox = el('div', {});
    card.append(el('h2', {}, 'Settings → Connections'), el('p', {}, 'Tools, projects and accounts your agents could work with.'), ce.node, connNote(), msg, guideBox,
      el('div', { class: 'bar' }, el('button', { onclick: () => { if (guideBox.childElementCount) guideBox.replaceChildren(); else guideBox.replaceChildren(ingestGuide()); } }, 'How to add knowledge'),
        el('button', { onclick: () => { box.remove(); personalisation(); } }, 'Personalisation…'), el('button', { class: 'go', onclick: () => box.remove() }, 'Done')));
    for (const type of ['keydown', 'keyup']) box.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(box);
  }

  // The in-game guide: the chief of staff shows you around, one step at a time. The box sits beside whatever it
  // is showing (that part of the screen is lit up and the rest dimmed), with a picture of the keys or a preview.
  // Practice steps move on by themselves once you've tried the thing; Back and Next step work on every step.
  function tour(force) {
    if (!force && (!settings || settings.tourDone)) return;
    if (document.querySelector('.coach')) return;
    const chief = defaults.agents[0], cname = agentName(chief.key), world = worldName();
    const MOVE = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
    const kc = (k, cls) => el('span', { class: 'kc' + (cls ? ' ' + cls : '') }, k);
    const cap = (...kids) => el('div', { class: 'cap' }, ...kids);
    const named = (key) => defaults.agents.find((a) => a.key === key);
    const visual = {
      walk: () => el('div', { class: 'cv' }, el('div', { class: 'kgrid' }, el('span'), kc('W'), el('span'), kc('A'), kc('S'), kc('D')), el('div', { class: 'kor' }, 'or'),
        el('div', { class: 'kgrid' }, el('span'), kc('\u2191'), el('span'), kc('\u2190'), kc('\u2193'), kc('\u2192')), el('div', { class: 'kor' }, '+'), el('div', { class: 'kcol' }, kc('Shift', 'wide'), cap('to run'))),
      map: () => el('div', { class: 'cv' }, el('div', { class: 'kcol' }, kc('M'), cap('big map')), el('div', { class: 'kor' }, '\u2192'), el('div', { class: 'kcol' }, kc('M'), cap('small again'))),
      talk: () => el('div', { class: 'cv' }, el('div', { class: 'kcol' }, el('span', { class: 'kc wide' }, '\u{1F5B1} Click'), cap('anyone')), el('div', { class: 'kor' }, 'or'), el('div', { class: 'kcol' }, kc('T'), cap('when next to them'))),
      status: () => el('div', { class: 'cv col' }, ...[['busy', 'Busy working'], ['you', 'Waiting for you to reply or approve'], ['free', 'Free, waiting for work']].map(([k, t]) => el('div', { class: 'srow' }, el('span', { class: 'st ' + k }, k === 'you' ? '!' : k === 'free' ? '\u2022\u2022\u2022' : ''), t))),
      team: () => {
        const crew = (a) => defaults.agents.filter((w) => w.boss === a.key).length;
        const d = defaults.agents.filter((a) => a.key !== chief.key && !a.boss && crew(a)).sort((a, b) => crew(b) - crew(a))[0];
        if (!d) return el('div');
        const ws = defaults.agents.filter((w) => w.boss === d.key).slice(0, 3);
        const who = (a, big) => el('div', { class: 'kcol' }, faceSlot(a.key, big), el('b', {}, agentName(a.key)), cap(a.role));
        return el('div', { class: 'cv' }, el('div', { class: 'tag' }, 'Director'), who(d, true), el('div', { class: 'kor' }, '\u2192'), el('div', { class: 'tag' }, 'Workers'), ...ws.map((w) => who(w)));
      },
      todo: () => {
        const row = (text, key, st, label, approve) => el('div', { class: 'trow' }, faceSlot(key), el('div', { class: 'tt' }, el('div', {}, text), el('span', { class: 'pill ' + st }, label)),
          ...(approve ? [el('span', { class: 'fake' }, 'Approve')] : []));
        const k = (key) => (named(key) ? key : chief.key);
        return el('div', { class: 'cv col tprev' }, el('div', { class: 'tin' }, 'Add a task\u2026', el('span', { class: 'fake' }, 'Add')),
          row('Draft a quote for the new client', k('merchant'), 'busy', 'Working on it'), row("Summarise this week's emails", k('inbox'), 'you', 'Ready for your OK', true),
          row('Book the car service', k('steward'), 'free', 'Waiting'));
      },
      meeting: () => el('div', { class: 'cv' }, el('div', { class: 'kcol' }, kc('2'), cap('or')), el('div', { class: 'kcol' }, kc('C'), cap('start or end'))),
      extras: () => el('div', { class: 'cv col' }, ...[['N', '\u{1F319}', 'Day or night'], ['Q', '\u{1F50A}', 'Sound on or off'], ['H', '\u2753', 'Help, any time']].map(([k, i, t]) => el('div', { class: 'srow' }, kc(k), el('span', { class: 'ico' }, i), t))),
    };
    const steps = [
      { say: `Welcome to ${world}! I'm ${cname}, your chief of staff. Let me show you around. It takes about a minute.`, center: true },
      { say: 'Walk with W A S D or the arrow keys. Hold Shift to run. Try it now.', visual: 'walk', keys: MOVE, need: 8, hint: 'Walk a few steps', top: true },
      { say: 'This is your map. You are the "Me" pin. Press M to make it big, then M again to make it small.', visual: 'map', target: () => window.__mapRect && window.__mapRect(), keys: ['KeyM'], need: 2, hint: 'Press M twice' },
      { say: 'To talk to someone, click them. Or walk up to them and press T.', visual: 'talk', event: 'kingdom:chat', hint: 'Click anyone to talk', top: true },
      { say: `Your quick actions. Press T or 1 to 4, or click them. T talks to whoever is in front of you, or to me when nobody is, and 3 takes you back to the town square.`, target: '#hotbar', keys: ['KeyT', 'Digit1', 'Digit2', 'Digit3', 'Digit4'], click: '#hotbar', hint: 'Try one' },
      { say: 'The marker over each person shows what they are doing.', visual: 'status', center: true },
      { say: 'Directors each run one area. When a director needs more hands, a worker is taken on. The director gives the worker every task and checks the work.', visual: 'team', center: true },
      { say: "Your to-do list. Type a task and the right person does it. When it's done, you approve it.", visual: 'todo', target: '[data-act="todo"]', keys: ['KeyK'], click: '[data-act="todo"]', hint: 'Open your to-do list' },
      { say: 'Call a meeting to talk to all your directors at once.', visual: 'meeting', target: '[data-act="meeting"]' },
      { say: 'Night, sound and help.', visual: 'extras', target: '[data-act="night"]', center: true },
      { say: 'Settings: rename anyone, connect your tools, and replay this guide. Nothing is ever sent, spent or posted without your click.', target: '[data-act="settings"]', last: true },
    ];
    let n = 0, count = 0, moving = false;
    const box = el('div', { class: 'coach', role: 'dialog', 'aria-label': `A guide to ${world}` });
    const spot = el('div', { class: 'coach-spot', 'aria-hidden': 'true' }), dim = el('div', { class: 'coach-dim', 'aria-hidden': 'true' });
    const head = el('div', { class: 'chead' }, faceSlot(chief.key, true), el('div', {}, el('div', { class: 'ctitle' }, `A guide to ${world}`), el('div', { class: 'cname' }, `${cname}, your chief of staff`)));
    const dots = el('div', { class: 'cdots' }), text = el('div', { class: 'ctext' }), pic = el('div', {}), hint = el('div', { class: 'chint' }), bar = el('div', { class: 'cbar' });
    box.append(head, dots, text, pic, hint, bar);
    const rectOf = (st) => {
      if (!st.target) return null;
      if (typeof st.target === 'function') { const r = st.target(); return r ? { left: r.x, top: r.y, width: r.w, height: r.h } : null; }
      const e = document.querySelector(st.target); if (!e) return null;
      const r = e.getBoundingClientRect(); return r.width && r.height ? r : null;
    };
    function place() {
      const st = steps[n]; if (!st) return;
      const r = rectOf(st), pad = 6;
      box.style.width = '';
      if (r) {  // narrow the box to sit beside something wide (the big map) when that's the only free space
        const side = Math.max(r.left, innerWidth - r.left - r.width) - 32;
        if (r.width > innerWidth * 0.4 && side >= 260 && side < 440) box.style.width = side + 'px';
      }
      const bw = box.offsetWidth, bh = box.offsetHeight;
      dim.hidden = !(st.center && !r); spot.hidden = !r;
      if (r) Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      let left, top;
      if (r) {  // beside it, wherever there's room: below, above, right, left; else at the bottom of the screen
        const cx = r.left + r.width / 2 - bw / 2, cy = r.top + r.height / 2 - bh / 2, g = 16;
        const fits = ([x, y]) => x >= 8 && y >= 8 && x + bw <= innerWidth - 8 && y + bh <= innerHeight - 8;
        const clampX = (x) => Math.max(8, Math.min(innerWidth - bw - 8, x)), clampY = (y) => Math.max(8, Math.min(innerHeight - bh - 8, y));
        const spotFit = [[clampX(cx), r.top + r.height + g], [clampX(cx), r.top - bh - g], [r.left + r.width + g, clampY(cy)], [r.left - bw - g, clampY(cy)]].find(fits);
        [left, top] = spotFit || [(innerWidth - bw) / 2, innerHeight - bh - 90];
      } else if (st.top) { left = (innerWidth - bw) / 2; top = 70; } else { left = (innerWidth - bw) / 2; top = (innerHeight - bh) / 2 - 20; }
      box.style.left = Math.max(8, Math.min(innerWidth - bw - 8, left)) + 'px';
      box.style.top = Math.max(8, Math.min(innerHeight - bh - 8, top)) + 'px';
    }
    const timer = setInterval(place, 250);
    function end() {
      box.remove(); spot.remove(); dim.remove(); clearInterval(timer);
      removeEventListener('keydown', onKey, true); document.removeEventListener('click', onClick, true); removeEventListener('kingdom:chat', onEvent);
      if (settings && !settings.tourDone) save({ ...settings, tourDone: true }).catch(() => {});
    }
    const go = (d) => { moving = false; n += d; count = 0; if (n >= steps.length) end(); else { n = Math.max(0, n); show(); } };
    const soon = () => { if (!moving) { moving = true; setTimeout(() => { if (moving) go(1); }, 700); } };  // once per step, however many keys follow
    function show() {
      const st = steps[n];
      text.textContent = st.say;
      pic.replaceChildren(...(st.visual ? [visual[st.visual]()] : []));
      hint.textContent = st.keys || st.event ? `\u{1F449} Try it: ${st.hint}` : ''; hint.hidden = !(st.keys || st.event);
      dots.replaceChildren(...steps.map((_, k) => el('span', { class: k === n ? 'on' : k < n ? 'done' : '' })));
      bar.replaceChildren(...(n > 0 ? [el('button', { onclick: () => go(-1) }, '\u2190 Back')] : []), el('button', { class: 'quiet', onclick: end }, 'End guide'),
        el('button', { class: 'go', onclick: () => go(1) }, st.last ? 'Done' : n === 0 ? 'Show me' : 'Next step \u2192'));
      place(); requestAnimationFrame(place);
    }
    function onKey(e) {
      const st = steps[n];
      if (!st || !st.keys || e.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
      if (!moving && st.keys.includes(e.code) && ++count >= (st.need || 1)) soon();
    }
    function onClick(e) { const st = steps[n]; if (st && st.click && e.target.closest && e.target.closest(st.click)) soon(); }
    function onEvent() { const st = steps[n]; if (st && st.event === 'kingdom:chat') soon(); }
    addEventListener('keydown', onKey, true); document.addEventListener('click', onClick, true); addEventListener('kingdom:chat', onEvent);
    document.body.append(dim, spot, box); show();
  }

  // village.js calls start() once it knows its default names and whether this browser already has village data
  function start(d, hasData) {
    defaults = d;
    if (!got.ok) { build(); return; }  // no settings server: defaults, nothing saved
    if (!settings && hasData) {  // an existing install: keep everything, mark it set up, no onboarding
      settings = { version: VERSION, setupDone: true, worldName: '', ownerName: '', agents: {}, tourDone: true, migrated: true };
      save(settings).catch(() => {});
    }
    build();
    if (!settings || !settings.setupDone) wizard(() => location.reload());
    else setTimeout(() => tour(false), 1500);
  }
  window.__world = { start, relabel, worldName, agentName, ownerName: () => (settings && clean(settings.ownerName, LIMIT.owner)) || '',
    names: () => Object.fromEntries((defaults ? [...defaults.agents.map((a) => a.key)] : []).map((k) => [k, agentName(k)])),
    connections: () => ((settings && settings.connections) || []).slice(), buildings: () => ((settings && settings.buildings) || []).slice(), buildMenu, settings: () => settings, open: personalisation, openConnections: connectionsPanel, tour: () => tour(true), saved: () => got.ok };
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
})();
