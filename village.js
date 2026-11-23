// Kingdom One: a top-down RPG village in the style of a sunlit Moroccan medina on an oasis.
// Empty for now: villas, paths, palms, a square with a fountain and the town hall, and
// every building can be walked into. Plain JavaScript on a canvas; all art is drawn in code
// to the locked style guide in NOTES.md (no text in the art, nothing fetched).
'use strict';
(() => {
  const T = 32;          // tile size in world pixels
  const SPEED = 150;     // walking speed, world pixels per second
  // guide step 34: the legs move by distance walked, not by time, so nobody glides or walks on the spot.
  // One full stride (left foot, stand, right foot, stand) covers STRIDE pixels, at any speed.
  const STRIDE = SPEED * 4 / 7;
  const walkFrame = (anim) => [0, 1, 2, 1][Math.floor((anim / STRIDE) * 4) % 4];
  const DEBUG = /[?&]debug\b/.test(location.search);

  // locked palette
  const GRASS_C = '#9bb862';
  const SAND = '#efd3ae', PLASTER = '#fbf6ec', TEAL = '#0f2a2e', LAGOON = '#2b8a8a',
        BRASS = '#e8b04b', TERRA = '#d9643f', PALM = '#4c8a4a', CEDAR = '#8a5a32';
  const OUTLINE = 'rgba(15,42,46,0.85)', SHADOW = 'rgba(15,42,46,0.18)';

  // ---------- small helpers ----------
  function hash(x, y, k = 0) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(k | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function rng(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function noise(x, y) {   // smooth value noise in 0..1
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const s = (v) => v * v * (3 - 2 * v), u = s(xf), v = s(yf);
    const a = hash(xi, yi, 77), b = hash(xi + 1, yi, 77), c = hash(xi, yi + 1, 77), d = hash(xi + 1, yi + 1, 77);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c =>
      Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt));
    return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  function ellipse(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }
  function box(c, x, y, w, h, color) { c.fillStyle = color; c.fillRect(x, y, w, h); }
  function rbox(c, x, y, w, h, r, color) {
    c.fillStyle = color; c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
    c.fill();
  }
  function outlineRect(c, x, y, w, h, lw = 1.5) { c.strokeStyle = OUTLINE; c.lineWidth = lw; c.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw); }
  function diamond(c, cx, cy, r, color) {
    c.fillStyle = color; c.beginPath();
    c.moveTo(cx, cy - r); c.lineTo(cx + r, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r, cy); c.closePath(); c.fill();
  }
  function star8(c, cx, cy, r, color) {
    c.fillStyle = color;
    for (const rot of [0, Math.PI / 4]) { c.save(); c.translate(cx, cy); c.rotate(rot); c.fillRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4); c.restore(); }
  }
  function octPath(c, cx, cy, r, squash = 0.9) {
    c.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + k * Math.PI / 4, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * squash;
      if (k) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath();
  }
  // horseshoe arch: w is the widest point, standing on `bottom`, total height h
  function horseshoePath(c, cx, bottom, w, h) {
    const r = w / 2, cy = bottom - h + r, a = 0.55;
    c.beginPath();
    c.moveTo(cx - r * Math.cos(a), bottom);
    c.lineTo(cx - r * Math.cos(a), cy + r * Math.sin(a));
    c.arc(cx, cy, r, Math.PI - a, a, false);
    c.lineTo(cx + r * Math.cos(a), bottom);
    c.closePath();
  }
  function roundArchPath(c, x, y, w, h) {
    const r = w / 2;
    c.beginPath(); c.moveTo(x, y + h); c.lineTo(x, y + r); c.arc(x + r, y + r, r, Math.PI, 0); c.lineTo(x + w, y + h); c.closePath();
  }
  function zelligeStrip(c, x, y, w, h, accent) {
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    box(c, x, y, w, h, '#f3e6cf');
    for (let k = 0, cx = x; cx < x + w; cx += h, k++) {
      diamond(c, cx + h / 2, y + h / 2, h / 2 - 0.5, k % 2 ? accent : TEAL);
      box(c, cx + h / 2 - 1, y + h / 2 - 1, 2, 2, BRASS);
    }
    c.restore();
  }
  // mashrabiya window: an arched opening with a cedar lattice
  function archWindow(c, x, y, w, h, frame = '#f3e6cf') {
    c.fillStyle = frame; roundArchPath(c, x - 3, y - 3, w + 6, h + 5); c.fill();
    c.save(); roundArchPath(c, x, y, w, h); c.clip();
    box(c, x, y, w, h, '#1d5458');
    c.strokeStyle = '#a8703f'; c.lineWidth = 1.2;
    for (let k = -h; k < w + h; k += 5) { c.beginPath(); c.moveTo(x + k, y); c.lineTo(x + k + h, y + h); c.stroke(); c.beginPath(); c.moveTo(x + k + h, y); c.lineTo(x + k, y + h); c.stroke(); }
    c.restore();
    c.strokeStyle = OUTLINE; c.lineWidth = 1; roundArchPath(c, x, y, w, h); c.stroke();
  }

  // ---------- tiles ----------
  const SANDT = 0, PATH = 1, STONE = 2, WATER = 3, BED = 4, FLOOR = 5, BACKWALL = 6, OUTERWALL = 7, MAT = 8, WALL = 9, GRASS = 10, ZELLIGE = 11, HEDGE = 12, VEG = 13;
  const SOLID_TILE = new Set([WATER, BACKWALL, OUTERWALL, WALL, HEDGE, VEG]);
  const OPEN_GROUND = new Set([SANDT, GRASS]);

  function newScene(id, name, w, h, opts = {}) {
    return {
      id, name, w, h, outdoor: !!opts.outdoor, palette: opts.palette || null, building: opts.building || null,
      tiles: new Uint8Array(w * h), solid: new Uint8Array(w * h), objAt: new Map(),
      objects: [], doors: [], wallDecor: [], water: [], cache: null,
      lights: [],  // night-time light sources: { x, y, r } in world pixels
    };
  }
  const inside = (s, x, y) => x >= 0 && y >= 0 && x < s.w && y < s.h;
  const tileAt = (s, x, y) => (inside(s, x, y) ? s.tiles[y * s.w + x] : -1);
  function setTile(s, x, y, t) { if (inside(s, x, y)) s.tiles[y * s.w + x] = t; }
  function fill(s, x0, y0, x1, y1, t) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTile(s, x, y, t); }
  function solidify(s, x, y, w = 1, h = 1, obj = null) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (!inside(s, xx, yy)) continue;
      s.solid[yy * s.w + xx] = 1;
      if (obj) s.objAt.set(yy * s.w + xx, obj);
    }
  }
  function finishTiles(s) {
    for (let i = 0; i < s.tiles.length; i++) {
      if (SOLID_TILE.has(s.tiles[i])) s.solid[i] = 1;
      if (s.tiles[i] === WATER) s.water.push(i);
    }
  }
  function addObj(s, o) { s.objects.push(o); return o; }

  // ---------- palettes ----------
  // the residents: who each villa is for (everyone has moved in since guide step 28). yard = props outside, room = props inside.
  const BIZ = ['#2b8a8a', '#d9643f', '#e8b04b'];   // Merchant's three businesses: each business, future ventures
  const RES = [
    // staff quarter, around the square
    { key: 'keeper', name: 'Keeper', title: "Keeper's house", role: 'Operations Manager', q: 'staff', x: 23, y: 13, type: 'tower', accent: '#1f6f8b', wall: '#f3dfc0',
      job: 'Owns tasks, projects, the calendar, reminders, deadlines and follow-ups.', yard: ['sundial', 'crates'], room: ['pegboard', 'crates'] },
    { key: 'librarian', name: 'Librarian', title: "Librarian's archive", role: 'Knowledge & Learning Manager (the Librarian)', q: 'staff', x: 49, y: 13, type: 'tower', flip: true, accent: '#3f7d5a', wall: '#f8eddc',
      job: 'Keeps the knowledge, documentation, decisions, lessons learned and reusable skills.', yard: ['books', 'reading'], room: ['scrolls', 'reading'] },
    { key: 'merchant', name: 'Merchant', title: "Merchant's merchant house", role: 'Business Manager', q: 'staff', x: 22, y: 38, type: 'cedar', accent: '#c98a2b', wall: '#fbf3e4',
      job: 'Client communication, proposals, quotes and business development, with a separate workspace for each business.', yard: ['teaset', 'carpets'], room: ['ledgers', 'teaset'] },
    { key: 'scholar', name: 'Scholar', title: "Scholar's observatory", role: 'Research & Strategy Analyst', q: 'staff', x: 30, y: 38, type: 'garden', flip: true, accent: '#237777', wall: '#efd3ae',
      job: 'Researches ideas, compares options and challenges assumptions. Two paths leave the door: there is always an alternative.', yard: ['maptable', 'astrolabe'], room: ['maptable', 'astrolabe'] },
    { key: 'engineer', name: 'Engineer', title: "Engineer's forge", role: 'Technology Lead', q: 'staff', x: 43, y: 38, type: 'cedar', flip: true, accent: '#b5523b', wall: '#f2d6b5',
      job: 'Infrastructure, cybersecurity, architecture, code, automation and the AI environment.', yard: ['forge', 'wheel'], room: ['workbench', 'rack'] },
    // workshop quarter, the project agents
    { key: 'youtube', name: 'Projectionist', title: 'Projectionist, the video shop', role: 'The media centre: videos, transcripts and highlights', q: 'workshop', x: 5, y: 13, type: 'cedar', accent: '#d9643f', wall: '#fbf6ec',
      job: 'The village media centre. Downloads and transcribes videos and finds their most replayed moments.', yard: ['reels', 'screen'], room: ['reels', 'screen'] },
    { key: 'scout', name: 'Hub scout', title: "The Hub scout's lookout", role: 'Hugging Face and GitHub watcher', q: 'workshop', x: 13, y: 13, type: 'tower', flip: true, accent: '#2b8a8a', wall: '#f7ead3',
      job: 'Watches Hugging Face and GitHub and sends word of anything relevant.', yard: ['dovecote', 'spyglass'], room: ['spyglass', 'books'] },
    { key: 'media', name: 'Media sorter', title: "The Media sorter's darkroom", role: 'Photos and media', q: 'workshop', x: 5, y: 38, type: 'cedar', accent: '#a8473a', wall: '#f7ead3',
      job: 'Sorts photos by time, classifies scenes and organises the media.', yard: ['darkroom', 'tripod'], room: ['prints', 'tripod'] },
    { key: 'studio', name: 'Studio', title: 'The Studio workshop', role: 'Client software', q: 'workshop', x: 51, y: 38, type: 'tower', accent: '#1f6f8b', wall: '#ecc9a2',
      job: "Builds external clients' software projects.", yard: ['drafting', 'crates'], room: ['drafting', 'crates'] },
    { key: 'inbox', name: 'Inbox', title: 'The Inbox post house', role: 'Inbox and email', q: 'workshop', x: 60, y: 38, type: 'garden', accent: '#d9643f', wall: '#f3dfc0',
      job: 'Reads, sorts and answers the inbox.', yard: ['postcart', 'dovecote'], room: ['letterboxes', 'postcart'] },
    { key: 'money', name: 'Money', title: 'The Money counting house', role: 'Money and accounts', q: 'workshop', x: 68, y: 38, type: 'tower', flip: true, accent: '#c98a2b', wall: '#fbf3e4',
      job: 'Keeps track of money in and money out.', yard: ['scales', 'strongbox'], room: ['strongbox', 'scales'] },
    // the private garden
    { key: 'steward', name: 'Steward', title: "Steward's garden house", role: 'Personal Assistant', q: 'private', x: 64, y: 14, type: 'garden', accent: '#b5523b', wall: '#fbf6ec',
      job: 'Personal plans, appointments, travel, the household and life admin. Personal records stay in this garden, apart from business.', yard: [], room: ['trunk', 'herbs'] },
    // guide step 28: Steward's worker, in a small potting shed inside the private garden so personal work never leaves it
    { key: 'garden', name: 'Garden helper', title: "The garden helper's potting shed", role: 'Household and life admin', q: 'private', x: 72, y: 15, w: 5, h: 4, type: 'garden', accent: '#6f8f3a', wall: '#f7ead3',
      job: 'Helps Steward with the household and life admin. Everything stays inside the private garden.', yard: [], room: ['herbs', 'trunk'] },
  ];
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));  // guide step 49
  // guide step 46: people hired at the town hall (agents/hires.json, written by the brain helper on the user's yes).
  // They work at their director's house, so they don't get a villa of their own.
  const HIRES = (() => { try { const x = new XMLHttpRequest(); x.open('GET', 'agents/hires.json?' + Date.now(), false); x.send(); const j = x.status === 200 ? JSON.parse(x.responseText) : []; return Array.isArray(j) ? j : []; } catch (e) { return []; } })();
  for (const h of HIRES) {
    const dir = RES.find((r) => r.key === h.boss); if (!dir || RES.some((r) => r.key === h.key)) continue;
    h.bossName = dir.name;
    RES.push({ key: h.key, name: h.name, title: `${h.name}, at ${dir.title}`, role: h.role, q: dir.q, hire: true, home: h.boss, bossKey: h.boss, accent: dir.accent, wall: dir.wall, job: h.job, yard: [], room: [] });
  }
  window.__hires = HIRES;  // the cast (cast.js) draws them too
  // Personalisation (world.js): the world's name and the agents' display names. The names written here are the
  // defaults; only the labels people see change. IDs, folders, roles, instructions and history never do.
  const W = window.__world || null;
  const relabel = (t) => (W ? W.relabel(t) : t);
  if (W) {
    const hasData = ['kingdom-one-todo', 'kingdom-one-chats', 'kingdom-one-log', 'kingdom-one-orders'].some((k) => { try { return !!localStorage.getItem(k); } catch (e) { return false; } });
    W.start({ world: 'Kingdom One', agents: [{ key: 'vizier', name: 'Vizier', role: 'Chief of Staff' }, ...RES.map((r) => ({ key: r.key, name: r.name, role: r.role }))] }, hasData);
    const walk = (root) => { const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n; (n = it.nextNode());) n.nodeValue = relabel(n.nodeValue); };
    for (const id of ['help', 'keys', 'menu']) { const e = document.getElementById(id); if (e) { walk(e); e.querySelectorAll('[title]').forEach((b) => { b.title = relabel(b.title); }); } }
    document.title = W.worldName();
  }
  // Org chart (guide step 25): directors own an area and a house; workers are like interns, given every task
  // by their director, who checks all their work. The workers' villas stay as their workshops (the user's
  // choice), but only directors have a house of their own.
  const DIRECTOR_OF = { youtube: 'librarian', media: 'librarian', scout: 'scholar', money: 'merchant', studio: 'engineer', inbox: 'keeper', garden: 'steward' };
  for (const r of RES) {
    r.boss = DIRECTOR_OF[r.key] || r.bossKey || null;
    r.rank = r.boss ? 'worker' : 'director';
  }
  const bossOf = (r) => RES.find((x) => x.key === r.boss);
  const placeKind = (r) => (r.boss ? `workshop, for ${bossOf(r).name}'s team` : 'house');
  const PAPERS = ['#fbf6ec', '#f6ead6', '#f3e3cc', '#f7efe0', '#f8ecd9', '#f4e6d0', '#faf1e4', '#f2e0c6'];
  const FLOORS = ['#d98d63', '#e3b48a', '#cf9a6e', '#e8c9a0', '#d48a66', '#dcae84', '#c98a63', '#e6bf96'];
  const RUGS = ['#b5523b', '#2b8a8a', '#c98a2b', '#3f7d5a', '#d9643f', '#1f6f8b', '#a8473a', '#237777'];

  // ---------- scenes ----------
  const scenes = {};
  const HALL_SEATS = [];  // guide step 29: everyone's own seat at the council table, filled in when the hall is built

  function buildTown() {
    const s = newScene('town', 'Kingdom One', 80, 60, { outdoor: true });
    // ground: sand with patches of oasis grass
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (noise(x / 5.5, y / 5.5) > 0.66) setTile(s, x, y, GRASS);
    // roads: the main street, the road to the south gate and the south street
    fill(s, 3, 27, 76, 28, PATH);
    fill(s, 39, 36, 40, 56, PATH);
    fill(s, 6, 46, 73, 47, PATH);
    // the square, bordered in zellige, and the town hall steps
    fill(s, 32, 22, 47, 35, STONE);
    for (let x = 32; x <= 47; x++) { setTile(s, x, 22, ZELLIGE); setTile(s, x, 35, ZELLIGE); }
    for (let y = 22; y <= 35; y++) { setTile(s, 32, y, ZELLIGE); setTile(s, 47, y, ZELLIGE); }
    fill(s, 39, 20, 40, 21, STONE);
    fill(s, 35, 20, 37, 21, BED);
    fill(s, 42, 20, 44, 21, BED);
    // the oasis pool in Steward's private garden, with grass around it
    for (let y = 3; y <= 13; y++) for (let x = 63; x <= 76; x++) {
      const dx = (x + 0.5 - 70.5) / 5.2, dy = (y + 0.5 - 8) / 3, d = dx * dx + dy * dy;
      if (d <= 1) setTile(s, x, y, WATER); else if (d <= 2.1 && tileAt(s, x, y) === SANDT) setTile(s, x, y, GRASS);
    }
    // the private garden's hedge, with a gap for its gate, and Steward's vegetable patch
    for (let y = 3; y <= 23; y++) setTile(s, 62, y, HEDGE);
    for (let x = 62; x <= 76; x++) if (x !== 68) setTile(s, x, 23, HEDGE);
    fill(s, 70, 20, 72, 21, VEG);
    // the medina wall with a gate on the south road
    s.wallSet = new Set();
    const wall = (x, y) => { setTile(s, x, y, WALL); s.wallSet.add(y * s.w + x); };
    for (let x = 2; x <= s.w - 3; x++) { wall(x, 2); if (x !== 39 && x !== 40) wall(x, s.h - 3); }
    for (let y = 3; y <= s.h - 4; y++) { wall(2, y); wall(s.w - 3, y); }
    // outside the medina wall: the desert edge of the map, where nobody goes (guide step 31)
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (x < 2 || y < 2 || x > s.w - 3 || y > s.h - 3) s.solid[y * s.w + x] = 1;
    // villas, one per resident
    const houses = RES.filter((r) => !r.hire).map((r, i) => {
      const b = addHouse(s, i, r);
      const dx = b.door.x, dy = b.door.y, road = b.y < 27 ? 26 : 45;
      if (r.q === 'private') fill(s, dx, dy + 1, dx, 22, PATH);  // to the garden path, below
      else fill(s, dx, dy + 1, dx, road, PATH);
      if (b.key === 'scholar') { fill(s, dx - 2, dy + 2, dx, dy + 2, PATH); fill(s, dx - 2, dy + 2, dx - 2, road, PATH); }
      // at night: the door lantern and two lit windows
      s.lights.push({ x: (dx + 0.5) * T, y: (dy + 0.4) * T, r: 72 });
      for (const f of [0.2, 0.8]) s.lights.push({ x: (b.x + b.w * f) * T, y: (b.y + b.h - 2) * T, r: 48 });
      addObj(s, { floor: true, sortY: 0, bx: dx * T - 4, by: (dy + 1) * T - 4, bw: T + 8, bh: T + 8, draw: (c) => drawDoorstep(c, dx * T, (dy + 1) * T, b.accent) });
      const boss = bossOf(r);
      addSign(s, dx + 2, dy + 1, b.accent, boss
        ? `${b.title}, a workshop. ${b.name}, ${b.role}, works for ${boss.name} (${boss.role}), who gives every task and checks all the work: ${b.job} ${b.name} works here, in the saffron vest every worker wears. No tasks yet.`
        : `${b.title}. ${b.name}, ${b.role}, a director: ${b.job} ${b.name} lives here.`);
      if (b.yard[0]) addProp(s, b.yard[0], b.x + 1, b.y + 5, b);
      if (b.yard[1]) addProp(s, b.yard[1], b.x + 6, b.y + 5, b);
      return b;
    });
    const steward = houses.find(b => b.key === 'steward');
    fill(s, 67, 22, 74, 22, PATH); fill(s, 68, 22, 68, 26, PATH);  // the garden path, out through the gate
    addProp(s, 'hammock', 64, 20, steward, 2);
    addProp(s, 'trunk', 66, 19, steward);
    const hall = addHall(s, 34, 12);
    s.lights.push({ x: (hall.x + 6) * T, y: (hall.y + 7) * T, r: 110 });
    for (const f of [0.15, 0.85]) s.lights.push({ x: (hall.x + hall.w * f) * T, y: (hall.y + 5) * T, r: 56 });
    finishTiles(s);
    for (const i of s.wallSet) addWallTile(s, i % s.w, (i / s.w) | 0);
    addGate(s, 39, s.h - 3);
    addObj(s, { sortY: 24 * T - 2, bx: 67 * T - 8, by: 23 * T - 60, bw: 3 * T + 16, bh: T + 66, draw: (c) => drawGardenGate(c, 68 * T, 23 * T) });
    addSign(s, 69, 24, steward.accent, "Steward's private garden. Personal plans and records stay in here, apart from business and client work.");

    // the square and the roads
    addFountain(s, 38, 27);
    for (const [x, y] of [[32, 22], [47, 22], [32, 35], [47, 35], [18, 26], [60, 26], [24, 29], [56, 29], [38, 50], [41, 50]]) addLantern(s, x, y);
    for (const [x, y] of [[34, 25], [44, 25], [34, 33], [44, 33]]) addBench(s, x, y);
    const vizier = { name: 'Vizier', title: 'the town hall' };
    addProp(s, 'dispatch', 35, 23, vizier, 2);
    addProp(s, 'dispatch', 43, 23, vizier, 2);
    addSign(s, 42, 54, BRASS, 'Welcome to Kingdom One. Thirteen villas and the town hall are ready, but nobody has moved in yet.', true);
    for (const [x, y] of [[33, 20], [46, 20]]) addAgave(s, x, y, true);
    addTownLife(s, houses);

    // keep space clear around everything that is not open ground, then plant palms and trees
    const clear = new Uint8Array(s.w * s.h);
    const mark = (x, y, r) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (inside(s, x + dx, y + dy)) clear[(y + dy) * s.w + x + dx] = 1;
    };
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const t = tileAt(s, x, y);
      if (t === WALL) continue;
      if (!OPEN_GROUND.has(t) || s.solid[y * s.w + x]) mark(x, y, 1);
    }
    for (const b of [...houses, hall]) {
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) mark(x, y, 1);
      for (const d of b.doors) mark(d.x, d.y + 1, 2);
    }
    const r = rng(20261121);
    const treeAt = new Uint8Array(s.w * s.h);
    const nearTree = (x, y) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inside(s, x + dx, y + dy) && treeAt[(y + dy) * s.w + x + dx]) return true;
      return false;
    };
    const nearWater = (x, y) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (tileAt(s, x + dx, y + dy) === WATER) return true;
      return false;
    };
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const t = tileAt(s, x, y);
      if (!OPEN_GROUND.has(t) || s.solid[y * s.w + x]) continue;
      const outside = x < 2 || y < 2 || x >= s.w - 2 || y >= s.h - 2;
      if (outside) { if (y >= s.h - 2 && x >= 35 && x <= 44) continue; if (r() < 0.8) { addTree(s, x, y, r, true); treeAt[y * s.w + x] = 1; } continue; }
      if (clear[y * s.w + x]) continue;
      const nearWall = x < 6 || y < 6 || x >= s.w - 6 || y >= s.h - 6;
      const roll = r();
      if (nearWater(x, y)) { if (roll < 0.4 && !nearTree(x, y)) { addTree(s, x, y, r, true); treeAt[y * s.w + x] = 1; } continue; }
      if (nearWall && roll < 0.3 && !nearTree(x, y)) { addTree(s, x, y, r, r() < 0.75); treeAt[y * s.w + x] = 1; }
      else if (roll < 0.06 && !nearTree(x, y)) { addTree(s, x, y, r, r() < 0.6); treeAt[y * s.w + x] = 1; }
      else if (roll < 0.078 && !nearTree(x, y)) addAgave(s, x, y, false);
      else if (roll < 0.088) addRock(s, x, y, r);
    }
    s.houses = houses; s.hall = hall;
    return s;
  }

  function addHouse(s, i, r) {
    const x = r.x, y = r.y;
    const b = {
      kind: 'house', i, id: 'house-' + r.key, key: r.key, name: r.name, title: r.title, role: r.role, job: r.job,
      quarter: r.q, type: r.type, flip: !!r.flip, yard: r.yard, room: r.room, owner: null,
      x, y, w: r.w || 7, h: r.h || 5, wall: r.wall, accent: r.accent,
    };
    b.door = { x: x + Math.floor(b.w / 2), y: y + b.h - 1 };
    b.doors = [b.door];
    for (let yy = y; yy < y + b.h; yy++) for (let xx = x; xx < x + b.w; xx++) {
      if (xx === b.door.x && yy === b.door.y) continue;
      solidify(s, xx, yy);
    }
    addObj(s, { sortY: (y + b.h) * T, bx: x * T - 50, by: y * T - 130, bw: b.w * T + 100, bh: b.h * T + 140, draw: (c, t) => drawVilla(c, b, t) });
    s.doors.push({ x: b.door.x, y: b.door.y, to: b.id + '-in', label: r.boss ? `${b.title} · ${r.name} works here · ${bossOf(r).name}'s team` : `${b.title} · ${r.name} lives here`, building: b });
    return b;
  }

  function addHall(s, x, y) {
    const b = { kind: 'hall', id: 'hall', name: 'Town Hall', x, y, w: 12, h: 8, wall: PLASTER, accent: LAGOON };
    b.doors = [{ x: x + 5, y: y + 7 }, { x: x + 6, y: y + 7 }];
    b.door = b.doors[0];
    for (let yy = y; yy < y + b.h; yy++) for (let xx = x; xx < x + b.w; xx++) {
      if (b.doors.some(d => d.x === xx && d.y === yy)) continue;
      solidify(s, xx, yy);
    }
    addObj(s, { sortY: (y + b.h) * T, bx: x * T - 40, by: y * T - 120, bw: b.w * T + 80, bh: b.h * T + 130, draw: (c, t) => drawHall(c, b, t) });
    for (const d of b.doors) s.doors.push({ x: d.x, y: d.y, to: 'hall-in', label: 'Town Hall · Vizier, Chief of Staff', building: b });
    return b;
  }

  function addTree(s, x, y, r, palm) {
    const size = 0.85 + r() * 0.35, jx = (r() - 0.5) * 8, jy = (r() - 0.5) * 4, lean = (r() - 0.5) * 16, citrus = r() < 0.4, rot = r() * 6.28;
    solidify(s, x, y);
    const bx = x * T + 16 + jx, by = y * T + 26 + jy;
    addObj(s, { sortY: by, bx: bx - 50, by: by - 100, bw: 100, bh: 110, draw: (c, t) => palm ? drawPalm(c, bx, by, size, lean, rot, t) : drawOlive(c, bx, by, size, citrus) });
  }
  // ---------- guide step 16: small props so the town feels lived in ----------
  // Each piece is placed only on open sand, grass or the square: never on a road or path,
  // never in the 3x3 zone in front of a door, and never on top of something else.
  const DECOR_MSG = {
    barrels: 'Cedar barrels with brass hoops, full of olive oil. Waiting for the village to need them.',
    produce: 'Crates of oranges and dates, fresh from the oasis.',
    bush: 'A round clipped shrub.',
    bloom: 'A clipped shrub in flower.',
    fence: 'A low carved cedar fence.',
    flowerbox: 'A raised planter of bougainvillea.',
    juicecart: 'A fresh orange-juice cart with a striped awning. The glasses are clean and waiting: nobody to serve yet.',
    spicestall: 'A spice stall with cones of cumin, paprika and turmeric. Nobody is minding it yet.',
    pottery: 'Stacked terracotta pots and jars.',
    baskets: 'Woven palm baskets, stacked and empty.',
  };
  function addTownLife(s, houses) {
    const okTile = new Set([SANDT, GRASS, STONE]);
    const doorZone = (x, y) => s.doors.some(d => Math.abs(x - d.x) <= 1 && y > d.y && y <= d.y + 3);
    const canPlace = (x, y, w) => {
      for (let k = 0; k < w; k++) {
        const xx = x + k;
        if (!inside(s, xx, y) || !okTile.has(tileAt(s, xx, y)) || s.solid[y * s.w + xx] || doorZone(xx, y)) return false;
      }
      return true;
    };
    const put = (kind, x, y, w = 1) => {
      if (!canPlace(x, y, w)) return null;
      const o = addObj(s, { kind, sortY: (y + 1) * T - 2, bx: x * T - 12, by: y * T - 50, bw: w * T + 24, bh: T + 56, msg: DECOR_MSG[kind], draw: (c, t) => DECOR[kind](c, x * T, y * T, w * T, t) });
      solidify(s, x, y, w, 1, o);
      return o;
    };
    // the square: a juice cart, a spice stall, pottery and baskets
    put('juicecart', 44, 30, 2); put('spicestall', 34, 30, 2);
    put('pottery', 33, 27); put('baskets', 46, 27); put('pottery', 46, 31); put('baskets', 33, 31);
    // along the main street
    for (const [k, x, y, w] of [['flowerbox', 28, 25, 2], ['flowerbox', 54, 25, 2], ['bush', 6, 29], ['bloom', 14, 30], ['bush', 29, 30],
      ['bloom', 50, 30], ['bush', 66, 30], ['bloom', 74, 29], ['produce', 11, 25], ['barrels', 20, 24], ['bush', 45, 25], ['bloom', 31, 25]]) put(k, x, y, w || 1);
    // flanking the road to the gate
    for (const [k, x, y, w] of [['bush', 36, 37], ['bush', 43, 37], ['bloom', 36, 42], ['bloom', 43, 42], ['fence', 34, 52, 3], ['fence', 43, 52, 3]]) put(k, x, y, w || 1);
    // workshop quarter: barrels and crates by the yards
    for (const [k, x, y] of [['barrels', 41, 44], ['produce', 50, 44], ['barrels', 58, 44], ['produce', 66, 44], ['barrels', 75, 44], ['produce', 4, 44], ['barrels', 20, 44], ['produce', 30, 44]]) put(k, x, y);
    // along the south street
    for (const [k, x, y] of [['bush', 12, 49], ['bloom', 22, 49], ['bush', 30, 49], ['bloom', 50, 49], ['bush', 58, 49], ['bloom', 68, 49]]) put(k, x, y);
    // north quarter yards
    for (const [k, x, y, w] of [['flowerbox', 10, 21, 2], ['fence', 19, 21, 3], ['barrels', 4, 21], ['flowerbox', 46, 17, 2]]) put(k, x, y, w || 1);
    // Steward's garden: a low fence along the oasis and a bush or two
    put('fence', 64, 15, 3); put('fence', 72, 15, 3); put('bloom', 75, 19); put('bush', 63, 17);
    // more street lamps for night time: main street, south street, the gate road and the quarter paths
    for (const [x, y] of [[6, 26], [12, 29], [30, 26], [28, 29], [50, 26], [52, 29], [68, 29], [72, 26],
      [10, 48], [20, 45], [28, 48], [36, 48], [44, 48], [50, 45], [60, 48], [70, 45], [38, 43], [41, 43], [38, 38], [41, 38]]) {
      if (canPlace(x, y, 1)) addLantern(s, x, y);
    }
    s.lights.push({ x: 40 * T, y: 29 * T, r: 90 });  // the fountain catches the light
    // lantern strings over the main street (overhead, so they block nothing)
    for (const [x0, x1] of [[18, 24], [56, 60]]) for (let k = 1; k < 4; k++) s.lights.push({ x: (x0 + (x1 - x0) * k / 4 + 0.5) * T, y: 27.4 * T, r: 54 });
    for (const [x0, x1] of [[18, 24], [56, 60]]) addObj(s, { sortY: 1e9, bx: x0 * T, by: 24 * T, bw: (x1 - x0 + 1) * T, bh: 4 * T, draw: (c, t) => drawLanternString(c, x0 * T + 16, 26 * T - 30, x1 * T + 16, 29 * T - 30, t) });
    // a cat asleep on a bench in the square
    addObj(s, { sortY: 26 * T + 1, bx: 34 * T, by: 25 * T - 10, bw: T, bh: T, msg: 'A cat, fast asleep in the sun. It lives here, whoever moves in.', draw: (c, t) => drawCat(c, 35 * T + 6, 25 * T + 8, t) });
  }
  const DECOR = {
    barrels(c, X, Y) {
      sh(c, X + 16, Y + 28, 15);
      for (const [bx, by, k] of [[X + 2, Y + 8, 1], [X + 16, Y + 10, 0.9], [X + 9, Y - 6, 0.85]]) {
        const w = 15 * k, h = 18 * k;
        box(c, bx, by, w, h, '#9a6238'); box(c, bx + w * 0.65, by, w * 0.35, h, '#7a4b2a');
        box(c, bx, by + 3, w, 2, BRASS); box(c, bx, by + h - 5, w, 2, BRASS);
        c.fillStyle = '#b0743f'; ellipse(c, bx + w / 2, by, w / 2, 3); outlineRect(c, bx, by, w, h, 1);
      }
    },
    produce(c, X, Y) {
      sh(c, X + 16, Y + 28, 15);
      crate(c, X + 2, Y + 12, 15, 15, TERRA); crate(c, X + 16, Y + 14, 14, 13, PALM);
      c.fillStyle = '#f0a23b'; for (const [dx, dy] of [[5, 11], [9, 10], [13, 11], [7, 8], [11, 8]]) circle(c, X + dx, Y + dy, 2.6);
      c.fillStyle = '#7a4120'; for (const [dx, dy] of [[19, 13], [22, 12], [25, 13], [21, 10], [24, 10]]) ellipse(c, X + dx, Y + dy, 2.2, 1.6);
    },
    bush(c, X, Y) { drawShrub(c, X + 16, Y + 26, false); },
    bloom(c, X, Y) { drawShrub(c, X + 16, Y + 26, true); },
    fence(c, X, Y, W) {
      c.fillStyle = SHADOW; c.fillRect(X + 4, Y + 24, W, 4);
      box(c, X + 2, Y + 8, W - 4, 4, '#9a6238'); box(c, X + 2, Y + 16, W - 4, 4, '#8a5a32');
      for (let px = X + 3; px < X + W - 2; px += 10) { box(c, px, Y + 2, 5, 22, '#7a4b2a'); c.fillStyle = '#7a4b2a'; circle(c, px + 2.5, Y + 2, 2.5); box(c, px + 1, Y + 4, 1, 18, '#a8703f'); }
      outlineRect(c, X + 2, Y + 8, W - 4, 12, 1);
    },
    flowerbox(c, X, Y, W) {
      c.fillStyle = SHADOW; c.fillRect(X + 6, Y + 26, W - 4, 4);
      box(c, X + 2, Y + 12, W - 4, 14, '#e6d3b3'); box(c, X + 2, Y + 12, W - 4, 2, '#f3e6cf'); zelligeStrip(c, X + 4, Y + 17, W - 8, 6, LAGOON);
      outlineRect(c, X + 2, Y + 12, W - 4, 14, 1);
      for (let i = 0; i < 7; i++) { c.fillStyle = i % 2 ? PALM : '#3f7d4a'; circle(c, X + 6 + (W - 12) * i / 6, Y + 8 + (i % 3) * 2, 6); }
      for (let i = 0; i < 12; i++) box(c, X + 4 + hash(i, X, 1) * (W - 10), Y + 2 + hash(i, Y, 2) * 10, 3, 3, ['#c2367a', '#e05a9c', '#f08cbc'][i % 3]);
    },
    juicecart(c, X, Y, W, t) {
      c.fillStyle = SHADOW; ellipse(c, X + W / 2 + 6, Y + 28, W / 2, 6);
      box(c, X + 4, Y + 6, W - 8, 18, '#e6d3b3'); zelligeStrip(c, X + 6, Y + 14, W - 12, 6, TERRA); outlineRect(c, X + 4, Y + 6, W - 8, 18, 1);
      for (const wx of [X + 12, X + W - 12]) { c.fillStyle = '#5a3220'; circle(c, wx, Y + 26, 6); c.fillStyle = BRASS; circle(c, wx, Y + 26, 2); }
      box(c, X + 6, Y - 26, 2, 32, '#7a4b2a'); box(c, X + W - 8, Y - 26, 2, 32, '#7a4b2a');
      for (let k = 0; k < 6; k++) box(c, X + 2 + k * (W - 4) / 6, Y - 32, (W - 4) / 6 + 0.5, 10, k % 2 ? '#fbf6ec' : '#f0a23b');
      c.fillStyle = '#f0a23b'; for (let k = 0; k < 9; k++) circle(c, X + 14 + (k % 5) * 5 + (k > 4 ? 2 : 0), Y + 2 - (k > 4 ? 4 : 0), 2.8);
      for (const gx of [X + W - 22, X + W - 16]) { box(c, gx, Y - 2, 4, 7, '#fbd27a'); box(c, gx, Y - 2, 4, 1, '#fff6d8'); }
      box(c, X + 6, Y - 40, 1.5, 8, '#7a4b2a'); drawPennant(c, X + 7.5, Y - 40, t, TERRA);
    },
    spicestall(c, X, Y, W, t) {
      box(c, X + W - 6, Y - 38, 1.5, 8, '#7a4b2a'); drawPennant(c, X + W - 4.5, Y - 38, t, LAGOON);
      c.fillStyle = SHADOW; c.fillRect(X + 6, Y + 24, W - 4, 5);
      box(c, X + 3, Y + 10, W - 6, 14, '#9a6238'); box(c, X + 3, Y + 10, W - 6, 2, '#c88a52'); outlineRect(c, X + 3, Y + 10, W - 6, 14, 1);
      box(c, X + 4, Y - 24, 2, 34, '#7a4b2a'); box(c, X + W - 6, Y - 24, 2, 34, '#7a4b2a');
      for (let k = 0; k < 6; k++) box(c, X + 1 + k * (W - 2) / 6, Y - 30, (W - 2) / 6 + 0.5, 9, k % 2 ? '#fbf6ec' : LAGOON);
      const cols = ['#c98a2b', '#b5523b', '#e8b04b', '#7a4120', '#d9643f'];
      cols.forEach((col, k) => { const cx = X + 10 + k * (W - 20) / 4; c.fillStyle = '#e6d3b3'; ellipse(c, cx, Y + 10, 6, 3); c.fillStyle = col; c.beginPath(); c.moveTo(cx - 5, Y + 9); c.lineTo(cx + 5, Y + 9); c.lineTo(cx, Y - 2); c.closePath(); c.fill(); });
    },
    pottery(c, X, Y) {
      sh(c, X + 16, Y + 28, 14);
      c.fillStyle = TERRA; ellipse(c, X + 10, Y + 18, 8, 9); c.fillStyle = '#c4522f'; ellipse(c, X + 22, Y + 20, 7, 7);
      c.fillStyle = '#e88a62'; ellipse(c, X + 15, Y + 6, 6, 8); box(c, X + 12, Y - 3, 6, 3, '#c4522f');
      c.fillStyle = LAGOON; ellipse(c, X + 22, Y + 19, 7, 2);
    },
    baskets(c, X, Y) {
      sh(c, X + 16, Y + 28, 14);
      for (const [bx, by, w] of [[X + 3, Y + 14, 14], [X + 15, Y + 16, 13], [X + 8, Y + 4, 13]]) {
        box(c, bx, by, w, 11, '#d8b87a');
        for (let k = 0; k < 3; k++) box(c, bx, by + 2 + k * 3, w, 1, '#b8955a');
        box(c, bx, by, w, 2, '#c49a5c'); outlineRect(c, bx, by, w, 11, 1);
      }
    },
  };
  function drawShrub(c, cx, gy, flowers) {
    c.fillStyle = SHADOW; ellipse(c, cx + 5, gy, 14, 4);
    c.fillStyle = '#3f7d4a'; circle(c, cx, gy - 11, 12);
    c.fillStyle = PALM; circle(c, cx - 3, gy - 14, 9); c.fillStyle = '#6aa85a'; circle(c, cx - 5, gy - 17, 4);
    c.strokeStyle = 'rgba(15,42,46,0.35)'; c.lineWidth = 1; c.beginPath(); c.arc(cx, gy - 11, 12, 0, Math.PI * 2); c.stroke();
    if (flowers) for (let i = 0; i < 7; i++) box(c, cx - 9 + hash(i, cx, 3) * 16, gy - 21 + hash(i, gy, 4) * 16, 3, 3, ['#c2367a', '#e05a9c', '#fbf6ec'][i % 3]);
  }
  function drawLanternString(c, x0, y0, x1, y1, t) {
    const n = 7, sag = 18;
    c.strokeStyle = 'rgba(90,50,32,0.8)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, y0);
    c.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag * 2, x1, y1); c.stroke();
    for (let k = 1; k < n; k++) {
      const f = k / n, mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + sag * 2;
      const x = (1 - f) * (1 - f) * x0 + 2 * f * (1 - f) * mx + f * f * x1, y = (1 - f) * (1 - f) * y0 + 2 * f * (1 - f) * my + f * f * y1;
      const col = [BRASS, TERRA, LAGOON][k % 3];
      c.fillStyle = `rgba(255,214,130,${0.18 + Math.sin(t * 2 + k) * 0.04})`; circle(c, x, y + 6, 8);
      c.fillStyle = col; c.beginPath(); c.moveTo(x - 3, y + 2); c.lineTo(x + 3, y + 2); c.lineTo(x + 4, y + 8); c.lineTo(x, y + 12); c.lineTo(x - 4, y + 8); c.closePath(); c.fill();
    }
  }
  function drawCat(c, x, y, t) {
    const b = Math.sin(t * 1.5) * 0.6;  // breathing
    c.fillStyle = '#d9843f'; ellipse(c, x, y, 9, 5 + b * 0.3);
    c.fillStyle = '#d9843f'; circle(c, x + 8, y - 2, 4.5);
    c.beginPath(); c.moveTo(x + 5, y - 5); c.lineTo(x + 6, y - 9); c.lineTo(x + 8, y - 6); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(x + 9, y - 6); c.lineTo(x + 11, y - 9); c.lineTo(x + 12, y - 5); c.closePath(); c.fill();
    c.strokeStyle = '#d9843f'; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 8, y + 1); c.quadraticCurveTo(x - 4, y + 7, x + 4, y + 5); c.stroke();
    box(c, x - 3, y - 4, 2, 6, '#b8692e'); box(c, x + 1, y - 4, 2, 6, '#b8692e');
    c.strokeStyle = TEAL; c.lineWidth = 0.8; c.beginPath(); c.moveTo(x + 6, y - 2); c.lineTo(x + 8, y - 2); c.moveTo(x + 9, y - 2); c.lineTo(x + 11, y - 2); c.stroke();
  }

  function addAgave(s, x, y, big) {
    const bx = x * T + 16, by = y * T + 26;
    const o = addObj(s, { sortY: by, bx: bx - 20, by: by - 36, bw: 40, bh: 42, msg: 'A terracotta planter with an agave.', draw: (c) => drawAgave(c, bx, by, big) });
    solidify(s, x, y, 1, 1, o);
  }
  function addRock(s, x, y, r) {
    const bx = x * T + 16 + (r() - 0.5) * 8, by = y * T + 20, k = 0.7 + r() * 0.5;
    addObj(s, { sortY: by, bx: bx - 16, by: by - 16, bw: 32, bh: 24, draw: (c) => drawRock(c, bx, by, k) });
  }
  function addLantern(s, x, y) {
    const bx = x * T + 16, by = y * T + 26;
    const o = addObj(s, { sortY: by, bx: bx - 24, by: by - 70, bw: 48, bh: 76, msg: 'A brass street lantern, pierced with stars. It lights the street at night.', draw: (c, t) => drawLantern(c, bx, by, t) });
    solidify(s, x, y, 1, 1, o);
    s.lights.push({ x: bx, y: by - 20, r: 110 });
  }
  function addBench(s, x, y) {
    const o = addObj(s, { sortY: (y + 1) * T, bx: x * T, by: y * T - 6, bw: 2 * T + 8, bh: T + 10, msg: 'A cedar bench on the square. Nobody is sitting here yet.', draw: (c) => drawBench(c, x * T, y * T) });
    solidify(s, x, y, 2, 1, o);
  }
  function addSign(s, x, y, color, msg, big = false) {
    const bx = x * T + 16, by = y * T + 26;
    const o = addObj(s, { sortY: by, bx: bx - 26, by: by - 50, bw: 52, bh: 56, msg, draw: (c) => drawSign(c, bx, by, color, big) });
    solidify(s, x, y, 1, 1, o);
  }
  function addFountain(s, x, y) {
    const cx = (x + 2) * T, cy = (y + 2) * T;
    const o = addObj(s, { sortY: (y + 4) * T - 4, bx: cx - 72, by: cy - 90, bw: 150, bh: 160, msg: 'The octagonal fountain. The water is clear and cold.', draw: (c, t) => drawFountain(c, cx, cy, t) });
    solidify(s, x, y, 4, 4, o);
  }
  function addWallTile(s, x, y) {
    addObj(s, { sortY: (y + 1) * T - 1, bx: x * T - 2, by: y * T - 22, bw: T + 4, bh: T + 24, draw: (c) => drawWallTile(c, s, x, y) });
  }
  function addGate(s, x, y) {
    const o = addObj(s, { sortY: (y + 1) * T, bx: x * T - 24, by: y * T - 64, bw: 2 * T + 48, bh: T + 70, msg: 'The south gate. It stays shut: the world beyond is not built yet.', draw: (c) => drawGate(c, x * T, y * T) });
    setTile(s, x, y, WALL); setTile(s, x + 1, y, WALL);
    solidify(s, x, y, 2, 1, o);
  }

  // ---------- interiors ----------
  // Guide step 13: a standing person is one twelfth of the room's height, so rooms are 14 tiles tall,
  // with a thin back wall, open floor between pieces, one desk and chair for the owner, and a job layout.
  const ROOM_JOBS = {
    keeper: ['pegboard', 'crates', 'files', 'sundial', 'letterboxes', 'crates'],
    librarian: ['scrolls', 'books', 'reading', 'scrolls', 'books', 'reading'],
    merchant: ['ledgers', 'teaset', 'scales', 'biz0', 'biz1', 'biz2'],
    scholar: ['maptable', 'astrolabe', 'books', 'spyglass', 'drafting', 'reading'],
    engineer: ['workbench', 'rack', 'crates', 'rack', 'drafting', 'workbench'],
    youtube: ['screen', 'reels', 'tripod', 'screen', 'reels', 'prints'],
    scout: ['spyglass', 'maptable', 'books', 'dovecote', 'reading', 'scrolls'],
    media: ['prints', 'tripod', 'darkroom', 'prints', 'crates', 'prints'],
    studio: ['drafting', 'crates', 'workbench', 'drafting', 'books', 'crates'],
    inbox: ['letterboxes', 'postcart', 'files', 'dovecote', 'letterboxes', 'crates'],
    money: ['scales', 'strongbox', 'ledgers', 'strongbox', 'files', 'scales'],
    steward: ['trunk', 'herbs', 'reading', 'herbs', 'books', 'teaset'],
    garden: ['herbs', 'trunk', 'files', 'herbs', 'reading', 'teaset'],
  };
  const HAS_FIREPLACE = new Set(['steward', 'librarian']);
  const deskMsg = (name, key) => (RES.find((r) => r.key === key) || {}).boss
    ? `${name}'s desk and chair, where ${name} sits and works. The desk is clear: no tasks yet.`
    : `${name}'s desk and chair, where ${name} sits and works. Nothing is waiting on it yet.`;

  function buildHouseInterior(b) {
    const i = b.i, w = 19, h = 14;
    const pal = { paper: PAPERS[i % 8], floor: FLOORS[(i * 3) % 8], accent: b.accent, rug: RUGS[(i + 3) % 8] };
    const s = newScene(b.id + '-in', b.title, w, h, { palette: pal, building: b });
    roomShell(s, [9]);
    const m = (x, fw = 1) => (b.flip ? w - x - fw : x);
    for (const x of [2.1, 14.9]) s.wallDecor.push({ draw: (g) => drawWindowDecor(g, (b.flip ? w - x - 1.8 : x) * T, 4, 1.8 * T, 20, pal) });
    s.wallDecor.push({ draw: (g) => drawWallPlate(g, 9.5 * T, 13, 9, pal) });
    // the owner's desk, facing the door
    addFurn(s, 'rug', 6, 5, 7, 5, { floor: true, silk: true });
    addFurn(s, 'deskchair', 9, 2, 1, 1, { msg: deskMsg(b.name, b.key) });
    addFurn(s, 'ownerdesk', 8, 3, 3, 1, { msg: deskMsg(b.name, b.key) });
    addFurn(s, 'bookshelf', m(5, 2), 1, 2, 1);
    // guide step 18: fire only where there is a real fireplace, and these rooms have one (with a chimney outside)
    if (HAS_FIREPLACE.has(b.key)) addFurn(s, 'fireplace', m(12, 2), 1, 2, 1);
    else addFurn(s, 'bookshelf', m(12, 2), 1, 2, 1);
    // private corner behind a carved screen
    addFurn(s, 'bed', m(1, 2), 1, 2, 2);
    addFurn(s, 'nightstand', m(3), 1, 1, 1);
    addFurn(s, 'screen', m(1, 3), 4, 3, 1);
    // lounge for visitors
    addFurn(s, 'divan', m(14, 3), 1, 3, 1);
    addFurn(s, 'table', m(14, 2), 3, 2, 1);
    addFurn(s, 'chair', m(16), 3, 1, 1);
    // the job
    const jobs = ROOM_JOBS[b.key] || b.room;
    const BIZ_NAMES = ['your first business', 'your second business', 'future ventures'];
    [[2, 7], [4, 7], [2, 10], [14, 7], [16, 7], [16, 10]].forEach(([x, y], k) => {
      const job = jobs[k];
      if (!job) return;
      if (job.startsWith('biz')) {  // Merchant keeps a separate desk for each business
        const n = +job[3];
        addFurn(s, 'bizdesk', m(x), y, 1, 1, { color: BIZ[n], msg: `Merchant's ${BIZ_NAMES[n]} desk. Each business has its own desk and papers, kept apart. Nothing on it yet.` });
      } else addProp(s, job, m(x), y, b);
    });
    // finish
    addFurn(s, 'fountain', m(12, 2), 10, 2, 2);
    addFurn(s, 'chest', m(5), 11, 1, 1);
    for (const x of [7, 11]) addFurn(s, 'lamp', x, 12, 1, 1);
    for (const x of [1, 17]) addFurn(s, 'plant', x, 12, 1, 1);
    addChandelier(s, 9.5, 7.2);
    exitDoors(s, b, [9]);
    return s;
  }

  function buildHallInterior(b) {
    const w = 26, h = 16;
    const pal = { paper: PLASTER, floor: '#e3b48a', accent: LAGOON, rug: '#b5523b' };
    const s = newScene('hall-in', 'Town Hall', w, h, { palette: pal, building: b });
    roomShell(s, [12, 13]);
    s.wallDecor.push({ draw: (g) => drawNoticeBoard(g, 1.4 * T, 5, 2 * T, 20) });
    for (const x of [4.4, 19.8]) s.wallDecor.push({ draw: (g) => drawWindowDecor(g, x * T, 4, 1.8 * T, 20, pal) });
    for (const x of [6.9, 18.2]) s.wallDecor.push({ draw: (g) => drawHanging(g, x * T, 1, pal, 22) });
    s.wallDecor.push({ draw: (g) => drawWallPlate(g, 13 * T, 14, 11, pal) });
    const vizier = { name: 'Vizier', title: 'the town hall' };
    // Guide step 14: one big table with a seat for each of the 14 agents, and the head chair for the director
    addFurn(s, 'bookshelf', 8, 1, 2, 1);
    addFurn(s, 'bookshelf', 16, 1, 2, 1);
    addFurn(s, 'fireplace', 12, 1, 2, 1, { msg: 'The great hall fireplace, behind the head of the table. The fire is lit and crackling.' });
    addFurn(s, 'lectern', 3, 4, 2, 1, { msg: "Vizier's briefing lectern, for the daily briefing. No briefing has been given yet." });
    addProp(s, 'dispatch', 21, 4, vizier, 2);
    addFurn(s, 'rug', 9, 3, 8, 10, { floor: true, silk: true });
    HALL_SEATS.push({ key: 'you', x: 13 * T, y: 3 * T + 33, dir: 'down', sortY: 4 * T + 1 });
    addFurn(s, 'headchair', 12, 3, 2, 1, { msg: "Your chair, Chief Human Officer, at the head of the table. You run the council from here, and Vizier sits at your right hand." });
    const seats = ['Vizier', ...RES.map(r => r.name)];
    const table = addFurn(s, 'banquet', 12, 4, 2, Math.ceil(seats.length / 2), { msg: `The council table, with a seat for every agent in the village (${seats.length}). Everyone has moved in. The council hasn't met yet.` });
    seats.forEach((name, k) => {  // Vizier first, at the director's right hand (west, since the head chair faces the door)
      const left = k % 2 === 0, row = 4 + Math.floor(k / 2);
      const msg = name === 'Vizier'
        ? "Vizier's seat, at your right hand. Vizier sits here when the council meets."
        : `${name}'s seat at the council table, empty until the council meets.`;
      addFurn(s, 'sidechair', left ? 11 : 14, row, 1, 1, { side: left ? -1 : 1, msg, accent: k === 0 ? BRASS : (RES[k - 1] || {}).accent });
      // where they sit: on the cushion, facing the table, legs under it
      HALL_SEATS.push({ key: k === 0 ? 'vizier' : RES[k - 1].key, x: (left ? 11 : 14) * T + 16 + (left ? 10 : -10), y: row * T + 25, dir: left ? 'right' : 'left', sortY: (row + 1) * T + 1 });
    });
    table.sortY = (4 + Math.ceil(seats.length / 2)) * T + 16;  // drawn after everyone seated, so their legs go under it
    // sides
    addFurn(s, 'chest', 1, 7, 1, 1, { msg: "Vizier's records chest, for outstanding work and decisions. No records yet." });
    addFurn(s, 'divan', 1, 10, 3, 1); addFurn(s, 'divan', 22, 10, 3, 1);
    addFurn(s, 'fountain', 3, 12, 2, 2); addFurn(s, 'fountain', 21, 12, 2, 2);
    addFurn(s, 'screen', 21, 7, 3, 1);
    for (const x of [10, 15]) addFurn(s, 'lamp', x, 14, 1, 1);
    for (const [x, y] of [[1, 14], [24, 14], [1, 4], [24, 2]]) addFurn(s, 'plant', x, y, 1, 1);
    for (const y of [6.2, 9.6]) addChandelier(s, 13, y);
    exitDoors(s, b, [12, 13]);
    return s;
  }

  function addChandelier(s, cx, cy) {  // hangs from above, so it draws over everything and blocks nothing
    addObj(s, { sortY: 1e9, bx: cx * T - 40, by: cy * T - 120, bw: 80, bh: 140, draw: (c, t) => drawChandelier(c, cx * T, cy * T, t) });
    s.lights.push({ x: cx * T, y: cy * T - 30, r: 170 });
  }

  function roomShell(s, mats) {
    fill(s, 0, 0, s.w - 1, s.h - 1, FLOOR);
    fill(s, 1, 0, s.w - 2, 0, BACKWALL);
    fill(s, 0, 0, 0, s.h - 1, OUTERWALL);
    fill(s, s.w - 1, 0, s.w - 1, s.h - 1, OUTERWALL);
    fill(s, 0, s.h - 1, s.w - 1, s.h - 1, OUTERWALL);
    for (const x of mats) setTile(s, x, s.h - 1, MAT);
    finishTiles(s);
  }
  function exitDoors(s, b, mats) {
    const out = b.doors;
    const sx = out.reduce((a, d) => a + d.x + 0.5, 0) / out.length;
    for (const x of mats) {
      s.doors.push({ x, y: s.h - 1, to: 'town', label: 'Back out to the medina', spawn: { x: sx * T, y: (b.door.y + 1) * T + T * 0.75, dir: 'down' } });
    }
    const mx = mats.reduce((a, x) => a + x + 0.5, 0) / mats.length;
    for (const d of scenes.town.doors) if (d.building === b) d.spawn = { x: mx * T, y: (s.h - 2) * T + T * 0.7, dir: 'up' };
  }

  const MSG = {
    bed: 'A low cedar bed with a woven blanket, made up and waiting for its owner.',
    nightstand: 'A little side table with a brass lantern.',
    bookshelf: 'An arched cedar niche with a few books and some pottery.',
    desk: 'A low cedar writing desk with blank paper. No work done here yet.',
    chair: 'A leather pouf. Nobody has sat on it yet.',
    table: 'A brass tray table set with a teapot and glasses.',
    plant: 'A terracotta pot with a young palm.',
    chest: 'An empty cedar chest with brass bands.',
    lectern: "The speaker's carved cedar lectern. No meeting has been held yet.",
    longtable: 'The council table. Every seat is empty.',
    divan: 'A low silk divan with bolsters, for visitors. Nobody has visited yet.',
    screen: 'A carved cedar screen that keeps the private corner private.',
    fountain: 'A little zellige fountain, splashing quietly.',
    lamp: 'A tall pierced-brass lantern.',
    fireplace: 'A zellige fireplace with a crackling fire, keeping the room warm and waiting.',
  };
  function addFurn(s, kind, tx, ty, tw, th, opts = {}) {
    const o = {
      kind, tx, ty, tw, th, opts, floor: !!opts.floor, msg: opts.msg || MSG[kind] || null,
      sortY: (ty + th) * T, bx: tx * T - 6, by: ty * T - T - 10, bw: tw * T + 12, bh: th * T + T + 20,
    };
    o.draw = (c, t) => FURN[kind](c, tx * T, ty * T, tw * T, th * T, s.palette, t, o);
    if (!o.floor) solidify(s, tx, ty, tw, th, o);
    const glow = { lamp: [0.5, -0.6, 80], nightstand: [0.5, 0, 56], ownerdesk: [0.15, -0.2, 64], lectern: [0.5, 0, 50], fireplace: [0.5, 0.6, 120] }[kind];
    if (glow) s.lights.push({ x: (tx + tw * glow[0]) * T, y: (ty + glow[1]) * T, r: glow[2] });
    return addObj(s, o);
  }

  // ---------- ground drawing (drawn in crisp pieces by drawGround, see the zoom section) ----------
  function drawTile(g, s, x, y) {
    const px = x * T, py = y * T, t = tileAt(s, x, y), pal = s.palette;
    const nb = [tileAt(s, x, y - 1), tileAt(s, x + 1, y), tileAt(s, x, y + 1), tileAt(s, x - 1, y)];
    switch (t) {
      case SANDT: case WALL: {  // clean sand with the odd soft ripple
        box(g, px, py, T, T, SAND);
        if (hash(x, y, 31) < 0.14) {
          g.strokeStyle = '#e6c69c'; g.lineWidth = 1.5; g.beginPath();
          const rx = px + 6 + hash(x, y, 32) * 14, ry = py + 10 + hash(x, y, 33) * 14;
          g.moveTo(rx, ry); g.quadraticCurveTo(rx + 6, ry - 3, rx + 12, ry); g.stroke();
        }
        // grass curving into the inside corners, so grass edges flow instead of stepping
        const gr = (v) => v === GRASS, R = 10;
        const fillet = (cx, cy, sx, sy) => {
          box(g, Math.min(cx, cx + sx * R), Math.min(cy, cy + sy * R), R, R, GRASS_C);
          g.fillStyle = SAND; circle(g, cx + sx * R, cy + sy * R, R);
        };
        if (gr(nb[0]) && gr(nb[3])) fillet(px, py, 1, 1);
        if (gr(nb[0]) && gr(nb[1])) fillet(px + T, py, -1, 1);
        if (gr(nb[2]) && gr(nb[3])) fillet(px, py + T, 1, -1);
        if (gr(nb[2]) && gr(nb[1])) fillet(px + T, py + T, -1, -1);
        break;
      }
      case GRASS: {  // smooth lawn, rounded where it meets sand
        const sandy = (v) => v === SANDT || v === WALL;
        const R = 12, r = [sandy(nb[0]) && sandy(nb[3]), sandy(nb[0]) && sandy(nb[1]), sandy(nb[2]) && sandy(nb[1]), sandy(nb[2]) && sandy(nb[3])].map(v => (v ? R : 0));
        if (r.some(Boolean)) box(g, px, py, T, T, SAND);
        g.fillStyle = GRASS_C; g.beginPath();
        g.moveTo(px + r[0], py); g.lineTo(px + T - r[1], py); if (r[1]) g.arcTo(px + T, py, px + T, py + r[1], r[1]);
        g.lineTo(px + T, py + T - r[2]); if (r[2]) g.arcTo(px + T, py + T, px + T - r[2], py + T, r[2]);
        g.lineTo(px + r[3], py + T); if (r[3]) g.arcTo(px, py + T, px, py + T - r[3], r[3]);
        g.lineTo(px, py + r[0]); if (r[0]) g.arcTo(px, py, px + r[0], py, r[0]);
        g.closePath(); g.fill();
        if (sandy(nb[2])) box(g, px + r[3], py + T - 2, T - r[2] - r[3], 2, '#86a552');  // a soft lip on the sunny side
        if (hash(x, y, 7) < 0.35) {  // a few soft tufts
          const gx = px + 6 + hash(x, y, 8) * 18, gy = py + 8 + hash(x, y, 9) * 16;
          g.strokeStyle = '#86a552'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(gx - 3, gy - 4); g.lineTo(gx, gy); g.lineTo(gx + 3, gy - 4); g.stroke();
        }
        if (hash(x, y, 99) < 0.04) for (let i = 0; i < 2; i++) { g.fillStyle = i ? '#e05a9c' : '#fbf6ec'; circle(g, px + 8 + hash(x, y, 40 + i) * 16, py + 8 + hash(x, y, 50 + i) * 16, 2); }
        break;
      }
      case PATH: {  // terracotta brick paving
        box(g, px, py, T, T, TERRA);
        for (let r = 0; r < 2; r++) {  // large calm pavers, two rows a tile, offset like brickwork
          const off = ((y * 2 + r) % 2) * 8;
          box(g, px, py + r * 16, T, 1, '#c85a37');
          for (let vx = px - 16 + off; vx < px + T; vx += 16) {
            if (vx >= px) box(g, vx, py + r * 16, 1, 16, '#c85a37');
            if (hash(vx, py + r, 4) < 0.22) box(g, Math.max(px, vx + 1), py + r * 16 + 1, Math.min(15, px + T - vx - 1), 15, '#de6f4a');
            box(g, Math.max(px, vx + 1), py + r * 16 + 1, Math.min(15, px + T - vx - 1), 1, 'rgba(255,255,255,0.12)');
          }
        }
        const kerb = '#f0dcb8', soft = (v) => v === SANDT || v === GRASS || v === WALL;
        if (soft(nb[0])) { box(g, px, py, T, 3, kerb); box(g, px, py + 3, T, 1, '#b04e30'); }
        if (soft(nb[2])) { box(g, px, py + T - 3, T, 3, kerb); box(g, px, py + T - 4, T, 1, '#b04e30'); }
        if (soft(nb[3])) { box(g, px, py, 3, T, kerb); box(g, px + 3, py, 1, T, '#b04e30'); }
        if (soft(nb[1])) { box(g, px + T - 3, py, 3, T, kerb); box(g, px + T - 4, py, 1, T, '#b04e30'); }
        break;
      }
      case STONE: {  // polished marble, as in the rooms: soft veins, brass and lagoon inlay
        box(g, px, py, T, T, hash(x, y, 2) < 0.5 ? '#f4ebdc' : '#f1e5d2');
        g.strokeStyle = 'rgba(176,150,118,0.32)'; g.lineWidth = 1; g.beginPath();
        const vx = px + hash(x, y, 3) * T; g.moveTo(vx, py); g.quadraticCurveTo(vx + 8 - hash(x, y, 4) * 16, py + 16, vx + 6 - hash(x, y, 5) * 12, py + T); g.stroke();
        box(g, px, py + 2, 2, T - 4, 'rgba(255,255,255,0.35)');
        box(g, px, py, T, 1, '#dccbb0'); box(g, px, py, 1, T, '#dccbb0');
        if (x % 3 === 0 && y % 3 === 0) { diamond(g, px, py, 5, LAGOON); diamond(g, px, py, 2.5, BRASS); }
        // brass strip where the marble meets a zellige border
        if (nb[0] === ZELLIGE) box(g, px, py, T, 2, BRASS);
        if (nb[2] === ZELLIGE) box(g, px, py + T - 2, T, 2, BRASS);
        if (nb[3] === ZELLIGE) box(g, px, py, 2, T, BRASS);
        if (nb[1] === ZELLIGE) box(g, px + T - 2, py, 2, T, BRASS);
        break;
      }
      case ZELLIGE: {
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
          const cx = px + i * 16, cy = py + j * 16, alt = ((x * 2 + i) + (y * 2 + j)) % 2;
          box(g, cx, cy, 16, 16, alt ? LAGOON : '#f3e6cf');
          diamond(g, cx + 8, cy + 8, 6, alt ? '#f3e6cf' : TEAL);
          box(g, cx + 7, cy + 7, 2, 2, BRASS);
          box(g, cx, cy, 16, 1, '#d9c7a6'); box(g, cx, cy, 1, 16, '#d9c7a6');
        }
        break;
      }
      case BED: {  // bougainvillea bed
        box(g, px, py, T, T, '#8a5a3c');
        box(g, px, py, T, 2, '#6e472f');
        for (let i = 0; i < 5; i++) { g.fillStyle = PALM; circle(g, px + 5 + hash(x, y, i) * 22, py + 6 + hash(x, y, i + 9) * 20, 5); }
        for (let i = 0; i < 9; i++) box(g, px + 2 + hash(x, y, i + 30) * 27, py + 2 + hash(x, y, i + 40) * 26, 3, 3, ['#c2367a', '#e05a9c', '#f08cbc'][i % 3]);
        break;
      }
      case HEDGE: {  // clipped hedge with bougainvillea
        box(g, px, py, T, T, '#3f7d4a');
        for (let i = 0; i < 8; i++) { g.fillStyle = hash(x, y, i + 3) < 0.5 ? PALM : '#5f9a55'; circle(g, px + 4 + hash(x, y, i) * 24, py + 4 + hash(x, y, i + 9) * 18, 5 + hash(x, y, i + 5) * 3); }
        for (let i = 0; i < 4; i++) box(g, px + 3 + hash(x, y, i + 30) * 25, py + 3 + hash(x, y, i + 40) * 20, 3, 3, i % 2 ? '#e05a9c' : '#c2367a');
        if (nb[2] !== HEDGE) { box(g, px, py + T - 7, T, 7, '#2f5f3a'); box(g, px, py + T - 7, T, 1, '#264d30'); }
        break;
      }
      case VEG: {  // vegetable patch
        box(g, px, py, T, T, '#8a5a3c');
        for (let r = 0; r < 3; r++) {
          box(g, px + 1, py + 8 + r * 10, T - 2, 2, '#6e472f');
          for (let k = 0; k < 4; k++) { g.fillStyle = (k + r) % 2 ? PALM : '#7fae5e'; circle(g, px + 5 + k * 7, py + 5 + r * 10, 3); }
          if (hash(x, y, r) < 0.6) box(g, px + 6 + hash(x, y, r + 5) * 18, py + 5 + r * 10, 3, 3, r % 2 ? '#d9643f' : '#f0a23b');
        }
        break;
      }
      case WATER: {
        const deep = nb.every(v => v === WATER);
        box(g, px, py, T, T, deep ? '#247a7b' : LAGOON);
        const cope = '#f3e6cf', inner = '#1f6b6c';
        if (nb[0] !== WATER) { box(g, px, py, T, 5, cope); box(g, px, py + 5, T, 2, inner); }
        if (nb[2] !== WATER) { box(g, px, py + T - 5, T, 5, cope); box(g, px, py + T - 7, T, 2, '#5fb3ad'); }
        if (nb[3] !== WATER) { box(g, px, py, 5, T, cope); box(g, px + 5, py, 2, T, inner); }
        if (nb[1] !== WATER) { box(g, px + T - 5, py, 5, T, cope); box(g, px + T - 7, py, 2, T, inner); }
        break;
      }
      case FLOOR: case MAT: {  // polished marble slabs, with a band of the room's colour inlaid round the walls
        const edge = x <= 1 || x >= s.w - 2 || y <= 1 || y >= s.h - 2;
        const base = edge ? pal.floor : (hash(x, y, 2) < 0.5 ? '#f4ebdc' : '#f1e5d2');
        box(g, px, py, T, T, base);
        if (!edge) {
          g.strokeStyle = 'rgba(176,150,118,0.35)'; g.lineWidth = 1; g.beginPath();
          const vx = px + hash(x, y, 3) * T; g.moveTo(vx, py); g.quadraticCurveTo(vx + 8 - hash(x, y, 4) * 16, py + 16, vx + 6 - hash(x, y, 5) * 12, py + T); g.stroke();
          box(g, px, py + 2, 2, T - 4, 'rgba(255,255,255,0.35)');
        } else {
          for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) if ((x * 2 + i + y * 2 + j) % 2) box(g, px + i * 16, py + j * 16, 16, 16, shade(pal.floor, 0.07));
        }
        box(g, px, py, T, 1, edge ? shade(pal.floor, -0.18) : '#dccbb0'); box(g, px, py, 1, T, edge ? shade(pal.floor, -0.18) : '#dccbb0');
        if (!edge && x % 3 === 0 && y % 3 === 0) { diamond(g, px, py, 5, pal.floor); diamond(g, px, py, 2.5, BRASS); }
        if (!edge) {  // brass strip where the marble meets the band
          if (x === 2) box(g, px, py, 2, T, BRASS);
          if (x === s.w - 3) box(g, px + T - 2, py, 2, T, BRASS);
          if (y === 2) box(g, px, py, T, 2, BRASS);
          if (y === s.h - 3) box(g, px, py + T - 2, T, 2, BRASS);
        }
        if (t === MAT) {
          const grad = g.createLinearGradient(0, py, 0, py + T);
          grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(15,42,46,0.55)');
          g.fillStyle = grad; g.fillRect(px, py, T, T);
          rbox(g, px + 3, py + 4, T - 6, 16, 2, pal.rug);
          for (let k = 0; k < 3; k++) diamond(g, px + 9 + k * 7, py + 12, 3, k % 2 ? BRASS : PLASTER);
          for (let k = 0; k < 6; k++) box(g, px + 6 + k * 4, py + 20, 1, 3, '#f3e6cf');
        }
        break;
      }
      case BACKWALL: {
        box(g, px, py, T, T, pal.paper);
        // one thin strip: carved cedar cornice, plaster, a brass line, a zellige band and a cedar skirting
        box(g, px, py, T, 4, '#7a4b2a'); box(g, px, py + 4, T, 1, BRASS);
        for (let k = 2; k < T; k += 6) box(g, px + k, py + 1, 2, 2, '#a8703f');
        box(g, px, py + 21, T, 1, BRASS); zelligeStrip(g, px, py + 22, T, 7, pal.accent);
        box(g, px, py + 29, T, 3, '#7a4b2a'); box(g, px, py + 29, T, 1, '#a8703f');
        break;
      }
      case OUTERWALL: {
        box(g, px, py, T, T, '#2a2420');
        if (x === 0) box(g, px + T - 4, py, 4, T, '#4b3a2f');
        if (x === s.w - 1) box(g, px, py, 4, T, '#4b3a2f');
        if (y === s.h - 1 && x > 0 && x < s.w - 1) box(g, px, py, T, 4, '#4b3a2f');
        break;
      }
    }
  }

  // ---------- object drawing ----------
  function drawPalm(c, bx, by, k, lean, rot, t) {
    const top = { x: bx + lean * k, y: by - 54 * k };
    c.fillStyle = SHADOW; ellipse(c, bx + 18 * k, by + 2, 26 * k, 8 * k);
    // ringed trunk
    for (let s = 0; s <= 9; s++) {
      const f = s / 9, x = bx + lean * k * f * f, y = by - 54 * k * f, w = (7 - f * 2.4) * k;
      c.fillStyle = s % 2 ? '#a07a50' : '#8a6440';
      ellipse(c, x, y, w, 3.6 * k);
    }
    // dates
    c.fillStyle = '#c98a2b'; circle(c, top.x - 4 * k, top.y + 5 * k, 3 * k); circle(c, top.x + 3 * k, top.y + 6 * k, 3 * k);
    c.fillStyle = TERRA; circle(c, top.x, top.y + 8 * k, 2.4 * k);
    // fronds, back ones first
    const sway = Math.sin(t * 0.9 + bx * 0.05) * 0.04;
    const fronds = [];
    for (let i = 0; i < 9; i++) fronds.push(rot + i * (Math.PI * 2 / 9) + sway);
    fronds.sort((a, b) => Math.sin(a) - Math.sin(b));
    for (const a of fronds) {
      const L = 30 * k, ca = Math.cos(a), sa = Math.sin(a);
      const tip = { x: top.x + ca * L, y: top.y + sa * L * 0.55 + 10 * k };
      const mid = { x: top.x + ca * L * 0.55, y: top.y + sa * L * 0.3 - 4 * k };
      const nx = -sa * 6 * k, ny = ca * 3.4 * k;
      c.fillStyle = sa < 0 ? '#3a6f3a' : PALM;
      c.beginPath(); c.moveTo(top.x, top.y);
      c.quadraticCurveTo(mid.x + nx, mid.y + ny, tip.x, tip.y);
      c.quadraticCurveTo(mid.x - nx, mid.y - ny, top.x, top.y);
      c.fill();
      c.strokeStyle = 'rgba(15,42,46,0.35)'; c.lineWidth = 0.8; c.stroke();
      c.strokeStyle = '#6aa85a'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(top.x, top.y); c.quadraticCurveTo(mid.x, mid.y, tip.x, tip.y); c.stroke();
    }
    c.fillStyle = '#5c8f4b'; circle(c, top.x, top.y, 4 * k);
  }
  function drawOlive(c, bx, by, k, citrus) {
    c.fillStyle = SHADOW; ellipse(c, bx + 10 * k, by + 1, 20 * k, 7 * k);
    box(c, bx - 3 * k, by - 16 * k, 6 * k, 16 * k, '#7a5a3c');
    box(c, bx - 3 * k, by - 16 * k, 2 * k, 16 * k, '#5e4430');
    const dark = citrus ? '#3f7d4a' : '#6f8a52', mid = citrus ? '#4c8a4a' : '#88a466', light = citrus ? '#6aa85a' : '#a8c086';
    c.fillStyle = dark; circle(c, bx, by - 27 * k, 17 * k); circle(c, bx - 11 * k, by - 21 * k, 11 * k); circle(c, bx + 11 * k, by - 21 * k, 11 * k);
    c.fillStyle = mid; circle(c, bx - 3 * k, by - 30 * k, 12 * k); circle(c, bx + 7 * k, by - 24 * k, 8 * k);
    c.fillStyle = light; circle(c, bx - 7 * k, by - 35 * k, 5 * k);
    if (citrus) { c.fillStyle = '#f0a23b'; for (const [dx, dy] of [[-9, -22], [6, -31], [10, -19], [-2, -16], [-12, -30]]) circle(c, bx + dx * k, by + dy * k, 2.4 * k); }
  }
  function drawAgave(c, bx, by, big) {
    const k = big ? 1.15 : 1;
    c.fillStyle = SHADOW; ellipse(c, bx + 4, by, 13 * k, 4 * k);
    c.fillStyle = TERRA; c.beginPath();
    c.moveTo(bx - 10 * k, by - 14 * k); c.lineTo(bx + 10 * k, by - 14 * k); c.lineTo(bx + 7 * k, by); c.lineTo(bx - 7 * k, by); c.closePath(); c.fill();
    box(c, bx - 11 * k, by - 16 * k, 22 * k, 4 * k, '#e88a62');
    box(c, bx + 3 * k, by - 12 * k, 3 * k, 11 * k, '#c4522f');
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i / 8) * Math.PI, L = (10 + (i % 3) * 4) * k;
      c.fillStyle = i % 2 ? '#86b3a3' : '#6f9f8f';
      c.beginPath(); c.moveTo(bx - 3 * k, by - 15 * k); c.lineTo(bx + Math.cos(a) * L, by - 15 * k + Math.sin(a) * L * 1.2); c.lineTo(bx + 3 * k, by - 15 * k); c.closePath(); c.fill();
    }
  }
  function drawRock(c, bx, by, k) {
    c.fillStyle = SHADOW; ellipse(c, bx + 3, by + 2, 10 * k, 3 * k);
    c.fillStyle = '#d2ab7c'; ellipse(c, bx, by - 3 * k, 10 * k, 7 * k);
    c.fillStyle = '#e6c599'; ellipse(c, bx - 2 * k, by - 6 * k, 6 * k, 4 * k);
  }
  function drawLantern(c, bx, by, t) {
    c.fillStyle = SHADOW; ellipse(c, bx + 4, by, 9, 3);
    box(c, bx - 6, by - 6, 12, 6, '#2c3a3a');
    box(c, bx - 1.5, by - 44, 3, 40, TEAL);
    const a = 0.26 + Math.sin(t * 2.2 + bx) * 0.04;
    const glow = c.createRadialGradient(bx, by - 54, 2, bx, by - 54, 26);
    glow.addColorStop(0, `rgba(255,214,130,${a})`); glow.addColorStop(1, 'rgba(255,214,130,0)');
    c.fillStyle = glow; c.fillRect(bx - 26, by - 80, 52, 52);
    // pierced brass lantern
    c.fillStyle = BRASS; c.beginPath();
    c.moveTo(bx - 7, by - 46); c.lineTo(bx + 7, by - 46); c.lineTo(bx + 8, by - 58); c.lineTo(bx, by - 68); c.lineTo(bx - 8, by - 58); c.closePath(); c.fill();
    c.strokeStyle = OUTLINE; c.lineWidth = 1; c.stroke();
    box(c, bx - 8, by - 47, 16, 3, '#b8862e');
    c.fillStyle = '#fff1c2';
    for (const [dx, dy] of [[-4, -52], [0, -54], [4, -52], [-2, -57], [2, -57], [0, -61], [-4, -49], [4, -49], [0, -49]]) circle(c, bx + dx, by + dy, 1);
    box(c, bx - 1, by - 72, 2, 5, BRASS);
    c.fillStyle = BRASS; circle(c, bx, by - 73, 1.8);
  }
  function drawBench(c, x, y) {
    c.fillStyle = SHADOW; c.fillRect(x + 8, y + 26, 58, 5);
    for (const sx of [x + 4, x + 50]) { box(c, sx, y + 12, 10, 16, '#e6d3b3'); box(c, sx + 7, y + 12, 3, 16, '#cdb690'); outlineRect(c, sx, y + 12, 10, 16, 1); }
    for (let k = 0; k < 3; k++) box(c, x + 1, y + 3 + k * 5, 62, 4, k === 2 ? '#b0743f' : '#9a6238');
    box(c, x + 1, y + 3, 62, 1, '#c88a52');
    outlineRect(c, x + 1, y + 3, 62, 15, 1);
  }
  function drawSign(c, bx, by, color, big) {
    c.fillStyle = SHADOW; ellipse(c, bx + 4, by, 8, 3);
    box(c, bx - 2, by - 24, 4, 24, '#6d4426');
    const w = big ? 34 : 22, h = big ? 26 : 20, top = by - 24 - h + 6;
    c.fillStyle = '#7a4b2a'; roundArchPath(c, bx - w / 2, top, w, h); c.fill();
    c.fillStyle = CEDAR; roundArchPath(c, bx - w / 2 + 2, top + 2, w - 4, h - 3); c.fill();
    c.strokeStyle = OUTLINE; c.lineWidth = 1; roundArchPath(c, bx - w / 2, top, w, h); c.stroke();
    if (big) { star8(c, bx, top + h / 2 + 2, 8, BRASS); star8(c, bx, top + h / 2 + 2, 4, TERRA); }
    else { c.fillStyle = BRASS; circle(c, bx, top + h / 2 + 2, 5.5); c.fillStyle = color; circle(c, bx, top + h / 2 + 2, 3.5); }
  }
  function drawFountain(c, cx, cy, t) {
    c.fillStyle = SHADOW; octPath(c, cx + 8, cy + 10, 62); c.fill();
    c.fillStyle = TEAL; octPath(c, cx, cy, 62); c.fill();
    c.fillStyle = LAGOON; octPath(c, cx, cy, 59); c.fill();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, r = 55;
      diamond(c, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9, 3, k % 2 ? BRASS : PLASTER);
    }
    c.fillStyle = '#f3e6cf'; octPath(c, cx, cy, 51); c.fill();
    c.fillStyle = '#3aa0a0'; octPath(c, cx, cy, 46); c.fill();
    c.save(); octPath(c, cx, cy, 46); c.clip();
    for (let k = 0; k < 3; k++) {
      const r = (t * 16 + k * 15) % 45 + 10;
      c.strokeStyle = `rgba(255,255,255,${0.35 * (1 - r / 55)})`; c.lineWidth = 2;
      c.beginPath(); c.ellipse(cx, cy, r, r * 0.9, 0, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
    c.fillStyle = '#e0cfb1'; circle(c, cx, cy + 2, 15);
    c.fillStyle = '#f3e6cf'; circle(c, cx, cy - 3, 12);
    c.fillStyle = '#5fb3ad'; circle(c, cx, cy - 4, 8);
    c.fillStyle = BRASS; circle(c, cx, cy - 7, 3);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + t * 0.6, ph = (t * 1.6 + k * 0.31) % 1;
      const d = 6 + ph * 26, hgt = Math.sin(ph * Math.PI) * 24;
      c.fillStyle = `rgba(214,240,238,${0.9 - ph * 0.6})`;
      circle(c, cx + Math.cos(a) * d, cy - 9 + Math.sin(a) * d * 0.8 - hgt, 2);
    }
    c.strokeStyle = OUTLINE; c.lineWidth = 1.5; octPath(c, cx, cy, 62); c.stroke();
  }
  const isWall = (s, x, y) => s.wallSet.has(y * s.w + x) || (tileAt(s, x, y) === WALL);
  function drawWallTile(c, s, x, y) {
    const X = x * T, Y = y * T, below = isWall(s, x, y + 1), above = isWall(s, x, y - 1), left = isWall(s, x - 1, y), right = isWall(s, x + 1, y);
    const H = 12;
    if (!below) { c.fillStyle = SHADOW; c.fillRect(X + 4, Y + T, T, 6); }
    box(c, X, Y - H, T, T, '#e7c592');
    for (let k = 0; k < 3; k++) box(c, X + hash(x, y, k) * 24, Y - H + 4 + hash(x, y, k + 5) * 20, 6, 1, '#d8b07a');
    if (!below) {
      box(c, X, Y + T - H, T, H, '#c99a62');
      box(c, X, Y + T - H, T, 1, '#b4844f');
      for (let k = (x % 2) * 8; k < T; k += 16) box(c, X + k, Y + T - H, 1, H, '#b4844f');
    }
    const horiz = left || right;
    if (horiz && !above) {
      for (let k = 0; k < 2; k++) { box(c, X + k * 16 + 3, Y - H - 6, 10, 8, '#f0d3a3'); box(c, X + k * 16 + 3, Y - H, 10, 2, '#d4ab72'); }
    } else if (!horiz) {
      const sx = x < s.w / 2 ? X + 1 : X + T - 9;
      for (let k = 0; k < 2; k++) { box(c, sx, Y - H + k * 16 + 3, 8, 10, '#f0d3a3'); box(c, sx, Y - H + k * 16 + 11, 8, 2, '#d4ab72'); }
    }
    c.fillStyle = OUTLINE;
    if (!above) c.fillRect(X, Y - H, T, 1.2);
    if (!left) c.fillRect(X, Y - H, 1.2, below ? T : T + 0);
    if (!right) c.fillRect(X + T - 1.2, Y - H, 1.2, T);
    if (!below) c.fillRect(X, Y + T - 1.2, T, 1.2);
  }
  function drawGate(c, X, Y) {
    const W = 2 * T, cx = X + W / 2, bottom = Y + T;
    c.fillStyle = SHADOW; c.fillRect(X - 10, bottom, W + 28, 8);
    box(c, X - 14, Y - 40, W + 28, T + 40, '#e7c592');
    box(c, X - 14, bottom - 14, W + 28, 14, '#c99a62');
    for (let k = 0; k < 5; k++) { box(c, X - 12 + k * 18, Y - 48, 12, 9, '#f0d3a3'); box(c, X - 12 + k * 18, Y - 41, 12, 2, '#d4ab72'); }
    c.fillStyle = LAGOON; horseshoePath(c, cx, bottom, 54, 62); c.fill();
    zelligeStrip(c, X - 14, bottom - 22, 18, 8, LAGOON); zelligeStrip(c, X + W - 4, bottom - 22, 18, 8, LAGOON);
    c.fillStyle = '#6d3b1f'; horseshoePath(c, cx, bottom, 46, 56); c.fill();
    c.fillStyle = CEDAR; horseshoePath(c, cx, bottom, 40, 52); c.fill();
    box(c, cx - 1, bottom - 46, 2, 46, '#5a3220');
    c.fillStyle = BRASS;
    for (let r = 0; r < 4; r++) for (const dx of [-13, -6, 6, 13]) circle(c, cx + dx, bottom - 10 - r * 9, 1.3);
    circle(c, cx - 4, bottom - 22, 2.2); circle(c, cx + 4, bottom - 22, 2.2);
    c.strokeStyle = OUTLINE; c.lineWidth = 1.5; horseshoePath(c, cx, bottom, 54, 62); c.stroke();
    outlineRect(c, X - 14, Y - 40, W + 28, T + 40);
  }

  // ---------- villas and the town hall ----------
  function terrace(c, X, top, W, bottom, wall) {
    box(c, X - 3, top, W + 6, bottom - top, '#e9c9a0');
    for (let ty = top + 6; ty < bottom - 2; ty += 9) box(c, X + 3, ty, W - 6, 1, '#d9b386');
    for (let tx = X + 10; tx < X + W - 4; tx += 12) box(c, tx, top + 5, 1, bottom - top - 8, '#ddb98c');
    // parapet
    box(c, X - 3, top, W + 6, 5, shade(wall, 0.3));
    box(c, X - 3, top, 5, bottom - top, shade(wall, 0.3));
    box(c, X + W - 2, top, 5, bottom - top, shade(wall, -0.05));
    box(c, X - 3, bottom - 4, W + 6, 4, shade(wall, 0.15));
    outlineRect(c, X - 3, top, W + 6, bottom - top);
  }
  function villaDoor(c, dx, bottom, accent) {
    const cx = dx + T / 2;
    c.fillStyle = accent; horseshoePath(c, cx, bottom, 30, 44); c.fill();
    c.fillStyle = 'rgba(255,255,255,.25)'; horseshoePath(c, cx, bottom, 30, 44); c.fill();
    zelligeStrip(c, cx - 15, bottom - 44, 30, 6, accent);
    c.fillStyle = accent; horseshoePath(c, cx, bottom, 26, 40); c.fill();
    c.fillStyle = '#6d3b1f'; horseshoePath(c, cx, bottom, 22, 36); c.fill();
    c.fillStyle = CEDAR; horseshoePath(c, cx, bottom, 18, 33); c.fill();
    c.fillStyle = BRASS;
    for (let r = 0; r < 3; r++) for (const ddx of [-5, 0, 5]) circle(c, cx + ddx, bottom - 8 - r * 8, 1);
    circle(c, cx + 6, bottom - 16, 1.8);
    c.strokeStyle = OUTLINE; c.lineWidth = 1.2; horseshoePath(c, cx, bottom, 30, 44); c.stroke();
  }
  // ---------- the art pass: generated sprites replace the drawn villas, one at a time ----------
  // Each sprite is cut out of its magenta background by tools/cutout.ps1. door: the door's centre and the
  // bottom of the front wall as fractions of the sprite; width: the sprite's width in tiles. A villa with
  // no sprite (or one that hasn't loaded) is still drawn in code.
  const VILLA_ART = {
    keeper: { src: 'art/villa-keeper.png', doorX: 0.369, doorY: 0.904, width: 8.25 },
    librarian: { src: 'art/villa-librarian.png', doorX: 0.307, doorY: 0.87, width: 7.5 },
    merchant: { src: 'art/villa-merchant.png', doorX: 0.26, doorY: 0.858, width: 8 },
    engineer: { src: 'art/villa-engineer.png', doorX: 0.29, doorY: 0.906, width: 7.4 },
    scholar: { src: 'art/villa-scholar.png', doorX: 0.277, doorY: 0.877, width: 7.2 },
  };
  for (const a of Object.values(VILLA_ART)) { a.img = new Image(); a.img.onload = () => { a.ok = true; }; a.img.src = a.src; }
  function drawVilla(c, b, t) {
    const art = VILLA_ART[b.key];
    if (art && art.ok) {
      const w = art.width * T, h = w * art.img.height / art.img.width;
      const left = (b.door.x + 0.5) * T - art.doorX * w, top = (b.y + b.h) * T - art.doorY * h;
      c.fillStyle = SHADOW; ellipse(c, left + w * 0.55, top + h * 0.97, w * 0.5, 9);
      c.drawImage(art.img, left, top, w, h);
      return;
    }
    const X = b.x * T, Y = b.y * T, W = b.w * T, H = b.h * T, bottom = Y + H;
    const g = { X, Y, W, bottom, dx: b.door.x * T, tower: null, dome: null, spot: null };
    const F = b.type === 'garden' ? 2.1 * T : 2.5 * T;
    const roofBot = bottom - F, roofTop = Y + (b.type === 'garden' ? 0.4 * T : 0);
    // shadow to the lower right
    c.fillStyle = SHADOW; c.beginPath();
    c.moveTo(X + W, roofTop + 10); c.lineTo(X + W + 14, roofTop + 20); c.lineTo(X + W + 14, bottom + 7); c.lineTo(X + 12, bottom + 7); c.lineTo(X, bottom); c.closePath(); c.fill();
    // façade
    box(c, X, roofBot, W, F, b.wall);
    box(c, X + W - 7, roofBot, 7, F, shade(b.wall, -0.07));
    box(c, X, roofBot, W, 3, shade(b.wall, -0.12));
    zelligeStrip(c, X, bottom - 9, W, 9, b.accent);
    const dx = b.door.x * T;
    if (b.type === 'garden') {
      // front arcade of three arches, the middle one holds the door
      for (const ax of [X + 18, X + W - 50]) {
        c.fillStyle = shade(b.wall, -0.14); roundArchPath(c, ax, roofBot + 14, 32, F - 23); c.fill();
        c.fillStyle = shade(b.wall, -0.24); roundArchPath(c, ax + 4, roofBot + 18, 24, F - 27); c.fill();
        archWindow(c, ax + 9, roofBot + 26, 14, 18, shade(b.wall, -0.14));
        c.strokeStyle = OUTLINE; c.lineWidth = 1; roundArchPath(c, ax, roofBot + 14, 32, F - 23); c.stroke();
      }
      for (const px of [X + 14, X + 52, X + W - 56, X + W - 18]) { box(c, px, roofBot + 12, 5, F - 21, shade(b.wall, 0.2)); }
    } else {
      archWindow(c, X + 22, roofBot + 18, 18, 24);
      archWindow(c, X + W - 40, roofBot + 18, 18, 24);
      if (b.type === 'cedar') {
        // carved cedar balcony over the windows
        box(c, X + 16, roofBot + 10, 30, 4, '#7a4b2a');
        box(c, X + W - 46, roofBot + 10, 30, 4, '#7a4b2a');
      }
    }
    villaDoor(c, dx, bottom - 1, b.accent);
    outlineRect(c, X, roofBot, W, F);
    // roof terrace
    terrace(c, X, roofTop, W, roofBot + 3, b.wall);
    g.roofTop = roofTop; g.roofBot = roofBot;
    if (b.type === 'cedar') {
      // upper meeting pavilion with a green tiled roof
      const pw = 3 * T, px = b.flip ? X + W - pw - 12 : X + 12, pTop = roofTop + 4, pf = 18;
      box(c, px, pTop + 18, pw, pf, shade(b.wall, 0.15));
      for (let k = 0; k < 3; k++) { c.fillStyle = shade(b.wall, -0.25); roundArchPath(c, px + 8 + k * 28, pTop + 22, 18, pf - 4); c.fill(); }
      outlineRect(c, px, pTop + 18, pw, pf, 1);
      c.fillStyle = '#3f7d5a'; c.beginPath();
      c.moveTo(px - 6, pTop + 20); c.lineTo(px + pw + 6, pTop + 20); c.lineTo(px + pw - 16, pTop - 8); c.lineTo(px + 16, pTop - 8); c.closePath(); c.fill();
      c.fillStyle = PALM; for (let k = 0; k < 4; k++) c.fillRect(px - 2 + k * 4, pTop + 16 - k * 7, pw + 4 - k * 8, 2);
      c.strokeStyle = OUTLINE; c.lineWidth = 1.2; c.beginPath();
      c.moveTo(px - 6, pTop + 20); c.lineTo(px + pw + 6, pTop + 20); c.lineTo(px + pw - 16, pTop - 8); c.lineTo(px + 16, pTop - 8); c.closePath(); c.stroke();
      box(c, px + pw / 2 - 1, pTop - 16, 2, 9, BRASS); c.fillStyle = BRASS; circle(c, px + pw / 2, pTop - 17, 2.5);
      // the open side of the terrace holds the job's roof piece
      g.spot = { x: b.flip ? X + 44 : X + W - 44, y: roofBot - 4 };
    } else if (b.type === 'tower') {
      // a tall tower on one side, a shaded pergola terrace on the other
      const tw = 2.4 * T, tx = b.flip ? X + W - tw - 4 : X + 4, tTop = Y - 1.3 * T, tFace = roofTop + 0.7 * T;
      g.tower = { tx, tw, tTop, tFace }; g.spot = { x: tx + tw / 2, y: tFace - 4 };
      c.fillStyle = SHADOW; c.fillRect(tx + tw, tTop + 10, 12, tFace - tTop + 30);
      box(c, tx, tFace, tw, roofBot - tFace + 2, b.wall);
      box(c, tx + tw - 6, tFace, 6, roofBot - tFace + 2, shade(b.wall, -0.07));
      archWindow(c, tx + tw / 2 - 7, tFace + 10, 14, 20);
      outlineRect(c, tx, tFace, tw, roofBot - tFace + 2, 1.2);
      terrace(c, tx + 3, tTop, tw - 6, tFace + 2, b.wall);
      for (let k = 0; k < 4; k++) box(c, tx + 2 + k * (tw - 10) / 3, tTop - 6, 6, 7, shade(b.wall, 0.3));
      // pergola with a striped awning
      const ax = b.flip ? X + 8 : tx + tw + 8, aw = W - tw - 20;
      for (let k = 0; k < 5; k++) box(c, ax, roofTop + 12 + k * 8, aw, 4, k % 2 ? PLASTER : b.accent);
      for (const sx of [ax, ax + aw - 4]) box(c, sx, roofTop + 10, 4, 44, '#7a4b2a');
      outlineRect(c, ax, roofTop + 12, aw, 36, 1);
    } else {
      // a low dome on the roof
      const dcx = X + W / 2, dBase = roofTop + (roofBot - roofTop) * 0.78, dw = 1.5 * T, dh = 1.7 * T;
      g.dome = { dcx, dBase, dw, dh }; g.spot = { x: b.flip ? X + 34 : X + W - 34, y: roofBot - 4 };
      c.fillStyle = SHADOW; ellipse(c, dcx + 12, dBase + 2, dw, 8);
      box(c, dcx - dw - 2, dBase - 6, dw * 2 + 4, 8, shade(b.wall, 0.1));
      const grad = c.createLinearGradient(dcx - dw, 0, dcx + dw, 0);
      grad.addColorStop(0, PLASTER); grad.addColorStop(1, shade(b.wall, -0.12));
      c.fillStyle = grad; c.beginPath(); c.ellipse(dcx, dBase - 4, dw, dh, 0, Math.PI, 0); c.fill();
      c.strokeStyle = OUTLINE; c.lineWidth = 1.4; c.beginPath(); c.ellipse(dcx, dBase - 4, dw, dh, 0, Math.PI, 0); c.closePath(); c.stroke();
      c.strokeStyle = shade(b.wall, -0.18); c.lineWidth = 1;
      c.beginPath(); c.ellipse(dcx, dBase - 4, dw * 0.5, dh, 0, Math.PI, 0); c.stroke();
      c.beginPath(); c.moveTo(dcx, dBase - 4); c.lineTo(dcx, dBase - 4 - dh); c.stroke();
      box(c, dcx - 1, dBase - 4 - dh - 10, 2, 11, BRASS);
      c.fillStyle = BRASS; circle(c, dcx, dBase - 4 - dh - 11, 2.5);
      for (const cx of [X + 4, X + W - 12]) box(c, cx, roofTop - 6, 8, 7, shade(b.wall, 0.3));
    }
    drawJob(c, b, g, t);
  }

  function drawHall(c, b, t) {
    const X = b.x * T, Y = b.y * T, W = b.w * T, H = b.h * T, bottom = Y + H, cx = X + W / 2;
    const F = 3.8 * T, roofBot = bottom - F;
    c.fillStyle = SHADOW; c.beginPath();
    c.moveTo(X + W, Y + 10); c.lineTo(X + W + 18, Y + 22); c.lineTo(X + W + 18, bottom + 9); c.lineTo(X + 14, bottom + 9); c.lineTo(X, bottom); c.closePath(); c.fill();
    // two-storey plaster front
    box(c, X, roofBot, W, F, PLASTER);
    box(c, X + W - 8, roofBot, 8, F, '#efe6d6');
    const mid = roofBot + F * 0.42;
    zelligeStrip(c, X, mid - 4, W, 8, LAGOON);
    zelligeStrip(c, X, bottom - 10, W, 10, LAGOON);
    for (const px of [X, X + W - 10]) box(c, px, roofBot, 10, F, '#f3e6cf');
    // upper storey: arched windows and the brass medallion in the middle
    for (let k = 0; k < 8; k++) {
      const wx = X + 26 + k * 44;
      if (Math.abs(wx + 8 - cx) < 30) continue;
      archWindow(c, wx, roofBot + 10, 16, 26);
    }
    c.fillStyle = BRASS; circle(c, cx, roofBot + 24, 16);
    c.fillStyle = '#c98a2b'; circle(c, cx, roofBot + 24, 13);
    star8(c, cx, roofBot + 24, 9, BRASS); c.fillStyle = TERRA; circle(c, cx, roofBot + 24, 3);
    c.strokeStyle = OUTLINE; c.lineWidth = 1.2; c.beginPath(); c.arc(cx, roofBot + 24, 16, 0, Math.PI * 2); c.stroke();
    // three-bay entrance arcade
    const arch = (ax, w, h, isDoor) => {
      c.fillStyle = LAGOON; horseshoePath(c, ax, bottom - 10, w + 8, h + 6); c.fill();
      c.fillStyle = isDoor ? '#5a3220' : '#d9c7a6'; horseshoePath(c, ax, bottom - 10, w, h); c.fill();
      c.strokeStyle = OUTLINE; c.lineWidth = 1.4; horseshoePath(c, ax, bottom - 10, w + 8, h + 6); c.stroke();
    };
    const doorCx = (b.doors[0].x + 1) * T;
    arch(doorCx - 78, 40, 52, false); arch(doorCx + 78, 40, 52, false);
    arch(doorCx, 58, 66, true);
    c.fillStyle = CEDAR; horseshoePath(c, doorCx, bottom - 10, 50, 60); c.fill();
    box(c, doorCx - 1, bottom - 64, 2, 54, '#4a2b16');
    c.fillStyle = BRASS;
    for (let r = 0; r < 5; r++) for (const ddx of [-18, -9, 9, 18]) circle(c, doorCx + ddx, bottom - 16 - r * 9, 1.2);
    circle(c, doorCx - 5, bottom - 34, 2.4); circle(c, doorCx + 5, bottom - 34, 2.4);
    // lanterns hanging in the side arches
    for (const lx of [doorCx - 78, doorCx + 78]) {
      box(c, lx - 0.5, bottom - 58, 1, 12, TEAL);
      c.fillStyle = BRASS; c.beginPath(); c.moveTo(lx - 5, bottom - 46); c.lineTo(lx + 5, bottom - 46); c.lineTo(lx + 3, bottom - 34); c.lineTo(lx - 3, bottom - 34); c.closePath(); c.fill();
      c.fillStyle = `rgba(255,214,130,${0.35 + Math.sin(t * 2 + lx) * 0.05})`; circle(c, lx, bottom - 40, 9);
    }
    // ground-floor windows beyond the arcade
    for (const wx of [X + 22, X + 56, X + W - 72, X + W - 38]) archWindow(c, wx, mid + 18, 16, 30);
    // Vizier's briefing balcony over the doors
    box(c, doorCx - 48, mid - 2, 96, 6, '#7a4b2a'); box(c, doorCx - 48, mid + 4, 96, 2, '#5a3220');
    box(c, doorCx - 48, mid - 16, 96, 2, BRASS);
    for (let k = doorCx - 46; k <= doorCx + 46; k += 6) box(c, k, mid - 14, 1.5, 12, '#a8703f');
    outlineRect(c, doorCx - 48, mid - 16, 96, 22, 1);
    outlineRect(c, X, roofBot, W, F);
    // carved cedar eave and the green-tiled pavilion roof
    const top = Y - 0.6 * T;
    c.fillStyle = '#3f7d5a'; c.beginPath();
    c.moveTo(X - 10, roofBot + 2); c.lineTo(X + W + 10, roofBot + 2); c.lineTo(X + W - 46, top); c.lineTo(X + 46, top); c.closePath(); c.fill();
    c.save(); c.clip();
    for (let ry = top, row = 0; ry < roofBot + 2; ry += 7, row++) {
      box(c, X - 10, ry, W + 20, 3, row % 2 ? PALM : '#46845a');
      for (let sx = X - 10 + (row % 2) * 6; sx < X + W + 10; sx += 12) box(c, sx, ry, 1.2, 7, '#2f6447');
    }
    c.restore();
    c.strokeStyle = OUTLINE; c.lineWidth = 1.6; c.beginPath();
    c.moveTo(X - 10, roofBot + 2); c.lineTo(X + W + 10, roofBot + 2); c.lineTo(X + W - 46, top); c.lineTo(X + 46, top); c.closePath(); c.stroke();
    box(c, X - 10, roofBot, W + 20, 6, '#7a4b2a');
    box(c, X - 10, roofBot + 6, W + 20, 2, BRASS);
    for (let k = X - 6; k < X + W + 8; k += 8) box(c, k, roofBot + 1, 3, 4, '#a8703f');
    box(c, X + 46, top - 2, W - 92, 4, BRASS);
    // the lantern tower in the middle of the roof
    const lw = 64, lTop = top - 34;
    box(c, cx - lw / 2, lTop + 14, lw, 22, PLASTER);
    for (let k = 0; k < 3; k++) { c.fillStyle = TEAL; roundArchPath(c, cx - 24 + k * 18, lTop + 18, 12, 16); c.fill(); }
    outlineRect(c, cx - lw / 2, lTop + 14, lw, 22, 1.2);
    c.fillStyle = '#3f7d5a'; c.beginPath(); c.moveTo(cx - lw / 2 - 6, lTop + 16); c.lineTo(cx + lw / 2 + 6, lTop + 16); c.lineTo(cx, lTop - 10); c.closePath(); c.fill();
    c.strokeStyle = OUTLINE; c.lineWidth = 1.2; c.stroke();
    // the hall's chimney, over the great fireplace inside
    drawChimney(c, X + W - 62, top + 16, t);
    // a flagpole on the finial, with the village flag waving in the breeze
    box(c, cx - 1, lTop - 46, 2, 37, BRASS);
    c.fillStyle = BRASS; circle(c, cx, lTop - 47, 3);
    drawFlag(c, cx + 1, lTop - 44, 30, 18, t, LAGOON);
    star8(c, cx + 13 + Math.sin(t * 3.2 - 1.4) * 0.8, lTop - 35 + Math.sin(t * 3.2 - 1.4) * 2, 4, BRASS);
    // the signal bell in the lantern tower, and message pigeons coming and going
    c.save(); c.translate(cx, lTop + 19); c.rotate(Math.sin(t * 1.6) * 0.18);
    c.fillStyle = BRASS; c.beginPath(); c.moveTo(-3, 0); c.lineTo(3, 0); c.lineTo(6, 11); c.lineTo(-6, 11); c.closePath(); c.fill();
    c.fillStyle = '#b8862e'; circle(c, 0, 12, 1.6); c.restore();
    drawPigeons(c, cx, lTop - 20, 80, 16, 6, t);
  }

  // ---------- wall decorations (drawn into the room cache) ----------
  function drawWindowDecor(g, x, y, w, h, pal) {
    c2Curtain(g, x - 9, y - 4, 10, h + 8, pal.accent);
    c2Curtain(g, x + w - 1, y - 4, 10, h + 8, pal.accent);
    g.fillStyle = pal.accent; roundArchPath(g, x - 4, y - 4, w + 8, h + 6); g.fill();
    g.save(); roundArchPath(g, x, y, w, h); g.clip();
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, '#cfeeee'); grad.addColorStop(1, '#7cc4c0');
    g.fillStyle = grad; g.fillRect(x, y, w, h);
    g.strokeStyle = '#8a5a32'; g.lineWidth = 2;
    for (let k = -h; k < w + h; k += 9) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k + h, y + h); g.stroke(); g.beginPath(); g.moveTo(x + k + h, y); g.lineTo(x + k, y + h); g.stroke(); }
    g.restore();
    g.strokeStyle = OUTLINE; g.lineWidth = 1.2; roundArchPath(g, x - 4, y - 4, w + 8, h + 6); g.stroke();
    box(g, x - 6, y + h + 1, w + 12, 4, '#8a5a32');
  }
  function c2Curtain(g, x, y, w, h, color) {
    box(g, x, y, w, h, color);
    for (let k = 2; k < w; k += 3) box(g, x + k, y, 1, h, shade(color, -0.2));
  }
  function drawWallPlate(g, cx, cy, r, pal) {
    g.fillStyle = 'rgba(15,42,46,.15)'; circle(g, cx + 2, cy + 2, r + 1);
    g.fillStyle = BRASS; circle(g, cx, cy, r);
    g.fillStyle = '#c98a2b'; circle(g, cx, cy, r - 2);
    star8(g, cx, cy, r * 0.55, BRASS);
    g.fillStyle = pal.accent; circle(g, cx, cy, 2);
  }
  function drawHanging(g, x, y, pal, h = 46) {
    box(g, x - 4, y, 40, 3, '#7a4b2a');
    g.fillStyle = pal.rug; g.fillRect(x, y + 3, 32, h);
    for (let k = 0; k < Math.floor(h / 11); k++) diamond(g, x + 16, y + 9 + k * 11, 4.5, k % 2 ? BRASS : PLASTER);
    box(g, x, y + 3, 32, 3, shade(pal.rug, -0.3)); box(g, x + 2, y + 3, 2, h, LAGOON); box(g, x + 28, y + 3, 2, h, LAGOON);
    for (let k = 1; k < 32; k += 4) box(g, x + k, y + h + 3, 1, 3, '#f3e6cf');
  }
  function drawNoticeBoard(g, x, y, w, h) {
    box(g, x - 3, y - 3, w + 6, h + 6, '#7a4b2a');
    box(g, x, y, w, h, '#c49a6c');
    for (let k = 0; k < 10; k++) box(g, x + hash(k, 1) * (w - 2), y + hash(k, 2) * (h - 2), 2, 2, '#a77d52');
    box(g, x + w / 2 - 12, y + 7, 24, 20, '#fdf8ec');
    g.fillStyle = TERRA; circle(g, x + w / 2, y + 8, 2);
    outlineRect(g, x - 3, y - 3, w + 6, h + 6, 1);
  }

  // ---------- furniture ----------
  const FURN = {
    rug(c, X, Y, W, H, pal, t, o) {  // kilim; silk ones get a sheen and a brass border
      rbox(c, X + 4, Y + 4, W - 8, H - 8, 2, pal.rug);
      if (o && o.opts.silk) {
        c.strokeStyle = BRASS; c.lineWidth = 3; c.strokeRect(X + 6, Y + 6, W - 12, H - 12);
        const g = c.createLinearGradient(X, Y, X + W, Y + H);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(X + 4, Y + 4, W - 8, H - 8);
        star8(c, X + W / 2, Y + H / 2, Math.min(W, H) * 0.18, BRASS); star8(c, X + W / 2, Y + H / 2, Math.min(W, H) * 0.1, TEAL);
      }
      c.strokeStyle = '#f3e6cf'; c.lineWidth = 2; c.strokeRect(X + 9, Y + 9, W - 18, H - 18);
      c.strokeStyle = TEAL; c.lineWidth = 1; c.strokeRect(X + 13, Y + 13, W - 26, H - 26);
      const rows = Math.max(1, Math.floor((H - 30) / 18));
      for (let r = 0; r < rows; r++) {
        const cy = Y + 15 + (H - 30) * (r + 0.5) / rows;
        for (let cx = X + 22; cx < X + W - 16; cx += 16) {
          diamond(c, cx, cy, 6, (cx / 16 + r) % 2 < 1 ? '#f3e6cf' : BRASS);
          diamond(c, cx, cy, 2.5, TEAL);
        }
      }
      for (let k = X + 8; k < X + W - 8; k += 4) { box(c, k, Y + 1, 1, 3, '#f3e6cf'); box(c, k, Y + H - 4, 1, 3, '#f3e6cf'); }
    },
    bed(c, X, Y, W, H, pal) {
      c.fillStyle = SHADOW; c.fillRect(X + 6, Y + H - 2, W - 4, 5);
      c.fillStyle = '#6d3b1f'; roundArchPath(c, X + 4, Y - 12, W - 8, 18); c.fill();
      c.fillStyle = CEDAR; roundArchPath(c, X + 7, Y - 9, W - 14, 14); c.fill();
      box(c, X + 3, Y + 4, W - 6, H - 6, '#7a4b2a');
      box(c, X + 6, Y + 6, W - 12, H - 12, '#fbf6ec');
      rbox(c, X + 8, Y + 7, 22, 10, 4, BRASS); rbox(c, X + W - 30, Y + 7, 22, 10, 4, TERRA);
      box(c, X + 6, Y + 22, W - 12, H - 28, pal.accent);
      for (let k = 0; k < 3; k++) box(c, X + 6, Y + 26 + k * 10, W - 12, 3, k % 2 ? BRASS : '#fbf6ec');
      box(c, X + 3, Y + H - 4, W - 6, 3, '#5a3220');
      outlineRect(c, X + 3, Y + 4, W - 6, H - 6, 1);
    },
    nightstand(c, X, Y, W, H, pal, t) {
      c.fillStyle = SHADOW; ellipse(c, X + W / 2 + 2, Y + H - 2, 11, 3);
      c.fillStyle = '#7a4b2a'; octPath(c, X + W / 2, Y + 12, 12, 0.6); c.fill();
      box(c, X + W / 2 - 8, Y + 14, 16, H - 16, CEDAR);
      c.fillStyle = BRASS; c.beginPath(); c.moveTo(X + W / 2 - 5, Y + 8); c.lineTo(X + W / 2 + 5, Y + 8); c.lineTo(X + W / 2 + 4, Y - 4); c.lineTo(X + W / 2, Y - 10); c.lineTo(X + W / 2 - 4, Y - 4); c.closePath(); c.fill();
      c.fillStyle = `rgba(255,220,140,${0.4 + Math.sin(t * 2) * 0.05})`; circle(c, X + W / 2, Y, 8);
      c.fillStyle = '#fff1c2'; circle(c, X + W / 2, Y + 1, 1.2); circle(c, X + W / 2 - 2, Y - 3, 1); circle(c, X + W / 2 + 2, Y - 3, 1);
    },
    bookshelf(c, X, Y, W, H, pal, t, o) {  // arched cedar niche
      const top = Y - T + 2;
      c.fillStyle = SHADOW; c.fillRect(X + 6, Y + H - 3, W - 6, 4);
      c.fillStyle = '#6d3b1f'; roundArchPath(c, X + 2, top, W - 4, Y + H - top - 2); c.fill();
      c.fillStyle = '#3f2414'; roundArchPath(c, X + 6, top + 4, W - 12, Y + H - top - 10); c.fill();
      for (let row = 0; row < 3; row++) {
        const sy = top + 14 + row * 13;
        let bx = X + 9;
        for (let k = 0; k < 9 && bx < X + W - 11; k++) {
          const bw = 3 + Math.floor(hash(o.tx * 10 + k, row) * 3), roll = hash(o.tx + k, row, 9);
          if (roll < 0.15) { c.fillStyle = TERRA; ellipse(c, bx + 4, sy + 7, 4, 5); box(c, bx + 2, sy, 4, 3, '#c4522f'); bx += 9; continue; }
          if (roll < 0.7) {
            const bh = 8 + Math.floor(hash(k, row + o.tx) * 3);
            box(c, bx, sy + 11 - bh, bw, bh, [TERRA, LAGOON, PALM, BRASS, '#7a4b2a', '#f3e6cf'][Math.floor(hash(k, row, o.tx) * 6)]);
          }
          bx += bw + 1;
        }
        box(c, X + 6, sy + 11, W - 12, 2, '#8a5a32');
      }
      c.strokeStyle = OUTLINE; c.lineWidth = 1; roundArchPath(c, X + 2, top, W - 4, Y + H - top - 2); c.stroke();
    },
    desk(c, X, Y, W, H) {
      c.fillStyle = SHADOW; c.fillRect(X + 6, Y + H - 2, W - 6, 5);
      box(c, X + 5, Y + 14, 4, H - 14, '#5a3220'); box(c, X + W - 9, Y + 14, 4, H - 14, '#5a3220');
      box(c, X + 2, Y + 2, W - 4, 14, '#9a6238');
      box(c, X + 2, Y + 2, W - 4, 2, '#c88a52');
      for (let k = X + 6; k < X + W - 6; k += 8) diamond(c, k + 4, Y + 18, 2.5, BRASS);
      box(c, X + 2, Y + 16, W - 4, 2, '#6d3b1f');
      box(c, X + 10, Y + 4, 18, 9, '#fdf8ec');
      box(c, X + 12, Y + 6, 12, 1, '#d6cdb8'); box(c, X + 12, Y + 9, 9, 1, '#d6cdb8');
      c.fillStyle = BRASS; circle(c, X + W - 16, Y + 8, 4); c.fillStyle = TEAL; circle(c, X + W - 16, Y + 7, 2);
      outlineRect(c, X + 2, Y + 2, W - 4, 16, 1);
    },
    chair(c, X, Y, W, H) {  // leather pouf
      c.fillStyle = SHADOW; ellipse(c, X + W / 2 + 3, Y + H - 4, 12, 4);
      c.fillStyle = '#a8703f'; ellipse(c, X + W / 2, Y + H - 10, 12, 8);
      c.fillStyle = '#c98a2b'; ellipse(c, X + W / 2, Y + H - 14, 12, 7);
      star8(c, X + W / 2, Y + H - 14, 4, '#e8c46a');
      c.strokeStyle = OUTLINE; c.lineWidth = 1; c.beginPath(); c.ellipse(X + W / 2, Y + H - 12, 12, 9, 0, 0, Math.PI * 2); c.stroke();
    },
    table(c, X, Y, W, H) {  // brass tray table with tea
      c.fillStyle = SHADOW; ellipse(c, X + W / 2 + 4, Y + H - 2, W / 2 - 8, 5);
      for (const lx of [X + W / 2 - 10, X + W / 2 + 6]) box(c, lx, Y + 12, 4, H - 14, '#6d3b1f');
      c.fillStyle = '#b8862e'; ellipse(c, X + W / 2, Y + 12, W / 2 - 6, 10);
      c.fillStyle = BRASS; ellipse(c, X + W / 2, Y + 10, W / 2 - 6, 9);
      c.strokeStyle = '#c98a2b'; c.lineWidth = 1; c.beginPath(); c.ellipse(X + W / 2, Y + 10, W / 2 - 12, 6, 0, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#d0d4d4'; ellipse(c, X + W / 2 - 2, Y + 6, 6, 5); box(c, X + W / 2 - 3, Y - 2, 2, 4, '#d0d4d4'); box(c, X + W / 2 + 3, Y + 3, 6, 2, '#d0d4d4');
      for (const gx of [X + W / 2 + 12, X + W / 2 - 16, X + W / 2 + 4]) { box(c, gx, Y + 8, 4, 5, '#9fd8c8'); box(c, gx, Y + 8, 4, 1, BRASS); }
    },
    plant(c, X, Y, W, H) {
      c.fillStyle = SHADOW; ellipse(c, X + W / 2 + 3, Y + H - 3, 9, 3);
      c.fillStyle = TERRA; c.beginPath(); c.moveTo(X + 8, Y + 14); c.lineTo(X + W - 8, Y + 14); c.lineTo(X + W - 11, Y + H - 2); c.lineTo(X + 11, Y + H - 2); c.closePath(); c.fill();
      box(c, X + 7, Y + 12, W - 14, 4, '#e88a62');
      for (let i = 0; i < 6; i++) {
        const a = Math.PI + 0.2 + (i / 5) * (Math.PI - 0.4);
        c.fillStyle = i % 2 ? PALM : '#3a6f3a';
        c.beginPath(); c.moveTo(X + W / 2, Y + 12); c.quadraticCurveTo(X + W / 2 + Math.cos(a) * 8, Y + 12 + Math.sin(a) * 16, X + W / 2 + Math.cos(a) * 15, Y + 12 + Math.sin(a) * 12);
        c.quadraticCurveTo(X + W / 2 + Math.cos(a) * 4, Y + 10 + Math.sin(a) * 8, X + W / 2, Y + 12); c.fill();
      }
    },
    chest(c, X, Y, W, H) {
      c.fillStyle = SHADOW; c.fillRect(X + 6, Y + H - 3, W - 6, 4);
      box(c, X + 3, Y + 8, W - 6, H - 10, '#7a4b2a');
      c.fillStyle = CEDAR; roundArchPath(c, X + 3, Y + 2, W - 6, 12); c.fill();
      box(c, X + 3, Y + 11, W - 6, 2, '#4a2b16');
      box(c, X + 7, Y + 4, 3, H - 6, BRASS); box(c, X + W - 10, Y + 4, 3, H - 6, BRASS);
      star8(c, X + W / 2, Y + 18, 3.5, BRASS);
      outlineRect(c, X + 3, Y + 8, W - 6, H - 10, 1);
    },
    lectern(c, X, Y, W, H) {
      c.fillStyle = SHADOW; c.fillRect(X + 14, Y + H - 3, W - 24, 4);
      box(c, X + W / 2 - 10, Y + 8, 20, H - 8, '#6d3b1f');
      box(c, X + W / 2 - 6, Y + 10, 12, H - 12, CEDAR);
      star8(c, X + W / 2, Y + 20, 4, BRASS);
      c.fillStyle = '#7a4120'; c.beginPath(); c.moveTo(X + 14, Y + 8); c.lineTo(X + W - 14, Y + 8); c.lineTo(X + W - 18, Y - 6); c.lineTo(X + 18, Y - 6); c.closePath(); c.fill();
      box(c, X + W / 2 - 10, Y - 4, 9, 10, '#fdf8ec'); box(c, X + W / 2 + 1, Y - 4, 9, 10, '#f3ecd9');
      box(c, X + W / 2 - 1, Y - 4, 2, 10, LAGOON);
    },
    longtable(c, X, Y, W, H, pal, t) {
      c.fillStyle = SHADOW; c.fillRect(X + 8, Y + H - 2, W - 6, 6);
      box(c, X + 6, Y + 14, 6, H - 14, '#4a2b16'); box(c, X + W - 12, Y + 14, 6, H - 14, '#4a2b16');
      box(c, X + 2, Y + 4, W - 4, H - 14, '#8a5a32');
      box(c, X + 2, Y + 4, W - 4, 3, '#b0743f');
      box(c, X + 2, Y + H - 12, W - 4, 4, '#6d3b1f');
      zelligeStrip(c, X + 24, Y + 16, W - 48, 12, pal.accent);
      for (let k = 0; k < 3; k++) {
        const lx = X + W * (0.25 + k * 0.25);
        c.fillStyle = BRASS; c.beginPath(); c.moveTo(lx - 5, Y + 18); c.lineTo(lx + 5, Y + 18); c.lineTo(lx + 4, Y + 8); c.lineTo(lx, Y + 3); c.lineTo(lx - 4, Y + 8); c.closePath(); c.fill();
        c.fillStyle = `rgba(255,220,140,${0.35 + Math.sin(t * 2 + k) * 0.05})`; circle(c, lx, Y + 11, 8);
      }
      outlineRect(c, X + 2, Y + 4, W - 4, H - 12, 1.2);
    },
    ownerdesk(c, X, Y, W, H, pal, t) {  // carved cedar desk with a leather top, a brass lamp and an inkwell
      c.fillStyle = SHADOW; c.fillRect(X + 6, Y + H - 1, W - 4, 6);
      box(c, X + 3, Y + 6, W - 6, H - 6, '#6d3b1f');
      box(c, X + 5, Y + 14, W - 10, H - 16, '#8a5a32');
      for (let k = X + 12; k < X + W - 10; k += 14) { c.fillStyle = '#5a3220'; roundArchPath(c, k - 4, Y + 15, 8, H - 18); c.fill(); star8(c, k, Y + 22, 2.5, BRASS); }
      box(c, X + 1, Y - 2, W - 2, 10, '#9a6238'); box(c, X + 1, Y - 2, W - 2, 2, '#c88a52');
      rbox(c, X + W / 2 - 22, Y, 44, 6, 2, pal.accent); box(c, X + W / 2 - 20, Y + 1, 40, 1, shade(pal.accent, 0.25));
      box(c, X + W / 2 - 8, Y - 1, 16, 5, '#fdf8ec');
      c.fillStyle = TEAL; circle(c, X + W - 14, Y + 2, 2.5); box(c, X + W - 13, Y - 6, 1, 6, '#3a2a1a');
      // brass lamp
      const lx = X + 12;
      box(c, lx - 1, Y - 14, 2, 14, '#b8862e'); c.fillStyle = BRASS; c.beginPath(); c.moveTo(lx - 7, Y - 12); c.lineTo(lx + 7, Y - 12); c.lineTo(lx + 4, Y - 20); c.lineTo(lx - 4, Y - 20); c.closePath(); c.fill();
      const glow = c.createRadialGradient(lx, Y - 10, 1, lx, Y - 10, 18);
      glow.addColorStop(0, `rgba(255,214,130,${0.35 + Math.sin(t * 2) * 0.04})`); glow.addColorStop(1, 'rgba(255,214,130,0)');
      c.fillStyle = glow; c.fillRect(lx - 18, Y - 28, 36, 36);
      outlineRect(c, X + 1, Y - 2, W - 2, H + 2, 1.2);
    },
    fireplace(c, X, Y, W, H, pal, t) {  // zellige-framed arched fireplace against the back wall, with a live fire
      const top = Y - T + 4, fx = X + 10, fw = W - 20, fy = Y - 6, fh = H;
      c.fillStyle = SHADOW; c.fillRect(X + 4, Y + H - 2, W - 2, 4);
      c.fillStyle = '#e6d3b3'; roundArchPath(c, X + 2, top, W - 4, Y + H - top - 2); c.fill();
      c.save(); roundArchPath(c, X + 2, top, W - 4, Y + H - top - 2); c.clip(); zelligeStrip(c, X + 2, top + 4, W - 4, 8, pal.accent); c.restore();
      c.fillStyle = '#2a1a12'; roundArchPath(c, fx, fy, fw, fh); c.fill();
      // embers and logs
      box(c, fx + 4, Y + H - 9, fw - 8, 4, '#5a3220'); box(c, fx + 8, Y + H - 12, fw - 16, 3, '#6d3b1f');
      for (let k = 0; k < 5; k++) { c.fillStyle = `rgba(255,${110 + k * 18},50,${0.6 + Math.sin(t * 7 + k) * 0.3})`; circle(c, fx + 6 + k * (fw - 12) / 4, Y + H - 8, 1.6); }
      // flames: three tongues that lick and flicker
      for (let k = 0; k < 3; k++) {
        const cx = fx + fw * (0.3 + k * 0.2), hgt = 13 + Math.sin(t * 9 + k * 2) * 3 + Math.sin(t * 17 + k) * 1.5, sway = Math.sin(t * 6 + k) * 2;
        const base = Y + H - 11;
        c.fillStyle = '#e8622f'; c.beginPath(); c.moveTo(cx - 5, base); c.quadraticCurveTo(cx - 6 + sway, base - hgt * 0.6, cx + sway, base - hgt); c.quadraticCurveTo(cx + 6 + sway, base - hgt * 0.6, cx + 5, base); c.closePath(); c.fill();
        c.fillStyle = '#f6b13c'; c.beginPath(); c.moveTo(cx - 3, base); c.quadraticCurveTo(cx - 3 + sway, base - hgt * 0.45, cx + sway * 0.6, base - hgt * 0.7); c.quadraticCurveTo(cx + 3 + sway, base - hgt * 0.45, cx + 3, base); c.closePath(); c.fill();
      }
      const g = c.createRadialGradient(X + W / 2, Y + H - 8, 2, X + W / 2, Y + H - 8, 46);
      g.addColorStop(0, `rgba(255,160,70,${0.32 + Math.sin(t * 8) * 0.05})`); g.addColorStop(1, 'rgba(255,160,70,0)');
      c.fillStyle = g; c.fillRect(X - 30, Y - 30, W + 60, H + 70);
      box(c, X, Y + H - 4, W, 4, '#cdb690');
      c.strokeStyle = OUTLINE; c.lineWidth = 1; roundArchPath(c, X + 2, top, W - 4, Y + H - top - 2); c.stroke();
    },
    banquet(c, X, Y, W, H, pal, t) {  // long cedar council table, running from the head chair towards the door
      c.fillStyle = SHADOW; c.fillRect(X + 8, Y + 6, W - 4, H);
      for (const [lx, ly] of [[X + 6, Y + 10], [X + W - 12, Y + 10], [X + 6, Y + H - 14], [X + W - 12, Y + H - 14]]) box(c, lx, ly, 6, 14, '#4a2b16');
      box(c, X + 2, Y + 2, W - 4, H - 8, '#8a5a32');
      box(c, X + 2, Y + 2, W - 4, 3, '#b0743f'); box(c, X + 2, Y + H - 10, W - 4, 4, '#6d3b1f');
      box(c, X + W / 2 - 7, Y + 10, 14, H - 26, pal.accent); zelligeStrip(c, X + W / 2 - 5, Y + 12, 10, H - 30, pal.accent);
      for (let r = 0; r < Math.round(H / T); r++) {  // a place setting in front of every seat
        const py = Y + r * T + 16;
        for (const px of [X + 12, X + W - 12]) { c.fillStyle = '#e6d3b3'; circle(c, px, py, 5); c.fillStyle = BRASS; circle(c, px, py, 3); }
        box(c, X + 18, py - 4, 2, 6, '#9fd8c8'); box(c, X + W - 20, py - 4, 2, 6, '#9fd8c8');
      }
      for (let k = 0; k < 3; k++) {
        const ly = Y + H * (0.2 + k * 0.3), lx = X + W / 2;
        c.fillStyle = BRASS; c.beginPath(); c.moveTo(lx - 5, ly + 6); c.lineTo(lx + 5, ly + 6); c.lineTo(lx + 4, ly - 4); c.lineTo(lx, ly - 9); c.lineTo(lx - 4, ly - 4); c.closePath(); c.fill();
        c.fillStyle = `rgba(255,220,140,${0.3 + Math.sin(t * 2 + k) * 0.05})`; circle(c, lx, ly - 1, 9);
      }
      outlineRect(c, X + 2, Y + 2, W - 4, H - 6, 1.2);
    },
    headchair(c, X, Y, W, H, pal) {  // the director's chair: tall carved cedar, brass star crest, facing the door
      const cx = X + W / 2;
      c.fillStyle = SHADOW; ellipse(c, cx + 4, Y + H, 18, 5);
      c.fillStyle = '#4a2b16'; roundArchPath(c, cx - 17, Y - 30, 34, 50); c.fill();
      c.fillStyle = '#7a4b2a'; roundArchPath(c, cx - 14, Y - 27, 28, 42); c.fill();
      c.fillStyle = pal.rug; roundArchPath(c, cx - 10, Y - 22, 20, 32); c.fill();
      for (let k = 0; k < 3; k++) diamond(c, cx, Y - 12 + k * 8, 3, k % 2 ? PLASTER : BRASS);
      star8(c, cx, Y - 34, 7, BRASS); star8(c, cx, Y - 34, 3.5, TERRA);
      box(c, cx - 17, Y + 14, 34, 10, '#5a3220'); rbox(c, cx - 15, Y + 10, 30, 8, 3, pal.rug);
      box(c, cx - 19, Y + 4, 5, 18, '#6d3b1f'); box(c, cx + 14, Y + 4, 5, 18, '#6d3b1f');
      c.fillStyle = BRASS; circle(c, cx - 16.5, Y + 4, 3); circle(c, cx + 16.5, Y + 4, 3);
      c.strokeStyle = OUTLINE; c.lineWidth = 1.2; roundArchPath(c, cx - 17, Y - 30, 34, 50); c.stroke();
    },
    sidechair(c, X, Y, W, H, pal, t, o) {  // carved chair pulled up to the table, its back away from the table
      const side = o.opts.side, cx = X + W / 2, acc = o.opts.accent || pal.accent;
      c.fillStyle = SHADOW; ellipse(c, cx + 3, Y + H - 3, 11, 4);
      box(c, cx - 9, Y + 14, 18, 12, '#6d3b1f');
      rbox(c, cx - 9, Y + 9, 18, 9, 3, acc); box(c, cx - 7, Y + 10, 14, 1, shade(acc, 0.3));
      const bx = side < 0 ? cx - 12 : cx + 6;
      c.fillStyle = '#5a3220'; roundArchPath(c, bx, Y - 8, 6, 32); c.fill();
      c.fillStyle = CEDAR; roundArchPath(c, bx + 1, Y - 6, 4, 28); c.fill();
      c.fillStyle = BRASS; circle(c, bx + 3, Y - 4, 1.8);
      c.strokeStyle = OUTLINE; c.lineWidth = 1; c.strokeRect(cx - 9, Y + 9, 18, 17);
    },
    bizdesk(c, X, Y, W, H, pal, t, o) {  // small writing desk dressed in one business's colour
      const col = o.opts.color;
      c.fillStyle = SHADOW; c.fillRect(X + 4, Y + H - 2, W - 2, 4);
      box(c, X + 3, Y + 4, W - 6, 6, '#9a6238'); box(c, X + 3, Y + 4, W - 6, 1, '#c88a52');
      box(c, X + 3, Y + 10, W - 6, H - 12, col); box(c, X + 3, Y + 10, W - 6, 2, shade(col, -0.25));
      for (let k = X + 6; k < X + W - 6; k += 5) box(c, k, Y + H - 4, 2, 3, BRASS);
      box(c, X + 9, Y + 2, 12, 5, '#fdf8ec'); c.fillStyle = col; circle(c, X + W - 8, Y + 5, 2.5);
      c.fillStyle = BRASS; circle(c, X + W / 2, Y + 18, 3); c.fillStyle = col; circle(c, X + W / 2, Y + 18, 1.5);
      outlineRect(c, X + 3, Y + 4, W - 6, H - 6, 1);
    },
    deskchair(c, X, Y, W, H, pal) {  // high-backed carved chair, facing the door
      const cx = X + W / 2;
      c.fillStyle = SHADOW; ellipse(c, cx + 3, Y + H - 2, 12, 4);
      c.fillStyle = '#5a3220'; roundArchPath(c, cx - 11, Y - 18, 22, 34); c.fill();
      c.fillStyle = CEDAR; roundArchPath(c, cx - 8, Y - 15, 16, 26); c.fill();
      c.fillStyle = pal.accent; roundArchPath(c, cx - 5, Y - 11, 10, 18); c.fill();
      star8(c, cx, Y - 6, 3, BRASS);
      box(c, cx - 11, Y + 14, 22, 8, '#6d3b1f'); rbox(c, cx - 10, Y + 11, 20, 6, 2, shade(pal.accent, 0.15));
      c.strokeStyle = OUTLINE; c.lineWidth = 1; roundArchPath(c, cx - 11, Y - 18, 22, 34); c.stroke();
    },
    divan(c, X, Y, W, H, pal) {  // low banquette with bolsters and back cushions
      c.fillStyle = SHADOW; c.fillRect(X + 6, Y + H - 2, W - 6, 5);
      box(c, X + 2, Y + 14, W - 4, H - 14, '#6d3b1f');
      for (let k = X + 8; k < X + W - 8; k += 10) box(c, k, Y + 18, 4, 4, BRASS);
      rbox(c, X + 2, Y + 4, W - 4, 12, 3, pal.rug); box(c, X + 2, Y + 4, W - 4, 2, shade(pal.rug, 0.2));
      const n = Math.max(2, Math.round(W / 24));
      for (let k = 0; k < n; k++) { const cx = X + 6 + (W - 12) * (k + 0.5) / n; rbox(c, cx - 9, Y - 6, 18, 13, 4, k % 2 ? BRASS : '#fbf6ec'); diamond(c, cx, Y, 3, pal.accent); }
      rbox(c, X, Y + 2, 7, 14, 3, pal.accent); rbox(c, X + W - 7, Y + 2, 7, 14, 3, pal.accent);
      outlineRect(c, X + 2, Y + 4, W - 4, H - 4, 1);
    },
    screen(c, X, Y, W, H) {  // carved cedar mashrabiya screen
      const top = Y - 22;
      c.fillStyle = SHADOW; c.fillRect(X + 6, Y + H - 4, W - 6, 5);
      const panels = Math.max(1, Math.round(W / T));
      for (let p = 0; p < panels; p++) {
        const px = X + 2 + p * (W - 4) / panels, pw = (W - 4) / panels - 2;
        c.fillStyle = '#6d3b1f'; roundArchPath(c, px, top, pw, Y + H - top - 4); c.fill();
        c.save(); roundArchPath(c, px + 3, top + 3, pw - 6, Y + H - top - 12); c.clip();
        box(c, px, top, pw, Y + H - top, '#3f2414');
        c.strokeStyle = '#b0743f'; c.lineWidth = 2;
        for (let k = -40; k < pw + 40; k += 7) { c.beginPath(); c.moveTo(px + k, top); c.lineTo(px + k + 40, top + 40); c.stroke(); c.beginPath(); c.moveTo(px + k + 40, top); c.lineTo(px + k, top + 40); c.stroke(); }
        c.restore();
        c.strokeStyle = OUTLINE; c.lineWidth = 1; roundArchPath(c, px, top, pw, Y + H - top - 4); c.stroke();
        star8(c, px + pw / 2, top + 6, 2.5, BRASS);
      }
    },
    fountain(c, X, Y, W, H, pal, t) {  // small zellige fountain
      const cx = X + W / 2, cy = Y + H / 2 + 4;
      c.fillStyle = SHADOW; octPath(c, cx + 4, cy + 6, 26); c.fill();
      c.fillStyle = TEAL; octPath(c, cx, cy, 27); c.fill();
      c.fillStyle = pal.accent; octPath(c, cx, cy, 25); c.fill();
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; diamond(c, cx + Math.cos(a) * 22, cy + Math.sin(a) * 20, 2.5, k % 2 ? BRASS : PLASTER); }
      c.fillStyle = '#f3e6cf'; octPath(c, cx, cy, 19); c.fill();
      c.fillStyle = '#3aa0a0'; octPath(c, cx, cy, 16); c.fill();
      const r = (t * 10) % 14 + 3;
      c.strokeStyle = `rgba(255,255,255,${0.4 * (1 - r / 17)})`; c.lineWidth = 1.5; c.beginPath(); c.ellipse(cx, cy, r, r * 0.9, 0, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#f3e6cf'; circle(c, cx, cy - 4, 6); c.fillStyle = BRASS; circle(c, cx, cy - 7, 2.5);
      for (let k = 0; k < 6; k++) { const ph = (t * 1.4 + k / 6) % 1, a = k / 6 * Math.PI * 2; c.fillStyle = `rgba(214,240,238,${0.9 - ph * 0.7})`; circle(c, cx + Math.cos(a) * ph * 12, cy - 8 + Math.sin(a) * ph * 9 - Math.sin(ph * Math.PI) * 9, 1.4); }
      c.strokeStyle = OUTLINE; c.lineWidth = 1.2; octPath(c, cx, cy, 27); c.stroke();
    },
    lamp(c, X, Y, W, H, pal, t) {  // tall brass floor lantern
      const cx = X + W / 2, gy = Y + H - 4;
      c.fillStyle = SHADOW; ellipse(c, cx + 3, gy, 8, 3);
      box(c, cx - 5, gy - 4, 10, 4, '#7a4b2a'); box(c, cx - 1, gy - 30, 2, 26, '#b8862e');
      const glow = c.createRadialGradient(cx, gy - 38, 2, cx, gy - 38, 24);
      glow.addColorStop(0, `rgba(255,214,130,${0.34 + Math.sin(t * 2.3 + X) * 0.04})`); glow.addColorStop(1, 'rgba(255,214,130,0)');
      c.fillStyle = glow; c.fillRect(cx - 24, gy - 62, 48, 48);
      c.fillStyle = BRASS; c.beginPath(); c.moveTo(cx - 6, gy - 30); c.lineTo(cx + 6, gy - 30); c.lineTo(cx + 7, gy - 40); c.lineTo(cx, gy - 49); c.lineTo(cx - 7, gy - 40); c.closePath(); c.fill(); stroke(c);
      c.fillStyle = '#fff1c2'; for (const [dx, dy] of [[-3, -35], [3, -35], [0, -38], [0, -42], [-2, -32], [2, -32]]) circle(c, cx + dx, gy + dy, 0.9);
    },
  };
  function drawDoorstep(c, X, Y, accent) {  // marble doorstep with a brass edge, as in the rooms
    c.fillStyle = SHADOW; c.fillRect(X + 3, Y + 4, T, T - 4);
    box(c, X - 2, Y, T + 4, T - 4, '#f4ebdc');
    box(c, X - 2, Y, T + 4, 2, 'rgba(255,255,255,0.5)');
    box(c, X - 2, Y + T - 6, T + 4, 2, BRASS);
    diamond(c, X + T / 2, Y + 12, 6, accent); diamond(c, X + T / 2, Y + 12, 2.5, BRASS);
    g2line(c, X + 4, Y + 4, X + 12, Y + 22);
    outlineRect(c, X - 2, Y, T + 4, T - 4, 1);
  }
  function g2line(c, x0, y0, x1, y1) { c.strokeStyle = 'rgba(176,150,118,0.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(x0 + 6, (y0 + y1) / 2, x1, y1); c.stroke(); }
  function drawChandelier(c, cx, cy, t) {
    const hy = cy - 56;  // hangs about head height and a half above the floor
    line(c, cx, hy - 60, cx, hy - 10, 'rgba(122,75,42,0.8)', 1.2);
    const glow = c.createRadialGradient(cx, hy, 4, cx, hy, 46);
    glow.addColorStop(0, `rgba(255,220,140,${0.22 + Math.sin(t * 1.7 + cx) * 0.03})`); glow.addColorStop(1, 'rgba(255,220,140,0)');
    c.fillStyle = glow; c.fillRect(cx - 46, hy - 46, 92, 92);
    c.fillStyle = 'rgba(255,214,130,0.10)'; ellipse(c, cx, cy, 34, 12);  // light pooled on the floor
    c.fillStyle = '#b8862e'; ellipse(c, cx, hy + 2, 18, 4);
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2 + 0.3, lx = cx + Math.cos(a) * 16, ly = hy + Math.sin(a) * 4;
      line(c, cx, hy - 10, lx, ly - 4, '#b8862e', 1);
      c.fillStyle = BRASS; c.beginPath(); c.moveTo(lx - 3, ly); c.lineTo(lx + 3, ly); c.lineTo(lx + 3, ly - 6); c.lineTo(lx, ly - 9); c.lineTo(lx - 3, ly - 6); c.closePath(); c.fill();
      c.fillStyle = '#fff1c2'; circle(c, lx, ly - 4, 1.2);
    }
    c.fillStyle = BRASS; c.beginPath(); c.moveTo(cx - 6, hy - 2); c.lineTo(cx + 6, hy - 2); c.lineTo(cx + 5, hy - 12); c.lineTo(cx, hy - 18); c.lineTo(cx - 5, hy - 12); c.closePath(); c.fill(); stroke(c);
    c.fillStyle = '#fff1c2'; for (const [dx, dy] of [[-2, -7], [2, -7], [0, -11], [0, -4]]) circle(c, cx + dx, hy + dy, 1);
  }

  // ---------- job props: what each resident's work looks like, outside and in ----------
  function addProp(s, kind, x, y, owner, w = 1) {
    const o = addObj(s, {
      kind, sortY: (y + 1) * T - 2, bx: x * T - 20, by: y * T - 70, bw: w * T + 40, bh: T + 76,
      msg: PMSG[kind] ? PMSG[kind](owner) : null,
      draw: (c, t) => PROP[kind](c, x * T, y * T, t, owner),
    });
    solidify(s, x, y, w, 1, o);
    return o;
  }
  const PMSG = {
    sundial: (b) => `${b.name}'s stone sundial, to keep the day on time. No deadlines are set yet.`,
    crates: (b) => `Crates sorted by colour, one colour per kind of job. All empty for now.`,
    pegboard: (b) => `${b.name}'s peg board for tasks, blockers and follow-ups. Every peg is empty.`,
    books: (b) => `Bundles of books, tied and ready to be shelved. ${b.name} hasn't opened them yet.`,
    reading: (b) => `A reading stand with an open book. Its pages are blank so far.`,
    scrolls: (b) => `${b.name}'s scroll racks, one slot for every decision and lesson learned. Nothing is filed yet.`,
    teaset: (b) => `A tea table set for meeting clients. Nobody has come to visit yet.`,
    carpets: (b) => `Carpets hung out on show in three colours, one for each business: each business.`,
    ledgers: (b) => `Three ledger boxes, one each for each business, kept apart. All empty.`,
    maptable: (b) => `${b.name}'s map table, for comparing routes and options. The map has no marks on it yet.`,
    astrolabe: (b) => `A brass astrolabe, for taking bearings before choosing a path.`,
    forge: (b) => `${b.name}'s forge. The coals are lit, but nothing is being made yet.`,
    wheel: (b) => `A water wheel that powers the workshop. It turns, but nothing is plugged in yet.`,
    workbench: (b) => `${b.name}'s workbench, with tools laid out for fixing and building. Nothing is on the bench yet.`,
    rack: (b) => `A tall cedar cabinet of blinking lights, ${b.name}'s machines. They are idle.`,
    reels: (b) => `Film reels drying on a line. None of them have been watched yet.`,
    screen: (b) => `A screen for watching the best moments. Nothing is showing yet.`,
    dovecote: (b) => `A dovecote. The pigeons carry word in and out. There's no news yet.`,
    spyglass: (b) => `A brass spyglass on a stand, for keeping watch on the world beyond the walls.`,
    darkroom: (b) => `A darkroom tent for developing photos. It's empty for now.`,
    tripod: (b) => `A camera on a tripod, ready to take pictures. No photos taken yet.`,
    prints: (b) => `An easel with a framed print, waiting to be sorted into an album.`,
    letterboxes: (b) => `A wall of small brass-doored boxes, one for each form and client. All empty.`,
    files: (b) => `Cedar filing chests for forms. Every drawer is empty.`,
    drafting: (b) => `${b.name}'s drafting table, with a blank plan and a ruler.`,
    postcart: (b) => `A post cart with mail bags. Nothing has been sent or delivered yet.`,
    scales: (b) => `Brass scales, for weighing money in against money out. Perfectly balanced at zero.`,
    strongbox: (b) => `An iron-bound strongbox. It's locked and empty.`,
    trunk: (b) => `${b.name}'s travel trunk, packed with nothing yet. No trips are planned.`,
    herbs: (b) => `Pots of mint, basil and thyme. Personal, not business.`,
    hammock: (b) => `A hammock between two palms. Nobody is resting in it yet.`,
    dispatch: (b) => `${b.name}'s dispatch table, where requests are handed to the team. No requests yet.`,
  };
  const sh = (c, cx, gy, rx) => { c.fillStyle = SHADOW; ellipse(c, cx + 3, gy, rx, rx * 0.3); };
  const stroke = (c, lw = 1) => { c.strokeStyle = OUTLINE; c.lineWidth = lw; c.stroke(); };
  function line(c, x0, y0, x1, y1, color, lw = 1) { c.strokeStyle = color; c.lineWidth = lw; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
  function crate(c, x, y, w, h, tag) {
    box(c, x, y, w, h, '#b0743f'); box(c, x, y, w, 3, '#c88a52');
    line(c, x + 2, y + 3, x + w - 2, y + h - 1, '#8a5a32', 1.5); box(c, x + w / 2 - 3, y + h / 2 - 2, 6, 4, tag);
    outlineRect(c, x, y, w, h, 1);
  }
  const PROP = {
    sundial(c, X, Y, t) {
      const cx = X + 16, gy = Y + 28; sh(c, cx, gy, 13);
      box(c, cx - 6, gy - 14, 12, 14, '#e0cfb1'); box(c, cx + 2, gy - 14, 4, 14, '#cdb690');
      c.fillStyle = '#f3e6cf'; c.beginPath(); c.ellipse(cx, gy - 16, 14, 7, 0, 0, Math.PI * 2); c.fill(); stroke(c);
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; box(c, cx + Math.cos(a) * 11 - 1, gy - 16 + Math.sin(a) * 5 - 1, 2, 2, k % 3 ? TEAL : BRASS); }
      const a = t * 0.08;
      line(c, cx, gy - 16, cx + Math.cos(a) * 10, gy - 16 + Math.sin(a) * 5, 'rgba(15,42,46,.45)', 2);
      c.fillStyle = BRASS; c.beginPath(); c.moveTo(cx - 1, gy - 16); c.lineTo(cx + 1, gy - 16); c.lineTo(cx, gy - 27); c.closePath(); c.fill();
    },
    crates(c, X, Y, t, b) {
      sh(c, X + 16, Y + 28, 15);
      crate(c, X + 2, Y + 12, 15, 15, LAGOON); crate(c, X + 16, Y + 14, 14, 13, TERRA); crate(c, X + 8, Y, 14, 12, BRASS);
    },
    pegboard(c, X, Y, t, b) {
      sh(c, X + 16, Y + 28, 14);
      box(c, X + 4, Y + 10, 3, 18, '#6d3b1f'); box(c, X + 25, Y + 10, 3, 18, '#6d3b1f');
      box(c, X + 1, Y - 14, 30, 26, '#7a4b2a'); box(c, X + 3, Y - 12, 26, 22, '#c49a6c');
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { box(c, X + 6 + k * 6, Y - 9 + r * 7, 2, 2, '#6d3b1f'); }
      for (const [k, col] of [[0, LAGOON], [2, TERRA], [5, BRASS]]) box(c, X + 5 + (k % 4) * 6, Y - 8 + ((k / 4) | 0) * 7, 5, 5, '#fdf8ec'), box(c, X + 5 + (k % 4) * 6, Y - 8 + ((k / 4) | 0) * 7, 5, 1.5, col);
      outlineRect(c, X + 1, Y - 14, 30, 26, 1);
    },
    books(c, X, Y) {
      sh(c, X + 16, Y + 28, 14);
      const cols = [LAGOON, TERRA, PALM, BRASS, '#7a4b2a', '#1f6f8b'];
      for (let r = 0; r < 4; r++) { box(c, X + 4 + (r % 2) * 3, Y + 22 - r * 6, 22, 6, cols[r]); box(c, X + 4 + (r % 2) * 3, Y + 22 - r * 6, 22, 1, '#fbf6ec'); }
      box(c, X + 15, Y + 4, 2, 24, '#c49a6c'); box(c, X + 5, Y + 14, 24, 2, '#c49a6c');
      outlineRect(c, X + 4, Y + 4, 25, 24, 1);
    },
    reading(c, X, Y) {
      sh(c, X + 16, Y + 28, 12);
      line(c, X + 9, Y + 28, X + 23, Y + 6, '#6d3b1f', 3); line(c, X + 23, Y + 28, X + 9, Y + 6, '#6d3b1f', 3);
      c.fillStyle = '#fdf8ec'; c.beginPath(); c.moveTo(X + 3, Y + 4); c.lineTo(X + 16, Y + 8); c.lineTo(X + 29, Y + 4); c.lineTo(X + 29, Y - 6); c.lineTo(X + 16, Y - 2); c.lineTo(X + 3, Y - 6); c.closePath(); c.fill(); stroke(c);
      line(c, X + 16, Y - 2, X + 16, Y + 8, '#d6cdb8'); box(c, X + 15, Y + 6, 2, 8, TERRA);
    },
    scrolls(c, X, Y) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 1, Y - 18, 30, 46, '#6d3b1f'); box(c, X + 3, Y - 16, 26, 42, '#3f2414');
      for (let r = 0; r < 5; r++) for (let k = 0; k < 4; k++) {
        box(c, X + 3, Y - 16 + r * 8 + 7, 26, 1.5, '#8a5a32');
        if (hash(k, r, 3) < 0.8) { c.fillStyle = '#f3e6cf'; circle(c, X + 7 + k * 6, Y - 12 + r * 8, 2.6); c.fillStyle = r % 2 ? TERRA : BRASS; circle(c, X + 7 + k * 6, Y - 12 + r * 8, 1); }
      }
      outlineRect(c, X + 1, Y - 18, 30, 46, 1);
    },
    teaset(c, X, Y) {
      sh(c, X + 16, Y + 28, 14);
      box(c, X + 9, Y + 16, 3, 11, '#6d3b1f'); box(c, X + 20, Y + 16, 3, 11, '#6d3b1f');
      c.fillStyle = '#b8862e'; ellipse(c, X + 16, Y + 16, 14, 7); c.fillStyle = BRASS; ellipse(c, X + 16, Y + 14, 14, 6.5);
      c.fillStyle = '#d0d4d4'; ellipse(c, X + 14, Y + 10, 5, 4); box(c, X + 13, Y + 3, 2, 4, '#d0d4d4'); box(c, X + 18, Y + 8, 5, 1.5, '#d0d4d4');
      for (const gx of [X + 5, X + 23]) { box(c, gx, Y + 10, 3, 4, '#9fd8c8'); box(c, gx, Y + 10, 3, 1, BRASS); }
    },
    carpets(c, X, Y) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 1, Y - 18, 3, 46, '#6d3b1f'); box(c, X + 28, Y - 18, 3, 46, '#6d3b1f'); box(c, X - 1, Y - 20, 34, 3, '#7a4b2a');
      BIZ.forEach((col, k) => {
        const x = X + 5 + k * 8; box(c, x, Y - 17, 7, 34 - k * 4, col);
        for (let r = 0; r < 3; r++) diamond(c, x + 3.5, Y - 10 + r * 9, 2.5, k === 2 ? TEAL : '#f3e6cf');
        for (let f = 0; f < 3; f++) box(c, x + 1 + f * 2, Y + 17 - k * 4, 1, 3, '#f3e6cf');
      });
    },
    ledgers(c, X, Y) {
      sh(c, X + 16, Y + 28, 15);
      BIZ.forEach((col, k) => { const x = X + 2 + k * 10; box(c, x, Y + 6, 9, 21, col); box(c, x + 1, Y + 8, 7, 2, '#fbf6ec'); box(c, x + 3, Y + 17, 3, 3, BRASS); outlineRect(c, x, Y + 6, 9, 21, 1); });
    },
    maptable(c, X, Y) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 4, Y + 14, 3, 14, '#5a3220'); box(c, X + 25, Y + 14, 3, 14, '#5a3220');
      box(c, X + 1, Y + 4, 30, 12, '#9a6238'); box(c, X + 3, Y + 2, 26, 11, '#f3e3c2');
      c.fillStyle = '#9fc7c0'; ellipse(c, X + 10, Y + 7, 6, 3); c.fillStyle = '#b8c98a'; ellipse(c, X + 21, Y + 8, 6, 3.5);
      line(c, X + 6, Y + 11, X + 26, Y + 4, TERRA, 1); line(c, X + 6, Y + 11, X + 24, Y + 11, LAGOON, 1);
      c.fillStyle = BRASS; circle(c, X + 26, Y + 4, 1.8); outlineRect(c, X + 1, Y + 2, 30, 14, 1);
    },
    astrolabe(c, X, Y, t) {
      sh(c, X + 16, Y + 28, 10);
      box(c, X + 10, Y + 24, 12, 4, '#6d3b1f'); box(c, X + 15, Y + 6, 2, 19, '#7a4b2a');
      c.strokeStyle = BRASS; c.lineWidth = 2.5; c.beginPath(); c.arc(X + 16, Y - 2, 11, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 1.5; c.beginPath(); c.ellipse(X + 16, Y - 2, 11 * Math.abs(Math.cos(t * 0.6)), 11, 0, 0, Math.PI * 2); c.stroke();
      line(c, X + 5, Y - 2, X + 27, Y - 2, '#b8862e', 1.5); c.fillStyle = TERRA; circle(c, X + 16, Y - 2, 2);
    },
    forge(c, X, Y, t) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 2, Y + 6, 28, 22, '#b9a585'); box(c, X + 2, Y + 6, 28, 3, '#d6c4a2');
      const g = 0.6 + Math.sin(t * 5) * 0.2 + Math.sin(t * 13) * 0.1;
      box(c, X + 6, Y + 10, 20, 8, '#3a2a20');
      for (let k = 0; k < 5; k++) { c.fillStyle = `rgba(255,${120 + k * 20},60,${g})`; circle(c, X + 9 + k * 3.5, Y + 15, 2.4); }
      const glow = c.createRadialGradient(X + 16, Y + 12, 2, X + 16, Y + 12, 22); glow.addColorStop(0, `rgba(255,150,70,${0.35 * g})`); glow.addColorStop(1, 'rgba(255,150,70,0)');
      c.fillStyle = glow; c.fillRect(X - 8, Y - 10, 48, 44);
      box(c, X + 12, Y - 18, 8, 24, '#a08a6c'); box(c, X + 12, Y - 18, 8, 2, '#7d6a52');
      drawSmoke(c, X + 16, Y - 20, t, X, 0.8);
      outlineRect(c, X + 2, Y + 6, 28, 22, 1);
    },
    wheel(c, X, Y, t) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 1, Y + 20, 30, 8, '#c9b28a'); box(c, X + 3, Y + 21, 26, 5, LAGOON);
      const cx = X + 16, cy = Y + 6, R = 15, a0 = t * 1.2;
      c.strokeStyle = '#7a4b2a'; c.lineWidth = 2.5; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
      for (let k = 0; k < 8; k++) { const a = a0 + k * Math.PI / 4; line(c, cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R, '#8a5a32', 1.5); box(c, cx + Math.cos(a) * R - 2, cy + Math.sin(a) * R - 2, 4, 4, '#6d3b1f'); }
      c.fillStyle = BRASS; circle(c, cx, cy, 3);
      c.fillStyle = 'rgba(214,240,238,.8)'; for (let k = 0; k < 3; k++) circle(c, cx + 12 - k * 3, Y + 20 + ((t * 30 + k * 4) % 6), 1.3);
    },
    workbench(c, X, Y) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 3, Y + 14, 3, 14, '#5a3220'); box(c, X + 26, Y + 14, 3, 14, '#5a3220');
      box(c, X + 1, Y + 6, 30, 9, '#9a6238'); box(c, X + 1, Y + 6, 30, 2, '#c88a52');
      c.strokeStyle = BRASS; c.lineWidth = 2; c.beginPath(); c.arc(X + 9, Y + 3, 4, 0, Math.PI * 2); c.stroke();
      box(c, X + 17, Y + 1, 9, 3, '#6b6f73'); box(c, X + 20, Y + 1, 2, 6, '#7a4b2a');
      outlineRect(c, X + 1, Y + 6, 30, 9, 1);
    },
    rack(c, X, Y, t) {
      sh(c, X + 16, Y + 28, 14);
      box(c, X + 3, Y - 20, 26, 48, '#6d3b1f'); box(c, X + 5, Y - 18, 22, 44, '#2c3a3a');
      for (let r = 0; r < 6; r++) {
        box(c, X + 6, Y - 16 + r * 7, 20, 5, '#3c4c4c');
        const on = hash(r, Math.floor(t * 3 + r), 7) < 0.6;
        box(c, X + 8, Y - 15 + r * 7, 2, 2, on ? '#7fe0c0' : '#2f6447'); box(c, X + 12, Y - 15 + r * 7, 2, 2, hash(r, Math.floor(t * 2), 9) < 0.5 ? BRASS : '#6d5a2a');
      }
      outlineRect(c, X + 3, Y - 20, 26, 48, 1);
    },
    reels(c, X, Y, t) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 2, Y - 10, 3, 38, '#6d3b1f'); box(c, X + 27, Y - 10, 3, 38, '#6d3b1f');
      line(c, X + 3, Y - 8, X + 29, Y - 8, '#e6d3b3', 1);
      for (let k = 0; k < 3; k++) {
        const cx = X + 9 + k * 7, cy = Y + 2 + Math.sin(t * 2 + k) * 0.8;
        line(c, cx, Y - 8, cx, cy - 5, '#e6d3b3', 1);
        c.fillStyle = '#2c3a3a'; circle(c, cx, cy, 5); c.fillStyle = '#6b6f73'; for (let h = 0; h < 4; h++) circle(c, cx + Math.cos(h * 1.57) * 2.6, cy + Math.sin(h * 1.57) * 2.6, 1);
        c.fillStyle = BRASS; circle(c, cx, cy, 1);
      }
    },
    screen(c, X, Y, t) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 2, Y - 14, 3, 42, '#6d3b1f'); box(c, X + 27, Y - 14, 3, 42, '#6d3b1f');
      for (let k = 0; k < 4; k++) box(c, X - 1 + k * 9, Y - 20, 9, 6, k % 2 ? PLASTER : TERRA);
      // a flickering picture: soft shifting colour, a rolling scan band and the odd bright flash
      const scene = Math.floor(t / 2.5), flash = (t % 2.5) < 0.08 ? 0.35 : 0;
      box(c, X + 5, Y - 12, 22, 18, ['#2b8a8a', '#d9643f', '#4c8a4a', '#e8b04b'][scene % 4]);
      c.fillStyle = `rgba(253,248,236,${0.35 + Math.sin(t * 9) * 0.06 + flash})`; c.fillRect(X + 5, Y - 12, 22, 18);
      c.fillStyle = 'rgba(15,42,46,0.18)'; c.fillRect(X + 5, Y - 12 + ((t * 14) % 18), 22, 3);
      c.fillStyle = 'rgba(253,248,236,0.85)'; c.beginPath(); c.moveTo(X + 13, Y - 7); c.lineTo(X + 13, Y + 1); c.lineTo(X + 20, Y - 3); c.closePath(); c.fill();
      outlineRect(c, X + 5, Y - 12, 22, 18, 1);
    },
    dovecote(c, X, Y, t) {
      sh(c, X + 16, Y + 28, 10);
      box(c, X + 14, Y - 4, 4, 32, '#7a4b2a');
      box(c, X + 6, Y - 22, 20, 18, PLASTER); box(c, X + 21, Y - 22, 5, 18, '#efe6d6');
      for (const [hx, hy] of [[10, -18], [17, -18], [10, -11], [17, -11]]) { c.fillStyle = TEAL; roundArchPath(c, X + hx, Y + hy, 5, 6); c.fill(); }
      c.fillStyle = TERRA; c.beginPath(); c.moveTo(X + 3, Y - 21); c.lineTo(X + 29, Y - 21); c.lineTo(X + 16, Y - 33); c.closePath(); c.fill(); stroke(c);
      outlineRect(c, X + 6, Y - 22, 20, 18, 1);
      drawPigeons(c, X + 16, Y - 40, 22, 7, 3, t);
    },
    spyglass(c, X, Y, t) {
      sh(c, X + 16, Y + 28, 11);
      line(c, X + 16, Y + 2, X + 7, Y + 28, '#6d3b1f', 2.5); line(c, X + 16, Y + 2, X + 25, Y + 28, '#6d3b1f', 2.5); line(c, X + 16, Y + 2, X + 16, Y + 28, '#6d3b1f', 2.5);
      c.save(); c.translate(X + 16, Y + 1); c.rotate(-0.45 + Math.sin(t * 0.4) * 0.15);
      box(c, -12, -3, 26, 6, BRASS); box(c, 10, -4, 5, 8, '#b8862e'); box(c, -14, -2, 4, 4, '#b8862e'); c.restore();
    },
    darkroom(c, X, Y) {
      sh(c, X + 16, Y + 28, 16);
      c.fillStyle = '#7d2f2a'; c.beginPath(); c.moveTo(X + 1, Y + 28); c.lineTo(X + 16, Y - 8); c.lineTo(X + 31, Y + 28); c.closePath(); c.fill(); stroke(c);
      c.fillStyle = '#a8473a'; c.beginPath(); c.moveTo(X + 16, Y - 8); c.lineTo(X + 31, Y + 28); c.lineTo(X + 22, Y + 28); c.closePath(); c.fill();
      c.fillStyle = '#3a1512'; c.beginPath(); c.moveTo(X + 10, Y + 28); c.lineTo(X + 16, Y + 8); c.lineTo(X + 20, Y + 28); c.closePath(); c.fill();
      box(c, X + 15, Y - 12, 2, 5, '#6d3b1f');
    },
    tripod(c, X, Y) {
      sh(c, X + 16, Y + 28, 11);
      line(c, X + 16, Y + 2, X + 7, Y + 28, '#2c3a3a', 2); line(c, X + 16, Y + 2, X + 25, Y + 28, '#2c3a3a', 2); line(c, X + 16, Y + 2, X + 16, Y + 28, '#2c3a3a', 2);
      rbox(c, X + 7, Y - 10, 18, 12, 2, '#2c3a3a'); box(c, X + 9, Y - 13, 6, 3, '#3c4c4c');
      c.fillStyle = '#6b6f73'; circle(c, X + 16, Y - 4, 4.5); c.fillStyle = '#1d5458'; circle(c, X + 16, Y - 4, 2.6); c.fillStyle = '#cfeeee'; circle(c, X + 15, Y - 5, 0.9);
    },
    prints(c, X, Y) {
      sh(c, X + 16, Y + 28, 12);
      line(c, X + 9, Y + 28, X + 14, Y - 10, '#7a4b2a', 2); line(c, X + 23, Y + 28, X + 18, Y - 10, '#7a4b2a', 2); line(c, X + 16, Y - 8, X + 16, Y + 28, '#7a4b2a', 2);
      box(c, X + 4, Y - 14, 24, 20, BRASS); box(c, X + 6, Y - 12, 20, 16, '#cfeeee');
      c.fillStyle = '#e8b04b'; circle(c, X + 21, Y - 8, 2.5); c.fillStyle = PALM; c.beginPath(); c.moveTo(X + 6, Y + 4); c.lineTo(X + 13, Y - 4); c.lineTo(X + 19, Y + 4); c.closePath(); c.fill();
      c.fillStyle = LAGOON; c.beginPath(); c.moveTo(X + 13, Y + 4); c.lineTo(X + 20, Y - 2); c.lineTo(X + 26, Y + 4); c.closePath(); c.fill();
      outlineRect(c, X + 4, Y - 14, 24, 20, 1);
    },
    letterboxes(c, X, Y, t, b) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 1, Y - 10, 30, 38, '#f3e6cf'); box(c, X + 26, Y - 10, 5, 38, '#e0cfb1');
      for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) { box(c, X + 4 + k * 7, Y - 7 + r * 8, 6, 6, BRASS); box(c, X + 5 + k * 7, Y - 6 + r * 8, 4, 1, '#8a6a2a'); }
      zelligeStrip(c, X + 1, Y + 24, 30, 4, b && b.accent ? b.accent : LAGOON);
      outlineRect(c, X + 1, Y - 10, 30, 38, 1);
    },
    files(c, X, Y) {
      sh(c, X + 16, Y + 28, 15);
      for (let r = 0; r < 3; r++) { box(c, X + 3, Y - 6 + r * 11, 26, 11, r % 2 ? '#8a5a32' : '#9a6238'); box(c, X + 13, Y - 2 + r * 11, 6, 2, BRASS); }
      box(c, X + 3, Y - 8, 26, 3, '#6d3b1f'); outlineRect(c, X + 3, Y - 8, 26, 36, 1);
    },
    drafting(c, X, Y) {
      sh(c, X + 16, Y + 28, 14);
      box(c, X + 6, Y + 10, 3, 18, '#5a3220'); box(c, X + 23, Y + 10, 3, 18, '#5a3220');
      c.fillStyle = '#9a6238'; c.beginPath(); c.moveTo(X + 1, Y + 14); c.lineTo(X + 31, Y + 14); c.lineTo(X + 28, Y - 6); c.lineTo(X + 4, Y - 6); c.closePath(); c.fill(); stroke(c);
      c.fillStyle = '#fdf8ec'; c.beginPath(); c.moveTo(X + 5, Y + 11); c.lineTo(X + 27, Y + 11); c.lineTo(X + 25, Y - 3); c.lineTo(X + 7, Y - 3); c.closePath(); c.fill();
      line(c, X + 9, Y + 6, X + 23, Y + 6, '#1f6f8b', 1); line(c, X + 10, Y + 1, X + 10, Y + 9, '#1f6f8b', 1); line(c, X + 16, Y, X + 22, Y + 9, '#1f6f8b', 1);
      line(c, X + 6, Y + 13, X + 26, Y - 1, BRASS, 2);
    },
    postcart(c, X, Y, t) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 2, Y + 8, 26, 12, '#9a6238'); box(c, X + 2, Y + 8, 26, 2, '#c88a52'); line(c, X + 28, Y + 12, X + 32, Y + 22, '#6d3b1f', 2);
      for (const [bx, col] of [[X + 5, '#e6d3b3'], [X + 13, '#d9c19a'], [X + 20, '#e6d3b3']]) { c.fillStyle = col; ellipse(c, bx + 3, Y + 4, 5, 7); box(c, bx + 1, Y - 3, 4, 2, '#8a5a32'); }
      c.fillStyle = '#5a3220'; circle(c, X + 10, Y + 22, 6); c.fillStyle = '#c88a52'; circle(c, X + 10, Y + 22, 2);
      outlineRect(c, X + 2, Y + 8, 26, 12, 1);
    },
    scales(c, X, Y, t) {
      sh(c, X + 16, Y + 28, 12);
      box(c, X + 9, Y + 24, 14, 4, '#b8862e'); box(c, X + 15, Y - 10, 2, 34, BRASS);
      const tilt = Math.sin(t * 0.8) * 1.2;
      line(c, X + 3, Y - 8 + tilt, X + 29, Y - 8 - tilt, BRASS, 2);
      for (const [px, dy] of [[X + 5, tilt], [X + 27, -tilt]]) { line(c, px, Y - 8 + dy, px - 4, Y + 4 + dy, '#b8862e'); line(c, px, Y - 8 + dy, px + 4, Y + 4 + dy, '#b8862e'); c.fillStyle = BRASS; ellipse(c, px, Y + 5 + dy, 6, 2); }
      c.fillStyle = BRASS; circle(c, X + 16, Y - 11, 2.5);
    },
    strongbox(c, X, Y) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 2, Y + 6, 28, 22, '#3c4c4c'); c.fillStyle = '#4b5d5d'; roundArchPath(c, X + 2, Y - 2, 28, 12); c.fill();
      for (const bx of [X + 6, X + 23]) box(c, bx, Y - 1, 3, 29, '#6b6f73');
      box(c, X + 12, Y + 10, 8, 9, BRASS); c.fillStyle = '#3a2a20'; circle(c, X + 16, Y + 13, 1.6); box(c, X + 15.3, Y + 13, 1.4, 4, '#3a2a20');
      outlineRect(c, X + 2, Y + 6, 28, 22, 1);
    },
    trunk(c, X, Y) {
      sh(c, X + 16, Y + 28, 15);
      box(c, X + 2, Y + 8, 28, 20, '#7a4b2a'); c.fillStyle = '#8a5a32'; roundArchPath(c, X + 2, Y + 2, 28, 10); c.fill();
      for (const bx of [X + 8, X + 22]) box(c, bx, Y + 3, 3, 25, '#4a2b16');
      box(c, X + 12, Y + 14, 5, 4, LAGOON); box(c, X + 18, Y + 19, 3, 5, TERRA); box(c, X + 4, Y + 18, 3, 3, BRASS);
      box(c, X + 14, Y + 6, 4, 4, BRASS); outlineRect(c, X + 2, Y + 8, 28, 20, 1);
    },
    herbs(c, X, Y) {
      sh(c, X + 16, Y + 28, 14);
      for (let k = 0; k < 3; k++) {
        const px = X + 3 + k * 9;
        c.fillStyle = TERRA; c.beginPath(); c.moveTo(px, Y + 18); c.lineTo(px + 8, Y + 18); c.lineTo(px + 7, Y + 28); c.lineTo(px + 1, Y + 28); c.closePath(); c.fill();
        c.fillStyle = ['#5f9a55', PALM, '#7fae5e'][k]; for (let l = 0; l < 4; l++) circle(c, px + 2 + l * 1.5, Y + 14 - (l % 2) * 4, 3);
      }
    },
    hammock(c, X, Y, t) {
      drawPalm(c, X + 6, Y + 26, 0.75, -6, 0.4, t); drawPalm(c, X + 58, Y + 26, 0.75, 6, 1.9, t);
      const sway = Math.sin(t * 1.2) * 2;
      c.fillStyle = '#e6d3b3'; c.beginPath(); c.moveTo(X + 8, Y - 6); c.quadraticCurveTo(X + 32, Y + 18 + sway, X + 56, Y - 6); c.quadraticCurveTo(X + 32, Y + 8 + sway, X + 8, Y - 6); c.fill(); stroke(c);
      for (let k = 0; k < 3; k++) line(c, X + 18 + k * 10, Y + 3 + sway * 0.6, X + 20 + k * 10, Y + 10 + sway, [TERRA, LAGOON, BRASS][k], 2);
    },
    dispatch(c, X, Y, t) {
      sh(c, X + 32, Y + 28, 28);
      box(c, X + 5, Y + 14, 4, 14, '#5a3220'); box(c, X + 55, Y + 14, 4, 14, '#5a3220');
      box(c, X + 1, Y + 4, 62, 12, '#9a6238'); box(c, X + 1, Y + 4, 62, 2, '#c88a52');
      zelligeStrip(c, X + 1, Y + 14, 62, 4, LAGOON);
      for (const [px, n] of [[X + 8, 3], [X + 26, 2], [X + 42, 4]]) for (let k = 0; k < n; k++) box(c, px - k, Y + 6 - k * 2, 12, 5, k % 2 ? '#f3ecd9' : '#fdf8ec');
      c.fillStyle = BRASS; circle(c, X + 58, Y + 5, 2.5);
      const bob = Math.abs(Math.sin(t * 3)) * 1.5;
      c.fillStyle = '#e6e2da'; ellipse(c, X + 56, Y + 1 - bob, 4, 2.6); c.fillStyle = '#9aa4a6'; circle(c, X + 59, Y - 1.5 - bob, 1.6); box(c, X + 60, Y - 2 - bob, 2, 1, BRASS);
      outlineRect(c, X + 1, Y + 4, 62, 12, 1);
    },
  };
  function drawPigeons(c, cx, cy, rx, ry, n, t) {
    for (let k = 0; k < n; k++) {
      const a = t * 0.7 + k * Math.PI * 2 / n, x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry, f = Math.sin(t * 11 + k * 2) * 3;
      c.strokeStyle = '#d8d4cc'; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(x - 5, y - f); c.lineTo(x, y); c.lineTo(x + 5, y - f); c.stroke();
      c.fillStyle = '#f4f1ea'; ellipse(c, x, y, 2.2, 1.4);
    }
  }
  function drawGardenGate(c, X, Y) {
    for (const px of [X - 6, X + T - 2]) { box(c, px, Y - 34, 8, 34 + T - 4, '#e7c592'); outlineRect(c, px, Y - 34, 8, 34 + T - 4, 1); }
    c.strokeStyle = '#3f7d4a'; c.lineWidth = 6; c.beginPath(); c.arc(X + 16, Y - 30, 20, Math.PI, 0); c.stroke();
    for (let k = 0; k < 9; k++) { const a = Math.PI + k * Math.PI / 8; c.fillStyle = k % 2 ? '#e05a9c' : '#c2367a'; circle(c, X + 16 + Math.cos(a) * 20, Y - 30 + Math.sin(a) * 20, 2.4); }
    c.fillStyle = BRASS; circle(c, X + 16, Y - 52, 2.5);
  }
  function awning(c, x, y, w, col) {
    c.fillStyle = col; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w + 3, y + 10); c.lineTo(x - 3, y + 10); c.closePath(); c.fill();
    c.save(); c.clip(); for (let k = 0; k < w + 6; k += 8) box(c, x - 3 + k, y, 4, 10, PLASTER); c.restore();
    for (let k = 0; k < w + 6; k += 6) { c.fillStyle = col; circle(c, x - 1 + k, y + 10, 2.2); }
    c.strokeStyle = OUTLINE; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w + 3, y + 10); c.lineTo(x - 3, y + 10); c.closePath(); c.stroke();
  }
  // the details on each villa's roof and front that show its job
  function drawJob(c, b, g, t) {
    const { X, W, bottom, roofBot, spot, tower, dome, dx } = g;
    switch (b.key) {
      case 'keeper': {  // a clock on the tower
        const cx = tower.tx + tower.tw / 2, cy = tower.tFace + 20;
        c.fillStyle = BRASS; circle(c, cx, cy, 12); c.fillStyle = PLASTER; circle(c, cx, cy, 10);
        for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; box(c, cx + Math.cos(a) * 8 - 0.8, cy + Math.sin(a) * 8 - 0.8, 1.6, 1.6, TEAL); }
        line(c, cx, cy, cx + Math.cos(t * 0.05 - 1.57) * 5, cy + Math.sin(t * 0.05 - 1.57) * 5, TEAL, 2);
        line(c, cx, cy, cx + Math.cos(t * 0.6 - 1.57) * 8, cy + Math.sin(t * 0.6 - 1.57) * 8, TERRA, 1.2);
        c.strokeStyle = OUTLINE; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, 12, 0, Math.PI * 2); c.stroke();
        break;
      }
      case 'librarian': {  // scroll cubbies on the archive tower
        const x0 = tower.tx + 8, y0 = tower.tFace + 6, w = tower.tw - 16;
        box(c, x0 - 2, y0 - 2, w + 4, 34, '#6d3b1f'); box(c, x0, y0, w, 30, '#3f2414');
        for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) { c.fillStyle = '#f3e6cf'; circle(c, x0 + 5 + k * (w - 10) / 5, y0 + 4 + r * 7.3, 2.4); c.fillStyle = (k + r) % 2 ? TERRA : BRASS; circle(c, x0 + 5 + k * (w - 10) / 5, y0 + 4 + r * 7.3, 0.9); }
        outlineRect(c, x0 - 2, y0 - 2, w + 4, 34, 1);
        c.fillStyle = BRASS; star8(c, tower.tx + tower.tw / 2, tower.tTop - 14, 6, BRASS);
        break;
      }
      case 'merchant': {  // three awnings, one per business, and rolled carpets on the roof
        awning(c, X + 17, roofBot + 8, 28, BIZ[0]);
        awning(c, X + W - 45, roofBot + 8, 28, BIZ[2]);
        awning(c, dx - 1, bottom - 56, 34, BIZ[1]);
        BIZ.forEach((col, k) => { c.fillStyle = col; rbox(c, spot.x - 18, spot.y - 6 - k * 6, 36, 6, 3, col); c.fillStyle = '#f3e6cf'; ellipse(c, spot.x + 18, spot.y - 3 - k * 6, 2, 3); });
        break;
      }
      case 'scholar': {  // the dome becomes an observatory, with a telescope
        const top = dome.dBase - 4 - dome.dh;
        c.fillStyle = '#1d3a3d'; c.fillRect(dome.dcx - 5, top + 6, 10, dome.dh - 8);
        c.save(); c.translate(dome.dcx, top + 18); c.rotate(-0.9 + Math.sin(t * 0.3) * 0.2);
        box(c, -4, -30, 8, 32, BRASS); box(c, -5, -34, 10, 6, '#b8862e'); c.restore();
        c.fillStyle = BRASS; circle(c, dome.dcx, top + 18, 3);
        break;
      }
      case 'engineer': {  // cable runs, a raised security grille and an antenna
        c.strokeStyle = '#2c3a3a'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(X + 8, roofBot + 6); c.lineTo(X + W - 14, roofBot + 6); c.lineTo(X + W - 14, bottom - 10); c.stroke();
        c.beginPath(); c.moveTo(X + 8, roofBot + 10); c.quadraticCurveTo(X + 60, roofBot + 18, X + W - 18, roofBot + 10); c.stroke();
        for (let k = X + 20; k < X + W - 20; k += 30) box(c, k, roofBot + 4, 3, 4, BRASS);
        box(c, dx + 4, bottom - 54, 24, 7, '#3c4c4c'); for (let k = 0; k < 5; k++) box(c, dx + 6 + k * 5, bottom - 54, 1.5, 9, '#6b6f73');
        box(c, spot.x - 1, spot.y - 34, 2, 34, '#3c4c4c');
        for (const [yy, ww] of [[-28, 14], [-20, 10], [-12, 16]]) box(c, spot.x - ww / 2, spot.y + yy, ww, 1.5, '#3c4c4c');
        c.fillStyle = Math.sin(t * 4) > 0 ? '#ff6b5a' : '#7a2a24'; circle(c, spot.x, spot.y - 36, 2.4);
        break;
      }
      case 'youtube': {  // a satellite dish on the roof
        box(c, spot.x - 2, spot.y - 12, 4, 12, '#6b6f73');
        c.save(); c.translate(spot.x, spot.y - 18); c.rotate(-0.5);
        c.fillStyle = '#f3f0ea'; c.beginPath(); c.ellipse(0, 0, 14, 8, 0, 0, Math.PI * 2); c.fill(); stroke(c);
        c.fillStyle = '#d8d2c4'; c.beginPath(); c.ellipse(0, 1, 9, 5, 0, 0, Math.PI * 2); c.fill();
        line(c, 0, 0, 0, -12, '#6b6f73', 1.5); c.fillStyle = TERRA; circle(c, 0, -12, 2.4); c.restore();
        break;
      }
      case 'scout': {  // a lookout canopy and spyglass on the tower, with pigeons
        const cx = tower.tx + tower.tw / 2, y = tower.tFace - 4;
        for (const px of [cx - 26, cx + 22]) box(c, px, y - 26, 3, 26, '#7a4b2a');
        for (let k = 0; k < 6; k++) box(c, cx - 30 + k * 10, y - 32, 10, 7, k % 2 ? PLASTER : b.accent);
        c.save(); c.translate(cx, y - 12); c.rotate(b.flip ? -2.6 : -0.5); box(c, -2, -3, 24, 6, BRASS); box(c, 18, -4, 5, 8, '#b8862e'); c.restore();
        drawPigeons(c, cx, tower.tTop - 30, 34, 9, 4, t);
        break;
      }
      case 'media': PROP.prints(c, spot.x - 16, spot.y - 28, t); break;
      case 'studio': {  // a small wooden crane on the tower, lifting a crate
        const cx = tower.tx + tower.tw / 2, y = tower.tFace - 4, dir = b.flip ? -1 : 1;
        box(c, cx - 2, y - 44, 4, 44, '#8a5a32');
        line(c, cx, y - 42, cx + dir * 46, y - 42, '#8a5a32', 3); line(c, cx, y - 30, cx + dir * 30, y - 42, '#7a4b2a', 1.5);
        const sw = Math.sin(t * 1.3) * 3, rx = cx + dir * 40 + sw;
        line(c, cx + dir * 40, y - 42, rx, y - 16, '#e6d3b3', 1);
        crate(c, rx - 7, y - 16, 14, 11, BRASS);
        break;
      }
      case 'inbox': {  // pigeon lofts on the roof and a brass bell by the door
        PROP.dovecote(c, spot.x - 16, spot.y - 28, t);
        const bx = dx + 38, swing = Math.sin(t * 2) * 0.15;
        box(c, bx - 6, bottom - 58, 12, 2, '#7a4b2a');
        c.save(); c.translate(bx, bottom - 56); c.rotate(swing);
        c.fillStyle = BRASS; c.beginPath(); c.moveTo(-3, 2); c.lineTo(3, 2); c.lineTo(6, 12); c.lineTo(-6, 12); c.closePath(); c.fill(); stroke(c);
        c.fillStyle = '#b8862e'; circle(c, 0, 13, 1.5); c.restore();
        break;
      }
      case 'money': {  // a gilded dome on the tower
        const cx = tower.tx + tower.tw / 2, y = tower.tFace - 6;
        const grad = c.createLinearGradient(cx - 22, 0, cx + 22, 0); grad.addColorStop(0, '#f6d27a'); grad.addColorStop(1, '#b8862e');
        c.fillStyle = grad; c.beginPath(); c.ellipse(cx, y, 22, 24, 0, Math.PI, 0); c.fill();
        c.strokeStyle = OUTLINE; c.lineWidth = 1.2; c.beginPath(); c.ellipse(cx, y, 22, 24, 0, Math.PI, 0); c.closePath(); c.stroke();
        box(c, cx - 1, y - 34, 2, 10, BRASS); c.fillStyle = BRASS; circle(c, cx, y - 35, 3);
        const g2 = (Math.sin(t * 2) + 1) / 2; c.fillStyle = `rgba(255,255,255,${0.3 + g2 * 0.4})`; circle(c, cx - 9, y - 14, 2);
        break;
      }
      case 'steward': PROP.herbs(c, spot.x - 16, spot.y - 28, t); break;
    }
    if (HAS_FIREPLACE.has(b.key)) {  // a chimney over the fireplace inside, on the side away from the roof feature
      const cx = spot.x < g.X + g.W / 2 ? g.X + g.W - 30 : g.X + 30;
      drawChimney(c, cx, g.roofTop + 4, t);
    }
  }
  // a cloth flag rippling from its pole (x, y is the top of the hoist)
  function drawFlag(c, x, y, w, h, t, color) {
    const n = 8, wave = (k) => Math.sin(t * 3.2 - k * 0.7) * 2.2 * (k / n);
    c.fillStyle = color; c.beginPath(); c.moveTo(x, y);
    for (let k = 1; k <= n; k++) c.lineTo(x + k * w / n, y + wave(k) + k * 0.25);
    for (let k = n; k >= 0; k--) c.lineTo(x + k * w / n, y + h + wave(k) - k * 0.25);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.moveTo(x, y);
    for (let k = 1; k <= n; k++) c.lineTo(x + k * w / n, y + wave(k) + k * 0.25);
    for (let k = n; k >= 0; k--) c.lineTo(x + k * w / n, y + 4 + wave(k));
    c.closePath(); c.fill();
    c.strokeStyle = OUTLINE; c.lineWidth = 0.8; c.stroke();
  }
  function drawPennant(c, x, y, t, color) {
    c.fillStyle = color; c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k <= 4; k++) c.lineTo(x + k * 3, y + Math.sin(t * 4.5 - k * 0.8) * 1.4 + k * 0.6);
    c.lineTo(x, y + 6); c.closePath(); c.fill();
  }
  function drawChimney(c, cx, base, t) {
    box(c, cx - 7, base - 18, 14, 20, '#e7c592'); box(c, cx + 3, base - 18, 4, 20, '#d4ab72');
    box(c, cx - 9, base - 22, 18, 5, '#c99a62'); box(c, cx - 9, base - 22, 18, 1, '#f0d3a3');
    outlineRect(c, cx - 9, base - 22, 18, 24, 1);
    drawSmoke(c, cx, base - 24, t, cx);
  }
  // soft smoke curling up and drifting with the breeze
  function drawSmoke(c, x, y, t, seed, k = 1) {
    for (let i = 0; i < 6; i++) {
      const ph = ((t * 0.32 + i / 6 + hash(seed, i, 3) * 0.05) % 1);
      const px = x + Math.sin(ph * 5 + seed) * 3 * k + ph * 14 * k, py = y - ph * 46 * k, r = (2.5 + ph * 7) * k;
      c.fillStyle = `rgba(214,210,204,${0.7 * (1 - ph) * Math.min(1, ph * 6)})`;
      circle(c, px, py, r);
    }
  }

  // ---------- the player ----------
  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  function drawSeated(c, n, S) {  // guide step 29: the sitting frame, on their chair
    const row = S.rows.indexOf(n.dir);
    c.drawImage(S.canvas, S.sitCol * S.fw * S.R, row * S.fh * S.R, S.fw * S.R, S.fh * S.R, n.x - S.footX, n.y - S.footY, S.fw, S.fh);
  }
  function drawPlayer(c, p) {
    // the Chief Human Officer, rendered from the 3D model in me3d.js (falls back to the drawn walker below)
    const S = window.__meSheet;
    if (S && p.seated && S.sitCol) { drawSeated(c, p, S); return; }
    if (S) {
      const row = S.rows.indexOf(p.dir), seq = [0, 1, 2, 1];
      const col = p.moving ? walkFrame(p.anim) : 1;
      const lift = state.drag ? 12 + Math.sin(state.time * 6) * 1.5 : 0;  // held up by the mouse
      c.fillStyle = `rgba(15,42,46,${state.drag ? 0.16 : 0.25})`; ellipse(c, p.x + 2, p.y - 1, state.drag ? 8 : 10, 3.8);
      c.drawImage(S.canvas, col * S.fw * S.R, row * S.fh * S.R, S.fw * S.R, S.fh * S.R, p.x - S.footX, p.y - S.footY - lift, S.fw, S.fh);
      return;
    }
    const x = Math.round(p.x), y = Math.round(p.y);
    const step = p.moving ? Math.sin((p.anim / STRIDE) * Math.PI * 2) : 0;
    const by = y - (p.moving ? Math.abs(step) * 1.2 : 0);
    const side = p.dir === 'left' || p.dir === 'right', face = p.dir === 'left' ? -1 : 1;
    c.fillStyle = 'rgba(15,42,46,.25)'; ellipse(c, x + 2, y - 1, 9, 3.5);
    c.fillStyle = '#34344e';
    if (side) { c.fillRect(x - 4 + step * 3, y - 9, 4, 8); c.fillRect(x - step * 3, y - 9, 4, 8); }
    else { c.fillRect(x - 5, y - 9, 4, 8 - Math.max(0, step) * 2); c.fillRect(x + 1, y - 9, 4, 8 - Math.max(0, -step) * 2); }
    c.fillStyle = '#4a3020';
    if (!side) { c.fillRect(x - 5, y - 2 - Math.max(0, step) * 2, 4, 2); c.fillRect(x + 1, y - 2 - Math.max(0, -step) * 2, 4, 2); }
    if (side) box(c, x - 2 - step * 2.5, by - 19, 4, 9, '#255b98');
    rbox(c, x - 7, by - 21, 14, 13, 3, '#2f6db5');
    box(c, x - 7, by - 11, 14, 2, '#7a4b2a');
    box(c, x - 1, by - 11, 2, 2, BRASS);
    if (!side) {
      box(c, x - 10, by - 20 + step * 1.5, 3, 9, '#2f6db5'); box(c, x + 7, by - 20 - step * 1.5, 3, 9, '#2f6db5');
      box(c, x - 10, by - 12 + step * 1.5, 3, 3, '#f3c89d'); box(c, x + 7, by - 12 - step * 1.5, 3, 3, '#f3c89d');
    } else {
      box(c, x - 2 + step * 2.5, by - 19, 4, 9, '#3a7cc4');
      box(c, x - 2 + step * 2.5, by - 11, 4, 3, '#f3c89d');
    }
    c.fillStyle = '#f3c89d'; circle(c, x, by - 27, 7);
    c.fillStyle = '#6b3e1f';
    if (p.dir === 'up') circle(c, x, by - 28, 7.4);
    else {
      c.beginPath(); c.arc(x, by - 28, 7.6, Math.PI, 0); c.fill();
      if (side) c.fillRect(x - face * 7.5, by - 29, face * 4, 7);
      else { c.fillRect(x - 7.5, by - 29, 3, 5); c.fillRect(x + 4.5, by - 29, 3, 5); }
    }
    c.fillStyle = '#2b2b2b';
    if (p.dir === 'down') { c.fillRect(x - 3.5, by - 27, 2, 2.5); c.fillRect(x + 1.5, by - 27, 2, 2.5); }
    else if (side) c.fillRect(x + face * 3 - 1, by - 27, 2, 2.5);
  }

  // ---------- state, input, movement ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const el = (id) => document.getElementById(id);
  const ui = { place: el('place'), hint: el('hint'), toast: el('toast'), help: el('help') };
  let dpr = 1, zoom = 2;

  scenes.town = buildTown();
  for (const b of scenes.town.houses) scenes[b.id + '-in'] = buildHouseInterior(b);
  scenes['hall-in'] = buildHallInterior(scenes.town.hall);
  // floors and walls are drawn on demand, at the screen's real sharpness (see sceneCS)
  const minimap = buildMinimap(scenes.town);

  const state = {
    scene: scenes.town, time: 0, fade: null, showMap: true, toastUntil: 0,
    timeMode: 'clock',  // 'clock' follows this computer's clock; N switches to always day or always night
    forceNight: null,   // set by tests to pin a night level
    player: { x: 40 * T, y: 54 * T + 20, dir: 'up', moving: false, anim: 0 },
  };
  const keys = new Set();
  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ShiftLeft: 'run', ShiftRight: 'run' };
  const RUN = 1.8;  // hold Shift to run
  const isTyping = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT'); };

  // ---------- Vizier, your chief of staff (guide step 24) ----------
  // Vizier lives in the town hall and is your right hand: follows you everywhere (through doors too), takes
  // your orders and passes each one to the right person. Vizier is meant to run on Opus 5.5, but nothing runs
  // on its own until the user switches that on (subscription only): for now orders are recorded and routed,
  // and since guide steps 41-44 every order is a real task on the to-do list.
  const vizier = { x: 40 * T + 26, y: 54 * T + 44, dir: 'up', moving: false, anim: 0, scene: 'town', phoneUntil: 0 };
  const trail = [];  // where you've walked, so Vizier follows your path
  const ORDER_KEY = 'kingdom-one-orders';
  let orders = [];
  try { orders = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch (e) { orders = []; }
  const saveOrders = () => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(orders)); } catch (e) { /* private window: kept for this visit only */ } };
  // who each kind of order goes to, matched by the words in it
  const ROUTES = [
    ['hire', ['hire', 'hiring', 'recruit', 'new agent', 'new person', 'take on']],
    ['steward', ['personal', 'family', 'home', 'birthday', 'holiday', 'appointment', 'doctor', 'dentist', 'gym', 'my wife', 'my partner', 'kids']],
    ['inbox', ['email', 'e-mail', 'inbox', 'mail', 'reply', 'respond', 'message']],
    ['money', ['money', 'pay ', 'payment', 'invoice', 'budget', 'account', 'expense', 'bank', 'bill', 'tax', 'price', 'cost']],
    ['studio', ['studio', 'client project', 'client software', 'quote for']],
    ['youtube', ['youtube', 'video', 'transcript', 'highlight', 'playlist']],
    ['scout', ['hugging face', 'huggingface', 'github', 'dataset', 'repo', 'release', 'new model']],
    ['media', ['photo', 'picture', 'image', 'album', 'camera']],
    ['engineer', ['tech', 'code', 'bug', 'server', 'computer', 'deploy', 'app', 'website', 'docker', 'install', 'fix the']],
    ['merchant', ['business', 'client', 'sales', 'venture', 'customer', 'deal']],
    ['scholar', ['research', 'strategy', 'compare', 'market', 'analyse', 'analyze', 'analysis', 'options']],
    ['librarian', ['learn', 'knowledge', 'library', 'note', 'notes', 'document', 'kb', 'summarise', 'summarize']],
    ['keeper', ['task', 'schedule', 'deadline', 'operations', 'follow up', 'follow-up', 'remind', 'organise', 'organize', 'plan']],
  ];
  const HIRE_ASK = /\b(hire|hiring|recruit|new (agent|worker|person|hire)|take on (a|an|another|someone))\b|\b(find|get|bring)\b[^.]{0,40}\b(a|an|another|some)\s+(helper|hand|assistant|worker|intern|candidate)\b/i;
  function routeOrder(text) {
    if (HIRE_ASK.test(text)) return 'hire';  // guide step 46: Vizier finds a candidate
    const named = whoIn(text);  // "ask Merchant to…": whoever you name gets it, before any keyword guessing
    if (named && named !== 'vizier') return named;
    const t = ' ' + text.toLowerCase() + ' ';
    for (const [key, words] of ROUTES) if (words.some((w) => t.includes(w))) return key;
    return 'vizier';
  }
  const agentOf = (key) => RES.find((r) => r.key === key);
  function vizierReply(to) {
    if (to === 'hire') return "Vizier: I'll find the right person and bring them to the town hall. You interview them, and they're only hired if you say yes.";
    if (to === 'vizier') return "Vizier: That one's mine. I've written it down and I'll keep it with me.";
    const a = agentOf(to);
    const priv = to === 'steward' || to === 'garden' ? ' Personal, so it stays private.' : '';
    if (a.boss) { const d = bossOf(a); return `Vizier: That's work for ${a.name}, on ${d.name}'s team. I've passed it to ${d.name}, who gives ${a.name} every task and checks the work.${priv}`; }
    return `Vizier: That's for ${a.name}, ${a.role}. I've passed it to ${a.name}.${priv}`;
  }
  // the hall's dispatch tables and records chest show what Vizier is holding (personal orders as a count only)
  function refreshDispatch() {
    const shown = orders.filter((o) => o.to !== 'steward'), personal = orders.length - shown.length;
    const last = shown.slice(-3).reverse().map((o) => `"${o.text.length > 60 ? o.text.slice(0, 57) + '...' : o.text}" for ${o.to === 'vizier' ? 'Vizier' : o.to === 'hire' ? 'hiring, later' : agentOf(o.to).name}`);
    const summary = orders.length === 0
      ? "Vizier's dispatch table, where your orders are handed to the team. No orders yet: walk up to Vizier and press E to give one."
      : `Vizier's dispatch table. ${orders.length} order${orders.length === 1 ? '' : 's'} so far${last.length ? ', latest: ' + last.join('; ') : ''}.${personal ? ` Plus ${personal} personal order${personal === 1 ? '' : 's'} for Steward, kept private.` : ''} Each one is on the Chief's to-do list.`;
    for (const s of [scenes.town, scenes['hall-in']]) for (const o of s.objects) {
      if (o.kind === 'dispatch') o.msg = summary;
      if (o.kind === 'chest' && /records chest/.test(o.msg || '')) o.msg = orders.length ? `Vizier's records chest: ${orders.length} order${orders.length === 1 ? '' : 's'} on record, each one on the Chief's to-do list.` : "Vizier's records chest, for outstanding work and decisions. No records yet.";
    }
  }
  function nearVizier() {
    const p = state.player;
    return vizier.scene === state.scene.id && Math.hypot(vizier.x - p.x, vizier.y - p.y) < 46;
  }
  // a small box to type an order into
  const orderBox = document.createElement('div');
  orderBox.className = 'hud';
  Object.assign(orderBox.style, { left: '50%', bottom: '110px', transform: 'translateX(-50%)', width: 'min(520px, calc(100vw - 32px))', background: 'rgba(18,20,28,.94)', border: '1px solid rgba(232,196,106,.45)', borderRadius: '14px', padding: '14px 16px', display: 'none', pointerEvents: 'auto' });
  orderBox.innerHTML = '<div style="font-weight:650;color:#e8c46a;margin-bottom:4px">An order for Vizier</div>'
    + '<div style="font-size:13px;color:#c9c1ae;margin-bottom:8px">Vizier will pass it to the right person, and it goes on your to-do list (K).</div>'
    + '<textarea rows="3" style="width:100%;box-sizing:border-box;border-radius:8px;border:1px solid #4b5a5c;background:#12151c;color:#f5efe2;padding:8px;font:14px system-ui;resize:vertical" placeholder="For example: follow up an unpaid invoice"></textarea>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button data-k="cancel" style="background:none;border:1px solid #4b5a5c;color:#c9c1ae;border-radius:8px;padding:6px 12px;cursor:pointer">Cancel</button><button data-k="send" style="background:#e8b04b;border:0;color:#12151c;font-weight:650;border-radius:8px;padding:6px 14px;cursor:pointer">Give the order</button></div>';
  document.body.appendChild(orderBox);
  const orderText = orderBox.querySelector('textarea');
  // the call card (guide step 30): while Vizier is on the phone, who is calling whom
  const callCard = document.createElement('div');
  callCard.className = 'hud';
  Object.assign(callCard.style, { left: '50%', transform: 'translateX(-50%)', top: '16px', background: 'rgba(18,20,28,.9)', border: '1px solid rgba(232,196,106,.45)', borderRadius: '14px',
    padding: '10px 14px', display: 'none', alignItems: 'center', gap: '10px', maxWidth: 'min(420px, calc(100vw - 32px))', font: '13px system-ui', color: '#f5efe2', zIndex: '16' });
  document.body.appendChild(callCard);
  let callUntil = 0;
  function showCall(from, to, line, secs) {
    const who = (key) => (key === 'you' ? 'You' : (CAST_NAME[key] || key));
    const person = (key) => {
      const box = document.createElement('div'); Object.assign(box.style, { textAlign: 'center', width: '64px' });
      const img = faceImg(key, 56); if (img) box.append(img);
      const nm = document.createElement('div'); nm.textContent = who(key); Object.assign(nm.style, { fontWeight: '650', fontSize: '12px', marginTop: '2px' });
      box.append(nm); return box;
    };
    const mid = document.createElement('div'); Object.assign(mid.style, { flex: '1', minWidth: '0' });
    const tag = document.createElement('div'); tag.textContent = '● On a call'; Object.assign(tag.style, { color: '#7cc4c0', fontWeight: '650', fontSize: '12px' });
    const txt = document.createElement('div'); txt.textContent = line; Object.assign(txt.style, { color: '#c9c1ae', marginTop: '2px' });
    mid.append(tag, txt);
    const arrow = document.createElement('div'); arrow.textContent = '→'; Object.assign(arrow.style, { color: '#e8c46a', fontSize: '18px' });
    callCard.replaceChildren(person(from), arrow, person(to), mid);
    callCard.style.display = 'flex';
    callUntil = state.time + secs;
  }
  const CAST_NAME = Object.fromEntries([['vizier', 'Vizier'], ...RES.map((r) => [r.key, r.name])]);
  function openOrders() { orderBox.style.display = 'block'; keys.clear(); orderText.value = ''; setTimeout(() => orderText.focus(), 0); }
  function closeOrders() { orderBox.style.display = 'none'; orderText.blur(); }
  function placeOrder(text) {  // record an order, route it, and let Vizier phone it through; returns { to, reply }
    const to = routeOrder(text);
    orders.push({ text, to, at: new Date().toISOString() });
    saveOrders(); refreshDispatch();
    const reply = vizierReply(to);
    if (to !== 'vizier' && to !== 'hire') {  // Vizier takes out the phone to pass it on, to the director who owns it
      const a = agentOf(to), callee = a.boss ? a.boss : a.key, personal = to === 'steward' || to === 'garden';
      const line = personal ? 'Passing on a personal order. It stays private.'
        : a.boss ? `Passing on your order for ${a.name}, on ${agentOf(callee).name}'s team.` : 'Passing on your order.';
      vizier.phoneUntil = state.time + 4;
      showCall('vizier', callee, line, 4);
    }
    return { to, reply };
  }
  function sendOrder() {
    const text = orderText.value.trim();
    if (!text) { closeOrders(); return; }
    closeOrders();
    addTodo(text);  // guide step 44: every order is a real task
  }
  orderBox.addEventListener('click', (e) => { const k = e.target.dataset && e.target.dataset.k; if (k === 'send') sendOrder(); if (k === 'cancel') closeOrders(); });
  orderText.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOrder(); }
    if (e.key === 'Escape') closeOrders();
  });
  function placeVizierBehind() {  // after a door or a drop, Vizier comes along and stands just behind you
    const p = state.player, back = { up: [0, 30], down: [0, -30], left: [30, 0], right: [-30, 0] }[p.dir] || [0, 30];
    const spot = landNear(state.scene, p.x + back[0], p.y + back[1]) || [p.x, p.y];
    Object.assign(vizier, { x: spot[0], y: spot[1], scene: state.scene.id, moving: false, dir: p.dir });
    trail.length = 0;
  }
  function updateVizier(dt) {
    const p = state.player;
    if (vizier.seated || vizier.scene !== state.scene.id) return;
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 3) {
      if (last && Math.hypot(p.x - last.x, p.y - last.y) > 64) { placeVizierBehind(); return; }  // you jumped (dragged yourself)
      trail.push({ x: p.x, y: p.y }); if (trail.length > 400) trail.shift();
    }
    // walk to the point on your path about 36 px behind you
    let target = null, acc = 0;
    for (let i = trail.length - 1; i > 0; i--) {
      acc += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
      if (acc >= 36) { target = trail[i - 1]; break; }
    }
    const dx = target ? target.x - vizier.x : 0, dy = target ? target.y - vizier.y : 0, d = Math.hypot(dx, dy);
    if (target && d > 2 && !state.drag) {
      const sp = Math.min(d / dt, Math.max(SPEED, d * 4) * (keys.has('run') ? RUN : 1));
      vizier.x += (dx / d) * sp * dt; vizier.y += (dy / d) * sp * dt;
      vizier.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      vizier.moving = true; vizier.anim += sp * dt;
    } else {
      vizier.moving = false;
      if (d <= 2 && Math.hypot(p.x - vizier.x, p.y - vizier.y) < 60) vizier.dir = Math.abs(p.x - vizier.x) > Math.abs(p.y - vizier.y) ? (p.x < vizier.x ? 'left' : 'right') : (p.y < vizier.y ? 'up' : 'down');
    }
  }
  function drawVizier(c) {
    const sheets = window.__castSheets;
    if (!sheets) return;
    const S = state.time < vizier.phoneUntil ? sheets.vizierPhone : sheets.vizier;
    if (!S) return;
    if (vizier.seated && S.sitCol) { drawSeated(c, vizier, S); return; }
    const row = S.rows.indexOf(vizier.dir), col = vizier.moving ? walkFrame(vizier.anim) : 1;
    c.fillStyle = 'rgba(15,42,46,.25)'; ellipse(c, vizier.x + 2, vizier.y - 1, 10, 3.8);
    c.drawImage(S.canvas, col * S.fw * S.R, row * S.fh * S.R, S.fw * S.R, S.fh * S.R, vizier.x - S.footX, vizier.y - S.footY, S.fw, S.fh);
  }
  refreshDispatch();

  // ---------- the directors (guide step 26) and their workers (guide step 28) ----------
  // Each director owns one area and one house, and mostly hangs out in their yard and their house, moving
  // between the two every minute or so. Since step 28 the workers do the same at their workshops, in their saffron
  // vests. Since guide step 42 directors hand them tasks from the to-do list and check the work.
  const PERSONA = {
    keeper: { personality: 'Calm, precise and never late; loves a clear plan.', quirk: 'Checks the sundial out front even with a clock on the tower, and hums while sorting the coloured crates.',
      lines: ["Keeper: Everything has a time and a crate. What needs doing?", "Keeper: The sundial says we're on schedule. The clock agrees, for once.", "Keeper: Give me the deadline and I'll give you the plan."] },
    librarian: { personality: 'Curious, gentle, and remembers everything.', quirk: "Can't pass a crooked book without straightening it, and starts sentences with \"as recorded in…\".",
      lines: ["Librarian: As recorded in the archive, nothing is ever really lost here.", "Librarian: One moment, that scroll is crooked. There. Now, how can I help?", "Librarian: Every lesson learned gets a shelf. Every decision gets a scroll."] },
    merchant: { personality: 'Warm and persuasive, and keeps each business strictly apart.', quirk: 'Always pours mint tea before talking numbers, and touches the matching coloured tassel when switching business.',
      lines: ["Merchant: Tea first, numbers after. Which business are we talking about?", "Merchant: Teal, terracotta and gold: one colour per business, never mixed. Never mixed.", "Merchant: Every client deserves a proper welcome. And a proper quote."] },
    scholar: { personality: "Sceptical and thorough, the friendly devil's advocate.", quirk: 'Always offers "the other path", and stargazes from the observatory at night.',
      lines: ["Scholar: Have you considered the other path?", "Scholar: Interesting. Now let's try to prove it wrong.", "Scholar: Two paths leave my door. There's always an alternative."] },
    engineer: { personality: 'Practical, unflappable and security-minded.', quirk: 'Taps things to hear if they are solid, and checks every door twice.',
      lines: ["Engineer: Sounds solid. Let me tap it to be sure.", "Engineer: Checked that door twice. Locked, as it should be.", "Engineer: If it can be automated safely, I'll build it."] },
    steward: { personality: 'Kind and discreet, and guards your privacy.', quirk: 'Keeps everything personal inside the garden, and waters the herbs while thinking.',
      lines: ["Steward: What's personal stays in the garden. You have my word.", "Steward: The mint needs water and so do you. Shall I plan your week?", "Steward: Appointments, trips, the household: leave it with me."] },
  };
  // the workers (guide step 28): every one wears the saffron bedaia, and has no tasks yet
  Object.assign(PERSONA, {
    youtube: { personality: 'Cheerful and quick, and loves a good highlight.', quirk: 'Rewinds everything before putting it back on the shelf.',
      lines: ["Projectionist: Librarian gives me my tasks. Nothing on the shelves yet!", "Projectionist: Everybody rewatches the best bit. I find it.", "Projectionist: Be kind, rewind. Ready when Librarian is."] },
    media: { personality: 'Patient, tidy and sharp-eyed.', quirk: 'Sorts everything by time, even the tea glasses.',
      lines: ["Media sorter: Librarian checks every print before it counts. No tasks yet.", "Media sorter: Morning shots on the left, evening on the right.", "Media sorter: Mind the darkroom door, it's always closing."] },
    scout: { personality: 'Watchful and excitable about new things.', quirk: 'Never puts the spyglass down, even indoors.',
      lines: ["Hub scout: Scholar sends me out. Nothing to watch yet.", "Hub scout: I can see the whole Hub from up here. Well, nearly.", "Hub scout: If something new turns up, Scholar hears first."] },
    studio: { personality: 'Inventive and a little impatient to start building.', quirk: 'Sketches plans on anything flat.',
      lines: ["Studio: Engineer checks everything I build. Nothing on the board yet.", "Studio: Give me a client and I'll give you a blueprint.", "Studio: The drafting table is ready. So am I."] },
    inbox: { personality: 'Brisk, polite and allergic to clutter.', quirk: 'Taps each letterbox as it passes, counting.',
      lines: ["Inbox: Keeper gives me my tasks. The post hasn't started yet.", "Inbox: Read, sort, answer. In that order.", "Inbox: Every letter gets a reply. Eventually."] },
    money: { personality: 'Careful, honest and a bit of a worrier.', quirk: 'Checks the strongbox lock every few minutes.',
      lines: ["Money: Merchant checks every number I count. Nothing to count yet.", "Money: Money in on the left scale, money out on the right.", "Money: The strongbox is locked. I checked. Twice."] },
    garden: { personality: 'Quiet, gentle and very discreet.', quirk: 'Talks to the herbs, never about you.',
      lines: ["Garden helper: Steward gives me my tasks. What's said in the garden stays here.", "Garden helper: The mint is doing well. No tasks yet.", "Garden helper: I keep the shed tidy for when Steward needs a hand."] },
  });
  for (const h of HIRES) if (!PERSONA[h.key]) PERSONA[h.key] = { personality: h.personality || 'New, keen and careful.', quirk: h.quirk || 'Still learning where everything is.',
    lines: [`${h.name}: ${h.bossName} gives me my tasks. Glad to be here!`, `${h.name}: Still learning where everything is.`, `${h.name}: Ready when ${h.bossName} is.`] };
  let DIRECTORS = null;  // everyone who lives or works in the village, built on first use, once the map helpers below exist
  const directors = () => DIRECTORS || (DIRECTORS = buildDirectors());
  const buildDirectors = () => RES.map((r) => {
    const b = scenes.town.houses.find((h) => h.key === (r.hire ? r.home : r.key)), room = scenes[b.id + '-in'], town = scenes.town;
    const pts = (s, tx0, tx1, ty0, ty1) => {
      const out = [];
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (walkTile(s, tx, ty)) out.push([tx, ty]);
      return out;
    };
    const yard = r.key === 'steward' ? pts(town, 63, 69, 19, 22) : r.key === 'garden' ? pts(town, 70, 76, 19, 22) : pts(town, b.x - 1, b.x + b.w, b.y + b.h, b.y + b.h + 1);  // the strip in front of the house, not the street
    const start = yard[Math.floor(hash(b.x, b.y, 3) * yard.length)] || [b.door.x, b.door.y + 1];
    const [x, y] = centre(start);
    return { key: r.key, name: r.name, b, yard, room: room.id, worker: !!r.boss, hire: !!r.hire, scene: 'town', x, y, dir: 'down', moving: false, anim: 0,
      path: null, goal: null, wait: 1 + hash(b.x, 7) * 3, line: 0, talkUntil: 0, working: false, desk: null, chat: null, blocked: 0, ...PERSONA[r.key] };
  });

  // ---------- how everyone moves (guide step 33) ----------
  // Everyone walks tile by tile on a planned route: along the paths where they can, around each other, never
  // through walls, furniture or fences, and through doors on foot (nobody teleports, except the meeting fade,
  // which the user chose). Directors who aren't working hang out and pace in their own yard. Workers wander the
  // whole town, but never into Steward's private garden unless it's their workshop. Anyone working walks home,
  // goes inside and sits at their desk. Nobody has work yet (no AI is switched on), so for now nobody does.
  // When you walk up to someone they stop and turn to you. Workers who bump into someone they haven't talked
  // to today stop and ask what they're working on, and both note it down (kept in this browser).
  const centre = ([tx, ty]) => [(tx + 0.5) * T, (ty + 0.85) * T];
  const tileOf = (x, y) => [Math.floor(x / T), Math.floor((y - 4) / T)];
  const walkTile = (s, tx, ty) => inside(s, tx, ty) && !s.solid[ty * s.w + tx] && !!reachOf(s)[ty * s.w + tx] && !doorAt(s, tx, ty);
  const EASY = new Set([PATH, STONE, ZELLIGE, MAT, FLOOR]);
  const inGarden = (tx, ty) => tx >= 63 && ty <= 23 && tx <= 77;
  function findPath(s, from, to, opts = {}) {  // cheapest route over walkable tiles; paths are cheap, grass and sand cost more
    const W = s.w, start = from[1] * W + from[0], goal = to[1] * W + to[0];
    if (start === goal) return [];
    if (!walkTile(s, to[0], to[1])) return null;
    const cost = new Float32Array(s.w * s.h).fill(Infinity), prev = new Int32Array(s.w * s.h).fill(-1);
    const heap = [[0, start]]; cost[start] = 0;
    const push = (n) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [c, i] = pop();
      if (i === goal) break;
      if (c > cost[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + a, ny = y + b, j = ny * W + nx;
        if (!walkTile(s, nx, ny) && j !== start) continue;
        if (opts.avoid && opts.avoid.has(j) && j !== goal) continue;
        if (opts.noGarden && s.id === 'town' && inGarden(nx, ny) && !inGarden(x, y)) continue;
        const nc = c + (EASY.has(s.tiles[j]) ? 1 : 3);
        if (nc < cost[j]) { cost[j] = nc; prev[j] = i; push([nc, j]); }
      }
    }
    if (prev[goal] < 0) return null;
    const out = [];
    for (let i = goal; i !== start; i = prev[i]) out.push([i % W, (i / W) | 0]);
    return out.reverse();
  }
  // the tiles at either side of a house door, and the desk seat inside
  const outsideDoorOf = (roomId) => { const b = scenes[roomId].building; return [b.door.x, b.door.y + 1]; };
  const insideDoorOf = (roomId) => { const room = scenes[roomId]; return [room.doors[0].x, room.h - 2]; };
  function deskOf(d) {
    if (d.desk) return d.desk;
    const room = scenes[d.room], side = [[8, 2], [10, 2], [9, 1]].find(([x, y]) => walkTile(room, x, y));
    return (d.desk = { side, seat: { x: 9.5 * T, y: 2 * T + 31, dir: 'down', sortY: 3 * T + 1 } });
  }
  const ROAM = [];  // town path tiles workers like to wander to
  function roamTiles(d) {
    if (!ROAM.length) { const s = scenes.town; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if ((s.tiles[y * s.w + x] === PATH || s.tiles[y * s.w + x] === STONE) && walkTile(s, x, y)) ROAM.push([x, y]); }
    return d.key === 'garden' ? ROAM : ROAM.filter(([x, y]) => !inGarden(x, y));
  }
  // what each person wants to do next: returns { scene, tile, then } or null to stay put a while
  // guide step 37: someone you've called over comes to you, and stays until you send them back to work
  function nearPlayerTile(d) {
    const s = state.scene, p = state.player, [px, py] = tileOf(p.x, p.y);
    if (d.scene === s.id && Math.hypot(d.x - p.x, d.y - p.y) < 64) return null;  // already with you
    let best = null, bd = Infinity;
    for (let r = 1; r <= 3 && !best; r++) for (let y = py - r; y <= py + r; y++) for (let x = px - r; x <= px + r; x++) {
      if (Math.max(Math.abs(x - px), Math.abs(y - py)) !== r || !walkTile(s, x, y)) continue;
      const [cx, cy] = centre([x, y]), dd = d.scene === s.id ? Math.hypot(cx - d.x, cy - d.y) : Math.hypot(x - px, y - py);
      if (dd < bd) { bd = dd; best = [x, y]; }
    }
    return best;
  }
  const insideTiles = (d) => d.insideTiles || (d.insideTiles = (() => { const room = scenes[d.room], out = []; for (let y = 2; y < room.h - 2; y++) for (let x = 1; x < room.w - 1; x++) if (walkTile(room, x, y)) out.push([x, y]); return out; })());
  function nextGoal(d) {
    if (d.mode === 'summoned') { const t = nearPlayerTile(d); return t ? { scene: state.scene.id, tile: t, then: 'idle' } : null; }
    if (d.mode === 'inside' && state.time > d.modeUntil) d.mode = null;
    if (d.mode === 'inside' && !d.working) { const list = insideTiles(d); return { scene: d.room, tile: list[Math.floor(Math.random() * list.length)], then: 'idle' }; }
    if (d.candidate) return null;  // guide step 46: a candidate waits in the town hall for the interview
    if (d.working && d.hire) { const list = insideTiles(d); return { scene: d.room, tile: list[Math.floor(Math.random() * list.length)], then: 'idle' }; }  // the director's desk is theirs
    if (d.working) {
      const desk = deskOf(d);
      return desk.side ? { scene: d.room, tile: desk.side, then: 'sit' } : null;
    }
    if (d.scene !== 'town') return { scene: 'town', tile: d.yard[Math.floor(Math.random() * d.yard.length)], then: 'idle' };
    if (!d.worker || Math.random() < 0.25) {  // directors pace a little in their own yard; workers drop home now and then
      const [tx, ty] = tileOf(d.x, d.y), near = d.yard.filter(([x, y]) => Math.abs(x - tx) + Math.abs(y - ty) <= 4);
      const list = near.length > 1 ? near : d.yard;
      return { scene: 'town', tile: list[Math.floor(Math.random() * list.length)], then: 'idle' };
    }
    const list = roamTiles(d);
    return { scene: 'town', tile: list[Math.floor(Math.random() * list.length)], then: 'idle' };
  }
  // plan the next stretch of the trip: within this scene, or to the door on the way in or out
  function planLeg(d, avoid) {
    const g = d.goal, s = scenes[d.scene], here = tileOf(d.x, d.y);
    let to, then = null;
    if (g.scene === d.scene) { to = g.tile; }
    else if (d.scene === 'town') { to = outsideDoorOf(g.scene); then = 'enter'; }
    else { to = insideDoorOf(d.scene); then = 'exit'; }
    const tiles = findPath(s, here, to, { avoid, noGarden: d.key !== 'garden' && d.key !== 'steward' && d.mode !== 'summoned' });
    if (!tiles) return false;
    d.path = tiles; d.leg = then; return true;
  }
  const others = (d) => {
    const list = directors().filter((o) => o !== d && o.scene === d.scene);
    if (vizier.scene === d.scene) list.push(vizier);
    if (state.scene.id === d.scene) list.push(state.player);
    return list;
  };
  function freeSide(d, crowd, from) {  // a free tile next to them, away from whoever is in the way
    const s = scenes[d.scene], [tx, ty] = tileOf(d.x, d.y);
    let best = null, bd = -Infinity;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + a, ny = ty + b;
      if (!walkTile(s, nx, ny)) continue;
      const [cx, cy] = centre([nx, ny]);
      if (crowd.some((o) => Math.hypot(o.x - cx, o.y - cy) < 24)) continue;
      const score = Math.hypot(from.x - cx, from.y - cy);
      if (score > bd) { bd = score; best = [nx, ny]; }
    }
    return best;
  }
  const faceTo = (d, x, y) => { d.dir = Math.abs(x - d.x) > Math.abs(y - d.y) ? (x < d.x ? 'left' : 'right') : (y < d.y ? 'up' : 'down'); };
  // ---- talking to each other (workers ask what people are working on, once a day, and both take notes) ----
  const NOTES_KEY = 'kingdom-one-notes', TALK_KEY = 'kingdom-one-talk';
  const talkLog = (() => { try { return JSON.parse(localStorage.getItem(TALK_KEY)) || []; } catch (e) { return []; } })();
  const saveTalk = () => { try { localStorage.setItem(TALK_KEY, JSON.stringify(talkLog)); } catch (e) { /* this visit only */ } };
  const today = () => new Date().toISOString().slice(0, 10);
  let villageNotes = (() => { try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || {}; } catch (e) { return {}; } })();
  const saveNotes = () => { try { localStorage.setItem(NOTES_KEY, JSON.stringify(villageNotes)); } catch (e) { /* private window: notes last this visit only */ } };
  const talkedToday = (a, b) => (villageNotes[a.key] || []).some((n) => n.date === today() && n.with === b.key);
  const doingWhat = (d) => (d.working ? 'working at my desk on a task' : 'nothing yet. No tasks so far');
  function startChat(a, b) {
    const t = state.time;
    const cap = (x) => x[0].toUpperCase() + x.slice(1);  // they take turns, so only one bubble shows at a time
    a.chat = { with: b, until: t + 5.6, lines: [[t, t + 1.8, `What are you working on, ${b.name}?`], [t + 3.8, t + 5.6, `${cap(doingWhat(a))}.`]] };
    b.chat = { with: a, until: t + 5.6, lines: [[t + 1.8, t + 3.8, `${cap(doingWhat(b))}. And you?`]] };
    for (const [x, y] of [[a, b], [b, a]]) {
      (villageNotes[x.key] = villageNotes[x.key] || []).push({ date: today(), with: y.key, text: `Talked with ${y.name}: ${doingWhat(y)}.` });
      villageNotes[x.key] = villageNotes[x.key].slice(-30);
    }
    saveNotes();
    for (const x of [a, b]) { x.path = null; x.moving = false; }
    faceTo(a, b.x, b.y); faceTo(b, a.x, a.y);
    // guide step 39: the villager log keeps real conversations only (people asking about each other's work)
    talkLog.push({ at: new Date().toISOString(), a: a.key, b: b.key, lines: [[a.key, a.chat.lines[0][2]], [b.key, b.chat.lines[0][2]], [a.key, a.chat.lines[1][2]]] });
    talkLog.splice(0, Math.max(0, talkLog.length - 100)); saveTalk(); if (typeof renderTalk === 'function' && talkBox.style.display === 'flex') renderTalk();
  }
  function updateDirectors(dt) {
    const p = state.player;
    for (const d of directors()) {
      if (d.seated) { d.moving = false; continue; }  // at the council table or at their desk
      if (d.chat) {  // stopped for a chat
        d.moving = false; faceTo(d, d.chat.with.x, d.chat.with.y);
        if (state.time > d.chat.until) { d.chat = null; d.wait = 0.5 + Math.random(); }
        continue;
      }
      // you walked up, or you're talking to them: stop and turn to you, in case you want to talk
      // (not when they're off to work, or you've just sent them back to it)
      const busy = d.working || (d.mode === 'inside' && d.scene !== d.room);
      if (state.scene.id === d.scene && (state.time < d.talkUntil || (!busy && Math.hypot(p.x - d.x, p.y - d.y) < 60))) { d.moving = false; faceTo(d, p.x, p.y); continue; }
      if (d.working && d.sitting) continue;
      // called over: if you've moved on, they follow
      if (d.mode === 'summoned' && d.goal && (d.goal.scene !== state.scene.id || Math.hypot(centre(d.goal.tile)[0] - p.x, centre(d.goal.tile)[1] - p.y) > 3 * T)) { d.goal = null; d.path = null; d.wait = 0; }
      if (!d.goal) {
        d.wait -= dt; d.moving = false;
        if (d.wait > 0) continue;
        d.goal = nextGoal(d); d.path = null;
        if (!d.goal) { d.wait = 2; continue; }
      }
      if (!d.path) {
        if (!planLeg(d)) { d.goal = null; d.wait = 1 + Math.random() * 2; continue; }
      }
      if (!d.path.length && d.resume) { d.resume = false; d.path = null; d.wait = 0.4; d.moving = false; continue; }  // stepped aside: wait a moment, then carry on
      if (!d.path.length) {  // reached the end of this stretch
        if (d.leg === 'enter') { const [x, y] = centre(insideDoorOf(d.goal.scene)); Object.assign(d, { scene: d.goal.scene, x, y, dir: 'up', path: null }); continue; }
        if (d.leg === 'exit') { const [x, y] = centre(outsideDoorOf(d.scene)); Object.assign(d, { scene: 'town', x, y, dir: 'down', path: null }); continue; }
        if (d.goal.then === 'sit') { const seat = deskOf(d).seat; Object.assign(d, { x: seat.x, y: seat.y, dir: seat.dir, seated: seat, sitting: true }); }
        d.goal = null; d.path = null; d.moving = false;
        d.wait = d.worker ? 2 + Math.random() * 5 : 3 + Math.random() * 6;
        continue;
      }
      // walk to the next tile, giving way to anyone in the way
      while (d.path.length && Math.hypot(centre(d.path[0])[0] - d.x, centre(d.path[0])[1] - d.y) < 0.5) d.path.shift();
      if (!d.path.length) continue;
      const [nx, ny] = centre(d.path[0]), dx = nx - d.x, dy = ny - d.y, dist = Math.hypot(dx, dy);
      const step = Math.min(dist, SPEED * 0.55 * dt), mx = d.x + (dx / (dist || 1)) * step, my = d.y + (dy / (dist || 1)) * step;
      const crowd = others(d);
      const inWay = crowd.find((o) => !o.seated && Math.hypot(o.x - mx, o.y - my) < 18 && Math.hypot(o.x - mx, o.y - my) < Math.hypot(o.x - d.x, o.y - d.y));
      if (inWay) {
        const onErrand = (n) => n.working || n.mode === 'summoned' || n.mode === 'inside';  // nobody stops for a chat on the way somewhere
        if (d.worker && d.scene === 'town' && directors().includes(inWay) && !inWay.chat && !inWay.seated && !onErrand(d) && !onErrand(inWay) && !talkedToday(d, inWay)) { startChat(d, inWay); continue; }
        d.moving = false; d.blocked += dt;
        // give way: one of the two steps aside onto a free tile and lets the other pass, then carries on
        const all = directors(), mine = all.indexOf(d), theirs = all.indexOf(inWay);
        const yieldFirst = theirs < 0 || inWay.blocked < 0.2 || mine < theirs;
        if (d.blocked > (yieldFirst ? 0.5 : 1.6)) {
          const side = freeSide(d, crowd, inWay);
          if (side) { d.path = [side]; d.resume = true; d.blocked = 0; continue; }
          if (d.blocked > 3) {  // boxed in: try a different way round, or give up for now
            const avoid = new Set(crowd.map((o) => { const [tx, ty] = tileOf(o.x, o.y); return ty * scenes[d.scene].w + tx; }));
            if (!planLeg(d, avoid)) { d.goal = null; d.path = null; d.wait = 1; }
            d.blocked = 0;
          }
        }
        continue;
      }
      d.blocked = 0;
      d.x = mx; d.y = my;
      if (dist - step < 0.5) { d.x = nx; d.y = ny; d.path.shift(); }  // on the tile centre: on to the next one
      d.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      d.moving = true; d.anim += step;
    }
  }
  // someone starts or stops working (nobody has tasks yet: this is for when they do, and for testing)
  function setWorking(key, on) {
    const d = directors().find((x) => x.key === key); if (!d) return;
    d.working = !!on; d.goal = null; d.path = null; d.wait = 0;
    if (on) d.mode = null;
    if (!on && d.sitting) { const side = deskOf(d).side; if (side) { const [x, y] = centre(side); Object.assign(d, { x, y, seated: null, sitting: false }); } }
  }
  function drawChat(c, d) {  // a speech bubble while two people talk
    const ch = d.chat; if (!ch) return;
    const now = ch.lines.find(([a, b]) => state.time >= a && state.time < b);
    if (!now) return;
    const text = relabel(now[2]);
    c.font = '600 7px system-ui, sans-serif';
    const lines = []; let cur = '';
    for (const w of text.split(' ')) { if (c.measureText(cur + ' ' + w).width > 84 && cur) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
    lines.push(cur);
    const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 8, h = lines.length * 9 + 5, x = d.x - w / 2, y = d.y - 66 - h;
    c.fillStyle = 'rgba(255,252,244,.96)'; rbox(c, x, y, w, h, 3, 'rgba(255,252,244,.96)');
    c.strokeStyle = OUTLINE; c.lineWidth = 0.8; c.strokeRect(x, y, w, h);
    c.fillStyle = OUTLINE; lines.forEach((l, i) => c.fillText(l, x + 4, y + 9 + i * 9));
  }
  const directorNear = () => directors().find((d) => d.scene === state.scene.id && Math.hypot(d.x - state.player.x, d.y - state.player.y) < 46) || null;
  function greet(d) {
    d.talkUntil = state.time + 4;
    const met = (villageNotes[d.key] || []).filter((n) => n.date === today()).map((n) => agentOf(n.with).name);
    toast(d.lines[d.line % d.lines.length] + (met.length ? ` (Today I've talked with ${[...new Set(met)].join(', ')}.)` : ''), d.key);
    d.line++;
  }
  function drawNPC(c, n, S) {
    if (!S) return;
    if (n.seated && S.sitCol) { drawSeated(c, n, S); return; }
    const row = S.rows.indexOf(n.dir), col = n.moving ? walkFrame(n.anim) : 1;
    c.fillStyle = 'rgba(15,42,46,.25)'; ellipse(c, n.x + 2, n.y - 1, 10, 3.8);
    c.drawImage(S.canvas, col * S.fw * S.R, row * S.fh * S.R, S.fw * S.R, S.fh * S.R, n.x - S.footX, n.y - S.footY, S.fw, S.fh);
    if (n.chat) drawChat(c, n);
  }

  // ---------- the council meeting (guide step 29) ----------
  // Call meeting (the menu bar, or C) brings everyone to the town hall: you at the head of the table, Vizier
  // at your right hand, then every director and worker in their own seat. No AI runs yet, so the meeting is
  // quiet. Ending it (the button, C, or walking off) sends directors and workers back to their yards and
  // leaves you and Vizier in front of the town hall.
  const seatOf = (key) => HALL_SEATS.find((x) => x.key === key);
  const sit = (n, seat) => Object.assign(n, { scene: 'hall-in', x: seat.x, y: seat.y, dir: seat.dir, seated: seat, moving: false, target: null, path: null, goal: null, chat: null, sitting: false, mode: null });
  function callMeeting() {
    if (state.fade || state.meeting) return;
    state.fade = { t: 0, phase: 'out', cb: () => {
      state.drag = null; keys.clear();
      state.scene = scenes['hall-in'];
      sit(state.player, seatOf('you'));
      sit(vizier, seatOf('vizier')); trail.length = 0;
      for (const d of directors()) { const seat = seatOf(d.key); if (seat) sit(d, seat); d.nextSwitch = Infinity; d.talkUntil = 0; }
      state.meeting = { started: state.time };
      updatePlace(); updateMenu(); openMeetingChat();
      toast(`The council is seated: all ${HALL_SEATS.length} of you. Nobody can talk yet, because no AI is switched on. Press C or walk away to end the meeting.`);
    } };
  }
  function endMeeting() {
    if (state.fade || !state.meeting) return;
    state.fade = { t: 0, phase: 'out', cb: () => {
      keys.clear();
      state.meeting = null; closeMeetingChat();
      state.scene = scenes.town;
      Object.assign(state.player, { x: 39.5 * T, y: 21.8 * T, dir: 'down', seated: null, moving: false });  // in front of the town hall
      Object.assign(vizier, { scene: 'town', x: 41.5 * T, y: 21.8 * T, dir: 'down', seated: null, moving: false }); trail.length = 0;
      for (const d of directors()) {
        d.seated = null;
        const spot = centre(d.yard[Math.floor(Math.random() * d.yard.length)] || d.yard[0]);
        Object.assign(d, { scene: 'town', x: spot[0], y: spot[1], dir: 'down', path: null, goal: null, wait: 1 + Math.random() * 2 });
      }
      updatePlace(); updateMenu();
      toast('Meeting over. Everyone has gone back to their yards.');
    } };
  }
  const toggleMeeting = () => (state.meeting ? endMeeting() : callMeeting());
  addEventListener('keydown', (e) => {
    if (isTyping() || e.repeat) return;
    if (e.code === 'KeyC') { e.preventDefault(); toggleMeeting(); }
  });
  // the menu bar: buttons for the same things as the keys
  const menu = document.getElementById('menu');
  function updateMenu() {
    const b = menu && menu.querySelector('[data-act="meeting"]');
    if (b) { b.textContent = state.meeting ? 'End meeting' : 'Call meeting'; b.classList.toggle('live', !!state.meeting); }
  }
  if (menu) menu.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    b.blur();
    const act = b.dataset.act;
    if (act === 'meeting') { startSound(); toggleMeeting(); return; }
    if (act === 'todo') { window.__todo && window.__todo(); return; }
    if (act === 'settings') { if (W) W.open(); return; }
    const code = { help: 'KeyH', map: 'KeyM', night: 'KeyN', sound: 'KeyQ' }[act];
    if (code) dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase() }));
  });

  // ---------- a very quiet background: soft wind, a trickle of water and the odd bird (all made in code) ----------
  // Browsers only allow sound after a click or key press, so it starts on the first one. Q turns it off and on.
  const sound = { ctx: null, master: null, on: true, started: false };
  function startSound() {
    if (sound.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    sound.started = true;
    const a = sound.ctx = new AC();
    sound.master = a.createGain(); sound.master.gain.value = sound.on ? 1 : 0; sound.master.connect(a.destination);
    const noise = a.createBuffer(1, a.sampleRate * 4, a.sampleRate), d = noise.getChannelData(0);
    for (let i = 0, last = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }  // soft brown noise
    const bed = (freq, q, gain, lfoRate) => {
      const src = a.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = a.createGain(); g.gain.value = gain;
      const lfo = a.createOscillator(), lg = a.createGain(); lfo.frequency.value = lfoRate; lg.gain.value = gain * 0.6;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      src.connect(f); f.connect(g); g.connect(sound.master); src.start();
    };
    bed(380, 0.6, 0.05, 0.07);   // wind, rising and falling slowly
    bed(1800, 1.2, 0.012, 0.5);  // the fountain's trickle
    const chirp = () => {
      if (nightLevel() < 0.5) {  // birds by day only
        const now = a.currentTime, notes = 2 + Math.floor(Math.random() * 3), base = 2600 + Math.random() * 1400;
        for (let k = 0; k < notes; k++) {
          const o = a.createOscillator(), g = a.createGain(), t0 = now + k * 0.13;
          o.type = 'sine'; o.frequency.setValueAtTime(base, t0); o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t0 + 0.07);
          g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.018, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
          o.connect(g); g.connect(sound.master); o.start(t0); o.stop(t0 + 0.1);
        }
      }
      setTimeout(chirp, 5000 + Math.random() * 11000);
    };
    setTimeout(chirp, 3000);
    if (sound.on) toast('Sound on, very quietly: wind, water and the odd bird. Press Q to turn it off.');
  }
  function toggleSound() {
    sound.on = !sound.on;
    if (sound.master) sound.master.gain.setTargetAtTime(sound.on ? 1 : 0, sound.ctx.currentTime, 0.2);
    toast(sound.on ? 'Sound on, very quietly. Press Q to turn it off.' : 'Sound off. Press Q to turn it back on.');
  }
  addEventListener('pointerdown', startSound);
  addEventListener('keydown', (e) => {
    if (isTyping()) return;
    if (e.code === 'KeyQ') { if (!e.repeat) { startSound(); toggleSound(); } return; }
    startSound();
  }, true);

  addEventListener('keydown', (e) => {
    if (isTyping()) return;
    if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
    else if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) interact(); }
    else if (e.code === 'KeyH') ui.help.classList.toggle('on');
    else if (e.code === 'KeyM') state.showMap = !state.showMap;
    else if (e.code === 'KeyN' && !e.repeat) {
      const order = ['clock', 'day', 'night'];
      state.timeMode = order[(order.indexOf(state.timeMode) + 1) % 3];
      toast({ clock: "Day and night follow this computer's clock.", day: 'Always day (preview). Press N again for night.', night: 'Always night (preview). Press N again to follow the clock.' }[state.timeMode]);
    }
    else if (e.code === 'Escape') ui.help.classList.remove('on');
  });
  addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
  addEventListener('blur', () => keys.clear());

  // ---------- grab yourself with the mouse and drop yourself anywhere (guide step 22) ----------
  // You land on the nearest open spot you could walk to: never in a wall, building, prop or water,
  // never outside the town walls, and never on a doorway (you still walk in through doors).
  function reachOf(s) {
    if (s.reach) return s.reach;
    const seen = new Uint8Array(s.w * s.h);
    const start = s.id === 'town' ? [40, 54] : [s.doors[0].x, s.h - 2];  // the gate road, or just inside a room's door
    const q = [start]; seen[start[1] * s.w + start[0]] = 1;
    while (q.length) {
      const [x, y] = q.shift();
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + a, ny = y + b, i = ny * s.w + nx;
        if (!inside(s, nx, ny) || seen[i] || s.solid[i] || doorAt(s, nx, ny)) continue;
        seen[i] = 1; q.push([nx, ny]);
      }
    }
    return (s.reach = seen);
  }
  function canLand(s, x, y) {
    const tx = Math.floor(x / T), ty = Math.floor((y - 4) / T);
    return inside(s, tx, ty) && reachOf(s)[ty * s.w + tx] && !hits(s, x, y) && !doorAt(s, tx, ty);
  }
  function landNear(s, x, y) {
    if (canLand(s, x, y)) return [x, y];
    for (let r = 4; r <= 320; r += 4) for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r;
      if (canLand(s, nx, ny)) return [nx, ny];
    }
    return null;
  }
  // ---------- talk to anyone (guide step 36) ----------
  // T next to someone opens a chat box on the right. Double-tap M from anywhere opens Vizier's. Whatever you
  // ask Vizier to do is passed to the right director, and that conversation shows in the chat log on the left
  // (L, or the button, opens and closes it). Esc closes a box.
  // No AI is switched on yet (subscription only, and only once the user says yes), so replies are scripted from
  // each person's personality, job and notes, and labelled as such. A brain can be plugged in later as
  // window.kingdomBrain(key, history) -> Promise<string>, without changing any of this.
  const CHAT_KEY = 'kingdom-one-chats', LOG_KEY = 'kingdom-one-log';
  // the brain helper (ai-village/helper/brain.py): when it's running on this computer, villagers answer for real,
  // through Claude Code on the user's own subscription, talk-only. When it isn't, replies are scripted.
  const BRAIN = `http://127.0.0.1:${(+location.port || 8765) + 1}`;  // the brain helper: the port after the village's
  let brain = null;  // the helper's status while it's reachable
  const askBrain = async (key, history, opts = {}) => {
    const r = await fetch(BRAIN + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: key, history, room: opts.room || '', hint: opts.hint || '', job: opts.job || null, names: W ? W.names() : null, world: W ? W.worldName() : null }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'no answer');
    return j.reply;
  };
  async function checkBrain() {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(BRAIN + '/status', { signal: ctl.signal }); clearTimeout(t);
      brain = r.ok ? await r.json() : null;
    } catch (e) { brain = null; }
    if (brain && !window.kingdomBrain) window.kingdomBrain = askBrain;
    if (!brain && window.kingdomBrain === askBrain) delete window.kingdomBrain;
    try { chatNote.textContent = brainLabel(); mNote.textContent = brainLabel(); } catch (e) { /* boxes not built yet */ }
  }
  const brainOn = () => !!window.kingdomBrain && (window.kingdomBrain !== askBrain || !!brain);
  const brainLabel = () => (brainOn() ? `Live: answered by Claude on your ${String((brain && brain.plan) || '').toUpperCase()} subscription, via the helper. Ask for something and it goes on your to-do list (K).` : "Scripted replies: the AI helper isn't running. Orders wait on your to-do list (K).");
  setTimeout(checkBrain, 0); setInterval(checkBrain, 20000);
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: this visit only */ } };
  const chats = load(CHAT_KEY, {}), chatLog = load(LOG_KEY, []);
  const panelStyle = { background: 'rgba(18,20,28,.94)', border: '1px solid rgba(232,196,106,.45)', borderRadius: '14px', display: 'none',
    flexDirection: 'column', font: '13px system-ui', color: '#f5efe2', pointerEvents: 'auto', zIndex: '15', overflow: 'hidden' };
  const mk = (tag, style, text) => { const e = document.createElement(tag); if (style) Object.assign(e.style, style); if (text != null) e.textContent = relabel(text); return e; };
  // the chat box, on the right
  const chatBox = mk('div', { ...panelStyle, right: '16px', top: '170px', bottom: '56px', width: 'min(340px, calc(100vw - 32px))' }); chatBox.className = 'hud';
  const chatHead = mk('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderBottom: '1px solid rgba(232,196,106,.25)' });
  const chatBody = mk('div', { flex: '1', overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' });
  const chatNote = mk('div', { fontSize: '11.5px', color: '#e8c46a', padding: '6px 12px', background: 'rgba(232,196,106,.08)' });
  const chatForm = mk('div', { display: 'flex', gap: '6px', padding: '8px', borderTop: '1px solid rgba(232,196,106,.25)' });
  const chatInput = mk('input', { flex: '1', borderRadius: '8px', border: '1px solid #4b5a5c', background: '#12151c', color: '#f5efe2', padding: '7px 9px', font: '13px system-ui' });
  const chatSend = mk('button', { background: '#2b8a8a', color: '#fff', border: '0', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', font: '600 13px system-ui' }, 'Send');
  chatForm.append(chatInput, chatSend); chatBox.append(chatHead, chatNote, chatBody, chatForm); document.body.appendChild(chatBox);
  // the chat log, on the left: Vizier passing your orders on
  const logBox = mk('div', { ...panelStyle, left: '16px', top: '130px', bottom: '56px', width: 'min(300px, calc(100vw - 32px))' }); logBox.className = 'hud';
  const logHead = mk('div', { padding: '10px 12px', borderBottom: '1px solid rgba(232,196,106,.25)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
  logHead.append(mk('div', { fontWeight: '650', color: '#e8c46a' }, "Vizier's chat log"));
  const logClose = mk('button', { background: 'none', border: '0', color: '#c9c1ae', cursor: 'pointer', fontSize: '16px' }, '×'); logHead.append(logClose);
  const logBody = mk('div', { flex: '1', overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' });
  logBox.append(logHead, logBody); document.body.appendChild(logBox);
  let chatWith = null;
  const nameOf = (key) => (key === 'you' ? 'You' : CAST_NAME[key] || key);
  function thinking(parent, who) {  // a "thinking…" line while someone answers
    const row = mk('div', { display: 'flex', gap: '8px', alignItems: 'center', color: '#c9c1ae', fontSize: '12px' });
    const img = faceImg(who, 22); if (img) row.append(img);
    row.append(mk('span', null, `${nameOf(who)} is thinking…`)); parent.append(row); parent.scrollTop = parent.scrollHeight;
    return row;
  }
  function bubble(parent, who, text, mine) {
    const row = mk('div', { display: 'flex', gap: '8px', alignItems: 'flex-start', flexDirection: mine ? 'row-reverse' : 'row' });
    const img = faceImg(who, 28); if (img) row.append(img);
    const b = mk('div', { background: mine ? '#2b5f63' : 'rgba(255,255,255,.07)', borderRadius: '10px', padding: '6px 9px', maxWidth: '80%' });
    b.append(mk('div', { fontSize: '11px', color: '#e8c46a', fontWeight: '650' }, nameOf(who)), mk('div', null, text));
    row.append(b); parent.append(row); parent.scrollTop = parent.scrollHeight;
  }
  function renderChat() {
    const key = chatWith, img = faceImg(key, 40);
    const card = key === 'vizier' ? { name: 'Vizier', role: 'Chief of Staff' } : cardFor(key);
    const t = mk('div', { flex: '1' }); t.append(mk('div', { fontWeight: '650', fontSize: '14px' }, card.name), mk('div', { fontSize: '11.5px', color: '#c9c1ae' }, card.role));
    const x = mk('button', { background: 'none', border: '0', color: '#c9c1ae', cursor: 'pointer', fontSize: '16px' }, '×'); x.onclick = closeChat;
    chatHead.replaceChildren(...(img ? [img, t, x] : [t, x]));
    chatNote.textContent = brainLabel(); showHireBar(key);
    chatInput.placeholder = relabel(key === 'vizier' ? 'Give Vizier an order, or say hello' : `Say something to ${card.name}`);
    chatBody.replaceChildren();
    (chats[key] || []).forEach((m) => bubble(chatBody, m.from, m.text, m.from === 'you'));
    if (!(chats[key] || []).length) bubble(chatBody, key, ((PERSONA[key] && PERSONA[key].lines[0]) || 'Hello, Chief. What can I do for you?').replace(/^[^:]+: /, ''), false);
  }
  function openChat(key) {
    chatWith = key; renderChat(); chatBox.style.display = 'flex'; keys.clear(); hideHover && hideHover();
    setTimeout(() => chatInput.focus(), 0);
    if (key === 'vizier') openLog();
  }
  function closeChat() { chatBox.style.display = 'none'; chatWith = null; chatInput.blur(); }
  function renderLog() {
    logBody.replaceChildren();
    if (!chatLog.length) logBody.append(mk('div', { color: '#c9c1ae' }, 'When you give Vizier an order, you\'ll see her pass it to the right director here.'));
    chatLog.slice(-40).forEach((m) => bubble(logBody, m.from, m.text, m.from === 'vizier'));
  }
  function openLog() { renderLog(); logBox.style.display = 'flex'; }
  function closeLog() { logBox.style.display = 'none'; }
  logClose.onclick = closeLog;
  const say = (key, from, text) => { (chats[key] = chats[key] || []).push({ from, text, at: new Date().toISOString() }); chats[key] = chats[key].slice(-60); store(CHAT_KEY, chats); };
  const logSay = (from, text) => { chatLog.push({ from, text, at: new Date().toISOString() }); chatLog.splice(0, Math.max(0, chatLog.length - 100)); store(LOG_KEY, chatLog); };
  const GREETING = /^\s*(hi|hello|hey|salaam|salam|good (morning|afternoon|evening)|how are you)\b/i;
  // names people go by, for "get Keeper", "Scholar, come here" and the like
  const ALIAS = (() => { const m = new Map(); for (const r of RES) { m.set(r.name.toLowerCase(), r.key); m.set(r.key, r.key); m.set(r.name.toLowerCase().split(' ')[0], r.key); } m.set('vizier', 'vizier'); m.set('scout', 'scout'); m.set('helper', 'garden'); return m; })();
  function whoIn(text) {  // the first person named in the text
    const t = ' ' + text.toLowerCase().replace(/[^a-z ]/g, ' ') + ' ';
    let best = null, at = Infinity;
    for (const [name, key] of ALIAS) { const i = t.indexOf(' ' + name + ' '); if (i >= 0 && i < at) { at = i; best = key; } }
    return best;
  }
  const npcOf = (key) => directors().find((d) => d.key === key);
  function summon(key) { const d = npcOf(key); if (!d || d.seated && !d.sitting) return false; if (d.sitting) setWorking(key, false); Object.assign(d, { mode: 'summoned', goal: null, path: null, wait: 0, chat: null }); return true; }
  function backToWork(key) { const d = npcOf(key); if (!d) return; Object.assign(d, { mode: 'inside', modeUntil: state.time + 180, goal: null, path: null, wait: 0 }); }
  const COME = /\b(come (here|over)|over here)\b/i, GET = /^\s*(please\s+)?(get|call|fetch|bring|find)\b/i, BACK = /\b(back to work|get back|you can go|that'?s all)\b/i;
  function commandReply(key, text) {  // "Keeper, come here", "get Scholar", "back to work": works with or without AI
    const named = whoIn(text);
    if (key === 'vizier' && named && named !== 'vizier' && (GET.test(text) || COME.test(text))) {
      const d = npcOf(named); if (!summon(named)) return `${d.name} is at the council table right now.`;
      vizier.phoneUntil = state.time + 4; showCall('vizier', named, `Asking ${d.name} to come and see you.`, 4);
      logSay('vizier', `To ${d.name}: The Chief would like to see you. Please come over.`); logSay(named, "On my way."); renderLog();
      return `I'm calling ${d.name} now. They're on their way to you.`;
    }
    if (key === 'vizier' && named && named !== 'vizier' && BACK.test(text)) {
      backToWork(named); logSay('vizier', `To ${npcOf(named).name}: Thanks, you can get back to work.`); logSay(named, 'Back to it.'); renderLog();
      return `I've told ${npcOf(named).name} to get back to work.`;
    }
    if (key !== 'vizier' && COME.test(text) && (!named || named === key)) { summon(key); return "Coming!"; }
    if (key !== 'vizier' && BACK.test(text)) { backToWork(key); return 'Right, back to work then.'; }
    return null;
  }
  const isOrder = (text) => !(GREETING.test(text) && text.length < 40) && !/\?\s*$/.test(text);
  // guide step 44: if you ask someone to do something and they agree, a real task exists, even if they forget to make it
  const AGREES = /\b(on it|on to it|onto it|will do|leave it with me|consider it done|right away|straight away|i['’]?m on (it|that|the case)|i['’]?ll (do|get|handle|sort|look|take care|make|write|draft|put|find|check|pass|prepare|plan|research|compare|work|have|start|set|pull|dig|go|see to)|i will (do|get|handle|take care|make|write|look)|happy to (do|help|take)|i can do that|you['’]?ll have it)\b/i;
  const ASKS = /\b(can|could|would|will) you\b|\bplease\b|\bi need you to\b|\bi['’]?d like you to\b|\bi want you to\b|^\s*(\w+[,:]\s*)?(do|make|write|draft|find|check|look( into)?|get|send|sort|plan|book|research|compare|summari[sz]e|prepare|create|build|fix|review|list|organi[sz]e|remind|follow up|work out|figure out|put together|come up with|give|hand|pass)\b/i;
  const asksToDo = (text) => !(GREETING.test(text) && text.length < 40) && ASKS.test(text) && !COME.test(text) && !BACK.test(text);
  function taskFromChat(key, text, reply) {  // returns the task if one was made
    if (key === 'vizier' || !asksToDo(text) || !AGREES.test(reply || '')) return null;
    return addTodo(text, { to: key, from: nameOf(key), direct: true });
  }
  function routeAndLog(text) {  // Vizier records the order, phones the owner, and the hand-over shows in her log
    const r = placeOrder(text);
    let hint = r.to === 'vizier' ? 'The village recorded this as an order for Vizier herself to keep.' : r.to === 'hire' ? 'The village noted this as a hiring request, for later.' : '';
    if (r.to !== 'vizier' && r.to !== 'hire') {
      const a = agentOf(r.to), d = a.boss ? bossOf(a) : a, personal = r.to === 'steward' || r.to === 'garden';
      logSay('vizier', `To ${d.name}: ${personal ? 'a personal order from the Chief (kept private).' : `"${text}"${a.boss ? ` This one is for ${a.name}, on your team.` : ''}`}`);
      logSay(d.key, a.boss ? `Got it, Vizier. I'll decide whether ${a.name} can take it, and check the work.` : "Got it, Vizier. I'll report back when it's done.");
      renderLog();
      hint = `The village recorded this as an order and Vizier phoned it through to ${d.name} (${d.role})${a.boss ? `, for ${a.name} on ${d.name}'s team` : ''}.${personal ? ' It is personal, so keep the details private.' : ''}`;
    }
    return { r, hint };
  }
  function scriptedReply(key, text) {  // no AI: an honest scripted answer from their personality, job and notes
    if (isCand(key)) return `${candidate.pitch || 'Hello, Chief.'} (That's all I can say for now: the AI helper isn't running.)`;
    if (key === 'vizier') {
      if (GREETING.test(text) && text.length < 40) return "Hello, Chief. Tell me what needs doing and I'll pass it to the right person.";
      return routeAndLog(text).r.reply.replace(/^Vizier: /, '');
    }
    const r = RES.find((x) => x.key === key), p = PERSONA[key], t = text.toLowerCase();
    const met = (villageNotes[key] || []).filter((n) => n.date === today());
    if (GREETING.test(text)) return p.lines[0].replace(/^[^:]+: /, '');
    if (/what (do|are) you|your job|work on|working on|what.*you do/.test(t)) return `${r.job}${r.boss ? ` I work for ${bossOf(r).name}, who gives me every task.` : ''} No tasks yet, so nothing on my desk.`;
    if (/note|learn|remember|today|talk(ed)? (to|with)/.test(t)) return met.length ? `My notes for today: ${met.map((n) => n.text).join(' ')}` : "Nothing in my notes yet today.";
    if (/who.*(boss|report)|report to/.test(t)) return r.boss ? `I report to ${bossOf(r).name}.` : 'I report to Vizier, your chief of staff.';
    return `${p.lines[(text.length + key.length) % p.lines.length].replace(/^[^:]+: /, '')} (That's all I can say for now: my AI isn't switched on yet.)`;
  }
  async function sendChat() {
    const text = chatInput.value.trim(), key = chatWith; if (!text || !key) return;
    chatInput.value = '';
    say(key, 'you', text); bubble(chatBody, 'you', text, true);
    let reply = commandReply(key, text);
    if (!reply) {
      if (brainOn()) {
        const routed = key === 'vizier' && isOrder(text) ? routeAndLog(text) : null;
        const wait = thinking(chatBody, key);
        try { reply = await window.kingdomBrain(key, chats[key], isCand(key) ? { room: 'candidate', job: candidate } : { hint: routed ? routed.hint : '' }); } catch (e) { reply = (routed ? routed.r.reply.replace(/^Vizier: /, '') : scriptedReply(key, text)) + ` (The helper couldn't answer: ${e.message})`; }
        wait.remove();
        if (routed) addTodo(text, { to: routed.r.to, from: 'Vizier', logged: true });
        else if (!isCand(key)) taskFromChat(key, text, reply);
      } else {
        const routed = key === 'vizier' && !(GREETING.test(text) && text.length < 40) ? routeAndLog(text) : null;
        reply = routed ? routed.r.reply.replace(/^Vizier: /, '') : scriptedReply(key, text);
        if (routed) addTodo(text, { to: routed.r.to, from: 'Vizier', logged: true });
      }
    }
    say(key, key, reply); if (chatWith === key) bubble(chatBody, key, reply, false);
    const n = directors().find((d) => d.key === key); if (n) n.talkUntil = state.time + 6;
  }
  chatSend.onclick = sendChat;
  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
    if (e.key === 'Escape') closeChat();
  });
  let lastM = 0;
  addEventListener('keydown', (e) => {
    if (isTyping() || e.repeat) return;
    if (e.code === 'KeyT') {
      e.preventDefault();
      if (chatWith) { closeChat(); return; }
      const near = nearVizier() ? 'vizier' : (directorNear() || {}).key;
      if (near) openChat(near); else toast('Walk up to someone and press T to talk. Double-tap M to talk to Vizier from anywhere.');
    } else if (e.code === 'KeyM') {
      const now = performance.now();  // the two taps toggle the map twice, so it ends up as it was
      if (now - lastM < 400) { openChat('vizier'); lastM = 0; } else lastM = now;
    } else if (e.code === 'KeyL') { logBox.style.display === 'flex' ? closeLog() : openLog(); }
    else if (e.code === 'Escape') { if (chatWith) closeChat(); else closeLog(); }
  });

  // ---------- the villager log (guide step 39): J ----------
  // What the villagers say to each other: only real conversations (a worker asking someone what they're
  // working on), never chatter for its own sake. The guide uses C, but C already calls a meeting here, so it's J.
  // Small talk from a free local model is waiting for the user's yes; until then the lines are scripted.
  const talkBox = mk('div', { ...panelStyle, left: '16px', top: '130px', bottom: '56px', width: 'min(320px, calc(100vw - 32px))' }); talkBox.className = 'hud';
  const talkHead = mk('div', { padding: '10px 12px', borderBottom: '1px solid rgba(232,196,106,.25)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
  const talkClose = mk('button', { background: 'none', border: '0', color: '#c9c1ae', cursor: 'pointer', fontSize: '16px' }, '×');
  talkHead.append(mk('div', { fontWeight: '650', color: '#e8c46a' }, 'Villager log'), talkClose);
  const talkBody = mk('div', { flex: '1', overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '10px' });
  talkBox.append(talkHead, mk('div', { fontSize: '11.5px', color: '#e8c46a', padding: '5px 12px', background: 'rgba(232,196,106,.08)' }, 'Real conversations only. Scripted lines: no AI is switched on yet.'), talkBody);
  document.body.appendChild(talkBox);
  function renderTalk() {
    talkBody.replaceChildren();
    if (!talkLog.length) talkBody.append(mk('div', { color: '#c9c1ae' }, "Nobody has talked yet. When a worker bumps into someone they haven't spoken to today, their conversation appears here."));
    for (const c of talkLog.slice(-30)) {
      const when = new Date(c.at), card = mk('div', { borderLeft: '2px solid rgba(232,196,106,.35)', paddingLeft: '8px', display: 'flex', flexDirection: 'column', gap: '6px' });
      card.append(mk('div', { fontSize: '11px', color: '#c9c1ae' }, `${nameOf(c.a)} and ${nameOf(c.b)} · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
      for (const [who, line] of c.lines) bubble(card, who, line, false);
      talkBody.append(card);
    }
    talkBody.scrollTop = talkBody.scrollHeight;
  }
  talkClose.onclick = () => { talkBox.style.display = 'none'; };
  addEventListener('keydown', (e) => {
    if (isTyping() || e.repeat || e.code !== 'KeyJ') return;
    if (talkBox.style.display === 'flex') talkBox.style.display = 'none'; else { closeLog(); renderTalk(); talkBox.style.display = 'flex'; }
  });

  // ---------- the to-do list (guide step 41) ----------
  // A list on the toolbar. Type a task: Vizier sees it, phones the director who owns it, and that director does it
  // through the brain helper, on the user's subscription and talk-only (Keeper can also read Gmail and Calendar).
  // Done tasks are crossed off, and hovering one shows exactly what was done. Without the helper running, tasks
  // wait: nothing is ever marked done that wasn't. One task at a time, in order.
  const TODO_KEY = 'kingdom-one-todo';
  let toolReqs = [], toolNames = {};  // the Chief's existing tools: requests waiting for the Chief
  const todos = load(TODO_KEY, []);
  for (const t of todos) if (t.status === 'working') t.status = 'waiting';  // the page closed mid-task: try again
  // guide step 48: only the Chief approves finished work. Anything marked done before this rule, without the Chief's OK, goes back to waiting for it.
  for (const t of todos) if (t.status === 'done' && t.approvedBy !== 'you') Object.assign(t, { status: 'ready', pdf: null, pdfError: null });
  const saveTodos = () => store(TODO_KEY, todos);
  const todoBox = mk('div', { ...panelStyle, left: '16px', top: '130px', bottom: '56px', width: 'min(340px, calc(100vw - 32px))' }); todoBox.className = 'hud';
  const todoHead = mk('div', { padding: '10px 12px', borderBottom: '1px solid rgba(232,196,106,.25)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
  const todoClose = mk('button', { background: 'none', border: '0', color: '#c9c1ae', cursor: 'pointer', fontSize: '16px' }, '×');
  todoHead.append(mk('div', { fontWeight: '650', color: '#e8c46a' }, 'To-do list'), todoClose);
  const todoNote = mk('div', { fontSize: '11.5px', color: '#e8c46a', padding: '6px 12px', background: 'rgba(232,196,106,.08)' });
  const todoForm = mk('div', { display: 'flex', gap: '6px', padding: '8px', borderBottom: '1px solid rgba(232,196,106,.25)' });
  const todoInput = mk('input', { flex: '1', borderRadius: '8px', border: '1px solid #4b5a5c', background: '#12151c', color: '#f5efe2', padding: '7px 9px', font: '13px system-ui' });
  todoInput.placeholder = 'Add a task for Vizier to pass on';
  const todoAdd = mk('button', { background: '#2b8a8a', color: '#fff', border: '0', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', font: '600 13px system-ui' }, 'Add');
  todoForm.append(todoInput, todoAdd);
  const todoBody = mk('div', { flex: '1', overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' });
  todoBox.append(todoHead, todoNote, todoForm, todoBody); document.body.appendChild(todoBox);
  // the hover report: who did it, when, and exactly what was done
  const todoTip = mk('div', { position: 'fixed', display: 'none', zIndex: '30', maxWidth: '360px', background: 'rgba(18,20,28,.97)', border: '1px solid rgba(232,196,106,.55)',
    borderRadius: '10px', padding: '10px 12px', font: '12.5px system-ui', color: '#f5efe2', pointerEvents: 'none', whiteSpace: 'pre-wrap', lineHeight: '1.4' });
  document.body.appendChild(todoTip);
  const STATUS = { waiting: ['Waiting', '#c9c1ae'], working: ['Working on it', '#7cc4c0'], ready: ['Ready for your OK', '#e8c46a'], done: ['Approved by you', '#8fc27a'], needs: ['Needs you', '#e8b04b'], failed: ["Couldn't finish", '#e08a72'] };
  const when = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; };
  const IDLE_NOTE = "The AI helper isn't running, so tasks wait. Nothing gets marked done until someone has really done it.";
  const LIVE_NOTE = 'Live: each task is done by Claude on your subscription, talk-only. Hover a task to see what was done.';
  function ownerOf(to) {  // who gets a task: the director who owns it, who may hand it to their worker (step 42)
    if (to === 'vizier' || to === 'hire') return 'vizier';
    const a = agentOf(to); return a.boss ? a.boss : a.key;
  }
  function tipFor(t) {
    const cut = (x, n) => (x.length > n ? x.slice(0, n - 1) + '…' : x);
    const lines = [t.text, '', `${STATUS[t.status][0]} · added ${when(t.at)}`, `Vizier passed it to ${nameOf(t.by)}`];
    for (const st of t.steps || []) lines.push(`· ${nameOf(st.who)} ${st.what}${st.what.startsWith('handed') || st.what.startsWith('sent') ? ': ' + cut(st.text, 220) : ''}`);
    if (t.doneAt && t.doneBy) lines.push('', `${t.status === 'done' ? 'Done' : 'Reported'} by ${nameOf(t.doneBy)}${t.checkedBy ? `, checked by ${nameOf(t.checkedBy)}` : ''} · ${when(t.doneAt)}`);
    if (t.approvedAt) lines.push(`Approved by you · ${when(t.approvedAt)}`);
    if (t.chiefNotes && t.chiefNotes.length) lines.push(`You sent it back ${t.chiefNotes.length === 1 ? 'once' : t.chiefNotes.length + ' times'}: ${t.chiefNotes[t.chiefNotes.length - 1]}`);
    if (t.emailDraft) lines.push('', 'Draft. Not sent or posted: nobody in the village can send email or post. Copy it and send or post it yourself if you want to.');
    if (t.toolAsk) lines.push('', 'A tool this needed is missing. The report compares recommended tools: nothing is added unless you say yes.');
    if (t.status === 'ready') lines.push('', 'Waiting for your OK. Click Approve, or Send back with a note. Nobody else can approve it, Vizier included.');
    if (t.report) lines.push('', t.report);
    if (t.pdf) lines.push('', 'The full report is a PDF: click PDF on this task.');
    else if (t.status !== 'waiting' && t.status !== 'working') lines.push('', t.pdfError ? `No PDF yet: ${t.pdfError}` : 'The PDF report is being made.');
    if (t.report) { /* shown above */ } else if (t.status === 'waiting') lines.push('', brainOn() ? 'Queued: it starts when the task ahead of it is finished.' : 'Waiting for the AI helper. Nothing has been done yet.');
    else if (t.status === 'working') lines.push('', `${t.now || nameOf(t.by) + ' is working on it'} now.`);
    return lines.join('\n');
  }
  function renderTodos() {
    todoNote.textContent = brainOn() ? LIVE_NOTE : IDLE_NOTE;
    todoBody.replaceChildren();
    for (const r of toolReqs.filter((x) => x.status === 'waiting')) todoBody.append(requestRow(r));
    if (!todos.length) todoBody.append(mk('div', { color: '#c9c1ae' }, 'No tasks yet. Add one above: Vizier passes it to the right director, who does it or hands it to their worker and checks the work.'));
    for (const t of todos.slice().reverse()) {
      const row = mk('div', { display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '6px 8px', borderRadius: '8px', background: 'rgba(255,255,255,.04)', cursor: 'default' });
      const img = faceImg(t.with || t.doneBy || t.by, 24); if (img) row.append(img);
      const mid = mk('div', { flex: '1', minWidth: '0' });
      const txt = mk('div', { textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? '#9a9486' : '#f5efe2', overflowWrap: 'anywhere' }, t.text);
      const [label, col] = STATUS[t.status];
      const who = t.status === 'working' ? (t.now || `${nameOf(t.by)} is on it`)
        : t.doneBy ? `${label} · by ${nameOf(t.doneBy)}${t.checkedBy ? `, checked by ${nameOf(t.checkedBy)}` : ''}` : `${label} · ${nameOf(t.by)}`;
      mid.append(txt, mk('div', { fontSize: '11px', color: col, marginTop: '2px' }, (t.emailDraft ? '✉ Draft, not sent · ' : '') + (t.toolAsk ? '🔧 Tool options for you · ' : '') + who));
      if (t.status === 'ready' || (t.emailDraft && t.report)) {
        const bar = mk('div', { display: 'flex', gap: '6px', marginTop: '5px', flexWrap: 'wrap' });
        const btn = (label, bg, title) => { const b = mk('button', { background: bg, color: '#fff', border: '0', borderRadius: '6px', padding: '2px 8px', cursor: 'pointer', font: '600 11px system-ui' }, label); b.title = title; return b; };
        if (t.status === 'ready') {
          const ok = btn('Approve', '#3f7d5a', 'Only you can approve finished work');
          ok.onclick = (e) => approveTask(t, e);
          const back = btn('Send back', '#9a6a2b', 'Send it back with a note: it goes to the end of the list and is done again');
          back.onclick = (e) => {
            e.stopPropagation(); if (bar.querySelector('input')) return;
            const inp = mk('input', { flex: '1 1 140px', minWidth: '0', background: 'rgba(0,0,0,.35)', border: '1px solid rgba(232,196,106,.4)', borderRadius: '6px', color: '#f5efe2', padding: '2px 6px', font: '12px system-ui' });
            inp.placeholder = 'What needs changing? Enter to send';
            inp.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter' && inp.value.trim()) sendBackTask(t, inp.value.trim(), k); if (k.key === 'Escape') renderTodos(); });
            bar.append(inp); inp.focus();
          };
          bar.append(ok, back);
        }
        if (t.emailDraft && t.report) {
          const cp = btn('Copy draft', '#2b8a8a', 'Copy the email draft so you can send it yourself');
          cp.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(t.report).then(() => toast('Draft copied. Nothing was sent.', 'vizier')).catch(() => toast("Couldn't copy it: select the text in the PDF instead.", 'vizier')); };
          bar.append(cp);
        }
        mid.append(bar);
      }
      const del = mk('button', { background: 'none', border: '0', color: '#7d776a', cursor: 'pointer', fontSize: '13px', padding: '0 2px' }, '×');
      del.title = 'Remove from the list'; del.disabled = t.status === 'working';
      del.onclick = () => { const i = todos.indexOf(t); if (i >= 0) { todos.splice(i, 1); saveTodos(); todoTip.style.display = 'none'; renderTodos(); } };
      if (t.pdf) {
        const pdf = mk('a', { color: '#e8c46a', fontSize: '11px', fontWeight: '650', textDecoration: 'none', border: '1px solid rgba(232,196,106,.45)', borderRadius: '6px', padding: '1px 6px', alignSelf: 'center' }, 'PDF');
        pdf.href = BRAIN + t.pdf; pdf.target = '_blank'; pdf.rel = 'noopener'; pdf.title = 'Open the report for this task';
        row.append(mid, pdf, del);
      } else row.append(mid, del);
      row.onmouseenter = (e) => { todoTip.textContent = relabel(tipFor(t)); todoTip.style.display = 'block'; row.onmousemove(e); };
      row.onmousemove = (e) => { const r = todoTip.getBoundingClientRect(); todoTip.style.left = Math.max(8, Math.min(e.clientX + 14, innerWidth - r.width - 8)) + 'px'; todoTip.style.top = Math.max(8, Math.min(e.clientY + 14, innerHeight - r.height - 8)) + 'px'; };
      row.onmouseleave = () => { todoTip.style.display = 'none'; };
      todoBody.append(row);
    }
  }
  function addTodo(text, opts = {}) {  // opts (guide step 44): { to, from, logged } for a task agreed in a chat
    text = text.trim(); if (!text) return null;
    const dup = todos.find((x) => x.text.toLowerCase() === text.toLowerCase() && Date.now() - new Date(x.at).getTime() < 10 * 60 * 1000);
    if (dup) return dup;
    const r = opts.to ? { to: opts.to, reply: null } : placeOrder(text);  // Vizier records it and phones the director who owns it
    const by = ownerOf(r.to), t = { id: Date.now().toString(36), text, to: r.to, by, status: 'waiting', at: new Date().toISOString(), from: opts.from || null, direct: !!opts.direct };
    todos.push(t); saveTodos();
    const personal = r.to === 'steward' || r.to === 'garden';
    if (by !== 'vizier' && !opts.logged) { logSay('vizier', `To ${nameOf(by)}: ${personal ? 'a personal task from the Chief (kept private).' : `a task from the Chief's list: "${text}"`}`); logSay(by, "On it. I'll report back when it's done."); renderLog(); }
    if (r.reply) toast(r.reply, 'vizier');
    else toast(`On your to-do list (K): "${text.length > 70 ? text.slice(0, 67) + '...' : text}"${opts.from ? `, agreed with ${opts.from}` : ''}. ${nameOf(by)} will do it and report back.`, by);
    if (todoBox.style.display === 'flex') renderTodos();
    runTodos();
    return t;
  }
  let todoBusy = false;
  // The Chief's existing tools (helper/tools.json): agents read them directly, but an action (start a download, run a
  // scan) only asks. The request waits here until the Chief clicks Approve (a real click: event.isTrusted), and only
  // then does the brain helper run it. Decline drops it.
  const seenReqs = new Set();
  async function pollRequests() {
    if (!brainOn()) return;
    try {
      const j = await (await fetch(BRAIN + '/requests')).json();
      toolReqs = Array.isArray(j.requests) ? j.requests : []; toolNames = j.tools || {};
      for (const r of toolReqs) if (r.status === 'waiting' && !seenReqs.has(r.id)) {
        seenReqs.add(r.id);
        toast(`${nameOf(r.agent)} asks to run ${toolNames[r.tool] || r.tool}: ${r.action}. It waits for your Approve on the to-do list (K).`, r.agent);
      }
      if (todoBox.style.display === 'flex') renderTodos();
    } catch (e) { /* the helper isn't running */ }
  }
  setInterval(pollRequests, 5000);
  function requestRow(r) {
    const row = mk('div', { display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '6px 8px', borderRadius: '8px', background: 'rgba(232,196,106,.10)', border: '1px solid rgba(232,196,106,.35)' });
    const img = faceImg(r.agent, 24); if (img) row.append(img);
    const mid = mk('div', { flex: '1', minWidth: '0', overflowWrap: 'anywhere' });
    const f = Object.entries(r.fields || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
    mid.append(mk('div', { color: '#f5efe2' }, `🔧 ${nameOf(r.agent)} wants to run ${toolNames[r.tool] || r.tool}: ${r.action}${f ? ` (${f})` : ''}`),
      mk('div', { fontSize: '11px', color: '#e8c46a', marginTop: '2px' }, `${r.why || 'No reason given.'} · Hasn't run: it only runs if you approve.`));
    const bar = mk('div', { display: 'flex', gap: '6px', marginTop: '5px' });
    const btn = (label, bg) => mk('button', { background: bg, color: '#fff', border: '0', borderRadius: '6px', padding: '2px 8px', cursor: 'pointer', font: '600 11px system-ui' }, label);
    const ok = btn('Approve', '#3f7d5a'), no = btn('Decline', '#7d776a');
    ok.onclick = (e) => decideRequest(r, 'approve', e); no.onclick = (e) => decideRequest(r, 'decline', e);
    bar.append(ok, no); mid.append(bar); row.append(mid);
    return row;
  }
  async function decideRequest(r, decision, e) {
    if (!e || !e.isTrusted) return;  // only the Chief's own click
    try {
      const j = await (await fetch(BRAIN + '/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, decision }) })).json();
      const d = j.request || {};
      toast(decision === 'approve' ? (d.status === 'done' ? `Started: ${toolNames[r.tool] || r.tool} ${r.action}.` : `It didn't start: ${d.result || j.error}`) : `Declined. ${nameOf(r.agent)}'s request won't run.`, r.agent);
      logSay('vizier', `The Chief ${decision === 'approve' ? 'approved' : 'declined'} ${nameOf(r.agent)}'s request to run ${toolNames[r.tool] || r.tool}: ${r.action}.`); renderLog();
    } catch (err) { toast(`Couldn't reach the helper: ${err.message}`, 'vizier'); }
    pollRequests();
  }
  // guide step 48: everything finished comes to the Chief. A director's approval only makes it "ready for your OK".
  // Only these two functions move a task on from there, and they only act on a real click or key press by the person
  // (event.isTrusted), so no agent, script or Vizier can approve anything for you. They aren't on the debug handle.
  function approveTask(t, e) {
    if (!e || !e.isTrusted || t.status !== 'ready') return;
    Object.assign(t, { status: 'done', approvedBy: 'you', approvedAt: new Date().toISOString(), pdf: null, pdfError: null });
    saveTodos(); renderTodos(); logSay('vizier', `The Chief approved "${t.text.length > 50 ? t.text.slice(0, 47) + '...' : t.text}".`); renderLog();
    toast(`Approved: "${t.text.length > 60 ? t.text.slice(0, 57) + '...' : t.text}". The report is updated.`, t.checkedBy || t.doneBy || 'vizier');
    makeReport(t);
  }
  function sendBackTask(t, note, e) {
    if (!e || !e.isTrusted || t.status !== 'ready') return;
    (t.chiefNotes = t.chiefNotes || []).push(note.slice(0, 500));
    t.lastResult = t.report;
    Object.assign(t, { status: 'waiting', pdf: null, pdfError: null, doneAt: null, now: null });
    saveTodos(); renderTodos(); logSay('vizier', `To ${nameOf(t.by)}: the Chief sent "${t.text.length > 40 ? t.text.slice(0, 37) + '...' : t.text}" back: ${note}`); renderLog();
    toast(`Sent back to ${nameOf(t.by)} with your note. It's queued again.`, 'vizier');
    runTodos();
  }
  // guide step 43: every finished task gets a PDF report, made on this computer by the brain helper (Edge prints it)
  let pdfBusy = false;
  async function makeReport(t) {
    if (pdfBusy || t.pdf || !['ready', 'done', 'needs', 'failed'].includes(t.status) || !brainOn()) return;
    pdfBusy = true;
    try {
      const faces = {};
      for (const k of new Set(['vizier', t.by, t.doneBy, t.checkedBy].filter(Boolean))) { const c = faceOf(k); if (c) faces[k] = c.toDataURL(); }
      const r = await fetch(BRAIN + '/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: t, faces }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) { t.pdf = j.url; t.pdfError = null; } else t.pdfError = j.error || 'no PDF';
    } catch (e) { t.pdfError = e.message; }
    saveTodos(); pdfBusy = false;
    if (todoBox.style.display === 'flex') renderTodos();
  }
  const nextReport = () => { const t = todos.find((x) => !x.pdf && !x.pdfError && ['ready', 'done', 'needs', 'failed'].includes(x.status)); if (t) makeReport(t); };
  // guide step 42: the director decides whether their worker can handle it. If so they hand it on with instructions,
  // the worker does it, and the director checks it: approved, or sent back with notes (at most twice, then the
  // director reports what's left to the Chief). Every step is kept on the task, so the hover shows the whole hand-over.
  const TEAM_OF = (key) => RES.filter((r) => r.boss === key).map((r) => r.key);
  const WORKER_ASK = /\b(give|hand|pass|send)\b[^.]*\b(to )?(your|the) (worker|intern|team)\b|\b(your|the) worker (can|should|to) /i;
  const plain = (s) => String(s || '').replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').trim();
  // reads the agent's answer word (DONE, HAND TO, APPROVED...) from the first few non-empty lines, and the text after it
  function verdict(out, words) {
    const ls = plain(out).split('\n').map((x) => x.trim());
    let seen = 0;
    for (let i = 0; i < ls.length && seen < 3; i++) {
      if (!ls[i]) continue; seen++;
      for (const w of words) {
        const m = new RegExp('^\\W*' + w + '\\b\\W*(.*)$', 'i').exec(ls[i]);
        if (m) return { word: w, tail: m[1].trim(), rest: ls.slice(i + 1).join('\n').trim() || m[1].trim() || ls[i] };
      }
    }
    return { word: null, tail: '', rest: plain(out) };
  }
  const MAX_SENDBACKS = 2;
  // Working with other departments: while doing a task, an agent can ask a colleague anywhere in the village
  // ("ASK Scholar: ...", at most twice a task). The colleague answers from their own area and notes, the answer goes
  // back to the agent, and every question and answer is kept on the task with the rest of the hand-over.
  const MAX_CONSULTS = 2;
  const whoIs = (n) => { n = String(n || '').trim().toLowerCase(); return ['vizier', ...RES.map((r) => r.key)].find((k) => k === n || nameOf(k).toLowerCase() === n) || null; };
  async function ask(t, key, room, job, line) {  // one step of the work, recorded on the task as it happens
    const run = async (j, l) => {
      t.now = l; t.with = key; saveTodos(); if (todoBox.style.display === 'flex') renderTodos();
      const n = npcOf(key); if (n) n.talkUntil = state.time + 6;
      return String(await askBrain(key, [{ from: 'you', text: t.text }], { room, job: j })).trim();
    };
    let out = await run(job, line);
    const consults = [];
    while (room === 'task' && consults.length < MAX_CONSULTS) {
      const ls = plain(out).split('\n'), i = ls.findIndex((x) => x.trim());
      const m = i >= 0 && /^ASK\s+([^:]{1,40}):\s*(.*)$/.exec(ls[i].trim()); if (!m) break;
      const q = [m[2], ...ls.slice(i + 1)].join(' ').replace(/\s+/g, ' ').trim().slice(0, 600), who = whoIs(m[1]);
      let a;
      if (!who || who === key) a = `There's nobody called ${m[1]} to ask. Finish it with what you have.`;
      else {
        step(t, key, `asked ${nameOf(who)}`, q); logSay(key, `To ${nameOf(who)}: ${q}`); renderLog();
        showCall(key, who, `Asking ${nameOf(who)} for help.`, 4);
        t.now = `${nameOf(who)} is answering ${nameOf(key)}`; t.with = who; saveTodos(); if (todoBox.style.display === 'flex') renderTodos();
        const n = npcOf(who); if (n) n.talkUntil = state.time + 6;
        a = plain(await askBrain(who, [{ from: 'you', text: q }], { room: 'consult', job: { from: key, question: q, task: t.text } }));
        step(t, who, `answered ${nameOf(key)}`, a); logSay(who, `To ${nameOf(key)}: ${a}`); renderLog();
      }
      consults.push({ name: who ? nameOf(who) : m[1], q, a });
      out = await run({ ...job, consults }, `${nameOf(key)} is finishing it with ${who ? nameOf(who) : 'that'}'s answer`);
    }
    return out;
  }
  const step = (t, who, what, text) => { (t.steps = t.steps || []).push({ who, what, text: plain(text), at: new Date().toISOString() }); saveTodos(); };
  const EMAIL_DRAFT = /^\s*(subject|to|dear|hi|hello)\b[^\n]{0,120}$/im;
  function finish(t, status, report, doneBy, checkedBy) {
    if (status === 'done') status = 'ready';  // guide step 48: finished work waits for the Chief's OK
    const emailTask = /\b(e-?mail|reply|replies|message to|write to)\b/i.test(t.text);
    Object.assign(t, { status, report: plain(report), doneBy, checkedBy: checkedBy || null, doneAt: new Date().toISOString(), now: null, with: null,
      emailDraft: status !== 'failed' && ((emailTask && EMAIL_DRAFT.test(plain(report))) || /^\s*\**POST DRAFT\b/im.test(plain(report))),  // email or social media drafts
      toolAsk: /^\s*TOOL OPTIONS\b/im.test(plain(report)) });  // a tool was missing: the agent compared options for the Chief
    saveTodos();
  }
  async function runTodos() {
    if (todoBusy || !brainOn()) return;
    const t = todos.find((x) => x.status === 'waiting'); if (!t) return;
    todoBusy = true; t.status = 'working'; t.steps = []; saveTodos(); if (todoBox.style.display === 'flex') renderTodos();
    if (t.to === 'hire') {  // guide step 46
      try { await scoutFor(t); } catch (e) { finish(t, 'failed', `Vizier couldn't find a candidate: ${e.message}`, 'vizier', null); }
      if (t.status === 'failed') toast(`Vizier: I couldn't find a candidate this time: ${t.report}`, 'vizier');
      else if (candidate && candidate.taskId === t.id) toast(`Vizier: I've found ${candidate.name} to help ${candidate.bossName}. They're waiting in the town hall for your interview.`, 'vizier');
      else toast(`Vizier: ${t.report}`, 'vizier');
      todoBusy = false; await makeReport(t); runTodos(); return;
    }
    const d = t.by, team = d === 'vizier' ? [] : TEAM_OF(d);
    const a = t.to !== 'vizier' && t.to !== 'hire' ? agentOf(t.to) : null;
    const asked = WORKER_ASK.test(t.text) || (t.direct && a && !!a.boss);
    const note = [a && a.boss ? `Vizier routed this to ${a.name}'s area, on your team.` : '', t.to === 'vizier' ? 'Nobody else owns this one, so it is yours.' : '',
      asked && team.length ? 'The Chief asked you to give this to your worker, so hand it on.' : '',
      t.direct && a && a.boss ? `The Chief asked ${a.name} directly and ${a.name} agreed, so hand it to ${a.name}.` : '',
      t.chiefNotes && t.chiefNotes.length ? `The Chief sent the last result back with this note: "${t.chiefNotes[t.chiefNotes.length - 1]}". Fix exactly that. The last result was: ${String(t.lastResult || '').slice(0, 1200)}` : ''].filter(Boolean).join(' ');
    try {
      const out = await ask(t, d, 'task', { text: t.text, note }, `${nameOf(d)} is deciding who does it`);
      const v = verdict(out, ['HAND TO', 'DONE', 'NEEDS THE CHIEF']);
      const w = v.word === 'HAND TO' && team.find((k) => v.tail.toLowerCase().includes(nameOf(k).toLowerCase()) || v.tail.toLowerCase().includes(k));
      if (!w) {  // the director did it themselves
        step(t, d, 'did it', v.rest);
        finish(t, v.word === 'DONE' ? 'done' : 'needs', v.rest, d, null);
      } else {
        const instructions = v.rest;
        step(t, d, `handed it to ${nameOf(w)}`, instructions);
        logSay(d, `To ${nameOf(w)}: a task from the Chief's list. ${instructions}`); logSay(w, "On it. I'll bring it back for you to check."); renderLog();
        showCall(d, w, `Handing a task to ${nameOf(w)}.`, 4);
        let feedback = '', report = '', head2 = '', last = '';
        for (let round = 0; round <= MAX_SENDBACKS; round++) {
          const wo = await ask(t, w, 'task', { text: t.text, instructions, report: round ? report : '', worker: w, feedback }, `${nameOf(w)} is working on it${round ? ` again (try ${round + 1})` : ''}`);
          const wv = verdict(wo, ['DONE', 'NEEDS THE CHIEF']); head2 = wv.word || ''; report = wv.rest;
          step(t, w, round ? `did it again (try ${round + 1})` : 'did it', report);
          const rv = await ask(t, d, 'review', { text: t.text, instructions, report, worker: w }, `${nameOf(d)} is checking ${nameOf(w)}'s work`);
          const rvv = verdict(rv, ['APPROVED', 'SEND BACK']); last = rvv.rest;
          if (rvv.word === 'APPROVED') { step(t, d, 'checked it: approved', last); break; }
          feedback = last;
          step(t, d, round < MAX_SENDBACKS ? 'sent it back' : 'sent it back for the last time', last);
          if (round < MAX_SENDBACKS) { logSay(d, `To ${nameOf(w)}: not yet. ${last}`); renderLog(); }
        }
        const approved = t.steps[t.steps.length - 1].what.startsWith('checked');
        if (approved) finish(t, head2 === 'DONE' ? 'done' : 'needs', report, w, d);
        else finish(t, 'needs', `${nameOf(d)} sent it back ${MAX_SENDBACKS + 1} times and it still isn't right. ${nameOf(d)}'s last notes: ${last}\n\n${nameOf(w)}'s last attempt: ${report}`, w, d);
      }
    } catch (e) {
      step(t, 'vizier', 'stopped', `The helper couldn't finish it: ${e.message}`);
      finish(t, 'failed', `The helper couldn't finish it: ${e.message}. It hasn't been done. Remove it and add it again to retry.`, t.with || d, null);
    }
    const short = t.text.length > 50 ? t.text.slice(0, 47) + '...' : t.text;
    const checked = t.checkedBy ? `, checked by ${nameOf(t.checkedBy)}` : '';
    logSay(t.checkedBy || t.doneBy, `To Vizier: ${t.status === 'ready' ? 'ready for the Chief' : 'reported back on'} "${short}" (by ${nameOf(t.doneBy)}${checked}).`); renderLog();
    if (todoBox.style.display === 'flex') renderTodos();
    const how = t.status === 'ready' ? 'Ready for your OK' : t.status === 'needs' ? 'Did what we could, and the rest needs you' : "Couldn't finish";
    toast(`${nameOf(t.checkedBy || t.doneBy)}: ${how}: "${short}" (by ${nameOf(t.doneBy)}${checked}). ${t.status === 'ready' ? ' Approve it on your to-do list (K).' : ' Hover it on your to-do list (K) to see the hand-over.'}`, t.checkedBy || t.doneBy);
    todoBusy = false; await makeReport(t); runTodos();
  }
  setInterval(() => { runTodos(); if (!todoBusy) nextReport(); if (todoBox.style.display === 'flex') todoNote.textContent = brainOn() ? LIVE_NOTE : IDLE_NOTE; }, 5000);
  function openTodos() { closeLog(); talkBox.style.display = 'none'; renderTodos(); todoBox.style.display = 'flex'; keys.clear(); setTimeout(() => todoInput.focus(), 0); }
  function closeTodos() { todoBox.style.display = 'none'; todoTip.style.display = 'none'; todoInput.blur(); }
  window.__todo = () => (todoBox.style.display === 'flex' ? closeTodos() : openTodos());
  todoClose.onclick = closeTodos;
  todoAdd.onclick = () => { addTodo(todoInput.value); todoInput.value = ''; };
  todoInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); addTodo(todoInput.value); todoInput.value = ''; }
    if (e.key === 'Escape') closeTodos();
  });
  addEventListener('keydown', (e) => {
    if (isTyping() || e.repeat || e.code !== 'KeyK') return;
    window.__todo();
  });

  // ---------- hiring (guide step 46) ----------
  // Vizier is always looking for ways to make the team better. Ask for help for a director ("find Scholar a helper", or
  // anything about hiring) and Vizier finds one candidate and brings them to the town hall. You interview them there
  // (walk up, press T). Nobody is hired unless you click Hire. On your yes the brain helper writes their agent folder,
  // instructions and notes, adds them to their director's instructions and to agents/hires.json, and they walk to
  // their director's house and start work. Their look is made in code like everyone else's, so it costs no credits.
  // If a director keeps doing tasks alone, Vizier suggests a helper (free: no AI is used until you ask).
  const CAND_KEY = 'kingdom-one-candidate', NUDGE_KEY = 'kingdom-one-hire-nudges';
  let candidate = load(CAND_KEY, null);
  const nudges = load(NUDGE_KEY, {});
  const isCand = (key) => !!candidate && key === candidate.key;
  const strHash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const pick = (arr, s, k) => arr[Math.floor(strHash(s + ':' + k) * arr.length)];
  function lookFor(name, color) {  // a look of their own, worked out from their name, in their director's house colour
    const n = name.toLowerCase();
    const look = { color, skin: pick(['#f1cfae', '#e2b48c', '#c68b63', '#a8714d', '#8a5a3c', '#6e4630'], n, 1), kit: pick(['folder', 'satchel', 'scrolls', 'letters', 'plans'], n, 2), smile: strHash(n + 's') < 0.5 };
    const hat = pick(['none', 'none', 'taqiyah', 'tarbouch', 'turban', 'hood'], n, 3);
    if (hat !== 'none') { look.head = hat; look.headColor = pick(['#f3e6cf', '#b5523b', '#2b8a8a', '#e8b04b', '#3f7d5a'], n, 4); }
    else { look.hair = pick(['short', 'wavy', 'curly', 'long', 'bun'], n, 5); look.hairColor = pick(['#1b1612', '#2a1b12', '#3b2a20', '#5a3a22', '#7a4b2a'], n, 6); }
    look.beard = pick(['none', 'none', 'stubble', 'short', 'moustache'], n, 7);
    if (look.beard !== 'none') look.beardColor = look.hairColor || '#2a1b12';
    if (strHash(n + 'g') < 0.25) look.glasses = true;
    return look;
  }
  // one clean name: no notes, no extra words, nothing the agent was thinking out loud
  const NAME_POOL = ['Yasmin', 'Idris', 'Salma', 'Karim', 'Nadia', 'Omar', 'Leila', 'Rayan', 'Amina', 'Tariq', 'Zineb', 'Hamza', 'Soraya', 'Bilal', 'Imane', 'Youssef'];
  function cleanName(raw) {
    let n = String(raw || '').split('\n')[0].replace(/^\W*name\W*/i, '').replace(/\(.*?\)|\[.*?\]|".*?"|\*|_/g, ' ').split(/[,;:.!?/|]| - | – | — /)[0];
    n = n.replace(/[^A-Za-z' -]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const taken = new Set(['vizier', 'you', 'chief', 'everyone', ...Object.values(CAST_NAME).map((x) => x.toLowerCase())]);
    const ok = (x) => /^[A-Z][a-z]+(?:[ '-][A-Z][a-z]+)?$/.test(x) && x.length <= 20 && !taken.has(x.toLowerCase());
    if (ok(n)) return n;
    const first = n.split(' ')[0];
    if (ok(first)) return first;
    return NAME_POOL.find(ok) || null;
  }
  function keyFor(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 17) || 'hire';
    let k = /^[a-z]/.test(base) ? base : 'h' + base, i = 2;
    while (CAST_NAME[k] || ['vizier', 'you', 'everyone', 'hire'].includes(k)) k = `${base}${i++}`;
    return k;
  }
  const personaOfHire = (h) => ({ personality: h.personality || 'New, keen and careful.', quirk: h.quirk || 'Still learning where everything is.',
    lines: [`${h.name}: ${h.bossName || 'My director'} gives me my tasks. Glad to be here!`, `${h.name}: Still learning where everything is.`, `${h.name}: Ready when ${h.bossName || 'my director'} is.`] });
  function teamContext() {  // what Vizier knows about each director's load (personal tasks: counts only)
    const week = Date.now() - 7 * 864e5;
    return RES.filter((r) => !r.boss).map((r) => {
      const ws = RES.filter((w) => w.boss === r.key).map((w) => w.name);
      const mine = todos.filter((t) => t.by === r.key && new Date(t.at).getTime() > week), alone = mine.filter((t) => t.doneBy === r.key).length;
      const latest = r.key === 'steward' || !mine.length ? '' : '; latest: ' + mine.slice(-2).map((t) => `"${t.text.slice(0, 60)}"`).join(', ');
      return `- ${r.name} (${r.role}): workers ${ws.join(', ') || 'none'}; ${mine.length} task(s) this week, ${alone} done alone${latest}`;
    }).join('\n');
  }
  async function findCandidate(t) {
    const out = plain(await askBrain('vizier', [{ from: 'you', text: t.text }], { room: 'scout', job: { text: t.text, context: teamContext() } }));
    const field = (k) => { const m = new RegExp('^\\W*' + k + '\\s*:\\s*(.+)$', 'im').exec(out); return m ? m[1].trim() : ''; };
    const forName = field('FOR').toLowerCase(), named = whoIn(t.text), nr = named && agentOf(named);
    const dir = RES.find((r) => !r.boss && forName.includes(r.name.toLowerCase())) || (nr && !nr.boss ? nr : nr && nr.boss ? bossOf(nr) : null) || RES.find((r) => !r.boss);
    const name = cleanName(field('NAME'));
    if (!name) throw new Error("Vizier couldn't settle on a clean name");
    return { key: keyFor(name), name, boss: dir.key, bossName: dir.name, role: field('ROLE').slice(0, 80) || `Helper for ${dir.name}`, job: field('JOB').slice(0, 300),
      personality: field('PERSONALITY').slice(0, 160), quirk: field('QUIRK').slice(0, 160), pitch: field('PITCH').slice(0, 400), look: lookFor(name, dir.accent || '#c98a2b'), taskId: t.id, at: new Date().toISOString() };
  }
  function spawnCandidate(c) {  // the candidate waits in the town hall, by the council table
    if (!c || !DIRECTORS || npcOf(c.key)) return;
    if (window.__castAdd && !(window.__castSheets || {})[c.key]) window.__castAdd({ key: c.key, name: c.name, role: c.role, ...c.look });
    const hall = scenes['hall-in'];
    const spot = [[7, 10], [6, 10], [8, 10], [7, 11], [6, 11], [8, 9], [5, 10], [7, 9]].find(([x, y]) => walkTile(hall, x, y)) || [7, 10];
    const [x, y] = centre(spot);
    PERSONA[c.key] = { personality: c.personality, quirk: c.quirk, lines: [`${c.name}: Hello! Vizier said you might have a few questions for me.`] };
    DIRECTORS.push({ key: c.key, name: c.name, b: hall.building, yard: [], room: 'hall-in', worker: true, candidate: true, scene: 'hall-in', x, y, dir: 'down', moving: false, anim: 0,
      path: null, goal: null, wait: 1, line: 0, talkUntil: 0, working: false, desk: null, chat: null, blocked: 0, ...PERSONA[c.key] });
    CAST_NAME[c.key] = c.name; ALIAS.set(c.name.toLowerCase(), c.key);
  }
  setInterval(() => { if (candidate && DIRECTORS && !npcOf(candidate.key)) spawnCandidate(candidate); }, 1500);
  // the decision, under the interview chat: only you can hire
  const hireBar = mk('div', { display: 'none', gap: '8px', padding: '8px 12px', alignItems: 'center', background: 'rgba(43,138,138,.15)', borderBottom: '1px solid rgba(232,196,106,.25)' });
  const hireText = mk('div', { flex: '1', fontSize: '12px', color: '#c9c1ae' });
  const hireYes = mk('button', { background: '#e8b04b', color: '#12151c', border: '0', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', font: '650 13px system-ui' }, 'Hire');
  const hireNo = mk('button', { background: 'none', color: '#c9c1ae', border: '1px solid #4b5a5c', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', font: '13px system-ui' }, 'Not this time');
  hireBar.append(hireText, hireNo, hireYes); chatBox.insertBefore(hireBar, chatBody);
  function showHireBar(key) {
    if (!isCand(key)) { hireBar.style.display = 'none'; return; }
    hireText.textContent = `Interviewing for ${candidate.role}, working for ${candidate.bossName}. Hire makes their agent folder and they start work.`;
    hireBar.style.display = 'flex';
  }
  async function hireCandidate() {
    const c = candidate; if (!c) return;
    hireYes.disabled = true;
    let h;
    try {
      const r = await fetch(BRAIN + '/hire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidate: c }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'no answer');
      h = j.hire;
    } catch (e) {
      hireYes.disabled = false;
      toast(`Vizier: I couldn't finish the paperwork for ${c.name}: ${e.message}. Nothing was created. Is the AI helper running?`, 'vizier'); return;
    }
    hireYes.disabled = false;
    const dir = agentOf(c.boss);
    RES.push({ key: c.key, name: c.name, title: `${c.name}, at ${dir.title}`, role: c.role, q: dir.q, hire: true, home: c.boss, bossKey: c.boss, boss: c.boss, rank: 'worker', accent: dir.accent, wall: dir.wall, job: c.job, yard: [], room: [] });
    HIRES.push({ ...h, bossName: dir.name });
    PERSONA[c.key] = personaOfHire({ ...h, bossName: dir.name });
    const d = npcOf(c.key), dd = npcOf(c.boss);
    Object.assign(d, { candidate: false, hire: true, worker: true, b: dd.b, room: dd.room, yard: dd.yard, working: true, mode: null, goal: null, path: null, wait: 0.5, talkUntil: 0, ...PERSONA[c.key] });
    candidate = null; store(CAND_KEY, null);
    const t = todos.find((x) => x.id === c.taskId);
    if (t) {
      step(t, 'you', 'interviewed them and said yes', `${c.name} hired as ${c.role}, working for ${dir.name}.`);
      Object.assign(t, { status: 'done', approvedBy: 'you', approvedAt: new Date().toISOString(), doneBy: 'vizier', report: `${t.report || ''}\n\nHired: you interviewed ${c.name} and said yes. ${c.name} now works for ${dir.name}.`.trim(), pdf: null, pdfError: null, doneAt: new Date().toISOString() });
      saveTodos(); if (todoBox.style.display === 'flex') renderTodos();
    }
    logSay('vizier', `To ${dir.name}: the Chief has hired ${c.name} to help you (${c.role}). They're on their way to your house.`); logSay(c.boss, `Welcome aboard, ${c.name}. I'll give you your first task.`); renderLog();
    closeChat();
    toast(`${c.name} is hired, and is walking to ${dir.name}'s house to start work. Their folder, instructions and notes are in agents/${c.key}/.`, c.key);
  }
  function declineCandidate() {
    const c = candidate; if (!c) return;
    const i = DIRECTORS.findIndex((x) => x.key === c.key); if (i >= 0) DIRECTORS.splice(i, 1);
    candidate = null; store(CAND_KEY, null);
    const t = todos.find((x) => x.id === c.taskId);
    if (t) { step(t, 'you', 'interviewed them and said no', `${c.name} wasn't hired.`); Object.assign(t, { report: `${t.report || ''}\n\nNot hired: you interviewed ${c.name} and said no.`.trim(), pdf: null, pdfError: null }); saveTodos(); }
    closeChat(); logSay('vizier', `${c.name} wasn't hired. I've thanked them and seen them out.`); renderLog();
    toast(`Vizier: Understood. I've thanked ${c.name} and seen them out. Ask me any time to look again.`, 'vizier');
  }
  hireYes.onclick = hireCandidate; hireNo.onclick = declineCandidate;
  async function scoutFor(t) {  // the to-do list's hiring tasks: Vizier finds one candidate
    if (candidate) { finish(t, 'needs', `${candidate.name} is still waiting in the town hall for your interview. Vizier will look for someone else after that.`, 'vizier', null); return; }
    t.now = 'Vizier is looking for a candidate'; t.with = 'vizier'; saveTodos(); if (todoBox.style.display === 'flex') renderTodos();
    const c = await findCandidate(t);
    candidate = c; store(CAND_KEY, c); spawnCandidate(c);
    step(t, 'vizier', `found a candidate: ${c.name}, for ${c.bossName}`, `${c.role}. ${c.job}\n\n${c.pitch}`);
    finish(t, 'needs', `Vizier found ${c.name} (${c.role}) to help ${c.bossName}. ${c.job}\n\n${c.name} is waiting in the town hall. Walk up and press T to interview them. They're only hired if you click Hire.`, 'vizier', null);
    showCall('vizier', c.boss, `Found a candidate to help ${c.bossName}.`, 4);
  }
  function hireNudge() {  // a director doing everything alone: Vizier suggests a helper (no AI used)
    if (candidate) return;
    const week = Date.now() - 7 * 864e5;
    for (const r of RES.filter((x) => !x.boss)) {
      const alone = todos.filter((t) => t.by === r.key && t.doneBy === r.key && new Date(t.at).getTime() > week).length;
      if (alone < 3 || Date.now() - (nudges[r.key] || 0) < 864e5) continue;
      nudges[r.key] = Date.now(); store(NUDGE_KEY, nudges);
      logSay('vizier', `To the Chief: ${r.name} has done ${alone} tasks alone this week. If you'd like, I'll find them a helper: add "find ${r.name} a helper" to your to-do list.`); renderLog();
      toast(`Vizier: ${r.name} has done ${alone} tasks alone this week. Want a helper for them? Add "find ${r.name} a helper" to your to-do list (K).`, 'vizier');
      return;
    }
  }
  setInterval(hireNudge, 60000);

  // ---------- the meeting chat (guide step 38) ----------
  // During a council meeting a chat box sits on the left: everyone at the table down the side, with their
  // faces and names. It starts on "Everyone", to talk to the whole room, or click one person to talk to just
  // them. Drag the corner to resize it; A− and A+ make the faces and names smaller or bigger.
  const MSIZE_KEY = 'kingdom-one-meeting-size';
  let mSize = (() => { try { return Number(localStorage.getItem(MSIZE_KEY)) || 36; } catch (e) { return 36; } })();
  const mBox = mk('div', { ...panelStyle, left: '16px', top: '130px', width: '380px', height: 'min(460px, calc(100vh - 200px))', resize: 'both', minWidth: '260px', minHeight: '220px', maxWidth: 'calc(100vw - 32px)' });
  mBox.className = 'hud';
  const mHead = mk('div', { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px', borderBottom: '1px solid rgba(232,196,106,.25)' });
  const mTitle = mk('div', { flex: '1', fontWeight: '650', color: '#e8c46a' }, 'Council meeting');
  const sizeBtn = (label, d) => { const b = mk('button', { background: 'rgba(255,255,255,.06)', border: '1px solid rgba(232,196,106,.25)', color: '#f5efe2', borderRadius: '6px', cursor: 'pointer', padding: '2px 7px', font: '600 12px system-ui' }, label); b.title = d > 0 ? 'Bigger faces and names' : 'Smaller faces and names'; b.onclick = () => { mSize = clamp(mSize + d, 24, 72); try { localStorage.setItem(MSIZE_KEY, mSize); } catch (e) { /* fine */ } renderMeeting(); }; return b; };
  mHead.append(mTitle, sizeBtn('A−', -8), sizeBtn('A+', 8));
  const mMain = mk('div', { flex: '1', display: 'flex', minHeight: '0' });
  const mList = mk('div', { overflowY: 'auto', borderRight: '1px solid rgba(232,196,106,.2)', padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px' });
  const mRight = mk('div', { flex: '1', display: 'flex', flexDirection: 'column', minWidth: '0' });
  const mNote = mk('div', { fontSize: '11.5px', color: '#e8c46a', padding: '5px 10px', background: 'rgba(232,196,106,.08)' });
  const mMsgs = mk('div', { flex: '1', overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '8px' });
  const mForm = mk('div', { display: 'flex', gap: '6px', padding: '8px', borderTop: '1px solid rgba(232,196,106,.25)' });
  const mInput = mk('input', { flex: '1', minWidth: '0', borderRadius: '8px', border: '1px solid #4b5a5c', background: '#12151c', color: '#f5efe2', padding: '7px 9px', font: '13px system-ui' });
  const mSend = mk('button', { background: '#2b8a8a', color: '#fff', border: '0', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', font: '600 13px system-ui' }, 'Send');
  mForm.append(mInput, mSend); mRight.append(mNote, mMsgs, mForm); mMain.append(mList, mRight); mBox.append(mHead, mMain);
  document.body.appendChild(mBox);
  let mTarget = 'everyone';
  const attendees = () => ['vizier', ...RES.map((r) => r.key)];
  function renderMeeting() {
    mList.replaceChildren();
    for (const key of ['everyone', ...attendees()]) {
      const row = mk('button', { display: 'flex', alignItems: 'center', gap: '8px', background: key === mTarget ? 'rgba(43,138,138,.45)' : 'transparent', border: '0', borderRadius: '8px', padding: '4px 6px', cursor: 'pointer', color: '#f5efe2', textAlign: 'left', font: `${Math.round(mSize * 0.36)}px system-ui` });
      if (key === 'everyone') row.append(mk('div', { width: mSize + 'px', height: mSize + 'px', borderRadius: '50%', background: '#2b8a8a', display: 'grid', placeItems: 'center', fontSize: Math.round(mSize * 0.42) + 'px', flex: 'none' }, '★'));
      else { const img = faceImg(key, mSize); if (img) row.append(img); }
      row.append(mk('span', { whiteSpace: 'nowrap' }, key === 'everyone' ? 'Everyone' : nameOf(key)));
      row.onclick = () => { mTarget = key; renderMeeting(); mInput.focus(); };
      mList.append(row);
    }
    mTitle.textContent = mTarget === 'everyone' ? 'Council meeting · everyone' : `Council meeting · ${nameOf(mTarget)}`;
    mNote.textContent = brainLabel();
    mInput.placeholder = mTarget === 'everyone' ? 'Talk to the whole room' : `Talk to ${nameOf(mTarget)} only`;
    mMsgs.replaceChildren();
    (chats[mTarget === 'everyone' ? 'everyone' : mTarget] || []).forEach((m) => bubble(mMsgs, m.from, m.text, m.from === 'you'));
  }
  function openMeetingChat() { mTarget = 'everyone'; renderMeeting(); mBox.style.display = 'flex'; closeLog(); }
  function closeMeetingChat() { mBox.style.display = 'none'; mInput.blur(); }
  function everyoneReplies(text) {  // the room answers: Vizier takes anything to be done, and the owner speaks up
    if (GREETING.test(text) && text.length < 40) return [['vizier', 'Good to have everyone here, Chief.'], ...['keeper', 'librarian', 'merchant'].map((k) => [k, PERSONA[k].lines[0].replace(/^[^:]+: /, '')])];
    const r = placeOrder(text), out = [['vizier', r.reply.replace(/^Vizier: /, '')]];
    if (r.to !== 'vizier' && r.to !== 'hire') {
      const a = agentOf(r.to), d = a.boss ? bossOf(a) : a;
      out.push([d.key, a.boss ? `That's for my team. ${a.name} will take it, and I'll check it. (Nothing happens until AI is switched on.)` : "That's mine. Noted. (Nothing happens until AI is switched on.)"]);
    }
    return out;
  }
  async function sendMeeting() {
    const text = mInput.value.trim(); if (!text) return;
    mInput.value = '';
    const room = mTarget === 'everyone' ? 'everyone' : mTarget;
    say(room, 'you', text); bubble(mMsgs, 'you', text, true);
    let replies;
    const live = async (who, hist, opts) => { const w = thinking(mMsgs, who); try { return await window.kingdomBrain(who, hist, opts); } catch (e) { return `(The helper couldn't answer: ${e.message})`; } finally { w.remove(); } };
    if (room === 'everyone') {
      const routed = brainOn() && isOrder(text) ? routeAndLog(text) : null;
      replies = brainOn() ? [['vizier', await live('vizier', chats.everyone, { room: 'everyone', hint: routed ? routed.hint : '' })]] : everyoneReplies(text);
      if (routed) addTodo(text, { to: routed.r.to, from: 'Vizier, at the meeting', logged: true });
    } else {
      const cmd = commandReply(room, text);
      replies = [[room, cmd || (brainOn() ? await live(room, chats[room], {}) : scriptedReply(room, text))]];
      if (!cmd && brainOn()) taskFromChat(room, text, replies[0][1]);
    }
    for (const [who, line] of replies) { say(room, who, line); if ((mTarget === 'everyone' ? 'everyone' : mTarget) === room) bubble(mMsgs, who, line, false); }
  }
  mSend.onclick = sendMeeting;
  mInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); sendMeeting(); } if (e.key === 'Escape') mInput.blur(); });

  // ---------- hover cards (guide step 35) ----------
  // Hover over anyone for a small card: their face, name, one sentence on what they do, and who they report to.
  // Directors report to Vizier, workers to their director, Vizier to you.
  const hoverCard = document.createElement('div');
  hoverCard.className = 'hud';
  Object.assign(hoverCard.style, { display: 'none', background: 'rgba(18,20,28,.94)', border: '1px solid rgba(232,196,106,.45)', borderRadius: '12px',
    padding: '8px 12px', font: '13px system-ui', color: '#f5efe2', maxWidth: '280px', gap: '10px', alignItems: 'flex-start', zIndex: '20' });
  document.body.appendChild(hoverCard);
  let hoverKey = null;
  const ACCESS_NOTE = { keeper: 'Can read your inbox and calendar (read only), when the AI helper is running.' };  // guide step 40
  function cardFor(key) {
    if (isCand(key)) return { name: candidate.name, role: 'Candidate · ' + candidate.role, what: candidate.job || 'Hoping to join the team.', boss: `Would work for ${candidate.bossName}. Waiting in the town hall for your interview: press T to talk.` };
    if (key === 'vizier') return { name: 'Vizier', role: 'Chief of Staff', what: 'Takes your orders and passes each one to the director who owns it, then follows up.', boss: 'Reports to you, the Chief Human Officer.' };
    const r = RES.find((x) => x.key === key), d = directors().find((x) => x.key === key);
    const boss = r.boss ? `Reports to ${bossOf(r).name}, their director.` : 'Reports to Vizier, your chief of staff.';
    const now = (d && d.working ? ' Working at their desk.' : '') + (ACCESS_NOTE[key] ? ' ' + ACCESS_NOTE[key] : '');
    return { name: r.name, role: (r.boss ? 'Worker · ' : 'Director · ') + r.role, what: r.job.split(/(?<=\.)\s/)[0] + now, boss };
  }
  function showHover(key, cx, cy) {
    if (key !== hoverKey) {
      const c = cardFor(key), img = faceImg(key, 44), txt = document.createElement('div');
      const nm = document.createElement('div'); nm.textContent = c.name; Object.assign(nm.style, { fontWeight: '650', fontSize: '14px' });
      const rl = document.createElement('div'); rl.textContent = c.role; Object.assign(rl.style, { color: '#e8c46a', fontSize: '11.5px' });
      const wh = document.createElement('div'); wh.textContent = c.what; Object.assign(wh.style, { marginTop: '3px' });
      const bs = document.createElement('div'); bs.textContent = c.boss; Object.assign(bs.style, { marginTop: '3px', color: '#c9c1ae', fontSize: '12px' });
      txt.append(nm, rl, wh, bs);
      hoverCard.replaceChildren(...(img ? [img, txt] : [txt]));
      hoverKey = key;
    }
    hoverCard.style.display = 'flex';
    const w = hoverCard.offsetWidth, h = hoverCard.offsetHeight;
    hoverCard.style.left = Math.min(innerWidth - w - 8, cx + 16) + 'px';
    hoverCard.style.top = Math.max(8, Math.min(innerHeight - h - 8, cy - h - 12)) + 'px';
  }
  function hideHover() { hoverCard.style.display = 'none'; hoverKey = null; }
  function personAt(wx, wy) {  // whoever's drawn under the pointer, front-most first
    const sid = state.scene.id, hit = (n) => Math.abs(wx - n.x) < 13 && wy > n.y - 46 && wy < n.y + 3;
    const list = directors().filter((d) => d.scene === sid).map((d) => [d.key, d]);
    if (vizier.scene === sid) list.push(['vizier', vizier]);
    return (list.filter(([, n]) => hit(n)).sort((a, b) => b[1].y - a[1].y)[0] || [null])[0];
  }
  canvas.addEventListener('pointermove', (e) => {
    if (state.drag || state.fade) { hideHover(); return; }
    const [wx, wy] = toWorld(e), key = personAt(wx, wy);
    if (key) showHover(key, e.clientX, e.clientY); else hideHover();
  });
  canvas.addEventListener('pointerleave', hideHover);

  function toWorld(e) {
    const cam = camera(state.scene), r = canvas.getBoundingClientRect();
    return [cam.x + ((e.clientX - r.left) * dpr) / cam.k, cam.y + ((e.clientY - r.top) * dpr) / cam.k];
  }
  const onPlayer = (wx, wy) => { const p = state.player; return Math.abs(wx - p.x) < 14 && wy > p.y - 44 && wy < p.y + 4; };
  canvas.addEventListener('pointerdown', (e) => {
    if (state.fade || e.button !== 0 || state.meeting) return;
    const [wx, wy] = toWorld(e);
    if (!onPlayer(wx, wy)) return;
    const p = state.player;
    state.drag = { ox: p.x - wx, oy: p.y - wy, from: [p.x, p.y] };
    p.moving = false; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    const [wx, wy] = toWorld(e);
    if (state.drag) {
      const s = state.scene, p = state.player;
      p.x = clamp(wx + state.drag.ox, 8, s.w * T - 8); p.y = clamp(wy + state.drag.oy, 12, s.h * T - 4);
      return;
    }
    canvas.style.cursor = onPlayer(wx, wy) ? 'grab' : personAt(wx, wy) ? 'help' : '';
  });
  const drop = () => {
    if (!state.drag) return;
    const s = state.scene, p = state.player, spot = landNear(s, p.x, p.y) || state.drag.from;
    p.x = spot[0]; p.y = spot[1]; p.dir = 'down';
    state.drag = null; canvas.style.cursor = '';
  };
  canvas.addEventListener('pointerup', drop);
  canvas.addEventListener('pointercancel', drop);

  function hits(s, x, y) {
    const l = Math.floor((x - 7) / T), r = Math.floor((x + 7) / T), tp = Math.floor((y - 8) / T), b = Math.floor((y - 1) / T);
    for (let ty = tp; ty <= b; ty++) for (let tx = l; tx <= r; tx++) {
      if (!inside(s, tx, ty) || s.solid[ty * s.w + tx]) return true;
    }
    return false;
  }
  function move(mx, my) {
    const s = state.scene, p = state.player;
    if (mx) { if (!hits(s, p.x + mx, p.y)) p.x += mx; else if (!my) nudge('y', mx); }
    if (my) { if (!hits(s, p.x, p.y + my)) p.y += my; else if (!mx) nudge('x', my); }
  }
  // slide around corners so doorways are easy to hit
  function nudge(axis, step) {
    const s = state.scene, p = state.player, amt = Math.abs(step);
    for (let off = 1; off <= 12; off++) for (const sg of [-1, 1]) {
      if (axis === 'x') {
        if (!hits(s, p.x + sg * off, p.y + step) && !hits(s, p.x + sg * Math.min(off, amt), p.y)) { p.x += sg * Math.min(off, amt); return; }
      } else if (!hits(s, p.x + step, p.y + sg * off) && !hits(s, p.x, p.y + sg * Math.min(off, amt))) { p.y += sg * Math.min(off, amt); return; }
    }
  }
  const doorAt = (s, tx, ty) => s.doors.find(d => d.x === tx && d.y === ty) || null;
  function feetTile(p) { return [Math.floor(p.x / T), Math.floor((p.y - 4) / T)]; }

  function useDoor(d) {
    if (state.fade || !d.spawn) return;
    state.fade = { t: 0, phase: 'out', cb: () => {
      state.scene = scenes[d.to];
      Object.assign(state.player, { x: d.spawn.x, y: d.spawn.y, dir: d.spawn.dir, moving: false });
      placeVizierBehind();  // Vizier comes through the door with you
      updatePlace();
    } };
  }
  function facing() {
    const p = state.player, [dx, dy] = DIRV[p.dir];
    return [Math.floor((p.x + dx * 22) / T), Math.floor((p.y - 6 + dy * 22) / T)];
  }
  function interact() {
    if (state.fade) return;
    if (nearVizier()) { openChat('vizier'); return; }
    const dn = directorNear();
    if (dn) { greet(dn); return; }
    const s = state.scene, p = state.player, [fx, fy] = facing(), [tx, ty] = feetTile(p);
    const d = doorAt(s, fx, fy) || doorAt(s, tx, ty);
    if (d) { useDoor(d); return; }
    const o = s.objAt.get(fy * s.w + fx);
    if (o && o.msg) toast(o.msg);
  }
  // face pictures (guide step 30): 'you', or any cast key; null until the 3D cast has been drawn
  const faceOf = (key) => (key === 'you' ? window.__mePortrait : window.__castPortraits && window.__castPortraits[key]) || null;
  const faceImg = (key, px) => {
    const c = faceOf(key); if (!c) return null;
    const img = new Image(); img.src = c.toDataURL(); img.alt = '';
    Object.assign(img.style, { width: px + 'px', height: px + 'px', flex: 'none' });
    return img;
  };
  function toast(msg, face) {  // face: who is talking, shown beside the line
    const img = face ? faceImg(face, 44) : null, span = document.createElement('span');
    span.textContent = relabel(msg);
    ui.toast.replaceChildren(...(img ? [img, span] : [span]));
    Object.assign(ui.toast.style, img ? { display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left' } : { display: '', textAlign: '' });
    ui.toast.classList.add('on');
    state.toastUntil = state.time + 3.2;
  }
  function updatePlace() {
    const s = state.scene;
    if (state.meeting) ui.place.innerHTML = `Council meeting<small>Town Hall · ${HALL_SEATS.length} at the table · C or a walk key ends it</small>`;
    else if (s.id === 'town') ui.place.innerHTML = `Kingdom One<small>The medina · Vizier, ${RES.filter((r) => !r.boss).length} directors and ${RES.filter((r) => r.boss).length} workers live and work here</small>`;
    else if (s.id === 'hall-in') ui.place.innerHTML = 'Town Hall<small>Vizier, Chief of Staff · lives here</small>';
    else {
      const b = s.building, r = RES.find((x) => x.key === b.key), boss = r && bossOf(r);
      ui.place.innerHTML = boss  // guide step 49: names and roles are escaped (a hire's role comes from an agent's words)
        ? `${esc(s.name)}<small>Workshop · ${esc(b.name)}, ${esc(b.role)} · works for ${esc(boss.name)}</small>`
        : `${esc(s.name)}<small>${esc(b.name)}, ${esc(b.role)} · director · lives here</small>`;
    }
    ui.place.innerHTML = relabel(ui.place.innerHTML);  // your world's and agents' names
  }
  let lastHint = '';
  function updateHint() {
    const s = state.scene, p = state.player;
    let text = '';
    if (!state.fade) {
      const [fx, fy] = facing();
      let near = null, best = 1e9;
      for (const d of s.doors) {
        const dist = Math.hypot((d.x + 0.5) * T - p.x, (d.y + 0.5) * T - p.y);
        if (dist < best) { best = dist; near = d; }
      }
      const dn = directorNear();
      if (nearVizier()) text = '<b>Vizier, Chief of Staff</b> · press T to talk or give an order';
      else if (dn) text = `<b>${esc(dn.name)}</b> · E to say hello · T to talk`;
      else if (near && best < 46) text = `<b>${esc(near.label)}</b> · walk through the door or press E`;
      else {
        const o = s.objAt.get(fy * s.w + fx);
        if (o && o.msg) text = 'Press <b>E</b> to look';
      }
    }
    if (text !== lastHint) { lastHint = text; ui.hint.innerHTML = relabel(text); ui.hint.classList.toggle('on', !!text); }
  }

  function update(dt) {
    state.time += dt;
    const p = state.player;
    if (state.fade) {
      const f = state.fade; f.t += dt / 0.22;
      if (f.t >= 1) { if (f.phase === 'out') { f.cb(); f.phase = 'in'; f.t = 0; } else state.fade = null; }
    }
    let dx = 0, dy = 0;
    if (!state.fade && !ui.help.classList.contains('on')) {
      if (keys.has('up')) dy -= 1; if (keys.has('down')) dy += 1;
      if (keys.has('left')) dx -= 1; if (keys.has('right')) dx += 1;
    }
    if ((dx || dy) && state.meeting && !state.fade) endMeeting();
    else if ((dx || dy) && !state.drag && !p.seated) {
      const len = Math.hypot(dx, dy), run = keys.has('run'), sp = SPEED * (run ? RUN : 1);
      p.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      const bx = p.x, by = p.y;
      move((dx / len) * sp * dt, (dy / len) * sp * dt);
      const went = Math.hypot(p.x - bx, p.y - by);  // against a wall you don't walk on the spot
      p.moving = went > 0.05; p.anim += went;
      const [tx, ty] = feetTile(p), d = doorAt(state.scene, tx, ty);
      if (d) useDoor(d);
    } else p.moving = false;
    updateVizier(dt);
    updateDirectors(dt);
    if (callUntil && state.time > callUntil) { callCard.style.display = 'none'; callUntil = 0; }
    if (state.toastUntil && state.time > state.toastUntil) { ui.toast.classList.remove('on'); state.toastUntil = 0; }
    updateHint();
  }

  // ---------- drawing ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    zoom = clamp(innerHeight / (13 * T), 1.25, 3);
  }
  addEventListener('resize', resize);
  resize();

  // Zoom (guide step 23): the mouse wheel or + and - zoom in and out, 0 resets. Indoors the base view
  // fits the whole room's height; outdoors it's set by the window height.
  const ZOOM_MIN = 0.6, ZOOM_MAX = 3;
  let userZoom = 1;
  const baseZoom = (s) => (s.outdoor ? zoom : clamp(innerHeight / ((s.h + 0.3) * T), 0.8, zoom));
  const sceneZoom = (s) => baseZoom(s) * userZoom;
  function setZoom(z) {
    const nz = clamp(z, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(nz - userZoom) < 1e-4) return;
    userZoom = nz;
    toast(`Zoom ${Math.round(userZoom * 100)}% · mouse wheel or + and - to zoom, 0 to reset`);
  }
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(userZoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  addEventListener('keydown', (e) => {
    if (isTyping()) return;
    if (e.key === '+' || e.key === '=') setZoom(userZoom * 1.15);
    else if (e.key === '-' || e.key === '_') setZoom(userZoom / 1.15);
    else if (e.key === '0') setZoom(1);
  });

  // Crisp ground (guide step 23): instead of one big picture, the floor, walls and paving are drawn in
  // 8x8-tile pieces, each at the screen's real pixel density for the current zoom, and only the pieces on
  // screen are kept. Each piece is drawn with a one-tile margin (every tile still sees its neighbours
  // across the edge), and pieces overlap by half a screen pixel, so there are no seams where they meet.
  const CHUNK = 8, MAX_CHUNKS = 40;
  const chunkCS = (s) => clamp(Math.ceil(dpr * sceneZoom(s) * 2) / 2, 1, 8);
  const chunkCache = new Map();  // key "scene:cx:cy:cs" -> canvas, oldest first
  function chunk(s, cx, cy, cs) {
    const key = `${s.id}:${cx}:${cy}:${cs}`;
    let c = chunkCache.get(key);
    if (c) { chunkCache.delete(key); chunkCache.set(key, c); return c; }  // most recently used goes last
    const size = (CHUNK + 2) * T;
    c = document.createElement('canvas'); c.width = Math.ceil(size * cs); c.height = Math.ceil(size * cs);
    const g = c.getContext('2d');
    g.scale(cs, cs); g.translate(-(cx * CHUNK - 1) * T, -(cy * CHUNK - 1) * T);
    for (let y = cy * CHUNK - 1; y <= cy * CHUNK + CHUNK; y++) for (let x = cx * CHUNK - 1; x <= cx * CHUNK + CHUNK; x++) {
      if (inside(s, x, y)) drawTile(g, s, x, y);
    }
    for (const d of s.wallDecor) d.draw(g);
    chunkCache.set(key, c);
    while (chunkCache.size > MAX_CHUNKS) chunkCache.delete(chunkCache.keys().next().value);
    return c;
  }
  function drawGround(s, cam) {
    const cs = chunkCS(s), e = 0.5 / cam.k;  // half a screen pixel of overlap
    const x0 = Math.max(0, Math.floor(cam.x / T / CHUNK)), x1 = Math.min(Math.ceil(s.w / CHUNK) - 1, Math.floor((cam.x + cam.w) / T / CHUNK));
    const y0 = Math.max(0, Math.floor(cam.y / T / CHUNK)), y1 = Math.min(Math.ceil(s.h / CHUNK) - 1, Math.floor((cam.y + cam.h) / T / CHUNK));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = chunk(s, cx, cy, cs), wx = cx * CHUNK * T, wy = cy * CHUNK * T, w = Math.min(CHUNK, s.w - cx * CHUNK) * T, h = Math.min(CHUNK, s.h - cy * CHUNK) * T;
      ctx.drawImage(c, (T - e) * cs, (T - e) * cs, (w + 2 * e) * cs, (h + 2 * e) * cs, wx - e, wy - e, w + 2 * e, h + 2 * e);
    }
  }

  // ---------- day and night (guide step 17 skipped: the village has night, lit by street lamps) ----------
  // 0 is full day, 1 is full night. Dawn runs 5:30-7:00 and dusk 18:00-19:30 on this computer's clock.
  function nightLevel() {
    if (state.forceNight != null) return state.forceNight;
    if (state.timeMode === 'day') return 0;
    if (state.timeMode === 'night') return 1;
    const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    if (h < 5.5 || h >= 19.5) return 1;
    if (h < 7) return 1 - (h - 5.5) / 1.5;
    if (h < 18) return 0;
    return (h - 18) / 1.5;
  }
  // a few leaves and petals blowing across, now and then
  function drawLeaves(cam, t) {
    for (let i = 0; i < 7; i++) {
      const period = 9 + hash(i, 1, 1) * 8, ph = ((t + hash(i, 2, 2) * period) % period) / period;
      if (ph > 0.55) continue;  // each one blows by, then there's a quiet gap
      const f = ph / 0.55;
      const x = cam.x - 40 + f * (cam.w + 80);
      const y = cam.y + cam.h * (0.15 + hash(i, 3, 3) * 0.7) + Math.sin(f * 9 + i) * 14 + f * 30;
      const a = t * (2 + hash(i, 4, 4) * 2) + i;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(1, 0.5 + 0.5 * Math.abs(Math.sin(a * 0.7)));
      ctx.fillStyle = i % 3 === 0 ? '#e05a9c' : (i % 2 ? '#88a466' : '#c9a24a');
      ctx.beginPath(); ctx.ellipse(0, 0, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  const nightLayer = document.createElement('canvas'), nl = nightLayer.getContext('2d');
  function drawNight(s, cam, t) {
    const n = nightLevel();
    if (n <= 0.01) return;
    const k = cam.k, W = canvas.width, H = canvas.height;
    if (nightLayer.width !== W || nightLayer.height !== H) { nightLayer.width = W; nightLayer.height = H; }
    const strength = s.outdoor ? 0.74 : 0.38, warm = Math.sin(Math.PI * n);  // warm is strongest mid-dusk / mid-dawn
    // a warm wash at dusk and dawn
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (warm > 0.05 && n < 0.99) { ctx.fillStyle = `rgba(255,150,70,${0.16 * warm})`; ctx.fillRect(0, 0, W, H); }
    // the dark, deep teal-blue, with holes cut where the lights are
    nl.setTransform(1, 0, 0, 1, 0, 0); nl.globalCompositeOperation = 'source-over'; nl.clearRect(0, 0, W, H);
    nl.fillStyle = `rgba(8,30,64,${strength * n})`; nl.fillRect(0, 0, W, H);
    nl.globalCompositeOperation = 'destination-out';
    nl.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
    const vis = [];
    for (const l of s.lights) {
      const r = l.r * (1 + Math.sin(t * 3 + l.x * 0.13) * 0.025);
      if (l.x + r < cam.x || l.x - r > cam.x + cam.w || l.y + r < cam.y || l.y - r > cam.y + cam.h) continue;
      vis.push([l, r]);
      const g = nl.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.82)'); g.addColorStop(0.45, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      nl.fillStyle = g; nl.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    ctx.drawImage(nightLayer, 0, 0);
    // warm lamplight on top
    ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
    ctx.globalCompositeOperation = 'multiply';  // tint the lit ground warm amber instead of washing it white
    for (const [l, r] of vis) {
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r * 0.85);
      g.addColorStop(0, `rgba(255,178,96,${0.55 * n})`); g.addColorStop(1, 'rgba(255,178,96,0)');
      ctx.fillStyle = g; ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const [l, r] of vis) {
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r * 0.4);
      g.addColorStop(0, `rgba(255,170,80,${0.12 * n})`); g.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = g; ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function camera(s) {
    const z = sceneZoom(s);
    const vw = canvas.width / (dpr * z), vh = canvas.height / (dpr * z), ww = s.w * T, wh = s.h * T, p = state.player;
    const cx = ww <= vw ? -(vw - ww) / 2 : clamp(p.x - vw / 2, 0, ww - vw);
    const cy = wh <= vh ? -(vh - wh) / 2 : clamp(p.y - 16 - vh / 2, 0, wh - vh);
    const k = dpr * z;
    return { x: Math.round(cx * k) / k, y: Math.round(cy * k) / k, w: vw, h: vh, k };
  }

  function draw(t) {
    const s = state.scene, cam = camera(s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = s.outdoor ? '#d8b98c' : '#141a1b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(cam.k, 0, 0, cam.k, -cam.x * cam.k, -cam.y * cam.k);
    const sx = Math.max(0, cam.x), sy = Math.max(0, cam.y);
    const sw = Math.min(s.w * T, cam.x + cam.w) - sx, sh = Math.min(s.h * T, cam.y + cam.h) - sy;
    ctx.imageSmoothingEnabled = true;
    if (sw > 0 && sh > 0) drawGround(s, cam);

    // shimmer on the pool
    for (const i of s.water) {
      const x = i % s.w, y = (i / s.w) | 0, px = x * T, py = y * T;
      if (px + T < cam.x || px > cam.x + cam.w || py + T < cam.y || py > cam.y + cam.h) continue;
      const a = (Math.sin(t * 1.8 + hash(x, y, 5) * 6.28) + 1) / 2;
      ctx.fillStyle = `rgba(255,255,255,${0.08 + 0.22 * a})`;
      ctx.fillRect(px + 8 + hash(x, y, 6) * 10 + Math.sin(t + x) * 2, py + 10 + hash(x, y, 7) * 12, 9, 2);
      if (hash(x, y, 8) < 0.08) {  // slow rings spreading where a fish or a drip breaks the surface
        const ph = (t * 0.25 + hash(x, y, 9)) % 1;
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - ph)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(px + 16, py + 16, 2 + ph * 14, (2 + ph * 14) * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }

    const vis = (o) => o.bx < cam.x + cam.w && o.bx + o.bw > cam.x && o.by < cam.y + cam.h && o.by + o.bh > cam.y;
    const list = [];
    for (const o of s.objects) {
      if (!vis(o)) continue;
      if (o.floor) o.draw(ctx, t); else list.push(o);
    }
    const sortOf = (n) => (n.seated ? n.seated.sortY : n.y);  // seated people sort with their chair, before the table
    list.push({ sortY: sortOf(state.player), draw: () => drawPlayer(ctx, state.player) });
    if (vizier.scene === s.id) list.push({ sortY: sortOf(vizier), draw: () => drawVizier(ctx) });
    for (const d of directors()) if (d.scene === s.id) list.push({ sortY: sortOf(d), draw: () => drawNPC(ctx, d, window.__castSheets && window.__castSheets[d.key]) });
    list.sort((a, b) => a.sortY - b.sortY);
    for (const o of list) o.draw(ctx, t);
    if (s.outdoor) drawLeaves(cam, t);
    if (state.walkView) drawWalkable(s, cam); else drawNight(s, cam, t);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (s.outdoor && state.showMap) drawMinimap(cam);
    if (state.fade) {
      const a = state.fade.phase === 'out' ? state.fade.t : 1 - state.fade.t;
      ctx.fillStyle = `rgba(15,42,46,${clamp(a, 0, 1)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ---------- where people can walk (guide step 31): V or ?walk ----------
  // Green: open and reachable, so people can walk there. Red: blocked (walls, water, trees, fences, buildings,
  // furniture). Amber: open but cut off, so nobody can get there. Blue: doors.
  function drawWalkable(s, cam) {
    const x0 = Math.max(0, Math.floor(cam.x / T)), x1 = Math.min(s.w - 1, Math.floor((cam.x + cam.w) / T));
    const y0 = Math.max(0, Math.floor(cam.y / T)), y1 = Math.min(s.h - 1, Math.floor((cam.y + cam.h) / T));
    const reach = reachOf(s);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * s.w + x;
      ctx.fillStyle = doorAt(s, x, y) ? 'rgba(40,110,230,.5)' : s.solid[i] ? 'rgba(220,50,40,.38)' : reach[i] ? 'rgba(40,190,90,.28)' : 'rgba(240,170,20,.5)';
      ctx.fillRect(x * T + 1, y * T + 1, T - 2, T - 2);
    }
  }
  function walkStats(s) {
    const reach = reachOf(s); let open = 0, blocked = 0, cut = 0;
    for (let i = 0; i < s.w * s.h; i++) { if (s.solid[i]) blocked++; else if (reach[i]) open++; else if (!doorAt(s, i % s.w, (i / s.w) | 0)) cut++; }
    return { open, blocked, cut };
  }
  addEventListener('keydown', (e) => {
    if (isTyping() || e.repeat || e.code !== 'KeyV') return;
    state.walkView = !state.walkView;
    if (state.walkView) { const w = walkStats(state.scene); toast(`Where people can walk: green is walkable (${w.open} tiles), red is blocked (${w.blocked}), amber is open but cut off (${w.cut}), blue is a door. V hides it.`); }
  });
  if (new URLSearchParams(location.search).has('walk')) state.walkView = true;

  // ---------- minimap ----------
  function buildMinimap(s) {
    const S = 3, c = document.createElement('canvas');
    c.width = s.w * S; c.height = s.h * S;
    const g = c.getContext('2d');
    const col = { [SANDT]: '#e9cfa3', [GRASS]: '#9bb862', [PATH]: TERRA, [STONE]: '#f3e6cf', [ZELLIGE]: LAGOON, [WATER]: '#3aa0a0', [BED]: '#c2367a', [WALL]: '#c99a62', [HEDGE]: '#2f5f3a', [VEG]: '#8a5a3c' };
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { g.fillStyle = col[tileAt(s, x, y)] || '#e9cfa3'; g.fillRect(x * S, y * S, S, S); }
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      if (s.solid[y * s.w + x] && OPEN_GROUND.has(tileAt(s, x, y)) && !s.objAt.has(y * s.w + x)) { g.fillStyle = PALM; g.fillRect(x * S, y * S, S, S); }
    }
    for (const b of s.houses) { g.fillStyle = b.wall; g.fillRect(b.x * S, b.y * S, b.w * S, b.h * S); g.fillStyle = b.accent; g.fillRect(b.x * S, (b.y + b.h) * S - 3, b.w * S, 3); }
    g.fillStyle = '#3f7d5a'; g.fillRect(s.hall.x * S, s.hall.y * S, s.hall.w * S, s.hall.h * S);
    g.fillStyle = BRASS; g.fillRect(s.hall.x * S + 2, (s.hall.y + s.hall.h) * S - 3, s.hall.w * S - 4, 2);
    g.fillStyle = '#3aa0a0'; g.beginPath(); g.arc(40 * S, 29 * S, 2 * S - 1, 0, Math.PI * 2); g.fill();
    return c;
  }
  function drawMinimap(cam) {
    const S = 3, mw = minimap.width, mh = minimap.height;
    if (innerWidth < 520) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = innerWidth - mw - 16, y = 16;
    rbox(ctx, x - 6, y - 6, mw + 12, mh + 12, 10, 'rgba(15,42,46,.86)');
    ctx.drawImage(minimap, x, y);
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + (cam.x / T) * S, y + (cam.y / T) * S, (cam.w / T) * S, (cam.h / T) * S);
    ctx.fillStyle = TERRA;
    circle(ctx, x + (state.player.x / T) * S, y + (state.player.y / T) * S, 3);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------- go ----------
  updatePlace();
  toast('Welcome to Kingdom One. Vizier, your chief of staff, has moved into the town hall and walks with you: press T beside anyone to talk, or double-tap M to reach Vizier from anywhere. Press H for help.');
  if (DEBUG) {
    window.__v = {
      state, scenes,
      go(id, tx, ty, dir = 'down') { state.scene = scenes[id]; Object.assign(state.player, { x: (tx + 0.5) * T, y: (ty + 0.8) * T, dir }); placeVizierBehind(); updatePlace(); },
      vizier, orders: () => orders, routeOrder, update: (dt) => update(dt), draw: () => draw(performance.now() / 1000), directors, canLand: (id, x, y) => canLand(scenes[id], x, y), callMeeting, endMeeting, seats: HALL_SEATS, summon, backToWork, commandReply, setWorking, notes: () => villageNotes, chat: (a, b) => { const f = (k) => directors().find((d) => d.key === k); startChat(f(a), f(b)); }, findPath: (id, a, b) => findPath(scenes[id], a, b), walkStats: (id) => walkStats(scenes[id]), sendOrder: (text) => { orderText.value = text; sendOrder(); }, callCard: () => callCard, openChat, todos: () => todos, candidate: () => candidate, hireCandidate, declineCandidate,
    };
  }
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt); draw(now / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
