// The slice skill: a family of horizontal slices cuts an owned volume of a
// part into layers, each filled with loops and fill in its chart. The recipe
// holds one versioned list of slice assignments (plan.slices); every variation
// is data in an assignment, never a hook.
//
//   assignments -> owners (part, volumes, family) -> owned layers (ownedLayers)
//   -> strokes (layerStrokes) -> lifted strokes (liftStrokes) -> operations
//
// Owners keep definition order. An owner without `within` takes what no other
// claims. Where two owners with `within` overlap, the first-defined one leads:
// the later one adopts the leader's slice family and the two alternate in the
// overlap, the leader's layer first. Region bands of skills not yet folded
// (vase-wall, thick-lip) and draped-skin reservations take material from the
// part before the owners share it.
//
// Whether loops run along boundaries between owners is one switch,
// LOOPS_ON_OWNER_BOUNDARIES in layer-strokes.mjs. Solid top and bottom layers
// come from where the part's sliced material ends, never from where an owner's
// share does.
import { requireThat } from '../geom/tolerance.mjs';
import { horizontalSlice, prepareSection, section, sliceFamily } from '../geom/slice.mjs';
import { solidMasks, volumeSection } from '../region/layer-region.mjs';
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
// fillDensity 1 is solid, 0 a shell of loops; loops 0 is fill only.
export const SLICE_DEFAULTS = Object.freeze({ loops: 2, fillDensity: 0.2, fillPattern: 'rectilinear', fillAnglesDeg: [45, 135],
  rotateFill: true, solidTop: 3, solidBottom: 3, fillOverlap: 0.15, spacingFactor: 1, sampleStepMm: 0.2 });
// Presets bundle settings that are not obvious. A brim is one layer of loops
// around the first-layer outline, outside the part. A support is sacrificial
// material under an assigned footprint: sparse straight rows inside one loop,
// its top layers an interface of rows at SUPPORT_INTERFACE_DENSITY.
export const SLICE_PRESETS = Object.freeze({
  brim: { loops: 5, fillDensity: 0, solidTop: 0, solidBottom: 0, within: [{ kind: 'outline' }] },
  support: { loops: 1, fillDensity: 0.15, fillAnglesDeg: [0, 90], solidTop: 2, solidBottom: 0 }
});
export const SUPPORT_INTERFACE_DENSITY = 0.8;
export const SUPPORT_GAPS = Object.freeze({ topGapMm: 0.2, xyGapMm: 0.3 });
const FIELDS = ['id', 'part', 'preset', 'filament', ...Object.keys(SLICE_DEFAULTS), 'within', 'surface', 'stack'];

// A complete assignment from a preset and overrides.
export function sliceAssignment({ id, part = null, preset = null, ...overrides }) {
  requireThat(preset === null || Object.hasOwn(SLICE_PRESETS, preset), `Unknown slice preset ${preset}; presets are ${Object.keys(SLICE_PRESETS).join(', ')}.`);
  return structuredClone({ id, part, preset, filament: null, ...SLICE_DEFAULTS, within: [], surface: { kind: 'horizontal' }, stack: null,
    ...(preset ? SLICE_PRESETS[preset] : {}), ...overrides });
}
export const defaultSlices = () => ({ version: SLICE_VERSION, assignments: [sliceAssignment({ id: 'body' })] });

