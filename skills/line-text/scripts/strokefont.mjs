import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {requireThat} from '../../../core/geom/tolerance.mjs';

// SVG stroke fonts (Hershey, EMS and Relief SingleLine) store each glyph as
// centerline subpaths, not filled outlines. Coordinates are font units, y up.
// A stroke is {closed, points:[[x,y]...]} or a dot {closed:false, dot:true, points:[[x,y]]}.

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
const decode = text => text.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(\w+));/g, (whole, hex, dec, name) =>
  hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : ENTITIES[name] ?? whole);

function attributes(text) {
  const result = {};
  for (const m of text.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[m[1]] = decode(m[2] ?? m[3]);
  return result;
}

const near = (a, b, eps) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps;

// Adaptive de Casteljau flattening: split until both control points lie within
// toleranceUnits of the chord.
function flattenCubic(p0, p1, p2, p3, tolerance, out, depth = 0) {
  const [dx, dy] = [p3[0] - p0[0], p3[1] - p0[1]], length = Math.hypot(dx, dy);
  const off = p => length < 1e-12 ? Math.hypot(p[0] - p0[0], p[1] - p0[1]) : Math.abs((p[0] - p0[0]) * dy - (p[1] - p0[1]) * dx) / length;
  if (depth >= 16 || Math.max(off(p1), off(p2)) <= tolerance) { out.push(p3); return; }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const p01 = mid(p0, p1), p12 = mid(p1, p2), p23 = mid(p2, p3), p012 = mid(p01, p12), p123 = mid(p12, p23), m = mid(p012, p123);
  flattenCubic(p0, p01, p012, m, tolerance, out, depth + 1);
  flattenCubic(m, p123, p23, p3, tolerance, out, depth + 1);
}

const ARGUMENTS = {M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0};

// Full SVG path syntax except arcs, which none of the bundled fonts use.
export function parsePathData(d, {toleranceUnits = 1, closeEpsilon = 0.5} = {}) {
  const tokens = [...d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)].map(m => m[1] ?? Number(m[2]));
  const strokes = [];
  let current = null, at = [0, 0], start = [0, 0], lastCubic = null, lastQuad = null, i = 0, command = null;

  const finish = closedByZ => {
    if (!current) return;
    const points = current;
    current = null;
    if (points.length === 1) { strokes.push({closed: false, dot: true, points}); return; }
    const closed = closedByZ || (points.length >= 4 && near(points[0], points.at(-1), closeEpsilon));
    if (closed && near(points[0], points.at(-1), closeEpsilon)) points.pop();
    if (points.length === 1) strokes.push({closed: false, dot: true, points});
    else strokes.push({closed: closed && points.length >= 3, points});
  };
  const lineTo = p => { if (!near(current.at(-1), p, 1e-9)) current.push(p); at = p; };

  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') command = tokens[i++];
    else requireThat(command, 'Stroke font path data begins with a number.');
    const upper = command.toUpperCase(), relative = command !== upper;
    requireThat(upper in ARGUMENTS, `Stroke font path command ${command} is not supported.`);
    if (upper === 'Z') { finish(true); at = start; lastCubic = lastQuad = null; continue; }
    const n = ARGUMENTS[upper], args = tokens.slice(i, i + n);
    requireThat(args.length === n && args.every(Number.isFinite), 'Truncated stroke font path data.');
    i += n;
    const [ox, oy] = relative ? at : [0, 0];
    if (upper === 'M') {
      finish(false);
      at = start = [args[0] + ox, args[1] + oy];
      current = [at];
      command = relative ? 'l' : 'L'; // extra coordinate pairs are implicit lineto
      lastCubic = lastQuad = null;
      continue;
    }
    if (!current) { current = [at]; start = at; } // path continuing after Z
    if (upper === 'L') { lineTo([args[0] + ox, args[1] + oy]); lastCubic = lastQuad = null; }
    else if (upper === 'H') { lineTo([args[0] + ox, at[1]]); lastCubic = lastQuad = null; }
    else if (upper === 'V') { lineTo([at[0], args[0] + oy]); lastCubic = lastQuad = null; }
    else if (upper === 'C' || upper === 'S') {
      const reflected = lastCubic ? [2 * at[0] - lastCubic[0], 2 * at[1] - lastCubic[1]] : at;
      const [c1, c2, end] = upper === 'C'
        ? [[args[0] + ox, args[1] + oy], [args[2] + ox, args[3] + oy], [args[4] + ox, args[5] + oy]]
        : [reflected, [args[0] + ox, args[1] + oy], [args[2] + ox, args[3] + oy]];
      const out = [];
      flattenCubic(at, c1, c2, end, toleranceUnits, out);
      for (const p of out) lineTo(p);
      lastCubic = c2; lastQuad = null;
    } else { // Q, T: raise to a cubic
      const reflected = lastQuad ? [2 * at[0] - lastQuad[0], 2 * at[1] - lastQuad[1]] : at;
      const [q, end] = upper === 'Q' ? [[args[0] + ox, args[1] + oy], [args[2] + ox, args[3] + oy]] : [reflected, [args[0] + ox, args[1] + oy]];
      const c1 = [at[0] + 2 / 3 * (q[0] - at[0]), at[1] + 2 / 3 * (q[1] - at[1])];
      const c2 = [end[0] + 2 / 3 * (q[0] - end[0]), end[1] + 2 / 3 * (q[1] - end[1])];
      const out = [];
      flattenCubic(at, c1, c2, end, toleranceUnits, out);
      for (const p of out) lineTo(p);
      lastQuad = q; lastCubic = null;
    }
  }
  finish(false);
  return strokes;
}

