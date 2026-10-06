// Read-only adapter into the existing Studio, with no delivery path.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {interpretMachineStudy} from '../core/export/machine-study.mjs';
import {createFileSnapshot} from '../core/print/file-snapshot.mjs';
const checked={study:null};
const hash=s=>createHash('sha256').update(s).digest('hex');
async function files(dir,program=true){
  const plan=await readFile(resolve(dir,'plan.json'),'utf8'),name='motion.json';
  return [plan,...await Promise.all(['machine.json',...(program?[name]:[])].map(name=>readFile(resolve(dir,name),'utf8')))];
}
const snapshot=createFileSnapshot();
export async function bundleFingerprint(dir,{program=true}={}){
  return hash(JSON.stringify(await Promise.all(['plan.json','machine.json',...(program?['motion.json']:[])].map(name=>snapshot(resolve(dir,name))))));
}
// Studies have no review metadata, so presentation and source identity agree.
export async function bundleFingerprints(dir,options){const source=await bundleFingerprint(dir,options);return {source,presentation:source};}
export async function loadBundle(dir,{program=true,allSources=false}={}){
  const [planText,machineText,source]=await files(dir,program||allSources),plan=JSON.parse(planText),machine=JSON.parse(machineText);
  if(plan.schema!=='saam-machine-study/1'||plan.output!=='machine-study')throw Error('Invalid machine study plan');
  const name='motion.json';
  if(source!==undefined&&checked.study?.source!==source)checked.study={source,program:interpretMachineStudy(source)};
  const decoded=source===undefined?null:checked.study.program,revision=hash(planText+machineText),outputId=source===undefined?undefined:hash(source),bounds=plan.studyBounds;
  if(!bounds||!['min','max'].every(k=>bounds[k]?.length===3&&bounds[k].every(Number.isFinite)))throw Error('Study needs finite display bounds');
  const sources=source===undefined?[]:[{name,sha256:outputId}];
  const vertices=Array.from({length:8},(_,i)=>[0,1,2].map(j=>bounds[(i>>j)&1?'max':'min'][j]));
  const geometry={boundsMm:bounds,vertices,faces:[],labels:[],edges:[],roof:null};
  const geometryId=hash(JSON.stringify(bounds));
  const state={kind:'wedge',plan,machine,revision,editRevision:revision,outputId,geometry,geometryId,geometryInputId:geometryId,pathSummary:{planarLayers:0},
    outputAvailability:'Simulation only; machine output is unavailable.',
    review:{generation:{id:outputId,mode:'development',editRevision:revision}},
    inspection:{title:machine.name,description:'Nominal mechanism study · inspect source motion and machine geometry.',
      facts:[['Machine',machine.name],...(decoded?[['Motion',decoded.seconds+' seconds']]:[]),['Source','Authored mechanism study']],settings:[['Model',machine.kinematicModel?.basis??'Nominal profile']],
      note:'Simulation only. No machine delivery or hardware execution.'}};
  state.workEvidence={schema:'saam-work-evidence/1',revision,inputKey:revision,geometryKey:geometryId,generationKey:outputId??null,editRevision:revision};
  if(decoded)state.completedOutput={id:outputId,current:true,plan,machine,geometry,geometryId,geometryInputId:geometryId,
    editRevision:revision,outputId,review:state.review,exportName:name,limitations:[]};
  if(program)state.program=structuredClone(program==='source'?{sources,summary:decoded.summary,notice:decoded.notice}:{...decoded,sources});
  if(allSources)state.sources={[name]:source};return state;
}
const unavailable=()=>{throw Error('Machine studies do not support generation or delivery');};
export const generateBundle=unavailable,updatePlan=unavailable;
