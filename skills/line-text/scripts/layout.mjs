import {requireThat} from '../../../core/geom/tolerance.mjs';
import {fontMetrics, kernUnits} from './strokefont.mjs';

// Lay a string out as millimetre centerline strokes, y up, first baseline at y = 0.
// `heightMm` is the measured capital height of the font, so "6 mm text" means the
// same physical letter height in every font.
export function layoutText(font, text, {heightMm, letterSpacingMm = 0, lineHeightFactor = 1.4, align = 'left', kerning = true} = {}) {
  requireThat(typeof text === 'string' && text.length > 0, 'Line text needs a non-empty string.');
  requireThat(Number.isFinite(heightMm) && heightMm > 0, 'Line text needs a positive heightMm.');
  const metrics = fontMetrics(font), scale = heightMm / metrics.capHeight;
  const lines = text.split('\n'), missing = new Set();
  for (const ch of text) if (ch !== '\n' && !font.glyphs.has(ch)) missing.add(ch);
  requireThat(!missing.size, `Font ${font.id} has no glyph for ${[...missing].map(c => JSON.stringify(c)).join(', ')}; choose another font or text.`);

  const lineHeightMm = lineHeightFactor * heightMm, placed = [], lineInfo = [];
  lines.forEach((line, row) => {
    const chars = [...line], baseline = -row * lineHeightMm;
    const x = [];
    let pen = 0;
    chars.forEach((ch, i) => {
      x.push(pen);
      const glyph = font.glyphs.get(ch), next = chars[i + 1];
      pen += (glyph.advance - (kerning && next ? kernUnits(font, ch, next) : 0)) * scale + letterSpacingMm;
    });
    // Advance width without the trailing letter spacing, for alignment.
    const width = chars.length ? pen - letterSpacingMm : 0;
    const shift = align === 'center' ? -width / 2 : align === 'right' ? -width : 0;
    chars.forEach((ch, i) => {
      const glyph = font.glyphs.get(ch);
      glyph.strokes.forEach((stroke, strokeIndex) => placed.push({
        closed: stroke.closed, ...(stroke.dot ? {dot: true} : {}),
        points: stroke.points.map(([px, py]) => [px * scale + x[i] + shift, py * scale + baseline]),
        glyph: {char: ch, line: row, index: i, stroke: strokeIndex}
      }));
    });
    lineInfo.push({text: line, baselineMm: baseline, widthMm: width, shiftMm: shift});
  });
  return {strokes: placed, lines: lineInfo, scale, heightMm, metrics, bounds: strokeBounds(placed)};
}

export function strokeBounds(strokes) {
  const points = strokes.flatMap(s => s.points);
  if (!points.length) return {min: [0, 0], max: [0, 0]};
  return {
    min: [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))],
    max: [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]
  };
}

export const translateStrokes = (strokes, dx, dy) => strokes.map(s => ({...s, points: s.points.map(([x, y]) => [x + dx, y + dy])}));

const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Chain open strokes whose ends meet (script letters that exit where the next
// begins), so a joined word deposits as one bead instead of a start and stop at
// every junction. Only endpoint to endpoint joins within toleranceMm; the chain
// keeps every original point and adds no connector geometry.
export function chainStrokes(strokes, toleranceMm) {
  const open = strokes.filter(s => !s.closed && !s.dot).map(s => ({...s, points: [...s.points]}));
  const rest = strokes.filter(s => s.closed || s.dot);
  const used = new Set(), result = [];
  for (let i = 0; i < open.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let chain = open[i].points;
    for (let grew = true; grew;) {
      grew = false;
      let best = null;
      for (let j = 0; j < open.length; j++) {
        if (used.has(j)) continue;
        const p = open[j].points;
        for (const [reverse, join] of [[false, gap(chain.at(-1), p[0])], [true, gap(chain.at(-1), p.at(-1))]])
          if (join <= toleranceMm && (!best || join < best.join)) best = {j, reverse, join};
      }
      if (best) {
        used.add(best.j);
        const next = best.reverse ? [...open[best.j].points].reverse() : open[best.j].points;
        chain = [...chain, ...(best.join < 1e-9 ? next.slice(1) : next)];
        grew = true;
      }
    }
    result.push({...open[i], points: chain});
  }
  // Preserve reading order: strokes sort by the glyph they start in.
  return [...result, ...rest].sort((a, b) => (a.glyph.line - b.glyph.line) || (a.glyph.index - b.glyph.index) || (a.glyph.stroke - b.glyph.stroke));
}