const between = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const loopsList = loops => Array.isArray(loops) && loops.length > 0 && loops.every(loop => Array.isArray(loop) && loop.length >= 3 && loop.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)));
// parts: the component ids a part may name (null for a single part).
export function validateSlices(slices, { parts, lineWidthMm, firstLayerMm }) {
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
        || v?.kind === 'outline' && keys === 'kind'
        || v?.kind === 'support' && keys === 'contactZMm,footprint,kind,topGapMm,xyGapMm' && loopsList(v.footprint) && between(v.topGapMm, 0, 10) && between(v.xyGapMm, 0, 10)
          && between(v.contactZMm, firstLayerMm + v.topGapMm, 1000),
      `Slice ${a.id} volumes are { kind: 'slab', fromMm, toMm } above the part bottom, { kind: 'geometry', geometry }, { kind: 'outline' } or { kind: 'support', footprint, contactZMm, topGapMm, xyGapMm } (contact above a first layer and the top gap).`);
    }
    for (const kind of ['outline', 'support']) requireThat(!a.within.some(v => v.kind === kind) || a.within.length === 1, `Slice ${a.id}: an ${kind} volume stands alone.`);
    requireThat((a.preset === 'support') === a.within.some(v => v.kind === 'support'), `Slice ${a.id}: a support volume goes with the support preset, and the preset needs one.`);
    requireThat(a.preset !== 'support' || a.part === null, `Slice ${a.id}: a support footprint is placed with the whole print; leave part null.`);
  }
  return slices;
}

// A support volume's footprint over the bed, moved with the print.
const placedFootprint = (volume, placement) => union(volume.footprint.map(loop => loop.map(([x, y]) => [x + placement.xMm, y + placement.yMm])), []);
const regionBox = loops => {
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const loop of loops) for (const [a, b] of loop) { min[0] = Math.min(min[0], a); min[1] = Math.min(min[1], b); max[0] = Math.max(max[0], a); max[1] = Math.max(max[1], b); }
  return { min, max };
};

// Owners of every assignment, in definition order. shells: [[part, shell,
// whole]] (part null for a single part; whole marks the shells an assignment
// without a part cuts); processes: each assignment's process (its
// filament's, when it names one); volumes: built geometry volumes by
// assignment id and index; placement moves support footprints. Each owner:
// {id, kind (part, outline or support), assignment, part, shell, within,
// family, widthMm, startMm, endMm}; a part owner's family spans its whole
// part, so solid masks see where the part ends.
export function sliceOwners(assignments, { shells, processes, volumes = new Map(), placement = { xMm: 0, yMm: 0 } }) {
  const owners = [];
  for (const [n, assignment] of assignments.entries()) {
    const stack = assignment.stack ?? processes[n], widthMm = processes[n].lineWidthMm;
    if (assignment.preset === 'support') {
      const volume = assignment.within[0], footprint = placedFootprint(volume, placement), box = regionBox(footprint);
      const top = volume.contactZMm - volume.topGapMm;
      const family = sliceFamily({ base: horizontalSlice(0), pitchMm: stack.layerMm, firstLayerMm: stack.firstLayerMm }, { min: [box.min[0], box.min[1], 0], max: [box.max[0], box.max[1], top] });
      owners.push({ id: assignment.id, kind: 'support', assignment, part: `support:${assignment.id}`, shell: { bounds: { min: [box.min[0], box.min[1], 0], max: [box.max[0], box.max[1], top] } },
        within: [], widthMm, footprint, gaps: { topGapMm: volume.topGapMm, xyGapMm: volume.xyGapMm }, contactZMm: volume.contactZMm, family, startMm: 0, endMm: top });
      continue;
    }
    const selected = shells.filter(([part, , whole]) => assignment.part === null ? whole : part === assignment.part);
    for (const [part, shell] of selected) {
      const bottom = shell.bounds.min[2], top = shell.bounds.max[2];
      const outline = assignment.within.some(v => v.kind === 'outline');
      const within = outline ? [] : assignment.within.map((v, i) => v.kind === 'slab'
        ? { kind: 'slab', fromMm: bottom + v.fromMm, toMm: v.toMm === null ? top : bottom + v.toMm }
        : { kind: 'geometry', geometry: volumes.get(assignment.id)[i] });
      const slabs = within.filter(v => v.kind === 'slab');
      const from = Math.max(bottom, ...slabs.map(v => v.fromMm)), to = Math.min(top, ...slabs.map(v => v.toMm));
      requireThat(to > from, `Slice ${assignment.id} owns no height of its part.`);
      // An owner with its own stack starts its grid at its lowest slab.
      const base = horizontalSlice(assignment.stack && slabs.length ? from : bottom);
      const [startMm, endMm] = outline ? [bottom, bottom + stack.firstLayerMm] : [from, to];
      const family = sliceFamily({ base, pitchMm: stack.layerMm, firstLayerMm: stack.firstLayerMm },
        { min: [shell.bounds.min[0], shell.bounds.min[1], base.origin[2]], max: [shell.bounds.max[0], shell.bounds.max[1], outline ? endMm : top] });
      owners.push({ id: part !== null ? `${part}:${assignment.id}` : assignment.id, kind: outline ? 'outline' : 'part', assignment, part, shell, within, family, widthMm, startMm, endMm });
    }
  }
  for (const part of new Set(owners.map(o => o.part))) {
    const defaults = owners.filter(o => o.part === part && o.kind === 'part' && !o.within.length);
    requireThat(defaults.length <= 1, `Slices ${defaults.map(o => o.assignment.id).join(' and ')} both own the rest of ${part ?? 'the part'}; give all but one a within volume.`);
  }
  return owners;
}