// A kerning side is a list of glyph names (g1/g2) and characters or U+ ranges (u1/u2).
function kerningSide(names, chars, byName) {
  const set = new Set();
  for (const name of (names ?? '').split(',').map(s => s.trim()).filter(Boolean)) if (byName.has(name)) set.add(byName.get(name));
  for (const token of (chars ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const range = /^U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?$/.exec(token);
    if (range) for (let c = parseInt(range[1], 16); c <= parseInt(range[2] ?? range[1], 16); c++) set.add(String.fromCodePoint(c));
    else for (const ch of token) set.add(ch);
  }
  return set;
}

export function parseStrokeFont(svg, {id, toleranceUnits = 1} = {}) {
  const face = attributes(/<font-face\b[^>]*>/s.exec(svg)?.[0] ?? '');
  const fontTag = attributes(/<font\b[^>]*>/s.exec(svg)?.[0] ?? '');
  const unitsPerEm = Number(face['units-per-em'] ?? 1000);
  const defaultAdvance = Number(fontTag['horiz-adv-x'] ?? unitsPerEm / 2);
  const glyphs = new Map(), byName = new Map();
  for (const m of svg.matchAll(/<glyph\b([^>]*?)\/?>/gs)) {
    const a = attributes(m[1]);
    const chars = [...(a.unicode ?? '')];
    if (chars.length !== 1) continue; // ligatures and unnamed glyphs are not text characters
    const glyph = {
      char: chars[0], name: a['glyph-name'] ?? null,
      advance: a['horiz-adv-x'] === undefined ? defaultAdvance : Number(a['horiz-adv-x']),
      strokes: a.d ? parsePathData(a.d, {toleranceUnits}) : []
    };
    glyphs.set(glyph.char, glyph);
    if (glyph.name) byName.set(glyph.name, glyph.char);
  }
  const kerning = new Map();
  for (const m of svg.matchAll(/<hkern\b([^>]*?)\/?>/gs)) {
    const a = attributes(m[1]), k = Number(a.k);
    if (!Number.isFinite(k)) continue;
    const left = kerningSide(a.g1, a.u1, byName), right = kerningSide(a.g2, a.u2, byName);
    for (const l of left) for (const r of right) kerning.set(l + r, k);
  }
  const metadata = /<metadata>([\s\S]*?)<\/metadata>/.exec(svg)?.[1].trim() ?? '';
  return {
    id: id ?? fontTag.id ?? 'font', family: face['font-family'] ?? fontTag.id ?? id ?? 'font',
    unitsPerEm, ascent: Number(face.ascent ?? 0.8 * unitsPerEm), descent: Number(face.descent ?? -0.2 * unitsPerEm),
    defaultAdvance, glyphs, kerning, metadata, sha256: createHash('sha256').update(svg).digest('hex')
  };
}

export function loadStrokeFont(path, options = {}) {
  return parseStrokeFont(readFileSync(path, 'utf8'), options);
}

// Font kerning value that narrows the pair, in font units.
export const kernUnits = (font, left, right) => font.kerning.get(left + right) ?? 0;

// Measured, not declared: the bundled fonts' cap-height headers do not match
// their glyphs (EMS Casual Hand's 'A' rises to 828 against a declared 500).
export function fontMetrics(font) {
  if (font.metrics) return font.metrics;
  const top = chars => {
    let best = null;
    for (const ch of chars) {
      const glyph = font.glyphs.get(ch);
      if (!glyph?.strokes.length) continue;
      const ys = glyph.strokes.flatMap(s => s.points.map(p => p[1]));
      best = Math.max(best ?? -Infinity, Math.max(...ys));
    }
    return best;
  };
  const bottom = chars => {
    let best = null;
    for (const ch of chars) {
      const glyph = font.glyphs.get(ch);
      if (!glyph?.strokes.length) continue;
      best = Math.min(best ?? Infinity, ...glyph.strokes.flatMap(s => s.points.map(p => p[1])));
    }
    return best;
  };
  const capHeight = top('HEIZ'), xHeight = top('xzvw');
  requireThat(capHeight > 0, `Font ${font.id} has no measurable capital height.`);
  font.metrics = {capHeight, xHeight: xHeight ?? capHeight * 0.7, ascender: top('bdfhkl') ?? capHeight, descender: bottom('gjpqy') ?? 0};
  return font.metrics;
}
