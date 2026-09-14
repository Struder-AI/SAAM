// Read-only adapter into the existing Studio, with no approval or delivery path.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {interpretMachineStudy,interpretSplitDeltaStudy} from '../core/export/machine-study.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
async function files(dir){
  const plan=await readFile(resolve(dir,'plan.json'),'utf8'),name=JSON.parse(plan).output==='split-delta-preview'?'motion.sdgcode':'motion.json';
  return [plan,...await Promise.all(['machine.json',name].map(name=>readFile(resolve(dir,name),'utf8')))];
}
export async function bundleFingerprint(dir){return hash((await files(dir)).join('\n'));}
export async function loadBundle(dir,{program=true,allSources=false}={}){
  const [planText,machineText,source]=await files(dir),plan=JSON.parse(planText),machine=JSON.parse(machineText);
  if(plan.schema!=='saam-machine-study/1'||!['machine-study','split-delta-preview'].includes(plan.output))throw Error('Invalid machine study plan');
  const split=plan.output==='split-delta-preview',name=split?'motion.sdgcode':'motion.json';
  const decoded=split?interpretSplitDeltaStudy(source,machine,plan.setup):interpretMachineStudy(source),revision=hash(planText+machineText),exportHash=hash(source),bounds=plan.studyBounds;
  if(!bounds||!['min','max'].every(k=>bounds[k]?.length===3&&bounds[k].every(Number.isFinite)))throw Error('Study needs finite display bounds');
  const sources=[{name,sha256:hash(source)}];
  const vertices=Array.from({length:8},(_,i)=>[0,1,2].map(j=>bounds[(i>>j)&1?'max':'min'][j]));
  const geometry={geometryVersion:revision,boundsMm:bounds,vertices,faces:[],labels:[],edges:[],roof:null};
  const state={kind:'wedge',plan,machine,revision,planHash:revision,exportHash,geometry,pathSummary:{planarLayers:0},
    geometryApproved:false,planApproved:false,toolpathApproved:false,outputAvailability:'Simulation only; machine output is unavailable.',
    review:{generation:{mode:'development'},approvals:{}},
    inspection:{title:machine.name,description:'Nominal mechanism study · inspect source motion and machine geometry.',
      facts:[['Machine',machine.name],['Motion',decoded.seconds+' seconds'],['Source','Authored mechanism study']],settings:[['Model',machine.kinematicModel?.basis??'Nominal profile']],
      note:'Simulation only. No print approvals, machine delivery or hardware execution.'}};
  if(program)state.program=program==='source'?{sources,summary:decoded.summary,notice:decoded.notice}:{...decoded,sources};
  if(allSources)state.sources={[name]:source};return state;
}
const unavailable=()=>{throw Error('Machine studies do not support manufacturing approval, generation or delivery');};
export const approve=unavailable,generateBundle=unavailable,deliver=unavailable,updatePlan=unavailable;
