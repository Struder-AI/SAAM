// The slice skill: a family of horizontal slices cuts an owned volume of a
// part into layers, each filled with loops and fill in its chart. The recipe
// holds one versioned list of slice assignments (plan.slices); every variation
// is data in an assignment, never a hook.
//
//   assignments -> owners (part, volumes, family) -> layer regions (layerRegion)
//   -> strokes (layerStrokes) -> lifted strokes (liftStrokes) -> operations
//
// Owners keep definition order. An owner without `within` takes what no other
// claims. Where two owners with `within` overlap, the first-defined one leads:
// the later one adopts the leader's slice family and the two alternate in the
// overlap, the leader's layer first. Region bands of skills not yet folded
// (vase-wall, thick-lip) and draped-skin reservations claim material too.
import { requireThat } from '../geom/tolerance.mjs';
import { horizontalSlice, prepareSection, section, sliceFamily } from '../geom/slice.mjs';
import { layerRegion, solidMasks } from '../region/layer-region.mjs';
import { layerStrokes, liftStrokes, loopMaterial, fillMaterial } from '../region/layer-strokes.mjs';
import { FILL_PATTERNS } from '../region/fill-patterns.mjs';
import { offsetRegion } from '../region/offset.mjs';
import { regionArea } from '../region/region2d.mjs';
import { difference, intersect, union } from '../region/boolean.mjs';
import { clipReservedRegion } from '../region/reservation.mjs';
import { lineSpacing } from '../path/spacing.mjs';
import { planarPolicy } from '../path/builder.mjs';
import { publishFinishedBoundary } from '../path/finished-surface.mjs';
import { planarWallTolerance } from '../machine/rules.mjs';
import { filamentPlan } from '../machine/filaments.mjs';

export const SLICE_VERSION = 1;
// The normal case: two loops, 20% fill, three solid layers top and bottom.
// fillDensity 1 is solid, 0 a shell of loops; loops 0 is fill only. Solid
// layers (top, bottom, and fillDensity 1) are rows at solidDensity.
export const SLICE_DEFAULTS = Object.freeze({ loops: 2, fillDensity: 0.2, solidDensity: 1, fillPattern: 'rectilinear', fillAnglesDeg: [45, 135],
  rotateFill: true, solidTop: 3, solidBottom: 3, fillOverlap: 0.15, spacingFactor: 1, sampleStepMm: 0.2 });
// Presets bundle settings that are not obvious. A brim is one layer of loops
// around the first-layer outline, outside the part.
export const SLICE_PRESETS = Object.freeze({
  brim: { loops: 5, fillDensity: 0, solidTop: 0, solidBottom: 0, within: [{ kind: 'outline' }] }
});
const FIELDS = ['id', 'part', 'preset', 'filament', ...Object.keys(SLICE_DEFAULTS), 'within', 'surface', 'stack'];

// A complete assignment from a preset and overrides.
export function sliceAssignment({ id, part = null, preset = null, ...overrides }) {
  requireThat(preset === null || Object.hasOwn(SLICE_PRESETS, preset), `Unknown slice preset ${preset}; presets are ${Object.keys(SLICE_PRESETS).join(', ')}.`);
  return structuredClone({ id, part, preset, filament: null, ...SLICE_DEFAULTS, within: [], surface: { kind: 'horizontal' }, stack: null,
    ...(preset ? SLICE_PRESETS[preset] : {}), ...overrides });
}
export const defaultSlices = () => ({ version: SLICE_VERSION, assignments: [sliceAssignment({ id: 'body' })] });

