// General plane slicing: spatial ownership -> compatible families -> chart
// regions/strokes -> world curves -> deposition -> ownership-constrained order.
// Shared zones use the first claimant's references; each owner's outside retains
// its own family. Internal owner boundaries have walls; solid masks follow part
// material rather than ownership seams.
import { curveAssignment, validateCurveAssignment } from './curves.mjs';
import { heightSlice, heightSliceNormal, heightReferencePatch, heightReferenceBounds } from '../geom/height-slice.mjs';
import { validateSplineSolid } from '../geom/spline-solid.mjs';
import { geometrySelections } from '../geom/selections.mjs';
import { requireThat } from '../geom/tolerance.mjs';
import { horizontalSlice, planeSlice, slicePoint, prepareSection, section, sliceFamily } from '../geom/slice.mjs';
import { solidMasks, volumeSection } from '../region/layer-region.mjs';
import { layerStrokes, mapSliceStrokes, loopMaterial, fillMaterial } from '../region/layer-strokes.mjs';
import { FILL_PATTERNS } from '../region/fill-patterns.mjs';
import { offsetRegion } from '../region/offset.mjs';
import { regionArea } from '../region/region2d.mjs';
import { difference, intersect, union } from '../region/boolean.mjs';
import { clipReservedRegion, clipReservedSlice } from '../region/reservation.mjs';
import { depositCurves } from '../path/deposition.mjs';
import { lineSpacing } from '../path/spacing.mjs';
import { planarPolicy, surfacePolicy } from '../path/builder.mjs';
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
  if(overrides.construction)return curveAssignment({id,...overrides});
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
    if(a.construction){validateCurveAssignment(a);requireThat(!ids.has(a.id),'Duplicate slice assignment id.');ids.add(a.id);continue;}
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
    validateSliceSurface(a.surface, a.id);
    requireThat(!a.preset || a.surface.kind === 'horizontal', `Slice ${a.id}: brim and support presets need horizontal references.`);
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

// Plane origins use selected geometry coordinates before placement; horizontal references retain the part's base.
export function validateSliceSurface(surface, id) {
  if (surface?.kind === 'horizontal' && Object.keys(surface).join() === 'kind') return;
  if(['roof','spline'].includes(surface?.kind)){
    const fields=surface.kind==='roof'?['kind','offsetMm']:['kind','offsetMm','patch'];
    requireThat(Object.keys(surface).sort().join()===fields.sort().join()&&Number.isFinite(surface.offsetMm),`Slice ${id}: height references need finite offsetMm and a spline needs its authored patch.`);
    if(surface.kind==='spline')validateSplineSolid({shape:'spline',patches:[surface.patch]});
    return;
  }
  requireThat(surface?.kind === 'plane' && Object.keys(surface).every(k => ['kind', 'origin', 'normal', 'xAxis'].includes(k)), `Slice ${id}: expected a horizontal, plane, roof or spline reference.`);
  const plane = planeSlice(surface);
  requireThat(plane.normal[2] > 1e-9, `Slice ${id}: plane normal must point upward for fixed-axis deposition.`);
}

const horizontal = slice => slice.kind === 'plane' && slice.normal[0] === 0 && slice.normal[1] === 0 && slice.normal[2] === 1
  && slice.xAxis[0] === 1 && slice.xAxis[1] === 0 && slice.yAxis[0] === 0 && slice.yAxis[1] === 1 && slice.origin[0] === 0 && slice.origin[1] === 0;
const sliceKey = slice => slice.kind==='height-field'?JSON.stringify([slice.kind,slice.reference,slice.offsetMm,slice.normalDepthMm,slice.sampleStepMm]):JSON.stringify([slice.kind, slice.origin, slice.normal, slice.xAxis]);

