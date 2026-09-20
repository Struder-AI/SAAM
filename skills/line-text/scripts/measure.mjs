import {inflatePaths} from '../../../core/region/clipper2.mjs';
import {fontMetrics} from './strokefont.mjs';
import {layoutText} from './layout.mjs';

// Clipper works on integers; keep a tenth of a font unit.
const SCALE = 10;
const ALNUM = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'];

const encode = strokes => strokes.map(s => {
  const pts = s.dot ? [s.points[0], [s.points[0][0] + 1, s.points[0][1]]] : s.closed ? [...s.points, s.points[0]] : s.points;
  return pts.map(([x, y]) => ({X: Math.round(x * SCALE), Y: Math.round(y * SCALE)}));
});
const area = loop => loop.reduce((sum, p, i) => sum + (p.X * loop[(i + 1) % loop.length].Y - loop[(i + 1) % loop.length].X * p.Y), 0) / 2;

// The drawing's topology once every centerline is widened to `widthUnits`:
// how many separate blobs and how many enclosed counters.
export function inkTopology(strokes, widthUnits) {
  const loops = inflatePaths(encode(strokes), widthUnits / 2 * SCALE, {join: 'round', miterLimit: 2, arcTolerance: 0.3 * SCALE, end: 'Round'});
  const outer = loops.filter(l => area(l) > 0).length;
  return {components: outer, holes: loops.length - outer};
}

// Endpoints closer than this to another stroke are drawing imprecision, not
// design: measured across the bundled fonts, endpoint gaps are exact touches or
// under 0.03 of cap height, then empty until about 0.04. Beyond it a gap is real.
export const JOIN_FRACTION = 0.03;

// The widest a bead can be before this drawing stops looking like itself: the
// first width beyond `baseUnits` at which two strokes fuse or a counter fills in.
// `baseUnits` sets the intended drawing, so near-misses that a snapped junction
// would close are not counted as gaps. Infinity for a drawing that never changes
// (a single open stroke). Units are font units.
export function fusionWidth(strokes, {baseUnits = 4, maxUnits = 400, step = 4} = {}) {
  if (!strokes.length) return Infinity;
  const base = inkTopology(strokes, baseUnits), same = t => t.components === base.components && t.holes === base.holes;
  let lo = baseUnits;
  for (let w = baseUnits + step; w <= maxUnits; w += step) {
    if (!same(inkTopology(strokes, w))) {
      let hi = w;
      for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (same(inkTopology(strokes, mid))) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    }
    lo = w;
  }
  return Infinity;
}

const glyphFusion = (font, ch) => {
  font.fusion ??= new Map();
  if (!font.fusion.has(ch)) font.fusion.set(ch, fusionWidth(font.glyphs.get(ch).strokes, {baseUnits: JOIN_FRACTION * fontMetrics(font).capHeight}));
  return font.fusion.get(ch);
};

// Fusion width for exactly the characters in a text, as a fraction of cap height,
// with the glyph that limits it. Space and unmeasured characters are skipped.
export function textFusion(font, text) {
  const {capHeight} = fontMetrics(font);
  let worst = {ratio: Infinity, char: null};
  for (const ch of new Set(text)) {
    if (ch === '\n' || !font.glyphs.get(ch)?.strokes.length) continue;
    const ratio = glyphFusion(font, ch) / capHeight;
    if (ratio < worst.ratio) worst = {ratio, char: ch};
  }
  return worst;
}

const sampleAlong = (points, spacing) => {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / spacing));
    for (let k = 0; k < n; k++) out.push({p: [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], dir: len ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : [1, 0]});
  }
  return out;
};

// Fraction of a glyph's ink drawn over ink that is already there in the same
// direction of travel: a doubled or retraced stroke deposits twice on one path.
export function retraceFraction(strokes, {distanceUnits = 4, spacing = 5} = {}) {
  const samples = strokes.map(s => sampleAlong(s.closed ? [...s.points, s.points[0]] : s.points, spacing));
  let total = 0, covered = 0;
  samples.forEach((mine, i) => {
    for (const s of mine) {
      total++;
      const hit = samples.some((other, j) => j !== i && other.some(o => Math.hypot(o.p[0] - s.p[0], o.p[1] - s.p[1]) <= distanceUnits && Math.abs(o.dir[0] * s.dir[0] + o.dir[1] * s.dir[1]) > 0.9));
      if (hit) covered++;
    }
  });
  return total ? covered / total : 0;
}

const quantile = (values, q) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };

// Font-level facts used to choose between fonts. Everything is measured from
// the glyphs; nothing is read from the font's own metric headers.
export function measureFont(font) {
  const metrics = fontMetrics(font), cap = metrics.capHeight;
  const ascii = [...Array(95)].map((_, i) => String.fromCharCode(32 + i));
  const letters = ALNUM.filter(ch => font.glyphs.get(ch)?.strokes.length);
  const fusion = letters.map(ch => glyphFusion(font, ch) / cap).filter(Number.isFinite);
  const strokeCounts = letters.map(ch => font.glyphs.get(ch).strokes.length);
  const retraced = letters.filter(ch => retraceFraction(font.glyphs.get(ch).strokes) > 0.15);
  // Joined script: how often adjacent lowercase letters leave and enter at the same point.
  const sample = 'the quick brown fox jumps over a lazy dog', laid = layoutText(font, sample, {heightMm: cap, kerning: true});
  let pairs = 0, joins = 0;
  const byIndex = new Map();
  for (const s of laid.strokes) { const k = s.glyph.index; if (!byIndex.has(k)) byIndex.set(k, []); byIndex.get(k).push(s); }
  for (let i = 0; i < sample.length - 1; i++) {
    if (sample[i] === ' ' || sample[i + 1] === ' ') continue;
    pairs++;
    const ends = (byIndex.get(i) ?? []).filter(s => !s.closed).flatMap(s => [s.points.at(-1)]);
    const starts = (byIndex.get(i + 1) ?? []).filter(s => !s.closed).flatMap(s => [s.points[0]]);
    if (ends.some(e => starts.some(b => Math.hypot(e[0] - b[0], e[1] - b[1]) <= 0.03 * cap))) joins++;
  }
  return {
    id: font.id, family: font.family, sha256: font.sha256, glyphCount: font.glyphs.size, kerningPairs: font.kerning.size,
    missingAscii: ascii.filter(ch => !font.glyphs.has(ch)).join(''),
    capHeightUnits: Math.round(cap), xHeightRatio: +(metrics.xHeight / cap).toFixed(3), descenderRatio: +(metrics.descender / cap).toFixed(3),
    strokesPerGlyph: {mean: +(strokeCounts.reduce((a, b) => a + b, 0) / strokeCounts.length).toFixed(2), max: Math.max(...strokeCounts)},
    retracedGlyphs: retraced.join(''),
    joinRate: pairs ? +(joins / pairs).toFixed(2) : 0,
    // Widest total stroke, as a fraction of cap height, before letters fuse.
    fusionOverCap: {median: +quantile(fusion, 0.5).toFixed(3), p10: +quantile(fusion, 0.1).toFixed(3), min: +Math.min(...fusion).toFixed(3)}
  };
}
