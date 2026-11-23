// Kingdom One: the characters, as 3D models built in code (guide steps 19, 20 and 21).
//
// Every character is built by buildCharacter(spec) on the same skeleton, proportions and walk as the first
// one, the Chief Human Officer (guide step 21: new characters are made from the first one's sheet, so the
// whole cast matches). Only the person changes: skin, hair, facial hair, glasses, headwear, the colour of
// their robe and a small touch for their job.
//
// You, the Chief Human Officer, start with a neutral look.
//
// Rule for every character: traditional Moroccan dress in light colours (the user's choice): a djellaba
// or kaftan in a light tint of their house colour, braid trim, babouche slippers.
//
// buildCharacter(spec, THREE), buildMe(THREE) and poseMe(model, step) are reusable in the 3D Kingdom app.
// In the village page this file also renders the Chief Human Officer's 12-frame walking sheet for
// village.js (window.__meSheet). ?sheet shows it, ?model shows a turntable, ?cast shows every character.
import * as THREE from './vendor/three.module.js';

const OUTLINE = '#0f2a2e', BRASS = '#e8b04b', IVORY = '#f3ecdf';
const VEST = '#e9a51c', VEST_TRIM = '#8a4a12';  // the workers' saffron bedaia and its embroidery

/** a light tint of a colour, for robes: mix towards ivory */
export function tint(hex, k = 0.7) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(IVORY.slice(1), 16);
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

// The Chief Human Officer: you. A neutral default look; change it to look like you (see README).
export const ME = {
  key: 'me', name: 'You', title: 'Chief Human Officer',
  skin: '#d9a77f', hair: 'short', hairColor: '#4a3a2e', hairSide: '#4a3a2e',
  beard: 'none', beardColor: '#4a3a2e', beardGrey: false, brows: '#4a3a2e', glasses: false, smile: true,
  head: 'none', robe: IVORY, robeShade: '#e4d8c3', braid: BRASS, jabador: '#e6d6b8', babouche: '#f3d98a',
  kit: 'star', build: 1, height: 1,
};