// Bounds projected into this plane chart, rather than unrelated world XY.
function chartExtent(owner, slice) {
  if(slice.kind==='height-field')return {min:owner.shell.bounds.min.slice(0,2),max:owner.shell.bounds.max.slice(0,2)};
  const corners = Array.from({ length: 8 }, (_, i) => [0, 1, 2].map(k => ((i >> k) & 1 ? owner.shell.bounds.max[k] : owner.shell.bounds.min[k]) - slice.origin[k]));
  const points = corners.map(p => [slice.xAxis, slice.yAxis].map(axis => axis.reduce((n, v, k) => n + v * p[k], 0)));
  const box = regionBox([points]);
  return { min: box.min.map(v => v - 1), max: box.max.map(v => v + 1) };
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
export function sliceOwners(assignments, { shells, processes, volumes = new Map(), placement = { xMm: 0, yMm: 0 }, selections = new Map() }) {
  const owners = [];
  for (const [n, assignment] of assignments.entries()) {
    if(assignment.construction)continue;
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
      const selectedPlacement = assignment.part === null ? null : selections.get(assignment.part);
      const shift = [placement.xMm + (selectedPlacement?.xMm ?? 0), placement.yMm + (selectedPlacement?.yMm ?? 0), selectedPlacement?.zMm ?? 0];
      const reference=assignment.surface.kind==='roof'?{kind:'roof',geometry:shell}:assignment.surface.kind==='spline'?{kind:'spline',patch:heightReferencePatch(assignment.surface.patch,shift)}:null;
      const base = reference?heightSlice(reference,{offsetMm:assignment.surface.offsetMm,sampleStepMm:assignment.sampleStepMm}):assignment.surface.kind === 'plane' ? planeSlice({ ...assignment.surface, origin: assignment.surface.origin.map((v, k) => v + shift[k]) }) : horizontalSlice(assignment.stack && slabs.length ? from : bottom);
      const [startMm, endMm] = outline ? [bottom, bottom + stack.firstLayerMm] : [from, to];
      const family = sliceFamily({ base, pitchMm: stack.layerMm, firstLayerMm: stack.firstLayerMm },
        { min: [shell.bounds.min[0], shell.bounds.min[1], assignment.surface.kind === 'horizontal' ? base.origin[2] : bottom], max: [shell.bounds.max[0], shell.bounds.max[1], outline ? endMm : top] });
      const owner = { id: part !== null ? `${part}:${assignment.id}` : assignment.id, kind: outline ? 'outline' : 'part', assignment, part, shell, within, family, widthMm, startMm, endMm };
      if (assignment.surface.kind === 'plane') validatePlaneBase(owner);
      if(reference)requireThat(heightReferenceBounds(reference).max[2]+base.offsetMm<=volumeBox(owner).min[2]+1e-8,`Slice ${assignment.id}: height reference base starts above owned bounds; lower offsetMm to avoid omitted material.`);
      owners.push(owner);
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
// The base starts a forward family. Require it to precede the owned bounds
// rather than silently leaving the material on its lower side unassigned.
// Bounds are conservative: a tighter ownership volume can relax this check.
function validatePlaneBase(owner) {
  const box = volumeBox(owner), { normal, origin } = owner.family.base;
  const low = normal.reduce((sum, value, i) => sum + value * (value >= 0 ? box.min[i] : box.max[i]), 0);
  const base = normal.reduce((sum, value, i) => sum + value * origin[i], 0);
  requireThat(base <= low + 1e-8, `Slice ${owner.assignment.id}: plane base starts inside or above the owned bounds and would omit lower material; move origin at least ${(base - low).toFixed(4)} mm backward along its normal, or restrict within.`);
}

const boxesMeet = (a, b) => [0, 1, 2].every(i => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]) > 1e-9);

// Establish overlapping spatial claims before selecting any operation order.
// Connected claims adopt the first claimant's pitch, but keep their own bases
// and orientations outside overlap. A local shared zone uses its first claimant.
export function resolveSliceOwnership(owners) {
  const explicit = owners.filter(o => o.kind === 'part' && o.within.length);
  const parents = explicit.map((_, i) => i), edges = [];
  const root = i => { while (parents[i] !== i) i = parents[i]; return i; };
  for (let i = 0; i < explicit.length; i++) for (let j = i + 1; j < explicit.length; j++) {
    const a = explicit[i], b = explicit[j];
    if (a.part !== b.part || !boxesMeet(volumeBox(a), volumeBox(b))) continue;
    // Bounding boxes only reject pairs. Actual solid/claim sections establish
    // overlap, including slabs crossing an oblique chart.
    const meets = a.family.layers.some(layer => {
      let area = section(a.shell, layer.slice).loops;
      for (const owner of [a, b]) for (const volume of owner.within) {
        const cut = volumeSection(volume, layer, chartExtent(owner, layer.slice));
        if (cut !== null) area = intersect(area, cut);
      }
      return regionArea(area) > 1e-9;
    });
    if (!meets) continue;
    edges.push([a.id, b.id]);
    const ra = root(i), rb = root(j); parents[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const resolved = owners.map(owner => {
    const index = explicit.indexOf(owner);
    if (index < 0) return { ...owner, ownershipGroup: null };
    const principal = explicit[root(index)], pitchMm = principal.family.pitchMm;
    const family = pitchMm === owner.family.pitchMm ? owner.family : sliceFamily({ ...owner.family, pitchMm }, owner.shell.bounds);
    return { ...owner, family, ownershipGroup: principal.id };
  });
  return { owners: resolved, overlaps: edges };
}

// Split actual material into disjoint claim cells on one common chart. Keeping
// the claimant list makes triple overlaps deterministic without pairwise loss.
function claimCells(region, explicit, layer, cuts) {
  let cells = [{ region, claimants: [] }];
  for (const owner of explicit) {
    const cut = cuts(owner, layer), next = [];
    for (const cell of cells) {
      const inside = cut === null ? cell.region : intersect(cell.region, cut);
      const outside = cut === null ? [] : difference(cell.region, cut);
      if (inside.length) next.push({ region: inside, claimants: [...cell.claimants, owner] });
      if (outside.length) next.push({ region: outside, claimants: cell.claimants });
    }
    cells = next;
  }
  return cells;
}

export function ownedLayers(inputOwners, { shells = [], bands = [], reserves = [], onProgress }) {
  const ownership = resolveSliceOwnership(inputOwners), owners = ownership.owners;
  const cache = new Map();
  const cached = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
  const partSection = (owner, slice) => cached(`section|${owner.part}|${sliceKey(slice)}`, () => {
    const prepared = cached(`prepared|${owner.part}|${JSON.stringify(slice.normal)}`, () => prepareSection(owner.shell, slice));
    return section(prepared, slice).loops;
  });
  const material = (owner, slice) => cached(`material|${owner.part}|${sliceKey(slice)}`, () => {
    if (owner.kind === 'support') return slice.origin[2] <= owner.endMm + 1e-8 ? owner.footprint : [];
    let region = partSection(owner, slice);
    for (const band of bands.filter(b => b.part === owner.part)) {
      const cut = volumeSection({ kind: 'slab', fromMm: band.startMm, toMm: band.endMm }, { slice }, chartExtent(owner, slice));
      region = cut === null ? [] : difference(region, cut);
    }
    for (const reserve of reserves) region = horizontal(slice)?clipReservedRegion(region, slice.origin[2], reserve):clipReservedSlice(region,slice,reserve,{sampleStepMm:owner.assignment.sampleStepMm});
    return region;
  });
  const volume = (owner, layer) => cached(`volume|${owner.id}|${sliceKey(layer.slice)}`, () => {
    const cuts = owner.within.map(v => volumeSection(v, layer, chartExtent(owner, layer.slice))).filter(c => c !== null);
    return cuts.length ? cuts.reduce((a, b) => a.length && b.length ? intersect(a, b) : []) : null;
  });
  const explicit = owners.filter(o => o.kind === 'part' && o.within.length), firstShared = new Map(), results = [];
  let done = 0;
  const total = owners.reduce((n, o) => n + o.family.layers.length, 0);
  for (const principal of owners) {
    const family = principal.family, byOwner = new Map(), materialMasks = new Map();
    for (const layer of family.layers) {
      onProgress?.({ stage: 'Slicing layers', completed: done++, total });
      const own = material(principal, layer.slice);
      materialMasks.set(layer.index, own);
      if (!own.length) continue;
      const z = layer.slice.origin?.[2]??layer.slice.offsetMm;
      if (horizontal(layer.slice) && (z <= principal.startMm + 1e-9 || z > principal.endMm + 1e-9)) continue;
      const candidates = explicit.filter(o => o.part === principal.part);
      let allocated;
      if (principal.kind === 'outline') {
        const boundary = partSection(principal, layer.slice);
        allocated = [{ owner: principal, region: difference(offsetRegion(boundary, principal.assignment.loops * lineSpacing(principal.widthMm, principal.assignment)), boundary), boundary }];
      } else if (principal.kind === 'support') {
        for (const [part, shell, whole] of shells) {
          if (!whole || z < shell.bounds.min[2] - 1e-8 || z > shell.bounds.max[2] + 1e-8) continue;
          const obstacle = offsetRegion(partSection({ part, shell }, layer.slice), principal.gaps.xyGapMm);
          requireThat(regionArea(intersect(own, obstacle)) < 1e-8, `Support ${principal.id} meets its part clearance at Z ${z.toFixed(3)} mm; revise its footprint.`);
        }
        allocated = [{ owner: principal, region: own, boundary: own }];
      } else {
        allocated = [];
        for (const cell of claimCells(own, candidates, layer, volume)) {
          if (!cell.claimants.length) {
            if (!principal.within.length) allocated.push({ owner: principal, region: cell.region, boundary: own });
            continue;
          }
          if (cell.claimants[0] !== principal) continue;
          const key = cell.claimants.map(o => o.id).join('|');
          if (!firstShared.has(key)) firstShared.set(key, layer.index);
          const turn = (layer.index - firstShared.get(key)) % cell.claimants.length;
          allocated.push({ owner: cell.claimants[turn], region: cell.region, boundary: own, shared: cell.claimants.length > 1 });
        }
      }
      for (const owner of new Set(allocated.map(a => a.owner))) {
        const cells = allocated.filter(a => a.owner === owner), region = cells.length === 1 ? cells[0].region : union(cells.flatMap(a => a.region), []);
        const layers = byOwner.get(owner) ?? [];
        layers.push({ ...layer, region, material: cells[0].boundary, share: owner.within.length || candidates.length ? { within: region, claims: [] } : null,
          outward: owner.kind === 'outline', shared: cells.some(a => a.shared) });
        byOwner.set(owner, layers);
      }
    }
    for (const [owner, layers] of byOwner) results.push({ owner, leader: owner === principal ? null : principal.id,
      family, familyId: principal.id, layers, material: materialMasks, ownership });
  }
  return results;
}

// Where a tilted layer first meets the horizontal part base, its bead gap
// tapers to that base. Split at the full-gap crossing so the trapezoidal segment
// integration is exact for a planar reference. Later parallel planes are uniform.
function planeContactGaps(curves, { slice, heightMm }, bottom) {
  if(slice.kind==='height-field')return curves.map(curve=>{
    const gaps=curve.points.map(point=>Math.max(0,Math.min(heightMm,point[2]-bottom))*heightSliceNormal(slice,point)[2]);
    return {...curve,heightsMm:gaps.slice(1).map((gap,i)=>(gap+gaps[i])/2)};
  });
  if (horizontal(slice)) return curves;
  const cosine = slice.normal[2], ceiling = bottom + heightMm / cosine;
  return curves.map(curve => {
    if (curve.points.every(p => p[2] >= ceiling - 1e-9)) return curve;
    const source = curve.closed ? [...curve.points, curve.points[0]] : curve.points, points = [source[0]], heightsMm = [];
    const gap = point => Math.max(0, Math.min(heightMm, (point[2] - bottom) * cosine));
    for (let i = 1; i < source.length; i++) {
      const a = source[i - 1], b = source[i], cuts = [];
      if ((a[2] < ceiling && b[2] > ceiling) || (a[2] > ceiling && b[2] < ceiling)) {
        const t = (ceiling - a[2]) / (b[2] - a[2]);
        cuts.push(a.map((v, k) => v + t * (b[k] - v)));
      }
      cuts.push(b);
      for (const point of cuts) { heightsMm.push((gap(points.at(-1)) + gap(point)) / 2); points.push(point); }
    }
    return { ...curve, closed: false, points, heightsMm };
  });
}

// Fixed-axis plane deposition follows the existing machine nonplanar slope
// contract. A tilted reference is not an instruction to rotate the nozzle.
export function validateSliceMachine(slice, machine, id,points=[]) {
  const normals=slice.kind==='height-field'?points.map(point=>heightSliceNormal(slice,point)):[slice.normal];
  const steepest=normals.reduce((n,normal)=>Math.min(n,normal[2]),1);
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, steepest))) * 180 / Math.PI;
  if (angleDeg <= 1e-7) return;
  requireThat(machine.capabilities?.includes('nonplanar') && Number.isFinite(machine.nonplanar?.maxAngleDeg), `Slice ${id}: machine has no declared nonplanar fixed-axis limit.`);
  requireThat(angleDeg <= machine.nonplanar.maxAngleDeg + 1e-7, `Slice ${id}: surface slope ${angleDeg.toFixed(3)} degrees exceeds machine nonplanar limit ${machine.nonplanar.maxAngleDeg} degrees.`);
}

