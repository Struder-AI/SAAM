import {requireThat} from '../../../core/geom/tolerance.mjs';
import {textFusion} from './measure.mjs';
import {FONTS, loadFont} from './catalog.mjs';

// Stroke weight as a fraction of cap height. These are authoring defaults to be
// tuned by physical trials, not typographic standards; pass `stemRatio` to override.
export const WEIGHTS = Object.freeze({light: 0.05, regular: 0.08, bold: 0.13});

// Choose how a word of a given height is built. The person's intent is a height,
// a weight and a style; the bead widths the process allows decide the rest:
//   fine         the wanted stroke is thinner than the thinnest bead: one thinnest bead
//   single-bead  the wanted stroke fits one bead of adjustable width: one bead, sized to it
//   parallel     the wanted stroke is wider than the widest bead: the fewest beads side by side
//                that each stay within the widest bead, sized to make up the wanted stroke
// A second bead doubles the work for a small gain, so a stroke up to `lightTolerance`
// wider than the widest bead still prints as one widest bead, a little lighter than asked.
// A stroke is only as wide as the font can hold: `fusion` limits it so counters stay open.
export function planLineText({font, text, heightMm, weight = 'regular', stemRatio, beadRangeMm, spacingFactor = 1, clearanceFactor = 0.5, lightTolerance = 0.25, onInfeasible = 'reduce'}) {
  requireThat(Number.isFinite(heightMm) && heightMm > 0, 'Line text needs a positive heightMm.');
  requireThat(Array.isArray(beadRangeMm) && beadRangeMm.length === 2 && beadRangeMm[0] > 0 && beadRangeMm[1] >= beadRangeMm[0], 'beadRangeMm must be [thinnest, widest] in mm.');
  requireThat(stemRatio !== undefined || weight in WEIGHTS, `weight must be one of ${Object.keys(WEIGHTS).join(', ')} or give stemRatio.`);
  requireThat(spacingFactor >= 0.5 && spacingFactor <= 1.5, 'spacingFactor must be within 0.5-1.5 for touching parallel beads.');
  const [wMin, wMax] = beadRangeMm, ratio = stemRatio ?? WEIGHTS[weight], requestedMm = ratio * heightMm;
  const fusion = textFusion(font, text), limitMm = fusion.ratio * heightMm;

  const construct = stemMm => {
    if (stemMm <= wMin) return {beadWidthMm: wMin, parallelCount: 1, regime: 'fine'};
    if (stemMm <= wMax) return {beadWidthMm: stemMm, parallelCount: 1, regime: 'single-bead'};
    if (stemMm <= wMax * (1 + lightTolerance)) return {beadWidthMm: wMax, parallelCount: 1, regime: 'single-bead'};
    // The fewest beads that each stay within the widest bead, then sized so the
    // row of them adds up to exactly the wanted stroke.
    const count = Math.ceil((stemMm / wMax - 1) / spacingFactor) + 1;
    return {beadWidthMm: Math.max(wMin, stemMm / (1 + (count - 1) * spacingFactor)), parallelCount: count, regime: 'parallel'};
  };
  const strokeWidth = c => c.beadWidthMm + (c.parallelCount - 1) * c.beadWidthMm * spacingFactor;
  const fits = c => strokeWidth(c) + clearanceFactor * c.beadWidthMm <= limitMm + 1e-9;

  const warnings = [];
  let chosen = construct(requestedMm), feasible = fits(chosen);
  if (!feasible) {
    let stem = requestedMm;
    while (!feasible && stem > wMin) { stem = Math.max(wMin, stem * 0.97); chosen = construct(stem); feasible = fits(chosen); }
    if (feasible) warnings.push(`Requested stroke ${requestedMm.toFixed(2)} mm would fill the counters of "${fusion.char}" at ${heightMm} mm; reduced to ${strokeWidth(chosen).toFixed(2)} mm.`);
    else chosen = construct(wMin);
  }
  const minHeightMm = Number.isFinite(fusion.ratio) ? wMin * (1 + clearanceFactor) / fusion.ratio : 0;
  if (!feasible) {
    const message = `${font.id} cannot hold the thinnest bead (${wMin} mm) at ${heightMm} mm without "${fusion.char}" filling in; use at least ${minHeightMm.toFixed(1)} mm, a thinner bead, or a font with roomier counters.`;
    requireThat(onInfeasible !== 'error', message);
    warnings.push(message);
  }
  if (chosen.regime === 'fine' && requestedMm < wMin) warnings.push(`The thinnest bead (${wMin} mm) is heavier than the ${requestedMm.toFixed(2)} mm stroke this weight asks for at ${heightMm} mm.`);
  return {
    fontId: font.id, heightMm, weight: stemRatio === undefined ? weight : null, stemRatio: ratio,
    requestedStrokeMm: +requestedMm.toFixed(3), strokeWidthMm: +strokeWidth(chosen).toFixed(3),
    ...chosen, pitchMm: +(chosen.beadWidthMm * spacingFactor).toFixed(3), spacingFactor, clearanceMm: +(clearanceFactor * chosen.beadWidthMm).toFixed(3),
    feasible, limit: {maxStrokeMm: Number.isFinite(limitMm) ? +limitMm.toFixed(3) : null, limitingGlyph: fusion.char, minHeightMm: +minHeightMm.toFixed(2)},
    warnings
  };
}