const between = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
// parts: the component ids a part may name (null for a single part).
export function validateSlices(slices, { parts, lineWidthMm }) {
  requireThat(slices && typeof slices === 'object' && Object.keys(slices).sort().join() === 'assignments,version', 'plan.slices needs version and assignments.');
  requireThat(slices.version === SLICE_VERSION, `Unsupported slice version ${slices.version}; this generator reads version ${SLICE_VERSION}.`);
  requireThat(Array.isArray(slices.assignments) && slices.assignments.length <= 80, 'Slice assignments are a list of at most 80.');
  const ids = new Set();
  for (const a of slices.assignments) {
    const unexpected = Object.keys(a ?? {}).filter(k => !FIELDS.includes(k)), missing = FIELDS.filter(k => !Object.hasOwn(a ?? {}, k));
    requireThat(!unexpected.length && !missing.length, `Slice assignment ${a?.id ?? ''} has ${[unexpected.length ? 'unexpected ' + unexpected.join(', ') : '', missing.length ? 'missing ' + missing.join(', ') : ''].filter(Boolean).join('; ')}.`);
    requireThat(typeof a.id === 'string' && /^[a-z][a-z0-9-]*$/.test(a.id) && !ids.has(a.id), 'Invalid or duplicate slice assignment id.'); ids.add(a.id);
    requireThat(a.part === null || parts?.includes(a.part), `Slice ${a.id} names an unknown part.`);
    requireThat(a.preset === null || Object.hasOwn(SLICE_PRESETS, a.preset), `Slice ${a.id} has an unknown preset.`);
    requireThat(a.filament === null || Number.isInteger(a.filament) && a.filament >= 0, `Slice ${a.id} filament must be null or a filament index.`);
    requireThat(Number.isInteger(a.loops) && a.loops >= 0, `Slice ${a.id} loops must be a whole number.`);
    requireThat(between(a.fillDensity, 0, 1) && (a.fillDensity === 0 || a.fillDensity >= 0.01), `Slice ${a.id} fillDensity must be 0 or 0.01–1.`);
    requireThat(between(a.solidDensity, 0.01, 1), `Slice ${a.id} solidDensity must be 0.01–1.`);
    requireThat(FILL_PATTERNS.includes(a.fillPattern), `Slice ${a.id} fillPattern must be one of ${FILL_PATTERNS.join(', ')}.`);
    requireThat(Array.isArray(a.fillAnglesDeg) && a.fillAnglesDeg.length > 0 && a.fillAnglesDeg.every(v => between(v, -180, 180)), `Slice ${a.id} has invalid fill angles.`);
    requireThat(typeof a.rotateFill === 'boolean', `Slice ${a.id} rotateFill must be true or false.`);
    for (const key of ['solidTop', 'solidBottom']) requireThat(Number.isInteger(a[key]) && a[key] >= 0 && a[key] <= 20, `Slice ${a.id} ${key} must be 0–20.`);
    requireThat(between(a.fillOverlap, 0, 0.5) && between(a.sampleStepMm, 0.01, 2), `Slice ${a.id} fillOverlap must be 0–0.5 and sampleStepMm 0.01–2.`);
    lineSpacing(lineWidthMm, a);
    requireThat(a.surface && Object.keys(a.surface).join() === 'kind' && a.surface.kind === 'horizontal', `Slice ${a.id}: only horizontal slices are available in this version.`);
    requireThat(a.stack === null || Object.keys(a.stack).sort().join() === 'firstLayerMm,layerMm' && between(a.stack.firstLayerMm, 0.01, 10) && between(a.stack.layerMm, 0.01, 10),
      `Slice ${a.id} stack must be null or { firstLayerMm, layerMm }.`);
    requireThat(Array.isArray(a.within), `Slice ${a.id} within must be a list of volumes.`);
    for (const v of a.within) {
      const keys = Object.keys(v ?? {}).sort().join();
      requireThat(v?.kind === 'slab' && keys === 'fromMm,kind,toMm' && between(v.fromMm, 0, 10000) && (v.toMm === null || between(v.toMm, v.fromMm + 1e-6, 10000))
        || v?.kind === 'geometry' && keys === 'geometry,kind' && v.geometry && typeof v.geometry === 'object'
        || v?.kind === 'outline' && keys === 'kind',
      `Slice ${a.id} volumes are { kind: 'slab', fromMm, toMm } above the part bottom, { kind: 'geometry', geometry } or { kind: 'outline' }.`);
    }
    requireThat(!a.within.some(v => v.kind === 'outline') || a.within.length === 1, `Slice ${a.id}: an outline volume stands alone.`);
  }
  return slices;
}

// Owners of every assignment, in definition order. shells: [[part, shell]]
// (part null for a single part); volumes: built geometry volumes by
// assignment id and index; bands: [{part, startMm, endMm}] claimed by other
// skills. Each owner: {id, assignment, part, shell, within, family, outline}.
export function sliceOwners(assignments, { shells, process, volumes = new Map() }) {
  const owners = [];
  for (const assignment of assignments) {
    const selected = shells.filter(([part]) => assignment.part === null || part === assignment.part);
    for (const [part, shell] of selected) {
      const bottom = shell.bounds.min[2], stack = assignment.stack ?? process;
      const outline = assignment.within.some(v => v.kind === 'outline');
      const within = outline ? [] : assignment.within.map((v, i) => v.kind === 'slab'
        ? { kind: 'slab', fromMm: bottom + v.fromMm, toMm: v.toMm === null ? shell.bounds.max[2] : bottom + v.toMm }
        : { kind: 'geometry', geometry: volumes.get(assignment.id)[i] });
      const slabs = within.filter(v => v.kind === 'slab');
      const from = Math.max(bottom, ...slabs.map(v => v.fromMm)), to = Math.min(shell.bounds.max[2], ...slabs.map(v => v.toMm));
      requireThat(to > from, `Slice ${assignment.id} owns no height of its part.`);
      // An owner with its own stack starts its grid at its lowest slab.
      const base = horizontalSlice(assignment.stack && slabs.length ? from : bottom);
      const family = sliceFamily({ base, pitchMm: stack.layerMm, firstLayerMm: stack.firstLayerMm },
        { min: [shell.bounds.min[0], shell.bounds.min[1], outline ? bottom : from], max: [shell.bounds.max[0], shell.bounds.max[1], outline ? bottom + stack.firstLayerMm : to] });
      owners.push({ id: shells.length > 1 ? `${part}:${assignment.id}` : assignment.id, assignment, part, shell, within, family, outline,
        startMm: outline ? bottom : from, endMm: outline ? bottom + stack.firstLayerMm : to });
    }
  }
  for (const part of new Set(owners.map(o => o.part))) {
    const defaults = owners.filter(o => o.part === part && !o.within.length && !o.outline);
    requireThat(defaults.length <= 1, `Slices ${defaults.map(o => o.assignment.id).join(' and ')} both own the rest of ${part ?? 'the part'}; give all but one a within volume.`);
  }
  return owners;
}