// Rank the complete supporting plane over fixed part bounds. Ranking the
// clipped region's maximum can go backwards when the upper contour shrinks.
function sliceRank(slice, bounds) {
  if(slice.kind==='height-field')return heightReferenceBounds(slice.reference).max[2]+slice.offsetMm;
  if (horizontal(slice)) return slice.origin[2];
  const heights = [bounds.min[0], bounds.max[0]].flatMap(x => [bounds.min[1], bounds.max[1]].map(y =>
    slice.origin[2] - ((x - slice.origin[0]) * slice.normal[0] + (y - slice.origin[1]) * slice.normal[1]) / slice.normal[2]));
  return Math.max(...heights);
}

function sliceTravelPolicy(slice, region, worldRegion, maxZ, process) {
  const options = { liftMm: process.liftMm, maxCombMm: process.maxCombMm, lineWidthMm: process.lineWidthMm };
  if (horizontal(slice)) return planarPolicy(region, { ...options, layerZ: slice.origin[2] });
  const surfaceZ = slice.kind==='height-field'?(x,y)=>slicePoint(slice,[x,y])[2]:(x, y) => slice.origin[2] - ((x - slice.origin[0]) * slice.normal[0] + (y - slice.origin[1]) * slice.normal[1]) / slice.normal[2];
  return surfacePolicy(worldRegion, { ...options, surfaceZ, maxZ });
}

