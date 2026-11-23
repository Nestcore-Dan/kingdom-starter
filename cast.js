// Kingdom One: the cast (guide step 21). Every agent is built from the same character builder as the
// Chief Human Officer, so proportions, walk and sheet grid match; only the person changes. All wear
// traditional Moroccan dress in light colours, their robe a light tint of their house colour.
// The cast is shown on ?cast, and ?model=<key> turns one of them around.
import { buildCharacter, renderSheets, renderPortraits, showTurntable, tint, SHEET } from './me3d.js';

const robeOf = (c) => ({ robe: tint(c, 0.72), braid: c });

export const CAST = [
  { key: 'vizier', name: 'Vizier', role: 'Chief of Staff', home: 'the town hall', color: '#2b8a8a', skin: '#a8714d', hair: 'wavy', hairColor: '#1b1612', beard: 'none', smile: true, kit: 'tube' },
  { key: 'keeper', name: 'Keeper', role: 'Operations Manager', home: "Keeper's house", color: '#1f6f8b', skin: '#e2b48c', hair: 'short', hairColor: '#5a3a22', beard: 'short', beardColor: '#5a3a22', head: 'tarbouch', headColor: '#b5523b', kit: 'satchel' },
  { key: 'librarian', name: 'Librarian', role: 'Knowledge & Learning Manager (the Librarian)', home: "Librarian's archive", color: '#3f7d5a', skin: '#c68b63', head: 'turban', headColor: '#f3e6cf', beard: 'full', beardColor: '#8d8984', brows: '#5a5550', glasses: true, kit: 'scrolls' },
  { key: 'merchant', name: 'Merchant', role: 'Business Manager', home: "Merchant's merchant house", color: '#c98a2b', skin: '#8a5a3c', hair: 'curly', hairColor: '#1b1612', beard: 'moustache', beardColor: '#1b1612', smile: true, kit: 'tassels' },
  { key: 'scholar', name: 'Scholar', role: 'Research & Strategy Analyst', home: "Scholar's observatory", color: '#237777', skin: '#f1cfae', hair: 'bun', hairColor: '#7a4b2a', brows: '#6d3b1f', glasses: true, beard: 'none', kit: 'satchel' },
  { key: 'engineer', name: 'Engineer', role: 'Technology Lead', home: "Engineer's forge", color: '#b5523b', skin: '#6e4630', hair: 'shaved', brows: '#1b1612', beard: 'stubble', kit: 'toolbelt', build: 1.06 },
  { key: 'youtube', name: 'Projectionist', role: 'The media centre: videos, transcripts and highlights', home: 'Projectionist, the video shop', color: '#d9643f', skin: '#e2b48c', hair: 'wavy', hairColor: '#2a1b12', head: 'taqiyah', headColor: '#d9643f', beard: 'none', smile: true, kit: 'reel' },
  { key: 'scout', name: 'Hub scout', role: 'Hugging Face and GitHub watcher', home: "The Hub scout's lookout", color: '#2b8a8a', skin: '#c68b63', head: 'hood', beard: 'short', beardColor: '#2a1b12', kit: 'spyglass', height: 1.03 },
  { key: 'media', name: 'Media sorter', role: 'Photos and media', home: "The Media sorter's darkroom", color: '#a8473a', skin: '#a8714d', hair: 'long', hairColor: '#2a1b12', beard: 'none', kit: 'camera' },
  { key: 'studio', name: 'Studio', role: 'Client software', home: 'The Studio workshop', color: '#1f6f8b', skin: '#8a5a3c', hair: 'short', hairColor: '#1b1612', beard: 'short', beardColor: '#1b1612', glasses: true, kit: 'plans' },
  { key: 'inbox', name: 'Inbox', role: 'Inbox and email', home: 'The Inbox post house', color: '#d9643f', skin: '#f1cfae', hair: 'curly', hairColor: '#a8582a', brows: '#8a4520', head: 'tarbouch', headColor: '#a8473a', beard: 'none', kit: 'letters', build: 0.96 },
  { key: 'money', name: 'Money', role: 'Money and accounts', home: 'The Money counting house', color: '#c98a2b', skin: '#6e4630', head: 'turban', headColor: '#e8b04b', beard: 'full', beardColor: '#1b1612', kit: 'purse' },
  { key: 'garden', name: 'Garden helper', role: 'Household and life admin, for Steward', home: "The garden helper's potting shed", color: '#6f8f3a', skin: '#a8714d', hair: 'short', hairColor: '#2a1b12', beard: 'stubble', kit: 'folder', build: 0.97 },
  { key: 'steward', name: 'Steward', role: 'Personal Assistant', home: "Steward's garden house", color: '#b5523b', skin: '#c68b63', hair: 'long', hairColor: '#3b2a20', beard: 'none', smile: true, kit: 'basket' },
].map((c) => ({ ...robeOf(c.color), ...c }));