// The owned region of every owner's layers: layer regions with leader and
// follower alternation, band claims and draped-skin reservations applied.
// -> [{owner, leader, layers: [{index, slice, heightMm, region}]}]
export function ownedLayers(owners, { bands = [], reserves = [], lineWidthMm, onProgress }) {
  const claims = owner => bands.filter(b => b.part === owner.part).map(b => ({ id: 'band', within: [{ kind: 'slab', fromMm: b.startMm, toMm: b.endMm }] }));
  const explicit = owners.filter(o => o.within.length);
  // Leaders: the first earlier explicit owner of the same part whose volume
  // meets this one's in some layer of the leader's family.
  const pairs = new Map();
  for (const follower of explicit) for (const leader of explicit) {
    if (leader === follower) break;
    if (leader.part !== follower.part || pairs.has(follower)) continue;
    const prepared = { id: leader.id, family: leader.family, part: prepareSection(leader.shell, leader.family.base), within: [...leader.within, ...follower.within] };
    const first = leader.family.layers.find(l => regionArea(layerRegion(prepared, l.index).region) > 0);
    if (first) pairs.set(follower, { leader, firstIndex: first.index });
  }
  const led = owner => pairs.get(owner);
  const results = [];
  let done = 0;
  const total = owners.reduce((n, o) => n + o.family.layers.length, 0);
  for (const owner of owners) {
    const pair = led(owner), family = pair ? pair.leader.family : owner.family;
    const prepared = { id: owner.id, part: prepareSection(owner.shell, family.base), within: owner.within, family };
    const layers = [];
    for (const layer of family.layers) {
      onProgress?.({ stage: 'Slicing layers', completed: done++, total });
      const z = layer.slice.origin[2];
      if (z <= owner.startMm + 1e-9 || z > owner.endMm + 1e-9) continue;
      let region;
      if (owner.outline) {
        const cut = section(prepared.part, layer.slice).loops;
        region = difference(offsetRegion(cut, owner.assignment.loops * lineSpacing(lineWidthMm, owner.assignment)), cut);
      } else {
        // Owners this layer yields to: every other explicit owner of the part,
        // except a partner that alternates with it and yields this layer.
        const others = [...claims(owner), ...explicit.filter(other => {
          if (other === owner || other.part !== owner.part) return false;
          const mine = pairs.get(owner)?.leader === other ? pairs.get(owner) : pairs.get(other)?.leader === owner ? pairs.get(other) : null;
          if (!mine) return true;
          const leaderTurn = (layer.index - mine.firstIndex) % 2 === 0;
          return mine.leader === other ? leaderTurn : !leaderTurn;
        })];
        region = layerRegion(prepared, layer.index, owner.within.length ? others : [...claims(owner), ...explicit.filter(o => o.part === owner.part)]).region;
        for (const reserve of reserves) region = clipReservedRegion(region, z, reserve);
      }
      layers.push({ index: layer.index, slice: layer.slice, heightMm: layer.heightMm, region });
    }
    results.push({ owner, leader: pair?.leader.id ?? null, layers });
  }
  return results;
}