// The nominal material actually emitted by this producer. Each segment owns
// its bead footprint and its computed vertical extent below the reference;
// neither sparse rows nor assignment seams imply a filled supporting shell.
// This is a rectangular-bead model, not a physical bead reconstruction.
function depositedSliceContains(operations,widthMm) {
  const segments=[];
  for(const op of operations)for(const stroke of op.strokes) {
    const points=stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points;
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],length=Math.hypot(...b.map((v,k)=>v-a[k]));
      const width=stroke.segmentMetadata?.[i-1]?.beadWidthMm??stroke.beadWidthMm??widthMm;
      const volume=stroke.volumesMm3?.[i-1]??length*(stroke.beadAreaMm2??0);
      if(length<1e-9||volume<=0)continue;
      const cosine=op.slice.kind==='height-field'?Math.min(heightSliceNormal(op.slice,a)[2],heightSliceNormal(op.slice,b)[2]):op.slice.normal[2];
      segments.push({a,b,radius:width/2,verticalMm:volume/(length*width*cosine)});
    }
  }
  return ({point:p})=>segments.some(({a,b,radius,verticalMm})=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],squared=dx*dx+dy*dy;
    if(squared<1e-16)return false;
    const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/squared));
    const z=a[2]+t*(b[2]-a[2]);
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<=radius+.02&&p[2]<=z+.02&&p[2]>=z-verticalMm-.02;
  });
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
    const { index, slice, region, share = null } = layer, z = slice.origin?.[2]??slice.offsetMm;
    validateSliceMachine(slice, machine, id,region.flat());
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
    const speedMmS = (horizontal(slice) ? index === 0 : report.layers === 0) ? process.firstLayerSpeedMmS : process.planarSpeedMmS;
    const worldRegion = region.map(loop => loop.map(point => slicePoint(slice, point).slice(0, 2)));
    const maxZ = Math.max(...region.flatMap(loop => loop.map(point => slicePoint(slice, point)[2])));
    const travelPolicy = sliceTravelPolicy(slice, region, worldRegion, maxZ, process);
    const current = [];
    for (const [group, found] of [['walls', strokes.walls], ['infill', strokes.infill], ['fill', strokes.fill]]) {
      if (!found.length) continue;
      const spacing = group === 'infill' ? pitch / settings.fillDensity : pitch / solidDensity;
      const opId = `${id}:${index}:${group}`;
      let covered;
      const mapped = mapSliceStrokes(found, slice);
      validateSliceMachine(slice,machine,id,mapped.flatMap(curve=>curve.points));
      const curves = planeContactGaps(mapped, layer, shell.bounds.min[2]);
      const lifted = depositCurves(curves, { widthMm: width, heightMm: layer.heightMm, speedMmS });
      operations.push({ id: opId, layerId: horizontal(slice) ? 'planar:' + z : 'slice:' + sliceKey(slice), phase: support ? 'supports' : 'planar', layer: index, rank: sliceRank(slice, shell.bounds), after: [...previous, ...current],
        strokes: roles ? lifted.map(stroke => ({ ...stroke, role: roles[stroke.role] })) : lifted, connectNearby: true,
        // Loops a boundary between owners cuts open are laid in the order found.
        order: group === 'walls' ? (lifted.every(s => s.closed && !s.volumesMm3) ? 'nearest' : 'given') : lifted.every(s => s.scanlineCell !== undefined) ? 'nearest-cells' : 'given', region: worldRegion, slice, ownershipIndex: index,
        // Coverage is consumed by material-region publication; built on first use.
        get materialRegion() {
          return covered ??= (group === 'walls' ? wallMaterial()
            : fillMaterial(group === 'infill' ? strokes.sparseRegion : strokes.solidRegion, width)).map(loop => loop.map(point => slicePoint(slice, point).slice(0, 2)));
        },
        materialCoverage: group !== 'walls' && spacing > width + 1e-8 ? 'sparse' : 'area',
        travelPolicy, ...((horizontal(slice) ? index === 1 : report.layers === 1) ? { fanPercent: process.fanPercent } : {}), ...(filament === null ? {} : { filament }) });
      current.push(opId);
    }
    previous = current;
    report.layers++; report.areaMm2 += regionArea(region);
  }
  if (support) return { id, operations, report };
  const coverage = settings.fillDensity >= 1 && pitch <= width + 1e-8 ? 'nominal' : 'sparse';
  return publishFinishedBoundary({ id, operations, report }, { shell, startMm, endMm, coverage,contains:depositedSliceContains(operations,width) });
}

