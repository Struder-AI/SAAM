import { createHash } from 'node:crypto';

export const VERSION = '0.2.0';
export const clone = value => structuredClone(value);
export const canonical = value => JSON.stringify(value, function (_key, item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  return item;
});
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array ? value : canonical(value)).digest('hex');
export const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
export function requireThat(condition, message) { if (!condition) throw new Error(message); }
export function number(value, min, max, name) {
  requireThat(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${name} must be between ${min} and ${max}.`);
}
export function defaults() {
  return {
    schema: 'saam-wedge-plan/1', generatorVersion: VERSION,
    geometry: {runMm: 30, widthMm: 20, baseMm: 2, angleDeg: 15},
    placement: {xMm: 150, yMm: 110},
    setup: {tool: 1, core: 'AA 0.4', nozzleMm: 0.4, material: 'PLA', filamentMm: 2.85,
      nozzleC: 215, bedC: 60, materialGuid: '', firmwareVersion: '', startupVerified: false},
    process: {firstLayerMm: 0.2, layerMm: 0.2, lineWidthMm: 0.4, skinNormalMm: 0.2, skinLayers: 2,
      planarSpeedMmS: 20, skinSpeedMmS: 10, firstLayerSpeedMmS: 12, travelSpeedMmS: 60,
      zSpeedMmS: 5, retractMm: 6.5, retractSpeedMmS: 25, liftMm: 2, fanPercent: 100,
      maxFlowMm3S: 4, minimumLayerSeconds: 6, skinDirection: 'alternating',
      substrate: 'horizontal-solid-fill', transition: 'staircase-gap-volume', beadModel: 'rectangular',
      clearanceResponsibility: 'operator', clearanceNote: 'For this demo the user will verify physical clearance.'},
    output: 'griffin-gcode'
  };
}
export function validatePlan(plan, machine) {
  const d = defaults();
  // Reject misspelled/unused process choices instead of silently ignoring them.
  function keys(actual, expected, path = 'plan') {
    requireThat(actual && typeof actual === 'object' && !Array.isArray(actual), `${path} must be an object.`);
    requireThat(Object.keys(actual).sort().join() === Object.keys(expected).sort().join(), `Unexpected or missing fields in ${path}.`);
    for (const key of Object.keys(expected)) if (expected[key] && typeof expected[key] === 'object') keys(actual[key], expected[key], `${path}.${key}`);
  }
  keys(plan, d);
  requireThat(plan.schema === d.schema && plan.generatorVersion === VERSION, 'Unsupported plan/generator version.');
  const {geometry: g, placement: pos, process: p, setup: s} = plan;
  for (const [key,min,max] of [['runMm',8,80],['widthMm',8,60],['baseMm',1,10],['angleDeg',1,15]]) number(g[key],min,max,key);
  for (const [key,min,max] of [['firstLayerMm',0.15,0.25],['layerMm',0.06,0.2],['lineWidthMm',0.35,0.48],['skinNormalMm',0.12,0.22],['skinLayers',1,4],['planarSpeedMmS',2,35],['skinSpeedMmS',2,20],['firstLayerSpeedMmS',2,20],['travelSpeedMmS',5,100],['zSpeedMmS',1,10],['retractMm',0,8],['retractSpeedMmS',1,35],['liftMm',0.5,10],['fanPercent',0,100],['maxFlowMm3S',0.1,8],['minimumLayerSeconds',0,30]]) number(p[key],min,max,key);
  requireThat(Number.isInteger(p.skinLayers), 'skinLayers must be an integer.');
  for (const key of ['skinDirection','substrate','transition','beadModel','clearanceResponsibility']) requireThat(p[key] === d.process[key], `Unsupported ${key}.`);
  requireThat(typeof p.clearanceNote === 'string' && p.clearanceNote.length <= 1000, 'Invalid clearance note.');
  requireThat(s.tool === 0 || s.tool === 1, 'Select nozzle #1 or #2.');
  requireThat(s.core === 'AA 0.4' && s.nozzleMm === 0.4 && s.material === 'PLA' && s.filamentMm === 2.85, 'This demo supports AA 0.4 and 2.85 mm PLA only.');
  number(s.nozzleC, 180, 230, 'PLA nozzle temperature'); number(s.bedC, 0, 70, 'PLA bed temperature');
  requireThat(typeof s.startupVerified === 'boolean' && typeof s.firmwareVersion === 'string' && /^[\w .+-]{0,80}$/.test(s.firmwareVersion), 'Invalid firmware setup.');
  requireThat(typeof s.materialGuid === 'string' && (s.materialGuid === '' || /^[a-f0-9-]{36}$/i.test(s.materialGuid)), 'Material GUID must be empty or a UUID.');
  requireThat(machine.id === 'ultimaker-s5' && machine.schema === 'saam-machine/1' && machine.outputs.some(o => o.id === plan.output), 'Unsupported machine/output.');
  const t = Math.tan(g.angleDeg*Math.PI/180), c = Math.cos(g.angleDeg*Math.PI/180);
  requireThat(g.baseMm - p.skinLayers*p.skinNormalMm/c > p.firstLayerMm, 'Base is too thin for the reserved skin.');
  // At the staircase interface the local gap is not the nominal layer height.
  // The generator bounds it by the actual substrate step geometry, not an
  // unsupported assumption that nozzle diameter is a physical gap limit.
  number(pos.xMm, 5, machine.bounds.max[0]-g.runMm-5, 'Placement X');
  number(pos.yMm, 8, machine.bounds.max[1]-g.widthMm-5, 'Placement Y');
  requireThat(g.baseMm+g.runMm*t+p.liftMm < machine.bounds.max[2], 'Wedge and travel lift exceed Z bounds.');
  return plan;
}
export function wedgeMesh(g) {
  const h = g.baseMm+g.runMm*Math.tan(g.angleDeg*Math.PI/180), x=g.runMm, y=g.widthMm, b=g.baseMm;
  return {vertices: [[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,b],[x,0,h],[x,y,h],[0,y,b]],
    faces: [[0,3,2,1],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]],
    labels: ['base','front-side','high-end','back-side','low-end','sloping-face']};
}
