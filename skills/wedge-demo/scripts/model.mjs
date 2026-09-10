import { createHash } from 'node:crypto';
import { loadMachine, validateSetup, toolBounds, requireMachine } from '../../../core/machine/profile.mjs';

export const VERSION = '0.3.0';
export const GENERIC_PLA_GUID = '506c9f0d-e3aa-4bd4-b2d2-23e2425b1aa9';
// Release metadata, fixed so regenerating a reviewed plan is deterministic.
export const BUILD_DATE = '2026-09-09';
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
export function defaults(machine=loadMachine()) {
  const plan = {
    schema: 'saam-wedge-plan/1', generatorVersion: VERSION,
    geometry: {points: legacyPoints({runMm:30,widthMm:20,baseMm:2,angleDeg:15})},
    placement: {xMm: 150, yMm: 110},
    setup: {tool: 1, core: 'AA 0.4', nozzleMm: 0.4, material: 'PLA', filamentMm: 2.85,
      nozzleC: 215, bedC: 60, buildVolumeC: 28, materialGuid: GENERIC_PLA_GUID, firmwareVersion: '', startupVerified: false},
    process: {firstLayerMm: 0.2, layerMm: 0.2, lineWidthMm: 0.4, skinNormalMm: 0.2, skinLayers: 2,
      planarSpeedMmS: 20, skinSpeedMmS: 10, firstLayerSpeedMmS: 12, travelSpeedMmS: 60,
      zSpeedMmS: 5, retractMm: 6.5, retractSpeedMmS: 25, liftMm: 2, combTravelMm: 12, startupRetracted: true, fanPercent: 100,
      maxFlowMm3S: 4, minimumLayerSeconds: 6, skinDirection: 'alternating',
      substrate: 'horizontal-solid-fill', transition: 'staircase-gap-volume', beadModel: 'rectangular',
      clearanceResponsibility: 'operator', clearanceNote: 'For this demo the user will verify physical clearance.'},
    output: 'griffin-gcode'
  };
  plan.setup=structuredClone(machine.defaultSetup);
  Object.assign(plan.process,machine.defaultProcess??{});
  plan.process.startupRetracted=machine.id==='ultimaker-s5';
  plan.output=machine.outputs[0].id;
  return plan;
}
export function validatePlan(plan, machine) {
  const d = defaults(machine);
  // Reject misspelled/unused process choices instead of silently ignoring them.
  function keys(actual, expected, path = 'plan') {
    requireThat(actual && typeof actual === 'object' && !Array.isArray(actual), `${path} must be an object.`);
    requireThat(Object.keys(actual).sort().join() === Object.keys(expected).sort().join(), `Unexpected or missing fields in ${path}.`);
    for (const key of Object.keys(expected)) if (expected[key] && typeof expected[key] === 'object' && !Array.isArray(expected[key])) keys(actual[key], expected[key], `${path}.${key}`);
  }
  keys(plan, d);
  requireThat(plan.schema === d.schema && plan.generatorVersion === VERSION, 'Unsupported plan/generator version.');
  const {geometry: g, placement: pos, process: p, setup: s} = plan;
  const roof=roofGeometry(g);
  number(roof.runMm,8,80,'Wedge X size');number(roof.widthMm,8,60,'Wedge Y size');
  const printSpeedLimit=Math.min(machine.maxFeedMmS.x,machine.maxFeedMmS.y);
  for (const [key,min,max] of [['firstLayerMm',0.15,0.25],['layerMm',0.06,0.2],['lineWidthMm',0.35,0.48],['skinNormalMm',0.12,0.22],['skinLayers',1,20],['planarSpeedMmS',2,printSpeedLimit],['skinSpeedMmS',2,printSpeedLimit],['firstLayerSpeedMmS',2,printSpeedLimit],['travelSpeedMmS',5,100],['zSpeedMmS',1,10],['retractMm',0,8],['retractSpeedMmS',1,35],['liftMm',0.5,10],['combTravelMm',0,20],['fanPercent',0,100],['maxFlowMm3S',0.1,8],['minimumLayerSeconds',0,30]]) number(p[key],min,max,key);
  requireThat(Number.isInteger(p.skinLayers), 'skinLayers must be an integer.');
  requireThat(typeof p.startupRetracted === 'boolean', 'startupRetracted must be true or false.');
  for (const key of ['skinDirection','substrate','transition','beadModel','clearanceResponsibility']) requireThat(p[key] === d.process[key], `Unsupported ${key}.`);
  requireThat(typeof p.clearanceNote === 'string' && p.clearanceNote.length <= 1000, 'Invalid clearance note.');
  if(plan.output==='griffin-gcode')requireThat(typeof s.materialGuid === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s.materialGuid), 'Material GUID must be a UUID; use the Generic PLA profile when the specific material is unknown.');
  validateSetup(plan,machine);
  requireMachine(machine,['xyz-extrusion','planar','nonplanar'],'Wedge demo');
  requireThat(s.nozzleMm===0.4&&s.material==='PLA','This bounded demo requires a 0.4 mm nozzle and PLA.');
  requireThat(roof.angleDeg<=Math.min(15,machine.nonplanar?.maxAngleDeg)+1e-9,'Wedge slope exceeds the declared machine non-planar limit.');
  if(machine.id==='bambu-h2d')requireThat(!p.startupRetracted,'H2D firmware hands off unretracted; startupRetracted must be false.');
  requireThat(typeof s.startupVerified === 'boolean' && typeof s.firmwareVersion === 'string' && /^[\w .+-]{0,80}$/.test(s.firmwareVersion), 'Invalid firmware setup.');
  const lowestSkinAtCrest=roof.maxHeightMm-(p.skinLayers-1)*p.skinNormalMm/roof.cosine-p.lineWidthMm/2*(Math.abs(roof.a)+Math.abs(roof.b));
  requireThat(lowestSkinAtCrest>=p.firstLayerMm, 'The lowest tilted layer has no printable extent.');
  // At the staircase interface the local gap is not the nominal layer height.
  // The generator bounds it by the actual substrate step geometry, not an
  // unsupported assumption that nozzle diameter is a physical gap limit.
  const bounds=toolBounds(machine,s.tool);
  number(pos.xMm, bounds.min[0]+5, bounds.max[0]-roof.runMm-5, 'Placement X');
  number(pos.yMm, bounds.min[1]+8, bounds.max[1]-roof.widthMm-5, 'Placement Y');
  requireThat(roof.maxHeightMm+p.liftMm < bounds.max[2], 'Wedge and travel lift exceed Z bounds.');
  return plan;
}
// Explicit conversion for old recipes; new plans store the eight source points.
export function legacyPoints(g) {
  requireThat(Object.keys(g).sort().join() === 'angleDeg,baseMm,runMm,widthMm','Invalid legacy wedge geometry.');
  for(const key of ['runMm','widthMm','baseMm','angleDeg'])requireThat(Number.isFinite(g[key]),'Invalid legacy wedge geometry.');
  const h = g.baseMm+g.runMm*Math.tan(g.angleDeg*Math.PI/180), x=g.runMm, y=g.widthMm, b=g.baseMm;
  return [[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,b],[x,0,h],[x,y,h],[0,y,b]];
}

