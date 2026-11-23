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

  function connEditor(list, onChange) {  // list is edited in place; onChange() after every change
    const node = el('div', {}), err = el('div', { class: 'err' });
    const kind = el('select', { 'aria-label': 'Kind of connection' }, el('option', { value: '' }, 'Choose what to add…'),
      ...Object.entries(KINDS).map(([v, k]) => el('option', { value: v }, k.label)));
    const name = el('input', { maxlength: 40, placeholder: 'Name (optional)' });
    const env = el('input', { maxlength: 41, placeholder: 'Key variable name, if it needs one (optional)' });
    const auth = el('select', { 'aria-label': 'How the key is sent' }, el('option', { value: 'bearer' }, 'Authorization: Bearer <key>'),
      el('option', { value: 'header' }, 'X-API-Key: <key> header'), el('option', { value: 'query' }, '?api_key=<key> in the address'));
    const help = el('p', { class: 'role' });
    let detail = el('input');
    const fields = el('div', {});
    let choosing = null;  // the connection whose "who may use it" chooser is open
    function shape() {
      const k = KINDS[kind.value]; err.textContent = '';
      if (!k) { fields.replaceChildren(); help.textContent = ''; return; }
      detail = k.options ? el('select', { 'aria-label': k.field }, el('option', { value: '' }, `${k.field}…`), ...k.options.map((o) => el('option', { value: o }, o)))
        : el('input', { maxlength: 200, placeholder: k.ph, 'aria-label': k.field });
      help.textContent = k.help;
      fields.replaceChildren(el('label', {}, k.field), detail, el('label', {}, 'Name'), name,
        ...(kind.value === 'api' ? [el('label', {}, 'Key variable'), env, el('label', {}, 'How the key is sent'), auth] : []),
        el('div', { class: 'bar' }, btn('Add', add, true)));
    }
    kind.onchange = shape;
    const changed = () => { render(); onChange && onChange(); };
    function add() {
      if (list.length >= MAX_CONN) { err.textContent = `That's the most for now (${MAX_CONN}).`; return; }
      const d = clean(detail.value, 200).replace(/\/$/, '');
      const c = { kind: kind.value, detail: d, name: clean(name.value, 40), env: kind.value === 'api' ? clean(env.value, 41) : '', auth: auth.value };
      const bad = checkConn(c); if (bad) { err.textContent = bad; return; }
      if (list.some((x) => x.kind === c.kind && x.detail === c.detail)) { err.textContent = "That's already on the list."; return; }
      c.name = c.name || (c.kind === 'repo' ? c.detail.split('/').slice(-2).join('/') : c.detail);
      c.id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); c.added = new Date().toISOString();
      c.on = false; c.agents = []; c.free = false;
      list.push(c); name.value = ''; env.value = ''; kind.value = ''; shape(); changed();
      if (c.kind === 'account') checkClaude(true);
    }
    const who = (c) => ((c.agents || []).includes('*') ? 'all agents' : (c.agents || []).map((k) => agentName(k)).join(', '));
    function claudeLine(c) {  // the Claude side of an account: added? signed in? with buttons that do the next step
      if (c.kind !== 'account') return [];
      const it = claude.items[c.id];
      const line = (text, ...b) => el('div', { class: 'cl' }, el('span', {}, text), ...b);
      if (claude.state === 'checking') return [line('Checking your Claude connectors…')];
      if (claude.state === 'off') return [line("The AI helper isn't running, so Kingdom can't check Claude. Start it, then:", btn('Check again', () => checkClaude(true)))];
      if (!it) return [line('Not checked with Claude yet.', btn('Check with Claude', () => checkClaude(true)))];
      if (it.status === 'connected') return [line(it.reads ? `✓ Connected in your Claude account (${it.reads} read-only tools).` : 'Connected in Claude, but it has no read-only tools agents may use.')];
      if (it.status === 'missing') return [line(`Not added to your Claude account yet. Add ${c.detail === 'Other' ? c.name : c.detail} in Claude's connectors and sign in there, then come back:`,
        btn('Add in Claude ↗', () => window.open(claude.page, '_blank', 'noopener')), btn('Check again', () => checkClaude(true)))];
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
      const msg = el('div', { class: 'err' });
      return el('div', { class: 'ch' }, el('div', { class: 'role' }, 'Who may use it?'), el('div', { class: 'cks' }, ...boxes.map((x) => x[1])),
        ...(c.kind === 'api' ? [el('label', { class: 'ck' }, free, ' This API is free, or on a plan I already pay for (no pay-per-use).')] : []),
        el('div', { class: 'bar' }, btn('Cancel', () => { choosing = null; render(); }), btn('Turn on for these', () => {
          const picked = boxes.filter((x) => x[0].checked).map((x) => x[0].value);
          if (!picked.length) { msg.textContent = 'Pick at least one agent.'; return; }
          if (c.kind === 'api' && !free.checked) { msg.textContent = 'Kingdom One only uses free APIs or ones you already pay for.'; return; }
          Object.assign(c, { on: true, agents: picked.includes('*') ? ['*'] : picked, free: c.kind === 'api' ? true : c.free });
          choosing = null; changed();
        }, true)), msg);
    }
    function render() {
      const rows = list.map((c) => {
        const k = KINDS[c.kind];
        const state = c.on ? `On for ${who(c)}` : 'Off';
        const row = el('div', { class: 'cn' + (c.on ? ' on' : '') },
          el('div', { class: 'cnt' }, el('b', {}, c.name), ` · ${k ? k.label : c.kind}`, el('br'),
            el('span', { class: 'role' }, c.detail + (c.env ? ` · key kept in ${c.env}` : '') + ` · ${state}`), ...claudeLine(c)),
          el('div', { class: 'cnb' }, c.on ? btn('Turn off', () => { c.on = false; changed(); }) : btn('Turn on…', () => { choosing = c.id; render(); }, true),
            btn('Remove', () => { list.splice(list.indexOf(c), 1); if (choosing === c.id) choosing = null; changed(); })));
        return choosing === c.id ? [row, chooser(c)] : [row];
      }).flat();
      const here = localTools.length ? [el('p', { class: 'role' }, `Already working on this computer: ${localTools.join(', ')}.`)] : [];
      node.replaceChildren(...here, ...(rows.length ? rows : [el('div', { class: 'role' }, 'Nothing added yet.')]),
        ...(claude.note ? [el('p', { class: 'role cl' }, claude.note)] : []),
        el('label', {}, 'Add a connection'), kind, help, fields, err);
    }
    editors.add(render);
    render();
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
    function keepDraft() { Object.assign(draft, f.read(), { step }); save({ ...(settings || {}), setupDone: false, draft }).catch(() => {}); }
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
        el('button', { onclick: () => box.remove() }, 'Cancel'),
        el('button', { class: 'go', onclick: () => done(f.read(), 'Saved. Reloading your world…') }, 'Save')), err);
    for (const type of ['keydown', 'keyup']) box.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(box);
  }

  function connectionsPanel() {
    const box = el('div', { class: 'wz', role: 'dialog', 'aria-modal': 'true' }), card = el('div', { class: 'wz-card' }); box.append(card);
    const list = ((settings && settings.connections) || []).map((c) => ({ ...c }));
    const msg = el('div', { class: 'err' });
    const ce = connEditor(list, () => { msg.textContent = 'Saving…'; save({ ...(settings || {}), connections: list }).then(() => { msg.textContent = 'Saved.'; }).catch((e) => { msg.textContent = `Couldn't save (${e.message}). Try again.`; }); });
    card.append(el('h2', {}, 'Settings → Connections'), el('p', {}, 'Tools, projects and accounts your agents could work with.'), ce.node, el('p', { class: 'role' }, CONN_NOTE), msg,
      el('div', { class: 'bar' }, el('button', { onclick: () => { box.remove(); personalisation(); } }, 'Personalisation…'), el('button', { class: 'go', onclick: () => box.remove() }, 'Done')));
    for (const type of ['keydown', 'keyup']) box.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(box);
  }

  function tour() {  // a short, dismissible look at what's here
    if (!settings || settings.tourDone) return;
    const box = el('div', { class: 'wz' }), card = el('div', { class: 'wz-card' }); box.append(card);
    const n = (k) => agentName(k);
    card.append(el('h2', {}, `Getting around ${worldName()}`),
      el('p', {}, `The town hall: ${n('vizier')}, your chief of staff, takes your orders (press T beside them, or M M from anywhere).`),
      el('p', {}, 'Your to-do list (K): add a task and the right director does it or hands it to a worker. Finished work waits for your OK.'),
      el('p', {}, "The houses and workshops: each director and worker has their own. Walk in through the door. The private garden keeps personal life apart from work."),
      el('p', {}, 'Agents only answer when the AI helper is running on your own Claude subscription (see README). With no helper they reply from a script, and nothing is ever done for real.'),
      el('div', { class: 'bar' }, el('button', { class: 'go', onclick: () => { box.remove(); save({ ...settings, tourDone: true }).catch(() => {}); } }, 'Got it')));
    for (const type of ['keydown', 'keyup']) box.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(box);
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
    else setTimeout(tour, 1200);
  }
  window.__world = { start, relabel, worldName, agentName, ownerName: () => (settings && clean(settings.ownerName, LIMIT.owner)) || '',
    names: () => Object.fromEntries((defaults ? [...defaults.agents.map((a) => a.key)] : []).map((k) => [k, agentName(k)])),
    connections: () => ((settings && settings.connections) || []).slice(), settings: () => settings, open: personalisation, openConnections: connectionsPanel, saved: () => got.ok };
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
})();