// One owner's operations from its owned layers. spec: {id, settings, layers,
// solidRegions?: Map(index -> loops) always filled solid, filament}; context:
// {process, machine, shell, startMm, endMm, report}.
export function sliceResult({ id, settings, layers, solidRegions = new Map(), filament = null }, { process, machine, shell, startMm, endMm, report: extra = {} }) {
  const width = process.lineWidthMm, pitch = lineSpacing(width, settings), wallToleranceMm = planarWallTolerance(machine);
  const masked = settings.fillDensity < 1 && (settings.solidTop > 0 || settings.solidBottom > 0 || solidRegions.size > 0);
  const angles = settings.fillAnglesDeg, angleAt = index => settings.rotateFill ? angles[index % angles.length] : angles[0];
  const operations = [], report = { layers: 0, skippedLayers: 0, areaMm2: 0, loops: 0, fillRows: 0, solidAreaMm2: 0, ...extra };
  let previous = [];
  for (const layer of layers) {
    const { index, slice, region } = layer, z = slice.origin[2];
    if (!region.length || regionArea(region) < width * width) { report.skippedLayers++; continue; }
    const solid = masked ? union(solidMasks(layers, index, { bottomLayers: settings.solidBottom, topLayers: settings.solidTop }).solid,
      intersect(region, union(solidRegions.get(index) ?? [], []))) : null;
    const strokes = layerStrokes(region, { ...settings, widthMm: width, fillAngleDeg: angleAt(index),
      patternAngleDeg: settings.fillPattern === 'rectilinear' ? angleAt(index) : angles[0], phaseMm: z, wallToleranceMm, solid });
    report.solidAreaMm2 += regionArea(strokes.solidRegion);
    report.loops += strokes.walls.length; report.fillRows += strokes.infill.length + strokes.fill.length;
    const speedMmS = index === 0 ? process.firstLayerSpeedMmS : process.planarSpeedMmS;
    const travelPolicy = planarPolicy(region, { layerZ: z, liftMm: process.liftMm, maxCombMm: process.maxCombMm, lineWidthMm: width });
    const current = [];
    for (const [group, found] of [['walls', strokes.walls], ['infill', strokes.infill], ['fill', strokes.fill]]) {
      if (!found.length) continue;
      const spacing = group === 'infill' ? pitch / settings.fillDensity : pitch / settings.solidDensity;
      const opId = `${id}:${index}:${group}`;
      let material;
      operations.push({ id: opId, layerId: 'planar:' + z, phase: 'planar', layer: index, rank: z, after: [...previous, ...current],
        strokes: liftStrokes(found, layer, { widthMm: width, speedMmS }), connectNearby: true,
        order: group === 'walls' ? 'nearest' : found.every(s => s.scanlineCell !== undefined) ? 'nearest-cells' : 'given', region,
        // Coverage is consumed by material-region publication; built on first use.
        get materialRegion() {
          return material ??= group === 'walls' ? loopMaterial(region, { widthMm: width, loops: settings.loops, spacingFactor: settings.spacingFactor })
            : fillMaterial(group === 'infill' ? strokes.sparseRegion : strokes.solidRegion, width);
        },
        materialCoverage: group !== 'walls' && spacing > width + 1e-8 ? 'sparse' : 'area',
        travelPolicy, ...(index === 1 ? { fanPercent: process.fanPercent } : {}), ...(filament === null ? {} : { filament }) });
      current.push(opId);
    }
    previous = current;
    report.layers++; report.areaMm2 += regionArea(region);
  }
  const coverage = settings.loops > 0 || (settings.fillDensity >= 1 && pitch <= width + 1e-8) ? 'nominal' : 'sparse';
  return publishFinishedBoundary({ id, operations, report }, { shell, startMm, endMm, coverage });
}

// Every slice assignment of a plan: owners, owned layers, results.
// -> {results, summary: {layers, instances}}
// envelopes: [{part, solidRegionAt(z)}] regions a process (a plastic-weld
// rivet) needs solid in the slices of its part.
export function sliceResults({ plan, machine, shells, volumes, bands, reserves, envelopes = [], onProgress }) {
  const assignments = plan.slices.assignments;
  if (!assignments.length) return { results: [], summary: null };
  const owners = sliceOwners(assignments, { shells, process: plan.process, volumes });
  const owned = ownedLayers(owners, { bands, reserves, lineWidthMm: plan.process.lineWidthMm, onProgress });
  const results = owned.map(({ owner, leader, layers }) => {
    const { assignment } = owner, family = leader ? owned.find(o => o.owner.id === leader).owner.family : owner.family;
    const process = assignment.filament === null ? plan.process : filamentPlan(plan, machine, assignment.filament).process;
    const held = envelopes.filter(e => e.part === owner.part);
    const solidRegions = new Map(held.length ? layers.map(l => [l.index, held.flatMap(e => e.solidRegionAt(l.slice.origin[2]))]) : []);
    return sliceResult({ id: owner.id, settings: assignment, layers, solidRegions, filament: assignment.filament },
      { process, machine, shell: owner.shell, startMm: owner.startMm, endMm: owner.endMm,
        report: { owner: assignment.id, part: owner.part, leader, layerMm: family.pitchMm } });
  });
  requireThat(results.some(r => r.operations.length), 'The slice assignments produced no material.');
  const layerIds = new Set(results.flatMap(r => r.operations.map(op => op.layerId)));
  return { results, summary: { layers: layerIds.size, instances: results.map(r => ({ id: r.id, ...r.report })) } };
}