// Every slice assignment of a plan: owners, owned layers, results. Support
// owners' results come back apart: they print before the part operations
// they hold up (supportDependencies).
// -> {results, supports, summary: {layers, instances}}
// envelopes: [{part, solidRegionAt(z)}] regions a process (a plastic-weld
// rivet) needs solid in the slices of its part.
export function sliceResults({ plan, machine, shells, volumes, bands, reserves, envelopes = [], onProgress }) {
  const assignments = plan.slices.assignments.filter(a=>!a.construction);
  if (!assignments.length) return { results: [], supports: [], summary: null };
  const processes = assignments.map(a => a.filament === null ? plan.process : filamentPlan(plan, machine, a.filament).process);
  const owners = sliceOwners(assignments, { shells, processes, volumes, placement: plan.placement, selections: geometrySelections(plan.geometry) });
  const owned = ownedLayers(owners, { shells, bands, reserves, onProgress });
  const results = [], supports = [];
  for (const { owner, leader, family, familyId, layers, material } of owned) {
    const { assignment } = owner;
    const process = processes[assignments.indexOf(assignment)];
    const held = envelopes.filter(e => e.part === owner.part);
    const solidRegions = new Map(held.length ? layers.map(l => [l.index, held.flatMap(e => horizontal(l.slice)?e.solidRegionAt(l.slice.origin[2]):
      difference(l.region,clipReservedSlice(l.region,l.slice,{footprint:[[owner.shell.bounds.min.slice(0,2),[owner.shell.bounds.max[0],owner.shell.bounds.min[1]],owner.shell.bounds.max.slice(0,2),[owner.shell.bounds.min[0],owner.shell.bounds.max[1]]]],regionAt:e.solidRegionAt},{sampleStepMm:assignment.sampleStepMm})))]) : []);
    const report = { owner: assignment.id, part: owner.kind === 'support' ? null : owner.part, leader, layerMm: family.pitchMm,
      ...(family.base.kind==='height-field'?{stackMetric:'vertical',beadHeightMetric:'local-normal-projection',chartMetric:'world-xy',topologySampleStepMm:family.base.sampleStepMm}:{}),
      ...(owner.kind === 'support' ? { contactZMm: owner.contactZMm, actualTopGapMm: owner.contactZMm - Math.max(...layers.filter(l => l.region.length).map(l => l.slice.origin[2])) } : {}) };
    const resultId = familyId === owner.id ? owner.id : `${owner.id}:shared:${familyId}`;
    const result = sliceResult({ id: resultId, settings: assignment, layers, material, solidRegions, filament: assignment.filament },
    { process, machine, shell: owner.shell, startMm: owner.startMm, endMm: owner.endMm, report });
    (owner.kind === 'support' ? supports : results).push({ ...result, ownershipGroup: owner.ownershipGroup, familyId });
  }
  requireThat([...results, ...supports].some(r => r.operations.length), 'The slice assignments produced no material.');
  const layerIds = new Set([...results, ...supports].flatMap(r => r.operations.map(op => op.layerId)));
  return { results: ownershipDependencies(results), supports, summary: { layers: layerIds.size, instances: [...results, ...supports].map(r => ({ id: r.id, ...r.report })) } };
}

// Shared ownership establishes this precedence, before the composer chooses
// travel/order among unrelated operations. Merge all families in a connected
// overlap by their ascending physical upper height; same-height walls precede
// their fills through the producer's existing after links.
export function ownershipDependencies(results) {
  const groups = new Map();
  for (const result of results) if (result.ownershipGroup) {
    const entries = groups.get(result.ownershipGroup) ?? [];
    entries.push(...result.operations); groups.set(result.ownershipGroup, entries);
  }
  const prerequisites = new Map();
  for (const operations of groups.values()) {
    const ordered = operations.map((operation, index) => ({ operation, index })).sort((a, b) => a.operation.rank - b.operation.rank || a.index - b.index);
    for (let i = 1; i < ordered.length; i++) prerequisites.set(ordered[i].operation.id, ordered[i - 1].operation.id);
  }
  return results.map(result => ({ ...result, operations: result.operations.map(operation => {
    const before = prerequisites.get(operation.id);
    return before ? { ...operation, after: [...new Set([...operation.after, before])] } : operation;
  }) }));
}