// A volume's box: geometry bounds and slab heights, for skipping owner pairs
// that cannot meet.
function volumeBox(owner) {
  const box = { min: [...owner.shell.bounds.min], max: [...owner.shell.bounds.max] };
  for (const v of owner.within) {
    const [lo, hi] = v.kind === 'slab' ? [[-Infinity, -Infinity, v.fromMm], [Infinity, Infinity, v.toMm]] : [v.geometry.bounds.min, v.geometry.bounds.max];
    for (let i = 0; i < 3; i++) { box.min[i] = Math.max(box.min[i], lo[i]); box.max[i] = Math.min(box.max[i], hi[i]); }
  }
  return box;
}
const boxesMeet = (a, b) => [0, 1, 2].every(i => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]) > 1e-9);
// Plan boxes that meet or touch.
const planBoxesMeet = (a, b) => [0, 1].every(i => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]) >= -1e-9);

// The owned region of every owner's layers. Each part's section and sliced
// material (section less bands and reservations) is cut once per height and
// shared by its owners; an owner's share is its volumes less the volumes it
// yields to, with leader and follower alternation.
// -> [{owner, leader, family, layers: [{index, slice, heightMm, region, material, share}], material: Map(index -> loops)}]
// share is null where the owner holds the whole plane, else {within, claims}:
// the owner's volume section (null for the whole plane) and the union it yields.
export function ownedLayers(owners, { shells = [], bands = [], reserves = [], onProgress }) {
  const cache = new Map(), cached = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
  const at = slice => slice.origin[2].toFixed(9);
  const prepared = owner => cached(`prepared|${owner.part}|${at(owner.family.base)}`, () => prepareSection(owner.shell, owner.family.base));
  const partSection = (owner, slice) => cached(`section|${owner.part}|${at(slice)}`, () => section(prepared(owner), slice).loops);
  const material = (owner, slice) => cached(`material|${owner.part}|${at(slice)}`, () => {
    const z = slice.origin[2];
    if (owner.kind === 'support') return z <= owner.endMm + 1e-8 ? owner.footprint : [];
    if (bands.some(b => b.part === owner.part && z > b.startMm + 1e-9 && z <= b.endMm + 1e-9)) return [];
    let region = partSection(owner, slice);
    for (const reserve of reserves) region = clipReservedRegion(region, z, reserve);
    return region;
  });
  // An owner's volume section: loops, or null where it holds the whole plane.
  const extent = owner => { const { min, max } = owner.shell.bounds, m = 1 + 1e-3 * Math.max(max[0] - min[0], max[1] - min[1]); return { min: [min[0] - m, min[1] - m], max: [max[0] + m, max[1] + m] }; };
  const volume = (owner, layer) => cached(`volume|${owner.id}|${at(layer.slice)}`, () => {
    const cuts = owner.within.map(v => volumeSection(v, layer, extent(owner))).filter(c => c !== null);
    return cuts.length ? cuts.reduce((a, b) => a.length && b.length ? intersect(a, b) : []) : null;
  });
  const explicit = owners.filter(o => o.kind === 'part' && o.within.length);
  const boxes = new Map(explicit.map(o => [o, volumeBox(o)]));
  // Leaders: the first earlier explicit owner of the same part whose volume
  // meets this one's part material in some layer of the leader's family.
  const pairs = new Map(), familyOf = owner => pairs.get(owner)?.family ?? owner.family;
  for (const follower of explicit) for (const leader of explicit) {
    if (leader === follower) break;
    if (leader.part !== follower.part || pairs.has(follower) || !boxesMeet(boxes.get(leader), boxes.get(follower))) continue;
    const lo = Math.max(boxes.get(leader).min[2], boxes.get(follower).min[2]), hi = Math.min(boxes.get(leader).max[2], boxes.get(follower).max[2]);
    const family = familyOf(leader);
    const first = family.layers.find(l => {
      const z = l.slice.origin[2];
      if (z <= lo + 1e-9 || z > hi + 1e-9) return false;
      const a = volume(leader, l), b = volume(follower, l), cut = partSection(leader, l.slice);
      const overlap = a === null ? b : b === null ? a : a.length && b.length ? intersect(a, b) : [];
      return overlap === null ? regionArea(cut) > 0 : overlap.length > 0 && regionArea(intersect(cut, overlap)) > 0;
    });
    if (first) pairs.set(follower, { leader, family, firstIndex: first.index });
  }
  // Whether owner yields layer to other: every other explicit owner of its
  // part, except an alternating partner on the owner's own turn.
  const yields = (owner, other, layer) => {
    if (other === owner || other.part !== owner.part) return false;
    if (!owner.within.length) return true;
    const mine = pairs.get(owner)?.leader === other ? pairs.get(owner) : pairs.get(other)?.leader === owner ? pairs.get(other) : null;
    if (!mine) return true;
    const leaderTurn = (layer.index - mine.firstIndex) % 2 === 0;
    return mine.leader === other ? leaderTurn : !leaderTurn;
  };
  const results = [];
  let done = 0;
  const total = owners.reduce((n, o) => n + familyOf(o).layers.length, 0);
  for (const owner of owners) {
    const family = familyOf(owner), settings = owner.assignment, layers = [];
    for (const layer of family.layers) {
      onProgress?.({ stage: 'Slicing layers', completed: done++, total });
      const z = layer.slice.origin[2];
      if (z <= owner.startMm + 1e-9 || z > owner.endMm + 1e-9) continue;
      const own = material(owner, layer.slice);
      let region = own, share = null, boundary = own;
      if (owner.kind === 'outline') {
        // A brim's loops grow outward from the part's first-layer outline.
        boundary = partSection(owner, layer.slice);
        region = difference(offsetRegion(boundary, settings.loops * lineSpacing(owner.widthMm, settings)), boundary);
      } else if (owner.kind === 'part' && own.length) {
        const within = owner.within.length ? volume(owner, layer) : null;
        if (within !== null) region = within.length ? intersect(region, within) : [];
        // Only volumes that reach the region's box can take from it.
        const box = region.length ? regionBox(region) : null;
        const yielded = box ? explicit.filter(other => yields(owner, other, layer)).map(other => volume(other, layer))
          .filter(cut => cut === null || cut.length && planBoxesMeet(regionBox(cut), box)) : [];
        const claims = yielded.includes(null) ? null : yielded.reduce((a, b) => a.length ? union(a, b) : b, []);
        if (claims === null) region = [];
        else if (claims.length) region = difference(region, claims);
        if (within !== null || claims?.length) share = { within, claims: claims ?? [] };
      }
      if (owner.kind === 'support') {
        for (const [part, shell, whole] of shells) {
          if (!whole || z < shell.bounds.min[2] - 1e-8 || z > shell.bounds.max[2] + 1e-8 || !region.length) continue;
          const obstacle = offsetRegion(partSection({ part, shell, family }, layer.slice), owner.gaps.xyGapMm);
          requireThat(regionArea(intersect(region, obstacle)) < 1e-8, `Support ${settings.id} meets its part clearance at Z ${z.toFixed(3)} mm; revise its footprint.`);
        }
      }
      layers.push({ index: layer.index, slice: layer.slice, heightMm: layer.heightMm, region, material: boundary, share, outward: owner.kind === 'outline' });
    }
    // Solid masks read the sliced material of the neighbouring layers.
    const reach = owner.kind === 'outline' ? 0 : Math.max(settings.solidTop, settings.solidBottom);
    const byIndex = new Map(layers.map(l => [l.index, l])), masks = new Map();
    for (const layer of family.layers) {
      let near = false;
      for (let d = -reach; d <= reach && !near; d++) near = byIndex.has(layer.index + d);
      if (near) masks.set(layer.index, byIndex.get(layer.index)?.material ?? material(owner, layer.slice));
    }
    results.push({ owner, leader: pairs.get(owner)?.leader.id ?? null, family, layers, material: masks });
  }
  return results;
}