// guide step 46: anyone hired at the town hall (agents/hires.json, read by village.js), drawn the same way, in the saffron vest
const HIRE_BOSS = {};
for (const h of (typeof window !== 'undefined' && window.__hires) || []) {
  const c = { key: h.key, name: h.name, role: h.role, home: `${h.bossName || h.boss}'s house`, color: '#c98a2b', skin: '#c68b63', beard: 'none', kit: 'folder', ...(h.look || {}) };
  CAST.push({ ...robeOf(c.color), ...c });
  HIRE_BOSS[h.key] = h.bossName || h.boss;
}

// Who has moved in. Guide step 24: you and your chief of staff. Step 26: the six directors. Step 28: the workers,
// one or more for every director, in their workshops. Nobody acts on orders yet: no AI runs until the user says so.
export const MOVED_IN = new Set(CAST.map((c) => c.key));
CAST.forEach((c) => { c.movedIn = MOVED_IN.has(c.key); });
const VIZIER_PHONE = { ...CAST.find((c) => c.key === 'vizier'), key: 'vizier-phone', phone: true };

// org chart (guide step 25): workers' villas are their workshops; their director gives every task and checks the work
const DIRECTOR_OF = { youtube: 'Librarian', media: 'Librarian', scout: 'Scholar', money: 'Merchant', studio: 'Engineer', inbox: 'Keeper', garden: 'Steward', ...HIRE_BOSS };
// guide step 28: only ten director spots. Anyone added once they are full is a worker, and every worker wears the
// saffron bedaia (the village's version of the guide's yellow safety vest), so you can tell them apart at a glance.
export const DIRECTOR_SPOTS = 10;
let directorsSoFar = 0;
CAST.forEach((c) => {
  if (c.key !== 'vizier' && !DIRECTOR_OF[c.key] && ++directorsSoFar > DIRECTOR_SPOTS) DIRECTOR_OF[c.key] = 'Vizier';  // over the cap: a worker
  c.rank = c.key === 'vizier' ? 'chief of staff' : DIRECTOR_OF[c.key] ? `worker for ${DIRECTOR_OF[c.key]}` : 'director';
  c.worker = !!DIRECTOR_OF[c.key];
  if (c.worker) c.vest = true;
});

export const castSpec = (key) => (key === 'vizier-phone' ? VIZIER_PHONE : CAST.find((c) => c.key === key) || null);
export { buildCharacter };