// Rank the bundled fonts for a request. `intent` is free words matched against
// each font's tags (for example ['formal', 'script'] or ['label']); feasible fonts
// rank first, then closer intent, then how much of the wanted weight survives.
export function rankFonts({text, heightMm, intent = [], weight = 'regular', stemRatio, beadRangeMm, fonts = FONTS.map(f => f.id), spacingFactor = 1}) {
  const words = new Set(intent.map(w => String(w).toLowerCase()));
  const rows = [];
  for (const id of fonts) {
    const entry = FONTS.find(f => f.id === id), font = loadFont(id);
    if ([...text].some(ch => ch !== '\n' && !font.glyphs.has(ch))) continue; // no silent glyph replacement
    const plan = planLineText({font, text, heightMm, weight, stemRatio, beadRangeMm, spacingFactor, onInfeasible: 'reduce'});
    const matches = entry.tags.filter(t => words.has(t));
    rows.push({fontId: id, feasible: plan.feasible, intentMatches: matches, score: matches.length, keptWeight: plan.strokeWidthMm / plan.requestedStrokeMm, plan, summary: entry.summary});
  }
  return rows.sort((a, b) => (b.feasible - a.feasible) || (b.score - a.score) || (Math.abs(1 - a.keptWeight) - Math.abs(1 - b.keptWeight)));
}

// What one bead costs to deposit. Material volume per millimetre is bead width times
// layer height, and the path builder slows any move whose flow would exceed the
// material limit, so the speed a bead actually prints at is the lower of the process
// speed and maxFlow / (width x layer). Flow never favors doubling up: splitting a
// stroke across beads moves the same volume.
export function depositionEstimate({beadWidthMm, layerMm, planarSpeedMmS, maxFlowMm3S, beadLengthMm = null, layers = 1}) {
  const area = beadWidthMm * layerMm, flowSpeed = maxFlowMm3S / area;
  const speed = Math.min(planarSpeedMmS, flowSpeed);
  return {
    beadAreaMm2: +area.toFixed(4), planarSpeedMmS, maxFlowMm3S, flowLimitedSpeedMmS: +flowSpeed.toFixed(2),
    effectiveSpeedMmS: +speed.toFixed(2), limitedBy: flowSpeed < planarSpeedMmS ? 'flow' : 'speed',
    flowAtSpeedMm3S: +(area * speed).toFixed(2),
    ...(beadLengthMm === null ? {} : {printMinutes: +(beadLengthMm * layers / speed / 60).toFixed(1)})
  };
}