// One owner's operations from its owned layers. spec: {id, settings, layers,
// material?: Map(index -> sliced material) for solid masks (the layers' own
// regions when absent), solidRegions?: Map(index -> loops) always filled
// solid, filament}; context: {process, machine, shell, startMm, endMm, report}.
// A support preset's operations are sacrificial: support roles, the supports
// phase and no finished boundary.
export function sliceResult({ id, settings, layers, material = null, solidRegions = new Map(), filament = null }, { process, machine, shell, startMm, endMm, report: extra = {} }) {
  const width = process.lineWidthMm, pitch = lineSpacing(width, settings), wallToleranceMm = planarWallTolerance(machine);
  const support = settings.preset === 'support', solidDensity = support ? SUPPORT_INTERFACE_DENSITY : 1;
  const masked = settings.fillDensity < 1 && (settings.solidTop > 0 || settings.solidBottom > 0 || solidRegions.size > 0);
  const maskLayers = material ? [...material].map(([index, region]) => ({ index, region })) : layers;
  const angles = settings.fillAnglesDeg, angleAt = index => settings.rotateFill ? angles[index % angles.length] : angles[0];
  const roles = support ? { perimeter: 'support-wall', 'perimeter-inner': 'support-wall', infill: 'support', fill: 'support-interface' } : null;
  const operations = [], report = { layers: 0, skippedLayers: 0, areaMm2: 0, loops: 0, fillRows: 0, solidAreaMm2: 0, ...extra };
  let previous = [];
  for (const layer of layers) {
    const { index, slice, region, share = null } = layer, z = slice.origin[2];
    if (!region.length || regionArea(region) < width * width) { report.skippedLayers++; continue; }
    const own = layer.material ?? region, outward = layer.outward ?? false;
    const solid = masked ? union(solidMasks(maskLayers, index, { bottomLayers: settings.solidBottom, topLayers: settings.solidTop }).solid,
      intersect(region, union(solidRegions.get(index) ?? [], []))) : null;
    const strokes = layerStrokes(region, { ...settings, widthMm: width, fillAngleDeg: angleAt(index), solidDensity,
      patternAngleDeg: settings.fillPattern === 'rectilinear' ? angleAt(index) : angles[0], phaseMm: z, wallToleranceMm, solid,
      material: own, share, outward });
    const wallMaterial = () => loopMaterial(region, { widthMm: width, loops: settings.loops, spacingFactor: settings.spacingFactor }, { material: own, share, outward });
    report.solidAreaMm2 += regionArea(strokes.solidRegion);
    report.loops += strokes.walls.length; report.fillRows += strokes.infill.length + strokes.fill.length;
    const speedMmS = index === 0 ? process.firstLayerSpeedMmS : process.planarSpeedMmS;
    const travelPolicy = planarPolicy(region, { layerZ: z, liftMm: process.liftMm, maxCombMm: process.maxCombMm, lineWidthMm: width });
    const current = [];
    for (const [group, found] of [['walls', strokes.walls], ['infill', strokes.infill], ['fill', strokes.fill]]) {
      if (!found.length) continue;
      const spacing = group === 'infill' ? pitch / settings.fillDensity : pitch / solidDensity;
      const opId = `${id}:${index}:${group}`;
      let covered;
      const lifted = liftStrokes(found, layer, { widthMm: width, speedMmS });
      operations.push({ id: opId, layerId: 'planar:' + z, phase: support ? 'supports' : 'planar', layer: index, rank: z, after: [...previous, ...current],
        strokes: roles ? lifted.map(stroke => ({ ...stroke, role: roles[stroke.role] })) : lifted, connectNearby: true,
        // Loops a boundary between owners cuts open are laid in the order found.
        order: group === 'walls' ? (found.every(s => s.closed) ? 'nearest' : 'given') : found.every(s => s.scanlineCell !== undefined) ? 'nearest-cells' : 'given', region,
        // Coverage is consumed by material-region publication; built on first use.
        get materialRegion() {
          return covered ??= group === 'walls' ? wallMaterial()
            : fillMaterial(group === 'infill' ? strokes.sparseRegion : strokes.solidRegion, width);
        },
        materialCoverage: group !== 'walls' && spacing > width + 1e-8 ? 'sparse' : 'area',
        travelPolicy, ...(index === 1 ? { fanPercent: process.fanPercent } : {}), ...(filament === null ? {} : { filament }) });
      current.push(opId);
    }
    previous = current;
    report.layers++; report.areaMm2 += regionArea(region);
  }
  if (support) return { id, operations, report };
  const coverage = settings.loops > 0 || (settings.fillDensity >= 1 && pitch <= width + 1e-8) ? 'nominal' : 'sparse';
  return publishFinishedBoundary({ id, operations, report }, { shell, startMm, endMm, coverage });
}