export function buildCharacter(spec, T = THREE) {
  const S = { ...ME, head: 'none', kit: 'none', beardGrey: false, glasses: false, smile: false, ...spec };
  if (!spec.robeShade) S.robeShade = tint(S.robe === IVORY ? '#c9b48f' : S.robe, 0.35);
  const ramp = new Uint8Array([90, 170, 255]);
  const grad = new T.DataTexture(ramp, 3, 1, T.RedFormat);
  grad.minFilter = grad.magFilter = T.NearestFilter; grad.needsUpdate = true;
  const mat = (c, extra = {}) => new T.MeshToonMaterial({ color: c, gradientMap: grad, ...extra });
  const flat = (c) => new T.MeshBasicMaterial({ color: c });
  const outlineMat = new T.MeshBasicMaterial({ color: OUTLINE, side: T.BackSide });
  const root = new T.Group(); root.name = S.key;

  const add = (parent, geo, material, pos = [0, 0, 0], opts = {}) => {
    const m = new T.Mesh(geo, material);
    m.position.set(...pos);
    if (opts.rot) m.rotation.set(...opts.rot);
    if (opts.scale) m.scale.set(...opts.scale);
    parent.add(m);
    if (opts.outline !== false) {  // inverted-hull outline: the thin deep-teal line of the style guide
      const o = new T.Mesh(geo, outlineMat);
      o.position.copy(m.position); o.rotation.copy(m.rotation); o.scale.copy(m.scale).multiplyScalar(opts.ol || 1.07);
      parent.add(o);
    }
    return m;
  };
  const cap = (r, len, seg = 10) => new T.CapsuleGeometry(r, len, 4, seg);
  const shade = (hex, k) => '#' + [16, 8, 0].map((s) => Math.max(0, Math.min(255, Math.round(((parseInt(hex.slice(1), 16) >> s) & 255) * k)))).map((v) => v.toString(16).padStart(2, '0')).join('');

  // ---- legs (hip pivot > knee pivot): jabador trousers under the robe, babouche slippers peeking out ----
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new T.Group(); hip.position.set(side * 0.1, 0.6, 0); root.add(hip);
    add(hip, cap(0.075, 0.16), mat(S.jabador), [0, -0.15, 0], { outline: false });
    const knee = new T.Group(); knee.position.set(0, -0.3, 0); hip.add(knee);
    add(knee, cap(0.065, 0.14), mat(S.jabador), [0, -0.12, 0], { outline: false });
    add(knee, new T.BoxGeometry(0.12, 0.06, 0.17), mat(S.babouche), [0, -0.27, 0.02], { ol: 1.1 });
    add(knee, new T.ConeGeometry(0.06, 0.1, 8), mat(S.babouche), [0, -0.275, 0.15], { rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.5], outline: false });
    legs.push({ hip, knee, side });
  }

  // ---- body: the djellaba ----
  const body = new T.Group(); body.name = 'body'; root.add(body);
  add(body, cap(0.2, 0.26, 14), mat(S.robe), [0, 0.88, 0], { scale: [1.05, 1, 0.74] });
  const skirt = new T.Group(); skirt.position.set(0, 0.68, 0); body.add(skirt);  // sways as the legs move
  add(skirt, new T.CylinderGeometry(0.205, 0.29, 0.58, 24), mat(S.robe), [0, -0.29, 0], { scale: [1.02, 1, 0.8], ol: 1.04 });
  add(skirt, new T.TorusGeometry(0.288, 0.012, 6, 32), mat(S.braid), [0, -0.565, 0], { rot: [Math.PI / 2, 0, 0], scale: [1.02, 0.8, 1], outline: false });
  const skirtZ = (y) => (0.205 + (0.29 - 0.205) * (-y / 0.58)) * 0.8 + 0.004;  // the robe's front surface at height y
  add(skirt, new T.BoxGeometry(0.03, 0.58, 0.01), mat(S.braid), [0, -0.29, skirtZ(-0.29)], { rot: [-0.115, 0, 0], outline: false });
  for (let k = 0; k < 5; k++) { const y = -0.06 - k * 0.1; add(skirt, new T.SphereGeometry(0.012, 6, 5), mat(S.braid), [0, y, skirtZ(y)], { outline: false }); }
  add(body, new T.BoxGeometry(0.03, 0.4, 0.01), mat(S.braid), [0, 0.9, 0.152], { outline: false });
  add(body, new T.TorusGeometry(0.085, 0.022, 8, 20), mat(S.jabador), [0, 1.12, 0.01], { rot: [Math.PI / 2 - 0.25, 0, 0], outline: false });
  if (S.vest) {  // guide step 28: workers wear a saffron bedaia, a sleeveless Moroccan vest, open at the front with embroidered edges
    const V = S.vest === true ? VEST : S.vest, gap = 0.42, sc = [1.08, 1, 0.8];
    const shell = (r0, r1, h, y, c, ts = gap) => add(body, new T.CylinderGeometry(r0, r1, h, 28, 1, true, ts, 2 * Math.PI - 2 * ts), mat(c, { side: T.DoubleSide }), [0, y, 0], { scale: sc, outline: false });
    shell(0.2, 0.216, 0.34, 0.86, V);                  // the body of the vest
    shell(0.205, 0.2, 0.012, 1.035, VEST_TRIM);        // embroidered top edge
    shell(0.217, 0.218, 0.03, 0.69, VEST_TRIM);        // embroidered hem
    for (const s of [-1, 1]) {                          // embroidered front edges
      const a = gap, r = 0.21;
      add(body, new T.BoxGeometry(0.022, 0.34, 0.012), mat(VEST_TRIM), [s * Math.sin(a) * r * sc[0], 0.86, Math.cos(a) * r * sc[2] + 0.002], { rot: [0, s * a, 0], outline: false });
      for (let k = 0; k < 3; k++) add(body, new T.SphereGeometry(0.011, 6, 5), mat(BRASS), [s * Math.sin(a) * r * sc[0], 0.78 + k * 0.08, Math.cos(a) * r * sc[2] + 0.01], { outline: false });
      // the shoulder straps, over the top of the sleeves
      add(body, new T.BoxGeometry(0.1, 0.03, 0.2), mat(V), [s * 0.17, 1.06, -0.01], { rot: [0, 0, -s * 0.45], outline: false });
    }
  }
  if (S.head !== 'hood' && S.head !== 'scarf') {  // the hood, folded down
    add(body, new T.SphereGeometry(0.17, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(S.robeShade), [0, 1.05, -0.15], { rot: [-1.2, 0, 0], scale: [1.1, 0.5, 0.8], ol: 1.05 });
  }
  add(body, new T.CylinderGeometry(0.07, 0.08, 0.08, 12), mat(S.skin), [0, 1.14, 0], { outline: false });

  // ---- arms: wide sleeves with braided cuffs, hands ----
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = new T.Group(); sh.position.set(side * 0.25, 1.06, 0); body.add(sh);
    add(sh, cap(0.07, 0.09), mat(S.robe), [0, -0.08, 0]);
    const el = new T.Group(); el.position.set(0, -0.17, 0); sh.add(el);
    add(el, new T.CylinderGeometry(0.068, 0.095, 0.17, 14), mat(S.robe), [0, -0.08, 0], { ol: 1.06 });
    add(el, new T.TorusGeometry(0.093, 0.01, 6, 18), mat(S.braid), [0, -0.165, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
    add(el, new T.SphereGeometry(0.052, 12, 10), mat(S.skin), [0, -0.21, 0.01]);
    sh.rotation.z = side * 0.1;
    arms.push({ sh, el, side });
  }

  // ---- head ----
  const head = new T.Group(); head.name = 'head'; head.position.set(0, 1.44, 0); body.add(head);
  add(head, new T.SphereGeometry(0.29, 32, 24), mat(S.skin), [0, 0, 0], { scale: [0.95, 1.04, 0.98] });
  for (const side of [-1, 1]) add(head, new T.SphereGeometry(0.06, 12, 10), mat(S.skin), [side * 0.28, -0.01, -0.02], { scale: [0.5, 1, 0.8] });
  add(head, new T.ConeGeometry(0.045, 0.12, 10), mat(shade(S.skin, 0.86)), [0, -0.02, 0.29], { rot: [Math.PI / 2 + 0.25, 0, 0], outline: false });
  for (const side of [-1, 1]) {
    add(head, new T.SphereGeometry(0.032, 10, 8), flat('#2a1b12'), [side * 0.1, 0.04, 0.262], { outline: false });
    add(head, new T.SphereGeometry(0.009, 6, 6), flat('#fdf8ec'), [side * 0.1 + 0.012, 0.052, 0.29], { outline: false });
    add(head, new T.BoxGeometry(0.11, 0.026, 0.03), mat(S.brows || S.hairColor), [side * 0.1, 0.11, 0.262], { rot: [-0.15, side * -0.25, side * 0.03], outline: false });
  }
  if (S.glasses) {  // round brass-rimmed glasses
    for (const side of [-1, 1]) add(head, new T.TorusGeometry(0.052, 0.008, 6, 20), mat(BRASS), [side * 0.1, 0.04, 0.29], { outline: false });
    add(head, new T.BoxGeometry(0.06, 0.008, 0.008), mat(BRASS), [0, 0.05, 0.3], { outline: false });
  }
  // facial hair
  const beardShell = (thetaStart, sy, color) => add(head, new T.SphereGeometry(0.305, 32, 20, Math.PI / 2 - 1.75, 3.5, Math.PI * thetaStart, Math.PI * (1 - thetaStart)), mat(color, { side: T.DoubleSide }), [0, -0.02, 0], { scale: [0.97, sy, 1.0], ol: 1.04 });
  if (S.beard === 'full') beardShell(0.58, 1.12, S.beardColor);
  if (S.beard === 'short') beardShell(0.64, 1.04, S.beardColor);
  if (S.beard === 'stubble') beardShell(0.68, 0.98, shade(S.skin, 0.86));
  if (S.beardGrey) add(head, new T.SphereGeometry(0.1, 16, 10), mat('#4a4440'), [0, -0.27, 0.19], { scale: [1.0, 0.5, 0.5], outline: false });
  if (S.beard === 'full' || S.beard === 'short' || S.beard === 'moustache') add(head, new T.BoxGeometry(0.17, 0.045, 0.05), mat(S.beardColor), [0, -0.105, 0.28], { outline: false });
  if (S.smile) add(head, new T.BoxGeometry(0.1, 0.022, 0.02), flat('#f4efe6'), [0, -0.15, 0.305], { outline: false });
  else add(head, new T.BoxGeometry(0.08, 0.014, 0.02), flat(shade(S.skin, 0.62)), [0, -0.15, 0.29], { outline: false });

  // hair (hidden under a scarf or hood)
  const hairCap = (theta, rx = -0.32, color = S.hairColor) => add(head, new T.SphereGeometry(0.305, 32, 16, 0, Math.PI * 2, 0, Math.PI * theta), mat(color, { side: T.DoubleSide }), [0, 0.03, -0.02], { scale: [1, 1.05, 1], rot: [rx, 0, 0], ol: 1.04 });
  const hairBack = (toTheta, color) => add(head, new T.SphereGeometry(0.302, 32, 16, Math.PI / 2 + 1.15, 2 * Math.PI - 2.3, Math.PI * 0.25, Math.PI * toTheta), mat(color, { side: T.DoubleSide }), [0, 0, 0], { scale: [0.96, 1.04, 0.99], outline: false });
  const covered = S.head === 'scarf' || S.head === 'hood' || S.head === 'turban';
  if (!covered) {
    if (S.hair === 'textured') {
      hairCap(0.42); hairBack(0.55, S.hairSide || S.hairColor);
      for (const [x, y, z, lean] of [[0, 0.33, 0.12, 0.55], [-0.09, 0.32, 0.08, 0.45], [0.09, 0.32, 0.08, 0.5], [0, 0.34, 0, 0.3], [-0.11, 0.3, -0.06, 0.2], [0.11, 0.3, -0.06, 0.25], [0.04, 0.33, 0.18, 0.7], [-0.05, 0.31, 0.2, 0.75]]) add(head, new T.ConeGeometry(0.075, 0.14, 7), mat(S.hairColor), [x, y, z], { rot: [lean, 0, -x * 1.5], outline: false });
    } else if (S.hair === 'short') {
      hairCap(0.4, -0.12); hairBack(0.5, S.hairColor);
    } else if (S.hair === 'curly') {
      hairCap(0.42, -0.15); hairBack(0.52, S.hairColor);
      for (let k = 0; k < 40; k++) {  // tight curls all over the crown and sides
        const a = k * 2.399, y = 0.05 + (k / 40) * 0.27, r = 0.3;
        const rr = Math.sqrt(Math.max(0, r * r - (y - 0.03) ** 2)) + 0.015;
        if (Math.cos(a) > 0.6 && y < 0.17) continue;  // keep the forehead clear
        add(head, new T.SphereGeometry(0.06, 10, 8), mat(k % 3 ? S.hairColor : shade(S.hairColor, 1.4)), [Math.sin(a) * rr, y, Math.cos(a) * rr - 0.02], { outline: false });
      }
    } else if (S.hair === 'bun') {
      hairCap(0.47, -0.1); hairBack(0.6, S.hairColor);
      add(head, new T.SphereGeometry(0.1, 14, 12), mat(S.hairColor), [0, 0.26, -0.22]);
    } else if (S.hair === 'long') {
      hairCap(0.47, -0.1); hairBack(0.62, S.hairColor);
      add(head, new T.CylinderGeometry(0.27, 0.24, 0.42, 20, 1, true, Math.PI / 2 + 0.9, 2 * Math.PI - 1.8), mat(S.hairColor, { side: T.DoubleSide }), [0, -0.15, -0.02], { outline: false });
    } else if (S.hair === 'wavy') {
      hairCap(0.45, -0.2); hairBack(0.55, S.hairColor);
      add(head, new T.TorusGeometry(0.12, 0.05, 8, 16, Math.PI), mat(S.hairColor), [0.06, 0.24, 0.17], { rot: [-0.6, 0, 0.4], outline: false });
    }
    // 'shaved' draws no hair
  }
  // headwear
  const H = S.headColor || S.braid;
  if (S.head === 'tarbouch') {  // the red felt fez with a black tassel
    add(head, new T.CylinderGeometry(0.19, 0.23, 0.2, 20), mat(H), [0, 0.3, -0.02], { rot: [-0.1, 0, 0] });
    add(head, new T.CylinderGeometry(0.004, 0.004, 0.12, 4), flat('#1b1b1b'), [0.12, 0.33, -0.08], { rot: [0, 0, 0.5], outline: false });
    add(head, new T.ConeGeometry(0.03, 0.08, 6), flat('#1b1b1b'), [0.17, 0.27, -0.1], { outline: false });
  } else if (S.head === 'turban') {  // wrapped cloth
    for (let k = 0; k < 3; k++) add(head, new T.TorusGeometry(0.25 - k * 0.04, 0.07, 10, 28), mat(k % 2 ? tint(H, 0.25) : H), [0, 0.18 + k * 0.07, -0.02], { rot: [Math.PI / 2 - 0.15, 0, 0.1 * (k - 1)], ol: 1.03 });
    add(head, new T.SphereGeometry(0.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(H), [0, 0.22, -0.02]);
  } else if (S.head === 'scarf') {  // a headscarf framing the face and falling to the shoulders
    add(head, new T.SphereGeometry(0.33, 32, 20, Math.PI / 2 + 0.85, 2 * Math.PI - 1.7, 0, Math.PI * 0.78), mat(H, { side: T.DoubleSide }), [0, 0.02, -0.01], { scale: [1, 1.06, 1], ol: 1.03 });
    add(head, new T.SphereGeometry(0.33, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.3), mat(H, { side: T.DoubleSide }), [0, 0.02, -0.01], { scale: [1, 1.06, 1], outline: false });
    add(body, new T.ConeGeometry(0.3, 0.32, 24, 1, true), mat(H, { side: T.DoubleSide }), [0, 1.16, -0.02], { outline: false });
  } else if (S.head === 'hood') {  // the djellaba's pointed hood, up
    add(head, new T.SphereGeometry(0.34, 32, 20, Math.PI / 2 + 0.8, 2 * Math.PI - 1.6, 0, Math.PI * 0.8), mat(S.robeShade, { side: T.DoubleSide }), [0, 0.02, -0.02], { scale: [1, 1.08, 1], ol: 1.03 });
    add(head, new T.ConeGeometry(0.16, 0.26, 16), mat(S.robeShade), [0, 0.36, -0.12], { rot: [-0.6, 0, 0], ol: 1.04 });
  } else if (S.head === 'taqiyah') {  // a small embroidered cap
    add(head, new T.SphereGeometry(0.26, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.32), mat(H, { side: T.DoubleSide }), [0, 0.12, -0.03], { scale: [1.08, 0.9, 1.08] });
    add(head, new T.TorusGeometry(0.235, 0.012, 6, 28), mat(S.braid), [0, 0.2, -0.03], { rot: [Math.PI / 2, 0, 0], outline: false });
  }

  // ---- a small touch for each job ----
  const strap = (col) => add(body, new T.BoxGeometry(0.035, 0.62, 0.36), mat(col), [0.02, 0.92, 0], { rot: [0, 0, 0.62], scale: [1, 1, 0.98], outline: false });
  const K = S.kit;
  if (K === 'star') add(body, new T.OctahedronGeometry(0.03), mat(BRASS, { emissive: '#5a3a10' }), [-0.12, 1.0, 0.152], { scale: [1, 1, 0.4], outline: false });
  if (K === 'tube') {  // a brass dispatch tube on the back
    strap('#7a4b2a');
    add(body, new T.CylinderGeometry(0.045, 0.045, 0.42, 12), mat(BRASS), [0.05, 0.95, -0.2], { rot: [0, 0, 0.62] });
  }
  if (K === 'satchel' || K === 'scrolls' || K === 'letters' || K === 'folder') {  // a leather satchel at the hip
    strap('#7a4b2a');
    add(body, new T.BoxGeometry(0.18, 0.16, 0.08), mat('#8a5a32'), [-0.27, 0.66, 0.04], { ol: 1.06 });
    add(body, new T.BoxGeometry(0.18, 0.06, 0.085), mat('#6d3b1f'), [-0.27, 0.72, 0.045], { outline: false });
    if (K === 'scrolls') for (let k = 0; k < 3; k++) add(body, new T.CylinderGeometry(0.02, 0.02, 0.16, 8), mat('#f3e6cf'), [-0.31 + k * 0.04, 0.79, 0.04], { outline: false });
    if (K === 'letters') for (let k = 0; k < 2; k++) add(body, new T.BoxGeometry(0.1, 0.07, 0.005), mat('#fdf8ec'), [-0.28 + k * 0.03, 0.78, 0.05], { rot: [0, 0, 0.2 - k * 0.3], outline: false });
    if (K === 'folder') add(body, new T.BoxGeometry(0.13, 0.1, 0.01), mat(S.braid), [-0.28, 0.78, 0.05], { outline: false });
  }
  if (K === 'toolbelt' || K === 'tassels' || K === 'purse' || K === 'spyglass') {  // a sash at the waist
    add(body, new T.CylinderGeometry(0.215, 0.215, 0.06, 20, 1, true), mat(K === 'toolbelt' ? '#6d3b1f' : S.braid, { side: T.DoubleSide }), [0, 0.66, 0], { scale: [1.04, 1, 0.78], outline: false });
  }
  if (K === 'toolbelt') for (const [x, z] of [[-0.18, 0.12], [0.18, 0.12], [0.2, -0.05]]) add(body, new T.BoxGeometry(0.07, 0.09, 0.05), mat('#8a5a32'), [x, 0.6, z], { rot: [0, Math.atan2(x, z), 0] });
  if (K === 'tassels') ['#2b8a8a', '#d9643f', '#e8b04b'].forEach((c, k) => add(body, new T.ConeGeometry(0.022, 0.12, 6), mat(c), [0.12 + k * 0.045, 0.58, 0.15], { rot: [Math.PI, 0, 0], outline: false }));  // each business, future ventures
  if (K === 'purse') add(body, new T.SphereGeometry(0.06, 12, 10), mat(BRASS), [0.2, 0.58, 0.1], { scale: [1, 1.2, 0.7] });
  if (K === 'spyglass') add(body, new T.CylinderGeometry(0.025, 0.035, 0.24, 10), mat(BRASS), [0.24, 0.6, 0.05], { rot: [0.2, 0, 0.3] });
  if (K === 'camera') {  // a camera on a strap
    strap('#3a2a20');
    add(body, new T.BoxGeometry(0.14, 0.09, 0.06), mat('#2c3a3a'), [0, 0.92, 0.17]);
    add(body, new T.CylinderGeometry(0.03, 0.03, 0.05, 12), mat('#6b6f73'), [0, 0.92, 0.215], { rot: [Math.PI / 2, 0, 0], outline: false });
  }
  if (K === 'reel') {  // a film reel at the hip
    strap('#3a2a20');
    add(body, new T.CylinderGeometry(0.08, 0.08, 0.03, 16), mat('#2c3a3a'), [-0.27, 0.68, 0.05], { rot: [Math.PI / 2, 0, 0] });
  }
  if (K === 'plans') {  // rolled plans under the arm
    add(body, new T.CylinderGeometry(0.03, 0.03, 0.34, 10), mat('#d6e6ee'), [-0.28, 0.8, 0.03], { rot: [Math.PI / 2 - 0.3, 0, 0] });
  }
  if (K === 'basket') {  // a woven basket of herbs
    add(body, new T.CylinderGeometry(0.09, 0.07, 0.1, 14), mat('#d8b87a'), [-0.28, 0.62, 0.06]);
    for (let k = 0; k < 4; k++) add(body, new T.SphereGeometry(0.03, 8, 6), mat('#4c8a4a'), [-0.3 + (k % 2) * 0.05, 0.69, 0.04 + (k >> 1) * 0.04], { outline: false });
  }

  // holding a phone to the ear (guide step 24: the chief of staff's second sheet, for calling people)
  let phone = null;
  if (S.phone) {
    const arm = arms.find((a) => a.side === -1);  // their right hand
    phone = add(arm.el, new T.BoxGeometry(0.07, 0.15, 0.025), mat('#2c3a3a'), [-0.02, -0.25, 0.06], { ol: 1.12 });
    add(arm.el, new T.BoxGeometry(0.054, 0.12, 0.005), flat('#7cc4c0'), [-0.02, -0.25, 0.075], { outline: false });
  }

  root.scale.set(S.build, S.height, S.build);
  root.userData = { legs, arms, body, head, skirt, spec: S, phone };
  return root;
}

export function buildMe(T = THREE) { return buildCharacter(ME, T); }

// step: -1 left foot forward, 0 standing, 1 right foot forward (any value in between for smooth walking)
export function poseMe(model, step) {
  const { legs, arms, body, skirt } = model.userData;
  const swing = 0.45 * step;  // a long robe means a slightly shorter, still clear stride
  if (skirt) { skirt.rotation.set(0.05 * Math.abs(step), 0, -0.05 * step); skirt.scale.set(1, 1, 1 + 0.12 * Math.abs(step)); }
  for (const { hip, knee, side } of legs) {
    const fwd = side === 1 ? swing : -swing;     // right leg forward when step is 1
    hip.rotation.x = -fwd;
    knee.rotation.x = fwd < 0 ? 0.55 * Math.abs(step) : 0.1 * Math.abs(step);  // the back leg bends
  }
  for (const { sh, el, side } of arms) {
    const fwd = side === 1 ? -swing : swing;    // arms swing opposite to the legs
    sh.rotation.x = -fwd * 0.85;
    el.rotation.x = -0.25 - Math.max(0, fwd) * 0.5;
    if (model.userData.phone && side === -1) {  // the phone hand stays up at the ear while walking
      sh.rotation.set(-2.2, 0, -0.8); el.rotation.set(-1.7, 0, 0.8);  // solved so the hand rests by the cheek, at the ear
    }
  }
  body.position.y = step === 0 ? 0 : -0.025;
  body.rotation.y = 0.06 * step;
  model.position.y = 0;
}

// Sitting (guide step 29): thighs forward, shins down, the robe over the lap, hands forward on the table.
// The whole model drops so the seat is at chair height; the frame's foot point stays on the floor below the seat.
export const SIT_DROP = 0.24;
export function poseSit(model) {
  poseMe(model, 0);
  const { legs, arms, body, skirt } = model.userData;
  for (const { hip, knee } of legs) { hip.rotation.x = -1.45; knee.rotation.x = 1.45; }
  if (skirt) { skirt.rotation.set(-1.3, 0, 0); skirt.scale.set(1.05, 0.62, 1.1); }
  for (const { sh, el, side } of arms) {
    sh.rotation.x = -0.75; el.rotation.x = -0.75;
    if (model.userData.phone && side === -1) { sh.rotation.set(-2.2, 0, -0.8); el.rotation.set(-1.7, 0, 0.8); }
  }
  body.position.y = 0; body.rotation.y = 0;
  model.position.y = -SIT_DROP;
}

// ---------------- walking sheets ----------------
// 3 columns (left foot forward, standing, right foot forward) x 4 rows (toward, right, left, away),
// plus a 4th column (guide step 29): sitting, facing each of the four directions.
// frames are rendered at 5x so characters stay sharp at full zoom
export const SHEET = { fw: 48, fh: 64, R: 5, footX: 24, footY: 58, rows: ['down', 'right', 'left', 'up'], sitCol: 3 };

function setupScene(T, model) {
  const scene = new T.Scene();
  scene.add(new T.HemisphereLight('#fff6e6', '#d9b98c', 1.6));
  const sun = new T.DirectionalLight('#fff1d6', 2.2); sun.position.set(-2.5, 4, 3); scene.add(sun);  // warm light from the upper left
  if (model) scene.add(model);
  return scene;
}

/** render walking sheets for several characters with one renderer; returns canvases in the same order */
export function renderSheets(specs, T = THREE) {
  const { fw, fh, R } = SHEET, PX = 21, elev = 0.52;  // 21 game pixels per unit; camera looks down about 30 degrees
  const w = fw / PX, h = fh / PX;
  const cam = new T.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 50);
  const ty = ((SHEET.footY - fh / 2) / PX) / Math.cos(elev);  // puts the feet at (footX, footY) in each frame
  cam.position.set(0, ty + Math.sin(elev) * 10, Math.cos(elev) * 10); cam.lookAt(new T.Vector3(0, ty, 0));
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(fw * R, fh * R); renderer.setClearColor(0x000000, 0);
  const facing = { down: 0, right: Math.PI / 2, left: -Math.PI / 2, up: Math.PI };
  const out = specs.map((spec) => {
    const model = buildCharacter(spec, T), scene = setupScene(T, model);
    const sheet = document.createElement('canvas'); sheet.width = 4 * fw * R; sheet.height = 4 * fh * R;
    const g = sheet.getContext('2d');
    SHEET.rows.forEach((dir, row) => {
      [-1, 0, 1].forEach((step, col) => {
        model.rotation.y = facing[dir];
        poseMe(model, step);
        renderer.render(scene, cam);
        g.drawImage(renderer.domElement, col * fw * R, row * fh * R);
      });
      model.rotation.y = facing[dir];
      poseSit(model);
      renderer.render(scene, cam);
      g.drawImage(renderer.domElement, SHEET.sitCol * fw * R, row * fh * R);
      poseMe(model, 0);
    });
    model.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    return sheet;
  });
  renderer.dispose();
  return out;
}
export function renderSheet(T = THREE, spec = ME) { return renderSheets([spec], T)[0]; }

// Face pictures (guide step 30): a small square head-and-shoulders portrait of each character, from the same
// model, toon shading and outline as their walking sheet, turned a little towards you, on a round backdrop in
// their house colour. Used on the call card and when someone says hello. Returns canvases (size x size).
export function renderPortraits(specs, size = 96, T = THREE) {
  const S = 2;  // drawn at twice the size, then scaled down, for clean edges
  const cam = new T.OrthographicCamera(-0.52, 0.52, 0.52, -0.52, 0.1, 50);
  cam.position.set(0, 1.62, 6); cam.lookAt(new T.Vector3(0, 1.45, 0));
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(size * S, size * S); renderer.setClearColor(0x000000, 0);
  const out = specs.map((spec) => {
    const model = buildCharacter(spec, T), scene = setupScene(T, model);
    poseMe(model, 0);
    model.rotation.y = 0.32;  // three-quarter view
    renderer.render(scene, cam);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), r = size / 2, col = spec.color || BRASS;
    g.fillStyle = tint(col, 0.55); g.beginPath(); g.arc(r, r, r - 2, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.arc(r, r, r - 2, 0, Math.PI * 2); g.clip();
    g.drawImage(renderer.domElement, 0, 0, size, size);
    g.restore();
    g.lineWidth = 3; g.strokeStyle = col; g.beginPath(); g.arc(r, r, r - 2.5, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.2; g.strokeStyle = OUTLINE; g.beginPath(); g.arc(r, r, r - 0.8, 0, Math.PI * 2); g.stroke();
    model.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    return c;
  });
  renderer.dispose();
  return out;
}

// A turntable view of one character: ?model (you) or ?model=<key>. Drag to turn it, W to walk.
export function showTurntable(spec = ME, caption = 'You, the Chief Human Officer.') {
  const T = THREE, model = buildCharacter(spec, T), scene = setupScene(T, model);
  scene.background = new T.Color('#efd3ae');
  const cam = new T.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 50);
  cam.position.set(0, 1.3, 4.6); cam.lookAt(0, 0.95, 0);
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight);
  Object.assign(renderer.domElement.style, { position: 'fixed', inset: '0', zIndex: '50' });
  document.body.appendChild(renderer.domElement);
  const floor = new T.Mesh(new T.CircleGeometry(0.7, 40), new T.MeshBasicMaterial({ color: '#d6b382' }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  let spin = 0, drag = null, walk = false;
  renderer.domElement.addEventListener('pointerdown', (e) => { drag = e.clientX; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', (e) => { if (drag != null) { spin += (e.clientX - drag) * 0.01; drag = e.clientX; } });
  addEventListener('keydown', (e) => { if (e.code === 'KeyW') walk = !walk; });
  const label = document.createElement('div');
  label.textContent = caption + ' Drag to turn, W to walk.';
  Object.assign(label.style, { position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: '51', background: 'rgba(18,20,28,.82)', color: '#f5efe2', padding: '8px 16px', borderRadius: '999px', font: '14px system-ui', whiteSpace: 'nowrap' });
  document.body.appendChild(label);
  const loop = (ms) => {
    const t = ms / 1000;
    model.rotation.y = spin + (drag == null ? t * 0.4 : 0);
    poseMe(model, walk ? Math.round(Math.sin(t * 6)) : 0);
    renderer.render(scene, cam);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Plain grid view of one sheet: ?sheet
function showSheet(sheet) {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position: 'fixed', inset: '0', zIndex: '50', background: '#fbf6ec', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', font: '14px system-ui', color: '#0f2a2e' });
  const img = new Image(); img.src = sheet.toDataURL('image/png');
  img.style.height = 'min(80vh, 768px)'; img.style.border = '1px solid #e0cfb1';
  img.style.background = 'repeating-conic-gradient(#f3e6cf 0% 25%, #fbf6ec 0% 50%) 0 0 / 24px 24px';
  const cap = document.createElement('div');
  cap.textContent = 'Walking sheet: rows are toward, right, left and away; columns are left foot forward, standing, right foot forward.';
  wrap.append(img, cap); document.body.appendChild(wrap);
}

if (typeof window !== 'undefined' && document.getElementById('game')) {
  try {
    const sheet = renderSheet();
    window.__meSheet = { canvas: sheet, ...SHEET };
    window.__mePortrait = renderPortraits([{ ...ME, color: BRASS }])[0];
    const q = new URLSearchParams(location.search);
    if (q.has('sheet')) showSheet(sheet);
    if (q.has('model') && !q.get('model')) showTurntable();
  } catch (err) {
    console.warn('3D character unavailable, using the drawn walker instead:', err);
  }
}