// ---- the cast page: ?cast ----
function showCast() {
  const sheets = renderSheets(CAST), portraits = renderPortraits(CAST);
  const { fw, fh, R } = SHEET;
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position: 'fixed', inset: '0', zIndex: '50', background: '#fbf6ec', overflow: 'auto', font: '14px system-ui', color: '#0f2a2e', padding: '24px 16px' });
  const h = document.createElement('h1');
  h.textContent = 'The cast of Kingdom One';
  Object.assign(h.style, { margin: '0 0 4px', fontSize: '22px', textAlign: 'center' });
  const p = document.createElement('p');
  p.textContent = 'Every agent is built on the Chief Human Officer\'s frame, in light Moroccan dress in their house colour. Workers wear the saffron bedaia. Click someone to turn them around.';
  Object.assign(p.style, { margin: '0 auto 20px', maxWidth: '680px', textAlign: 'center', color: '#4b5a5c' });
  const grid = document.createElement('div');
  Object.assign(grid.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px', maxWidth: '1100px', margin: '0 auto' });
  CAST.forEach((c, i) => {
    const card = document.createElement('a');
    card.href = '?model=' + c.key;
    Object.assign(card.style, { display: 'block', background: '#fff', border: '1px solid #e0cfb1', borderRadius: '12px', padding: '12px', textDecoration: 'none', color: 'inherit', borderTop: `4px solid ${c.color}` });
    const strip = document.createElement('canvas');
    strip.width = 4 * fw * R; strip.height = fh * R;  // standing in each of the four directions
    const g = strip.getContext('2d');
    for (let row = 0; row < 4; row++) g.drawImage(sheets[i], fw * R, row * fh * R, fw * R, fh * R, row * fw * R, 0, fw * R, fh * R);
    Object.assign(strip.style, { width: '100%', height: 'auto', background: '#f3e6cf', borderRadius: '8px' });
    const name = document.createElement('div');
    const face = portraits[i]; Object.assign(face.style, { width: '40px', height: '40px', verticalAlign: 'middle', marginRight: '8px' });
    name.append(face, c.name);
    Object.assign(name.style, { fontWeight: '650', fontSize: '16px', marginTop: '8px', display: 'flex', alignItems: 'center' });
    const role = document.createElement('div');
    role.textContent = `${c.role} · ${c.rank} · ${c.home}${c.rank.startsWith('worker') ? ' (workshop)' : ''} · ${c.movedIn ? (c.worker ? 'works here now' : 'lives here now') : 'not moved in yet'}`;
    Object.assign(role.style, { color: '#4b5a5c', fontSize: '12.5px', marginTop: '2px' });
    card.append(strip, name, role);
    grid.append(card);
  });
  // Vizier's second sheet: holding a phone, for calling people
  const phoneSheet = renderSheets([VIZIER_PHONE])[0];
  const card = document.createElement('a'); card.href = '?model=vizier-phone';
  Object.assign(card.style, { display: 'block', background: '#fff', border: '1px solid #e0cfb1', borderRadius: '12px', padding: '12px', textDecoration: 'none', color: 'inherit', borderTop: '4px solid #2b8a8a' });
  const strip = document.createElement('canvas'); strip.width = 4 * fw * R; strip.height = fh * R;
  const g = strip.getContext('2d');
  for (let row = 0; row < 4; row++) g.drawImage(phoneSheet, fw * R, row * fh * R, fw * R, fh * R, row * fw * R, 0, fw * R, fh * R);
  Object.assign(strip.style, { width: '100%', height: 'auto', background: '#f3e6cf', borderRadius: '8px' });
  const nm = document.createElement('div'); nm.textContent = 'Vizier, on the phone';
  Object.assign(nm.style, { fontWeight: '650', fontSize: '16px', marginTop: '8px' });
  const rl = document.createElement('div'); rl.textContent = "Vizier's second sheet, for passing your orders on by phone";
  Object.assign(rl.style, { color: '#4b5a5c', fontSize: '12.5px', marginTop: '2px' });
  card.append(strip, nm, rl); grid.insertBefore(card, grid.children[1]);
  wrap.append(h, p, grid);
  document.body.appendChild(wrap);
}

if (typeof window !== 'undefined' && document.getElementById('game')) {
  const q = new URLSearchParams(location.search);
  try {
    if (q.has('cast')) showCast();
    const key = q.get('model');
    if (key) { const c = castSpec(key); if (c) showTurntable(c, `${c.name}, ${c.role}. ${c.movedIn ? (c.worker ? 'Works in ' : 'Lives in ') + c.home + '.' : 'Not moved in yet.'}`); }
    // the walking sheets the village needs for whoever has moved in
    const residents = CAST.filter((c) => c.movedIn);
    const sheets = renderSheets([...residents, VIZIER_PHONE]);
    window.__castSheets = {};
    residents.forEach((c, i) => { window.__castSheets[c.key] = { canvas: sheets[i], ...SHEET }; });
    window.__castSheets.vizierPhone = { canvas: sheets[sheets.length - 1], ...SHEET };
    // face pictures for calls and hellos (guide step 30)
    const faces = renderPortraits(CAST);
    window.__castPortraits = {};
    CAST.forEach((c, i) => { window.__castPortraits[c.key] = faces[i]; });
    // guide step 46: draw someone new (a candidate in the town hall) after the page has loaded
    window.__castAdd = (spec) => {
      const c = { ...robeOf(spec.color || '#c98a2b'), ...spec, worker: true, vest: true, movedIn: true };
      window.__castSheets[c.key] = { canvas: renderSheets([c])[0], ...SHEET };
      window.__castPortraits[c.key] = renderPortraits([c])[0];
      return true;
    };
  } catch (err) {
    console.warn('The cast could not be drawn:', err);
  }
}