// Every slice assignment of a plan: owners, owned layers, results. Support
// owners' results come back apart: they print before the part operations
// they hold up (supportDependencies).
// -> {results, supports, summary: {layers, instances}}
// envelopes: [{part, solidRegionAt(z)}] regions a process (a plastic-weld
// rivet) needs solid in the slices of its part.
export function sliceResults({ plan, machine, shells, volumes, bands, reserves, envelopes = [], onProgress }) {
  const assignments = plan.slices.assignments;
  if (!assignments.length) return { results: [], supports: [], summary: null };
  const processes = assignments.map(a => a.filament === null ? plan.process : filamentPlan(plan, machine, a.filament).process);
  const owners = sliceOwners(assignments, { shells, processes, volumes, placement: plan.placement });
  const owned = ownedLayers(owners, { shells, bands, reserves, onProgress });
  const results = [], supports = [];
  for (const { owner, leader, family, layers, material } of owned) {
    const { assignment } = owner;
    const process = processes[assignments.indexOf(assignment)];
    const held = envelopes.filter(e => e.part === owner.part);
    const solidRegions = new Map(held.length ? layers.map(l => [l.index, held.flatMap(e => e.solidRegionAt(l.slice.origin[2]))]) : []);
    const report = { owner: assignment.id, part: owner.kind === 'support' ? null : owner.part, leader, layerMm: family.pitchMm,
      ...(owner.kind === 'support' ? { contactZMm: owner.contactZMm, actualTopGapMm: owner.contactZMm - Math.max(...layers.filter(l => l.region.length).map(l => l.slice.origin[2])) } : {}) };
    const result = sliceResult({ id: owner.id, settings: assignment, layers, material, solidRegions, filament: assignment.filament },
    { process, machine, shell: owner.shell, startMm: owner.startMm, endMm: owner.endMm, report });
    (owner.kind === 'support' ? supports : results).push(result);
  }
  requireThat([...results, ...supports].some(r => r.operations.length), 'The slice assignments produced no material.');
  const layerIds = new Set([...results, ...supports].flatMap(r => r.operations.map(op => op.layerId)));
  return { results, supports, summary: { layers: layerIds.size, instances: [...results, ...supports].map(r => ({ id: r.id, ...r.report })) } };
}
