import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {lineWidthLimits} from '../../../core/machine/rules.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {FONTS, loadFont} from './catalog.mjs';
import {lineText} from './compile.mjs';
import {depositionEstimate, rankFonts} from './plan.mjs';

// The thinnest and widest bead this machine's tool allows in ordinary or
// experimental big-bead deposition.
export function beadRangeFor(machineId, {experimental = false} = {}) {
  const machine = loadMachine(machineId), plan = defaults(machine);
  plan.process.experimentalDeposition = experimental;
  const range = lineWidthLimits(plan, machine);
  requireThat(Array.isArray(range), `${machineId} has no ${experimental ? 'experimental ' : ''}line width range.`);
  return [Math.max(0.3, range[0]), Math.min(experimental ? 2 : 0.8, range[1])];
}

// An `adjust` patch that makes the print this word: line-network on, every other
// pattern off, and the bead width the plan chose.
export function adjustPatch(result, {machineId, experimental = false, layerMm, placement, planarSpeedMmS, maxFlowMm3S}) {
  const template = defaults(loadMachine(machineId)), skills = {};
  for (const name of Object.keys(template.skills)) skills[name] = {enabled: false};
  skills['line-network'] = result.lineNetwork;
  const process = {lineWidthMm: result.process.lineWidthMm, experimentalDeposition: experimental};
  if (layerMm !== undefined) Object.assign(process, {firstLayerMm: layerMm, layerMm});
  if (planarSpeedMmS !== undefined) process.planarSpeedMmS = planarSpeedMmS;
  if (maxFlowMm3S !== undefined) process.maxFlowMm3S = maxFlowMm3S;
  return {skills, process, ...(placement ? {placement: {xMm: placement[0], yMm: placement[1]}} : {})};
}

// Choose a font (by name, or by intent from the ranked bundle) and build the word.
export function buildWord({text, heightMm, fontId, intent = [], weight, stemRatio, beadRangeMm, layers, id}) {
  const ranking = fontId ? null : rankFonts({text, heightMm, intent, weight: weight ?? 'regular', stemRatio, beadRangeMm});
  const chosen = fontId ?? ranking.find(r => r.feasible)?.fontId;
  requireThat(chosen, `No bundled font can hold "${text}" at ${heightMm} mm with beads of ${beadRangeMm[0]}-${beadRangeMm[1]} mm; use a larger size or a thinner bead.`);
  return {fontId: chosen, ranking, result: lineText({font: loadFont(chosen), text, heightMm, weight, stemRatio, beadRangeMm, layers, id})};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const take = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args.splice(i, 2)[1]; };
  const experimental = flag('--experimental');
  const out = take('--out', null), machineId = take('--machine', 'bambu-h2d'), fontId = take('--font', undefined);
  const heightMm = Number(take('--height', 20)), weight = take('--weight', undefined), layers = Number(take('--layers', 2));
  const layerMm = take('--layer-mm', undefined), intent = take('--intent', '').split(',').filter(Boolean);
  const place = take('--place', undefined)?.split(',').map(Number), stem = take('--stem-ratio', undefined);
  const speedArg = take('--speed', undefined), flowArg = take('--max-flow', undefined);
  const text = args.join(' ').replace(/\\n/g, '\n');
  if (!text) {
    console.error('usage: line-text.mjs "word" [--height MM] [--font ID | --intent a,b] [--weight light|regular|bold | --stem-ratio R] [--machine ID] [--experimental] [--layers N] [--layer-mm MM] [--speed MM/S] [--max-flow MM3/S] [--place X,Y] [--out patch.json]');
    console.error('fonts: ' + FONTS.map(f => f.id).join(', '));
    process.exit(1);
  }
  const beadRangeMm = beadRangeFor(machineId, {experimental});
  const {fontId: chosen, ranking, result} = buildWord({text, heightMm, fontId, intent, weight, stemRatio: stem === undefined ? undefined : Number(stem), beadRangeMm, layers});
  const template = defaults(loadMachine(machineId)).process;
  const layer = layerMm === undefined ? template.layerMm : Number(layerMm);
  const deposition = depositionEstimate({
    beadWidthMm: result.plan.beadWidthMm, layerMm: layer, planarSpeedMmS: speedArg === undefined ? template.planarSpeedMmS : Number(speedArg),
    maxFlowMm3S: flowArg === undefined ? template.maxFlowMm3S : Number(flowArg), beadLengthMm: result.report.beadLengthMm, layers
  });
  if (deposition.limitedBy === 'flow' && deposition.effectiveSpeedMmS < 5)
    result.plan.warnings.push(`Flow-limited to ${deposition.effectiveSpeedMmS} mm/s: a ${result.plan.beadWidthMm.toFixed(2)} x ${layer} mm bead at the ${deposition.maxFlowMm3S} mm3/s flow limit is slow; raise --max-flow (up to the machine's limit) or use a narrower bead.`);
  if (out) writeFileSync(out, JSON.stringify(adjustPatch(result, {machineId, experimental, layerMm: layerMm === undefined ? undefined : Number(layerMm), placement: place,
    planarSpeedMmS: speedArg === undefined ? undefined : Number(speedArg), maxFlowMm3S: flowArg === undefined ? undefined : Number(flowArg)}), null, 2) + '\n');
  console.log(JSON.stringify({font: chosen, beadRangeMm, plan: result.plan, deposition, report: result.report, ranking: ranking?.map(r => ({font: r.fontId, feasible: r.feasible, intentMatches: r.intentMatches})), patch: out}, null, 2));
}