// Order-independent point set. Normalize its base to local Z=0 and its
// minimum XY to (0,0); the plan's placement supplies machine coordinates.
export function roofGeometry(g) {
  requireThat(g && Object.keys(g).join()==='points','Wedge geometry requires only points. Upgrade older recipes first.');
  const points=g.points;
  requireThat(Array.isArray(points)&&points.length===8&&points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)),'Wedge requires eight finite XYZ points in millimeters.');
  const xs=[...new Set(points.map(p=>p[0]))].sort((a,b)=>a-b),ys=[...new Set(points.map(p=>p[1]))].sort((a,b)=>a-b);
  requireThat(xs.length===2&&ys.length===2,'Base must be an axis-aligned rectangle with vertical corner pairs.');
  const pairs=[[xs[0],ys[0]],[xs[1],ys[0]],[xs[1],ys[1]],[xs[0],ys[1]]].map(([x,y])=>points.filter(p=>p[0]===x&&p[1]===y).sort((a,b)=>a[2]-b[2]));
  requireThat(pairs.every(p=>p.length===2),'Each base corner needs exactly one point directly above it.');
  const base=pairs[0][0][2];
  requireThat(pairs.every(p=>p[0][2]===base&&p[1][2]>base),'Base points must share one height, with every roof point above its base.');
  const runMm=xs[1]-xs[0],widthMm=ys[1]-ys[0],heights=pairs.map(p=>p[1][2]-base);
  const [c,hx,hxy,hy]=heights,a=(hx-c)/runMm,b=(hy-c)/widthMm;
  requireThat(Math.abs(hxy-(hx+hy-c))<=1e-7,'Roof points must be coplanar (one flat roof).');
  const slope=Math.hypot(a,b),cosine=1/Math.hypot(1,slope),angleDeg=Math.atan(slope)*180/Math.PI;
  const vertices=[...pairs.map(p=>[p[0][0]-xs[0],p[0][1]-ys[0],0]),...pairs.map(p=>[p[1][0]-xs[0],p[1][1]-ys[0],p[1][2]-base])];
  return {vertices,runMm,widthMm,a,b,c,slope,cosine,angleDeg,minHeightMm:Math.min(...heights),maxHeightMm:Math.max(...heights)};
}
export function wedgeMesh(g) {
  const {vertices}=roofGeometry(g);
  const quads=[[0,3,2,1],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]];
  const names=['base','front-side','right-side','back-side','left-side','sloping-face'];
  return {vertices,faces:quads.flatMap(([a,b,c,d])=>[[a,b,c],[a,c,d]]),labels:names.flatMap(n=>[n,n])};
}
