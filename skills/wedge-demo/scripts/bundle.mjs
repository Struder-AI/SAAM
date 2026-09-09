import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, hash, defaults, validatePlan, requireThat, VERSION } from './model.mjs';
import { createGeometry, verifyGeometry } from './geometry.mjs';
import { generatePath } from './path.mjs';
import { exportGcode, interpretGcode } from './gcode.mjs';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export const defaultSetupFile=resolve(root,'.local/machine-setups/ultimaker-s5.json');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
async function save(file,value) {
  await mkdir(dirname(file),{recursive:true});
  const temp=file+'.tmp';await writeFile(temp,typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n');
  await rename(temp,file);
}
export async function runtimeHash() {
  const files=['model.mjs','geometry.mjs','path.mjs','gcode.mjs','bundle.mjs'];
  return hash(await Promise.all(files.map(async f=>[f,await readFile(new URL(f,import.meta.url),'utf8')])));
}
export async function initBundle(directory,plan,{setupFile=defaultSetupFile}={}) {
  const dir=resolve(directory);
  try{await access(resolve(dir,'plan.json'));throw new Error('Print already exists. Open it or choose another directory.');}catch(e){if(e.code!=='ENOENT')throw e;}
  const machine=await json(resolve(root,'machines/ultimaker-s5.json'));
  if(!plan){plan=defaults();try{const saved=await json(setupFile);requireThat(saved.machineId===machine.id&&saved.schema==='saam-machine-setup/1','Saved machine setup is incompatible.');plan.setup={...plan.setup,...saved.setup,materialGuid:saved.setup.materialGuid||plan.setup.materialGuid};}catch(e){if(e.code!=='ENOENT')throw e;}}
  validatePlan(plan,machine);
  const geometry=await createGeometry(plan.geometry);
  await save(resolve(dir,'geometry/model.3dm'),geometry.bytes);
  await save(resolve(dir,'geometry/model.json'),geometry.descriptor);
  await save(resolve(dir,'machine.json'),machine);
  await save(resolve(dir,'plan.json'),plan);
  await save(resolve(dir,'review.json'),{schema:'saam-review/1',approvals:{},history:[],generation:null});
  return dir;
}
export async function loadBundle(directory,{program=true}={}) {
  const dir=resolve(directory);
  const [plan,machine,geometry,review,bytes,runtime]=await Promise.all([
    json(resolve(dir,'plan.json')),json(resolve(dir,'machine.json')),json(resolve(dir,'geometry/model.json')),
    json(resolve(dir,'review.json')),readFile(resolve(dir,'geometry/model.3dm')),runtimeHash()]);
  validatePlan(plan,machine);await verifyGeometry(bytes,geometry);
  requireThat(canonical(plan.geometry)===canonical(geometry.parameters),'Plan and geometry disagree. Ask the agent to recreate the geometry.');
  const geometryHash=hash({file:hash(bytes),descriptor:geometry});
  const planHash=hash({plan,machine,geometryHash,runtime});
  const state={dir,plan,machine,geometry,review,geometryHash,planHash,runtime,
    geometryApproved:review.approvals.geometry?.hash===geometryHash,
    planApproved:review.approvals.plan?.hash===planHash};
  state.planApproved&&=state.geometryApproved;
  state.toolpathApproved=false;
  state.revision=hash({geometryHash,planHash,review});
  state.limitations=['Physical clearance is the operator’s responsibility for this demo.',
    'Bead shape and the staircase transition are approximations; no physical print has been validated.',
    'Griffin firmware startup internals are not animated; this export does not request routine bed leveling.'];
  state.setupBasis=plan.setup.startupVerified?'Confirmed startup behavior':'Standard S5 Griffin startup without routine bed leveling assumed';
  if(program&&review.generation) {
    try {
      requireThat(review.generation.planHash===planHash,'Generated program is stale; regenerate for the current plan.');
      const [code,path]=await Promise.all([readFile(resolve(dir,'exports/griffin-gcode/wedge.gcode'),'utf8'),json(resolve(dir,'path.saampath'))]);
      requireThat(hash(code)===review.generation.exportHash&&hash(path)===review.generation.pathHash,'Generated files changed; regenerate and review again.');
      const regenerated=generatePath(plan,machine);
      requireThat(canonical(path)===canonical(regenerated),'SAAMpath does not match the locked recipe.');
      requireThat(code===exportGcode(regenerated,plan,machine),'Export does not match SAAMpath.');
      state.program=interpretGcode(code,plan,machine);state.pathSummary=path.summary;
      state.exportHash=hash(code);state.code=code;
      state.toolpathApproved=state.planApproved&&review.approvals.toolpath?.hash===state.exportHash&&review.approvals.toolpath?.planHash===planHash&&review.generation.mode==='production';
    } catch(error) {state.programError=error.message;}
  }
  return state;
}
// A cheap liveness fingerprint for automatic UI updates. Full validation still
// happens on every changed snapshot and immediately before approval/delivery.
export async function bundleFingerprint(directory) {
  const names=['plan.json','machine.json','geometry/model.json','geometry/model.3dm','review.json','path.saampath','exports/griffin-gcode/wedge.gcode'];
  const values=await Promise.all(names.map(async name=>{try{return [name,hash(await readFile(resolve(directory,name)))];}catch(e){if(e.code==='ENOENT')return [name,null];throw e;}}));
  return hash(values);
}
export async function rememberSetup(directory,{setupFile=defaultSetupFile,source='User setup supplied through chat'}={}) {
  const state=await loadBundle(directory,{program:false});
  await save(setupFile,{schema:'saam-machine-setup/1',machineId:state.machine.id,setup:state.plan.setup,source,updatedAt:new Date().toISOString()});
  return setupFile;
}
export async function adjustBundle(directory,patch,{setupFile=defaultSetupFile}={}) {
  const state=await loadBundle(directory,{program:false});
  function merge(target,changes) {
    requireThat(changes&&typeof changes==='object'&&!Array.isArray(changes),'Adjustment must be an object.');
    for(const [key,value]of Object.entries(changes)) {
      requireThat(Object.hasOwn(target,key),`Unknown setting: ${key}`);
      if(value&&typeof value==='object'&&!Array.isArray(value))merge(target[key],value);else target[key]=value;
    }
  }
  const plan=structuredClone(state.plan);merge(plan,patch);
  if(patch.setup?.firmwareVersion!==undefined&&patch.setup.firmwareVersion!==state.plan.setup.firmwareVersion&&patch.setup.startupVerified===undefined)plan.setup.startupVerified=false;
  await updatePlan(directory,plan,state.revision);
  if(patch.setup)await rememberSetup(directory,{setupFile});
  return loadBundle(directory,{program:false});
}
export async function upgradeBundle(directory) {
  const plan=await json(resolve(directory,'plan.json'));
  if(plan.generatorVersion===VERSION)return;
  requireThat(['0.1.0','0.2.0','0.2.1','0.2.2','0.2.3'].includes(plan.generatorVersion),'Unsupported bundle upgrade.');
  const review=await json(resolve(directory,'review.json'));
  plan.generatorVersion=VERSION;plan.process.skinDirection='alternating';
  plan.process.combTravelMm??=defaults().process.combTravelMm;
  plan.process.startupRetracted??=defaults().process.startupRetracted;
  plan.setup.buildVolumeC??=defaults().setup.buildVolumeC;
  plan.setup.materialGuid||=defaults().setup.materialGuid;
  delete review.approvals.plan;delete review.approvals.toolpath;review.generation=null;
  review.history.push({event:'generator-upgraded',version:VERSION,time:new Date().toISOString()});
  await save(resolve(directory,'plan.json'),plan);await save(resolve(directory,'review.json'),review);
}
export async function updatePlan(directory,plan,revision) {
  const state=await loadBundle(directory,{program:false});
  requireThat(revision===state.revision,'This view is stale. Reload before changing the print.');validatePlan(plan,state.machine);
  if(canonical(plan)===canonical(state.plan))return state;
  const geometryChanged=canonical(plan.geometry)!==canonical(state.plan.geometry);
  if(geometryChanged) {
    const g=await createGeometry(plan.geometry);
    await save(resolve(state.dir,'geometry/model.3dm'),g.bytes);await save(resolve(state.dir,'geometry/model.json'),g.descriptor);
  }
  const review=state.review;
  review.history.push({event:'plan-edited',time:new Date().toISOString(),previousPlanHash:state.planHash,invalidated:geometryChanged?['geometry','plan','toolpath']:['plan','toolpath']});
  if(geometryChanged)delete review.approvals.geometry;
  delete review.approvals.plan;delete review.approvals.toolpath;review.generation=null;
  await save(resolve(state.dir,'plan.json'),plan);await save(resolve(state.dir,'review.json'),review);
  return loadBundle(directory);
}
export async function generateBundle(directory,{development=false}={}) {
  const state=await loadBundle(directory,{program:false});
  requireThat(development||state.planApproved,'Approve the geometry and locked plan before production generation.');
  const path=generatePath(state.plan,state.machine),code=exportGcode(path,state.plan,state.machine);
  const program=interpretGcode(code,state.plan,state.machine);
  const expected=path.actions.filter(a=>a.kind==='move');
  requireThat(program.moves.length===expected.length,'G-code move count differs from SAAMpath.');
  for(let i=0;i<expected.length;i++) {
    const a=expected[i],b=program.moves[i];
    requireThat(a.to.every((v,j)=>Math.abs(v-b.to[j])<=0.000006)&&Math.abs(a.volumeMm3-b.volumeMm3)<0.00007,'G-code round-trip changed the path.');
  }
  const checks={schema:'saam-checks/1',result:'pass',mode:development?'development':'production',planHash:state.planHash,
    exportHash:hash(code),pathHash:hash(path),checks:['plan-inputs','3dm-round-trip','declared-output','strict-gcode-interpretation','xyz-bounds','axis-feed','extrusion-flow','temperature-state','saampath-export-round-trip'],
    clearance:'operator responsibility; not checked',physicalValidation:'not performed',limitations:state.limitations};
  await save(resolve(state.dir,'path.saampath'),path);await save(resolve(state.dir,'exports/griffin-gcode/wedge.gcode'),code);
  await save(resolve(state.dir,'checks.json'),checks);
  const review=state.review;delete review.approvals.toolpath;
  review.generation={mode:checks.mode,planHash:state.planHash,exportHash:checks.exportHash,pathHash:checks.pathHash,version:VERSION};
  review.history.push({event:'generated',mode:checks.mode,time:new Date().toISOString(),exportHash:checks.exportHash});
  await save(resolve(state.dir,'review.json'),review);
  return checks;
}
export async function approve(directory,{stage,actor,revision}) {
  requireThat(['geometry','plan','toolpath'].includes(stage),'Unknown approval stage.');
  requireThat(typeof actor==='string'&&actor.trim().length>=2&&actor.length<=100,'Enter the human reviewer’s name.');
  const state=await loadBundle(directory);
  requireThat(revision===state.revision,'This review is stale. Reload before approving.');
  if(stage==='plan') {
    requireThat(state.geometryApproved,'Approve geometry first.');
  }
  if(stage==='toolpath')requireThat(state.planApproved&&state.program&&!state.programError&&state.review.generation?.mode==='production','Generate and check the approved production plan before toolpath approval.');
  const record={actor:actor.trim(),time:new Date().toISOString(),hash:stage==='geometry'?state.geometryHash:stage==='plan'?state.planHash:state.exportHash};
  if(stage==='toolpath')record.planHash=state.planHash;
  state.review.approvals[stage]=record;
  state.review.history.push({event:'human-approval',stage,...record});
  await save(resolve(state.dir,'review.json'),state.review);
  return loadBundle(directory);
}
export async function deliver(directory) {
  const state=await loadBundle(directory);
  requireThat(state.toolpathApproved,'Delivery requires approval of the exact current export.');
  const bytes=await readFile(resolve(state.dir,'exports/griffin-gcode/wedge.gcode'));
  requireThat(hash(bytes)===state.exportHash,'Export changed during delivery.');
  const destination=resolve(state.dir,'delivery/wedge.gcode');await save(destination,bytes);
  requireThat(hash(await readFile(destination))===state.exportHash,'Delivery bytes differ from reviewed export.');
  return destination;
}
