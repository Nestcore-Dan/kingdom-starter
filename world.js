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
  const COMMON = /^(Money|Studio|Inbox|Media sorter|Hub scout|Garden helper)$/;  // also ordinary words: only replace as a name
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
    return el('div', { class: 'guide' }, el('b', {}, 'How to add knowledge'), ...INGEST.map(([h, items]) => el('div', {}, el('div', { class: 'gh' }, h),
      el('ul', {}, ...items.map((x) => el('li', {}, ...(/^docker exec /.test(x) ? [cmd(x)] : [x])))))));
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
    let choosing = null, openBolton = null;
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
    const who = (c) => ((c.agents || []).includes('*') ? 'all agents' : (c.agents || []).map((k) => agentName(k)).join(', '));
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
      const boxes = [['*', 'All agents'], ...defaults.agents.map((a) => [a.key, `${agentName(a.key)} (${a.role})`])].map(([k, label]) => {
        const b = el('input', { type: 'checkbox', value: k }); b.checked = (c.agents || []).includes(k);
        return [b, el('label', { class: 'ck' }, b, ' ' + label)];
      });
      const free = el('input', { type: 'checkbox' }); free.checked = !!c.free;
      const mail = c.kind === 'account' && ['Gmail', 'Outlook'].includes(c.detail);
      const drafts = el('input', { type: 'checkbox' }); drafts.checked = !!c.drafts;
      const msg = el('div', { class: 'err' });
      return el('div', { class: 'ch' }, el('div', { class: 'role' }, `Who may use ${c.name}?`), el('div', { class: 'cks' }, ...boxes.map((x) => x[1])),
        ...(c.kind === 'api' ? [el('label', { class: 'ck' }, free, ' This API is free, or on a plan I already pay for (no pay-per-use).')] : []),
        ...(mail ? [el('label', { class: 'ck' }, drafts, ` They may save new drafts in my ${c.detail} drafts folder (never send, change or delete).`)] : []),
        el('div', { class: 'bar' }, btn('Not now', () => { choosing = null; render(); }), btn('Turn on for these', () => {
          const picked = boxes.filter((x) => x[0].checked).map((x) => x[0].value);
          if (!picked.length) { msg.textContent = 'Pick at least one agent.'; return; }
          if (c.kind === 'api' && !free.checked) { msg.textContent = 'Kingdom One only uses free APIs or ones you already pay for.'; return; }
          Object.assign(c, { on: true, agents: picked.includes('*') ? ['*'] : picked, free: c.kind === 'api' ? true : c.free, drafts: mail && drafts.checked });
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
          el('div', { class: 'cnt' }, el('b', {}, c.name), ` · ${k ? k.label : c.kind}`, el('br'),
            el('span', { class: 'role' }, c.detail + (c.env ? ` · key kept in ${c.env}` : '') + ` · ${state}`), ...claudeLine(c)),
          el('div', { class: 'cnb' }, c.on ? btn('Turn off', () => { c.on = false; changed(); }) : btn('Turn on…', () => { choosing = c.id; render(); }, true),
            btn('Remove', () => { list.splice(list.indexOf(c), 1); if (choosing === c.id) choosing = null; changed(); })));
        return choosing === c.id ? [row, chooser(c)] : [row];
      }).flat();
      const cats = CATALOG.map(([cat, items]) => el('div', { class: 'cat' }, el('div', { class: 'catn' }, cat),
        el('div', { class: 'tiles' }, ...items.map(([k, d, mono]) => {
          const label = k === 'bolton' ? BOLTON_INFO[d].name : d;
          const [st, cls] = tileState(k, d);
          return el('div', { class: 'tile ' + cls }, el('div', { class: 'mono', 'aria-hidden': 'true' }, mono), el('div', { class: 'tn' }, label),
            el('div', { class: 'ts' }, st || '\u00a0'), btn(st === 'On' || st === 'Connected' ? 'Settings' : 'Connect', () => connectTile(k, d), !(st === 'On' || st === 'Connected')));
        })), ...(cat.startsWith('Knowledge') && openBolton ? [boltonPanel(openBolton)] : [])));
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
  const CONN_NOTE = "Nothing is used until you turn it on and pick who may use it. Agents only read: accounts through your own Claude connectors (never sending, paying or posting), repositories through their free public APIs, tools on this computer directly, and an API you've said is free or already paid for (30 reads a day). Anything that would change something waits on your to-do list for your Approve click. Social media is drafts only. Tools your agents build appear here once you approve them.";

  // ---------- panels ----------
  const css = `
  .wz { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: rgba(10,12,18,.72); font: 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #f5efe2; }
  .wz-card { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto; background: rgba(18,20,28,.97); border: 1px solid rgba(232,196,106,.5); border-radius: 14px; padding: 22px 24px; box-sizing: border-box; }
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
  .coach { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(58px + env(safe-area-inset-bottom, 0px)); z-index: 55; width: min(560px, calc(100vw - 32px));
    display: flex; gap: 12px; align-items: flex-start; background: rgba(18,20,28,.96); border: 1px solid rgba(232,196,106,.55); border-radius: 14px; padding: 12px 14px;
    color: #f5efe2; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 8px 28px rgba(0,0,0,.45); }
  .coach .cface { flex: none; width: 56px; height: 56px; border-radius: 50%; overflow: hidden; background: #2b8a8a; border: 2px solid #e8c46a; }
  .coach .cface img { width: 100%; height: 100%; object-fit: cover; }
  .coach .cbody { min-width: 0; flex: 1; display: grid; gap: 6px; } .coach .cname { font: 600 11px system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #e8c46a; }
  .coach .chint { font-size: 12.5px; color: #e1ad01; } .coach .cbar { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
  .coach .cstep { margin-right: auto; font-size: 11.5px; color: #c9c1ae; }
  .coach button { font: 600 12.5px system-ui, sans-serif; color: #f5efe2; background: rgba(255,255,255,.08); border: 1px solid rgba(232,196,106,.3); border-radius: 8px; padding: 5px 11px; cursor: pointer; }
  .coach button.go { background: #2b8a8a; border-color: #5fc0bd; }
  .coach-ring { outline: 3px solid #e1ad01 !important; outline-offset: 3px; animation: coachpulse 1.4s ease-in-out infinite; }
  @keyframes coachpulse { 50% { outline-color: rgba(225,173,1,.35); } }
  @media (prefers-reduced-motion: reduce) { .coach-ring { animation: none; } }
  .wz .guide { background: rgba(255,255,255,.04); border: 1px solid rgba(232,196,106,.3); border-radius: 10px; padding: 10px 12px; margin: 8px 0; display: grid; gap: 8px; font-size: 13px; }
  .wz .guide .gh { font-weight: 600; color: #e8c46a; } .wz .guide ul { margin: 4px 0 0; padding-left: 18px; display: grid; gap: 4px; color: #e9e2d2; }
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
    const world = el('input', { maxlength: LIMIT.world, placeholder: defaults.world }); world.value = rec.worldName || '';
    const owner = el('input', { maxlength: LIMIT.owner, placeholder: 'Optional' }); owner.value = rec.ownerName || '';
    const agents = {};
    const grid = el('div', { class: 'row' });
    for (const a of defaults.agents) {
      const i = el('input', { maxlength: LIMIT.agent, placeholder: a.name, 'aria-label': `Name for ${a.role}` }); i.value = (rec.agents || {})[a.key] || '';
      agents[a.key] = i;
      grid.append(el('div', {}, el('label', {}, a.role), i), el('div', { class: 'role' }, `Default: ${a.name}`));
    }
    const read = () => ({ worldName: clean(world.value, LIMIT.world), ownerName: clean(owner.value, LIMIT.owner),
      agents: Object.fromEntries(Object.entries(agents).map(([k, i]) => [k, clean(i.value, LIMIT.agent)]).filter(([, v]) => v)) });
    return { world, owner, grid, read };
  }
  function summary(r) {
    const names = defaults.agents.filter((a) => r.agents[a.key]).map((a) => `${a.role}: ${r.agents[a.key]}`);
    return el('div', { class: 'sum' }, `World: ${r.worldName || defaults.world}`, el('br'), r.ownerName ? `You: ${r.ownerName}` : 'You: not set', el('br'),
      names.length ? `Renamed: ${names.join(' · ')}` : 'Agents: the default names', el('br'),
      (r.connections || []).length ? `Connections: ${r.connections.map((c) => c.name).join(' · ')}` : 'Connections: none yet', el('br'), 'Theme: Moroccan oasis (the current theme)');
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
        () => [el('h2', {}, 'Give your agents names, or keep the defaults.'), el('p', {}, "Only the name changes. Each agent keeps its role, instructions, permissions and history."),
          f.grid, nav(true, () => { step = 3; keepDraft(); show(); })],
        () => [el('h2', {}, 'Connect your tools.'), el('p', {}, 'Optional. Add what your agents can work with: tools on this computer (including ones your agents build), online repositories, your accounts such as Gmail or Xero, social media, or a custom API. Turn each on and pick who may use it. Accounts connect through your own Claude account: the buttons take you there. You can change all of this later in Settings → Connections.'),
          ce.node, el('p', { class: 'role' }, CONN_NOTE), nav(true, () => { step = 4; keepDraft(); show(); })],
        () => [el('h2', {}, 'Make it yours.'), el('p', {}, "Houses and workshops are signed with their owner's name, so they follow the names you chose. The doors still lead to the same places."),
          el('div', { class: 'sum' }, 'Theme: Moroccan oasis. More themes will come later in Settings → Appearance.'), nav(true, () => { step = 5; keepDraft(); show(); })],
        () => [el('h2', {}, 'Review your world and step inside.'), summary({ ...f.read(), connections: draft.connections }), el('p', {}, ''), el('p', {}, 'You can change all of this later: Settings, in the top menu.'),
          nav(true, () => finish({ ...f.read(), connections: draft.connections }), 'Enter my world')],
      ];
      if (step === 3) ce.render();
      card.replaceChildren(dots, ...views[step](), err);
      const first = card.querySelector('input'); if (first) setTimeout(() => first.focus(), 0);
    }
    for (const type of ['keydown', 'keyup']) box.addEventListener(type, (e) => e.stopPropagation());
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
    card.append(el('h2', {}, 'Settings → Connections'), el('p', {}, 'Tools, projects and accounts your agents could work with.'), ce.node, el('p', { class: 'role' }, CONN_NOTE), msg, guideBox,
      el('div', { class: 'bar' }, el('button', { onclick: () => { if (guideBox.childElementCount) guideBox.replaceChildren(); else guideBox.replaceChildren(ingestGuide()); } }, 'How to add knowledge'),
        el('button', { onclick: () => { box.remove(); personalisation(); } }, 'Personalisation…'), el('button', { class: 'go', onclick: () => box.remove() }, 'Done')));
    for (const type of ['keydown', 'keyup']) box.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(box);
  }

  // The in-game assistant: the chief of staff shows you around, one step at a time. It doesn't block the game:
  // most steps wait for you to try the thing (walk, open the map, talk, open the to-do list), and any step can be skipped.
  function tour(force) {
    if (!force && (!settings || settings.tourDone)) return;
    if (document.querySelector('.coach')) return;
    const chief = defaults.agents[0], cname = agentName(chief.key);
    const MOVE = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
    const steps = [
      { say: `Welcome to ${worldName()}! I'm ${cname}, your chief of staff. Let me show you around. You're the one in the ivory robe, and the town is yours.` },
      { say: 'Walk with the arrow keys or W A S D. Hold Shift to run. Have a little walk now.', keys: MOVE, need: 8, hint: 'Walk a few steps' },
      { say: 'Press M to see the whole town on the map. Press M again, a moment later, to put it away.', keys: ['KeyM'], hint: 'Press M' },
      { say: `To talk to anyone, walk up to them and press T. I live in the town hall, the big building with the flag north of the square. From anywhere, double-tap M and I'll answer.`, keys: ['KeyT', 'Enter'], anywhere: true, hint: 'Press T beside someone, or double-tap M and say hello' },
      { say: "Your to-do list: click To-do or press K. Type a task and I'll pass it to the right director, who does it or hands it to a worker and checks it. The mustard number counts what's waiting on you.", target: '[data-act="todo"]', keys: ['KeyK'], click: true, hint: 'Open the to-do list' },
      { say: 'Call meeting brings everyone to the council table, where you can talk to the whole team at once (C).', target: '[data-act="meeting"]' },
      { say: 'Settings is where you rename the world and the agents, and connect your tools: email, Xero, the Kingdom Library and more.', target: '[data-act="settings"]' },
      { say: "That's the tour. Press H any time for help, and you can replay this from Settings. Nothing is ever sent, spent or posted without your click.", target: '[data-act="help"]', last: true },
    ];
    let n = 0, count = 0, ring = null, moving = false;
    const box = el('div', { class: 'coach', role: 'dialog', 'aria-label': `${cname} shows you around` });
    const face = el('div', { class: 'cface' });
    const text = el('div', { class: 'ctext' }), hint = el('div', { class: 'chint' }), bar = el('div', { class: 'cbar' });
    box.append(face, el('div', { class: 'cbody' }, el('div', { class: 'cname' }, `${cname} · showing you around`), text, hint, bar));
    function portrait() {
      const c = window.__castPortraits && window.__castPortraits[chief.key];
      if (!c || face.firstChild) return;
      try { face.append(el('img', { src: c.toDataURL ? c.toDataURL() : c.src, alt: '' })); } catch (e) { /* drawn later */ }
    }
    function end() {
      box.remove(); if (ring) ring.classList.remove('coach-ring');
      removeEventListener('keydown', onKey, true); document.removeEventListener('click', onClick, true);
      if (settings && !settings.tourDone) save({ ...settings, tourDone: true }).catch(() => {});
    }
    const next = () => { moving = false; n++; count = 0; if (n >= steps.length) end(); else show(); };
    const soon = () => { if (!moving) { moving = true; setTimeout(next, 700); } };  // once per step, however many keys follow
    function show() {
      const st = steps[n]; portrait();
      if (ring) ring.classList.remove('coach-ring');
      ring = st.target ? document.querySelector(st.target) : null; if (ring) ring.classList.add('coach-ring');
      text.textContent = st.say;
      hint.textContent = st.keys ? `Try it: ${st.hint}` : ''; hint.hidden = !st.keys;
      bar.replaceChildren(el('span', { class: 'cstep' }, `${n + 1} of ${steps.length}`),
        el('button', { onclick: end }, 'End tour'),
        el('button', { class: 'go', onclick: () => { if (!moving) next(); } }, st.last ? 'Done' : st.keys ? 'Skip this' : 'Next'));
    }
    function onKey(e) {
      const st = steps[n];
      if (!st || !st.keys || e.repeat || (!st.anywhere && /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || ''))) return;
      if (!moving && st.keys.includes(e.code) && ++count >= (st.need || 1)) soon();
    }
    function onClick(e) {
      const st = steps[n];
      if (st && st.click && st.target && e.target.closest && e.target.closest(st.target)) soon();
    }
    addEventListener('keydown', onKey, true); document.addEventListener('click', onClick, true);
    document.body.append(box); show();
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
    connections: () => ((settings && settings.connections) || []).slice(), settings: () => settings, open: personalisation, openConnections: connectionsPanel, tour: () => tour(true), saved: () => got.ok };
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
})();
