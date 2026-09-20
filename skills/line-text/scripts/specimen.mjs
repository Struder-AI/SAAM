import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadFont} from './catalog.mjs';
import {lineText} from './compile.mjs';
import {layoutText} from './layout.mjs';
import {rankFonts} from './plan.mjs';
import {encodePng, rasterize} from './raster.mjs';

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const pathData = s => 'M' + s.points.map(p => `${p[0]} ${p[1]}`).join(' L') + (s.closed ? ' Z' : '');

// The candidates for a request, best first: only fonts that can hold the word at
// this size, numbered so a person can answer with a number. `omitted` counts fonts
// left out because they cannot hold it (or fell past `limit`).
export function specimenScene({text, heightMm, intent = [], weight = 'regular', stemRatio, beadRangeMm, fonts, layers = 1, limit = 6}) {
  const ranked = rankFonts({text, heightMm, intent, weight, stemRatio, beadRangeMm, fonts});
  const shown = ranked.filter(r => r.feasible).slice(0, limit);
  const rows = shown.map((row, i) => {
    const result = lineText({font: loadFont(row.fontId), text, heightMm, weight, stemRatio, beadRangeMm, layers}), p = row.plan;
    const [w, h] = result.report.extentMm;
    return {
      n: i + 1, fontId: row.fontId, strokes: result.network.strokes, beadWidthMm: p.beadWidthMm, widthMm: w,
      boxMm: Math.max(h, heightMm * 1.4 * text.split('\n').length), regime: p.regime, parallelCount: p.parallelCount,
      lighter: p.warnings.length > 0,
      note: `${p.parallelCount === 1 ? '1 bead' : p.parallelCount + ' beads x'}${p.parallelCount === 1 ? ',' : ''} ${p.beadWidthMm.toFixed(2)} mm${p.warnings.length ? ', weight reduced' : ''}`
    };
  });
  return {text, heightMm, rows, omitted: ranked.length - rows.length};
}

const rowTitle = r => `${r.n}  ${r.fontId} - ${r.note}`;

// Physical scale: 1 SVG user unit = 1 mm, beads at their real width.
export function specimenSvg(scene) {
  const labelMm = Math.max(3, scene.heightMm * 0.16), pad = 6, parts = [];
  let y = 0, width = 80;
  for (const r of scene.rows) {
    parts.push(`<text x="0" y="${y + labelMm}" font-size="${labelMm}" fill="#444" font-family="Helvetica,Arial,sans-serif">${esc(rowTitle(r))}</text>`);
    const top = y + labelMm * 1.8 + r.boxMm;
    parts.push(`<g transform="translate(0 ${top}) scale(1 -1)" fill="none" stroke="#111" stroke-width="${r.beadWidthMm}" stroke-linecap="round" stroke-linejoin="round">` +
      r.strokes.map(s => `<path d="${pathData(s)}"/>`).join('') + '</g>');
    width = Math.max(width, r.widthMm);
    y = top + labelMm * 1.5;
  }
  const W = width + 2 * pad, H = y + 2 * pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${W} ${H}" width="${W * 4}" height="${H * 4}"><rect x="${-pad}" y="${-pad}" width="${W}" height="${H}" fill="#fff"/>${parts.join('')}</svg>`;
}

const LABEL_CAP_PX = 15, LABEL_GAP_PX = 16, ROW_GAP_PX = 22, PAD_PX = 24, MAX_W_PX = 1400, MAX_H_PX = 2400;

// The same sheet as a PNG (default up to 10 px per mm, scaled down to fit), with
// labels drawn in the bundled stroke font. Returns {png, widthPx, heightPx, pxPerMm}.
export function specimenPng(scene) {
  const font = loadFont('relief-single-line'), n = scene.rows.length;
  const contentW = Math.max(1, ...scene.rows.map(r => r.widthMm)), contentH = scene.rows.reduce((s, r) => s + r.boxMm, 0);
  const fixedH = n * (LABEL_CAP_PX + LABEL_GAP_PX + ROW_GAP_PX) + 2 * PAD_PX;
  const s = Math.min(10, (MAX_W_PX - 2 * PAD_PX) / contentW, Math.max(1, MAX_H_PX - fixedH) / Math.max(contentH, 1));
  const labels = scene.rows.map(r => layoutText(font, rowTitle(r), {heightMm: LABEL_CAP_PX}));
  const widthPx = Math.ceil(Math.max(contentW * s, ...labels.map(l => l.bounds.max[0])) + 2 * PAD_PX);
  const heightPx = Math.ceil(fixedH + contentH * s);
  const ink = [], text = [];
  let y = PAD_PX;
  scene.rows.forEach((r, i) => {
    const base = y + LABEL_CAP_PX; // label baseline
    for (const st of labels[i].strokes) text.push({closed: st.closed, widthPx: 1.6, points: st.points.map(([px, py]) => [PAD_PX + px, base - py])});
    const top = base + LABEL_GAP_PX, bottom = top + r.boxMm * s;
    for (const st of r.strokes) ink.push({closed: st.closed, widthPx: r.beadWidthMm * s, points: st.points.map(([px, py]) => [PAD_PX + px * s, bottom - py * s])});
    y = bottom + ROW_GAP_PX;
  });
  const rgb = rasterize({widthPx, heightPx, groups: [{shapes: text, color: [90, 90, 90]}, {shapes: ink, color: [17, 17, 17]}]});
  return {png: encodePng(widthPx, heightPx, rgb), widthPx, heightPx, pxPerMm: s};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2), take = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args.splice(i, 2)[1]; };
  const svgOut = take('--out', null), pngOut = take('--png', null), height = Number(take('--height', 20)), weight = take('--weight', 'regular');
  const range = take('--range', '0.3,0.8').split(',').map(Number), intent = take('--intent', '').split(',').filter(Boolean);
  const fonts = take('--fonts', '').split(',').filter(Boolean), limit = Number(take('--top', 6)), text = args.join(' ').replace(/\\n/g, '\n');
  if (!text || (!svgOut && !pngOut)) {
    console.error('usage: specimen.mjs "word" (--png file.png | --out file.svg) [--height MM] [--weight light|regular|bold] [--range MIN,MAX] [--intent a,b] [--fonts id,id] [--top N]');
    process.exit(1);
  }
  const scene = specimenScene({text, heightMm: height, intent, weight, beadRangeMm: range, fonts: fonts.length ? fonts : undefined, limit});
  if (svgOut) writeFileSync(svgOut, specimenSvg(scene));
  let image = null;
  if (pngOut) { const r = specimenPng(scene); writeFileSync(pngOut, r.png); image = {widthPx: r.widthPx, heightPx: r.heightPx, pxPerMm: +r.pxPerMm.toFixed(2)}; }
  console.log(JSON.stringify({png: pngOut, svg: svgOut, image, candidates: scene.rows.map(r => ({n: r.n, font: r.fontId, construction: r.regime, beadMm: +r.beadWidthMm.toFixed(3), beads: r.parallelCount, lighterThanAsked: r.lighter})), omitted: scene.omitted}, null, 2));
}
