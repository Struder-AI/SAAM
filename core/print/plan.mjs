// Process plan for shell-based prints: geometry, placement, setup, shared
// process settings, and the settings of each selected skill.
//
// A locked plan must carry everything generation needs, so generation makes no
// further process choices. Unknown or missing fields are rejected rather than
// defaulted at generation time, which is what keeps a regenerated path
// identical to the reviewed one.

import { createHash } from 'node:crypto';
import { FULL_FILL_DEFAULTS } from '../../skills/full-fill/scripts/fill.mjs';
import { DRAPED_SKIN_DEFAULTS } from '../../skills/draped-skin/scripts/drape.mjs';
import { requireThat } from '../geom/tolerance.mjs';

export const VERSION = '0.1.0';
// Fixed release metadata, so regenerating a reviewed plan is byte-identical.
export const BUILD_DATE = '2026-09-08';

export const canonical = value => JSON.stringify(value, function (_key, item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  return item;
});
export const hash = value => createHash('sha256')
  .update(typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array ? value : canonical(value)).digest('hex');

export function number(value, min, max, name) {
  requireThat(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${name} must be between ${min} and ${max}.`);
}

export function defaults() {
  return {
    schema: 'saam-shell-plan/1',
    generatorVersion: VERSION,
    geometry: { shape: 'spline-top', runMm: 40, widthMm: 30, cpU: 5, cpV: 5, heightsMm: domeHeights(5, 5) },
    placement: { xMm: 140, yMm: 100 },
    setup: {
      tool: 1, core: 'AA 0.4', nozzleMm: 0.4, material: 'PLA', filamentMm: 2.85,
      nozzleC: 215, bedC: 60, buildVolumeC: 28,
      materialGuid: '506c9f0d-e3aa-4bd4-b2d2-23e2425b1aa9', firmwareVersion: '', startupVerified: false
    },
    process: {
      firstLayerMm: 0.2, layerMm: 0.2, lineWidthMm: 0.4,
      planarSpeedMmS: 20, skinSpeedMmS: 10, firstLayerSpeedMmS: 12, travelSpeedMmS: 60, zSpeedMmS: 5,
      retractMm: 6.5, retractSpeedMmS: 25, liftMm: 2, maxCombMm: 6,
      fanPercent: 100, maxFlowMm3S: 4, minimumLayerSeconds: 6,
      clearanceResponsibility: 'operator',
      clearanceNote: 'No collision model is implemented; the operator owns physical clearance.'
    },
    skills: {
      'full-fill': { enabled: true, ...FULL_FILL_DEFAULTS },
      'draped-skin': { enabled: true, ...DRAPED_SKIN_DEFAULTS }
    },
    output: 'griffin-gcode'
  };
}

// A gentle dome whose slope stays inside the S5's non-planar limit.
export function domeHeights(cpU, cpV, peak = 6, rise = 1.2) {
  const grid = [];
  for (let i = 0; i < cpU; i++) {
    const row = [];
    for (let j = 0; j < cpV; j++)
      row.push(Number((peak + rise * Math.sin(Math.PI * i / (cpU - 1)) * Math.sin(Math.PI * j / (cpV - 1))).toFixed(4)));
    grid.push(row);
  }
  return grid;
}

// Each shape carries its own parameters, so the strict field check is made
// against the selected shape rather than against whichever shape is the default.
export function geometryTemplate(shape) {
  if (shape === 'box') return { shape: 'box', runMm: 30, widthMm: 20, heightMm: 10 };
  if (shape === 'wedge') return { shape: 'wedge', runMm: 30, widthMm: 20, baseMm: 2, angleDeg: 15 };
  return { shape: 'spline-top', runMm: 40, widthMm: 30, cpU: 5, cpV: 5, heightsMm: [] };
}

export function validatePlan(plan, machine) {
  requireThat(plan && typeof plan === 'object' && ['box', 'wedge', 'spline-top'].includes(plan.geometry?.shape), 'Unsupported shape.');
  const expected = { ...defaults(), geometry: geometryTemplate(plan.geometry.shape) };
  keys(plan, expected);
  requireThat(plan.schema === expected.schema && plan.generatorVersion === VERSION, 'Unsupported plan or generator version.');

  const { geometry, placement, process, setup, skills } = plan;
  for (const [key, min, max] of [['runMm', 5, 200], ['widthMm', 5, 200]]) number(geometry[key], min, max, key);
  if (geometry.shape === 'box') number(geometry.heightMm, 0.5, 200, 'heightMm');
  if (geometry.shape === 'wedge') {
    number(geometry.baseMm, 0.5, 50, 'baseMm');
    number(geometry.angleDeg, 0.5, 60, 'angleDeg');
  }
  if (geometry.shape === 'spline-top') {
    for (const [key, min, max] of [['cpU', 3, 12], ['cpV', 3, 12]]) number(geometry[key], min, max, key);
    requireThat(Array.isArray(geometry.heightsMm) && geometry.heightsMm.length === geometry.cpU, 'heightsMm must have cpU rows.');
    for (const row of geometry.heightsMm) {
      requireThat(Array.isArray(row) && row.length === geometry.cpV, 'heightsMm rows must have cpV entries.');
      for (const value of row) number(value, 0.5, 200, 'control height');
    }
  }

  for (const [key, min, max] of [['firstLayerMm', 0.1, 0.3], ['layerMm', 0.06, 0.3], ['lineWidthMm', 0.3, 0.8],
    ['planarSpeedMmS', 2, 80], ['skinSpeedMmS', 2, 40], ['firstLayerSpeedMmS', 2, 40], ['travelSpeedMmS', 5, 200],
    ['zSpeedMmS', 1, 20], ['retractMm', 0, 10], ['retractSpeedMmS', 1, 50], ['liftMm', 0.2, 20],
    ['maxCombMm', 0, 100], ['fanPercent', 0, 100], ['maxFlowMm3S', 0.1, 15], ['minimumLayerSeconds', 0, 60]])
    number(process[key], min, max, key);
  requireThat(process.clearanceResponsibility === 'operator', 'Clearance responsibility must be recorded as operator.');
  requireThat(typeof process.clearanceNote === 'string' && process.clearanceNote.length <= 1000, 'Invalid clearance note.');

  requireThat(setup.tool === 0 || setup.tool === 1, 'Select nozzle #1 or #2.');
  requireThat(setup.core === 'AA 0.4' && setup.nozzleMm === 0.4 && setup.material === 'PLA' && setup.filamentMm === 2.85,
    'This pipeline supports an AA 0.4 core with 2.85 mm PLA.');
  number(setup.nozzleC, 180, 230, 'PLA nozzle temperature');
  number(setup.bedC, 0, 70, 'PLA bed temperature');
  number(setup.buildVolumeC, 0, 50, 'Build volume temperature');
  requireThat(/^[a-f0-9-]{36}$/i.test(setup.materialGuid), 'A material GUID is required for a Griffin file the printer will accept.');
  requireThat(typeof setup.startupVerified === 'boolean' && typeof setup.firmwareVersion === 'string' && /^[\w .+-]{0,80}$/.test(setup.firmwareVersion), 'Invalid firmware setup.');

  const fill = skills['full-fill'], skin = skills['draped-skin'];
  requireThat(typeof fill.enabled === 'boolean' && typeof skin.enabled === 'boolean', 'Each skill needs an enabled flag.');
  requireThat(fill.enabled || skin.enabled, 'Select at least one pattern skill.');
  number(fill.perimeters, 0, 8, 'perimeters');
  requireThat(Number.isInteger(fill.perimeters), 'perimeters must be an integer.');
  requireThat(Array.isArray(fill.fillAnglesDeg) && fill.fillAnglesDeg.length >= 1 && fill.fillAnglesDeg.every(angle => typeof angle === 'number' && angle >= -180 && angle <= 180), 'Invalid fill angles.');
  number(fill.fillOverlap, 0, 0.5, 'fillOverlap');
  number(fill.minFeatureMm, 0.05, 5, 'minFeatureMm');
  number(skin.layers, 1, 8, 'draped skin layers');
  requireThat(Number.isInteger(skin.layers), 'draped skin layers must be an integer.');
  number(skin.normalMm, 0.05, 0.5, 'skin normal thickness');
  number(skin.strokeAngleDeg, -180, 180, 'skin stroke angle');
  number(skin.sampleStepMm, 0.1, 5, 'skin sample step');
  number(skin.surveyStepMm, 0.1, 5, 'survey step');

  requireThat(machine.schema === 'saam-machine/1' && machine.outputs.some(option => option.id === plan.output), 'Unsupported machine or output.');
  if (skin.enabled) requireThat(Number.isFinite(machine.nonplanar?.maxAngleDeg), 'The machine file must declare nonplanar.maxAngleDeg.');
  number(placement.xMm, 5, machine.bounds.max[0] - geometry.runMm - 5, 'Placement X');
  number(placement.yMm, 5, machine.bounds.max[1] - geometry.widthMm - 5, 'Placement Y');
  return plan;
}

// Reject misspelled or unused settings instead of silently ignoring them.
function keys(actual, expected, path = 'plan') {
  requireThat(actual && typeof actual === 'object' && !Array.isArray(actual), `${path} must be an object.`);
  requireThat(Object.keys(actual).sort().join() === Object.keys(expected).sort().join(), `Unexpected or missing fields in ${path}.`);
  for (const key of Object.keys(expected)) {
    const value = expected[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) keys(actual[key], value, `${path}.${key}`);
  }
}
