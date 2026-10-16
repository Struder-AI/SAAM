// Reproducible native Boolean stress cases, each with a parent watchdog.
// Timings and failures are saved, including effective recovery adjustments.
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFile,mkdir,readdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {geometryOperations} from '../../core/geom/operations.mjs';
import {referencePatch} from '../../core/geom/reference-surface.mjs';
import {BOOLEAN_TOLERANCE_MM} from '../../core/dimensions.mjs';

const G=geometryOperations(),activeCase={row:null,stage:'fixture'};
async function fixture(id){
  const {default:author}=await import('./boolean-examples/'+id);
  return author(G);
}
function referenceBoolean(operation,operands){
  const min=[0,1,2].map(k=>Math.min(...operands.map(s=>s.bounds.min[k]))),max=[0,1,2].map(k=>Math.max(...operands.map(s=>s.bounds.max[k])));
  return {kind:'boolean',operation,operands,bounds:{min,max},empty:false};
}
function effectiveOperands(operands,body){
  const inherited=operands.reduce((sum,operand)=>sum+(operand.construction?.recoveries?.length??0),0);
  const recoveries=body.construction.recoveries??[],recovery=recoveries.length>inherited?recoveries.at(-1):null;
  if(recovery?.method!=='perturbation')return operands;
  return operands.map((operand,i)=>{const adjustment=recovery.adjustments.find(row=>row.operand===i);return adjustment?G.translateShell(operand,...adjustment.translationMm):operand;});
}
function progress(stage){activeCase.stage=stage;if(process.send)process.send({progress:true,stage,row:activeCase.row});}
async function runCase(index){
  const started=performance.now(),model=await fixture(index),constructionStart=performance.now();
  progress('construction');
  const body=G.combineSolids(model.operation,model.operands);
  const row={index,name:model.name,operation:model.operation,constructionMs:performance.now()-constructionStart,
    faces:body.patches.length,empty:body.empty,notes:body.notes??[],recoveries:body.construction.recoveries??[],sections:[]};
  activeCase.row=row;progress('case assertions');await model.verify?.(G,body);progress('sections');
  assert.deepEqual(body.topology.unmatched,[]);
  const expected=referenceBoolean(model.operation,effectiveOperands(model.operands,body)),bounds=expected.bounds;
  const mid=bounds.min.map((lo,k)=>(lo+bounds.max[k])/2),size=bounds.min.map((lo,k)=>Math.max(1,bounds.max[k]-lo));
  const curved=referencePatch({name:'stress-cut',degreeU:2,degreeV:2,controlPoints:[0,.5,1].map(u=>[0,.5,1].map(v=>[
    bounds.min[0]-1+u*(size[0]+2),bounds.min[1]-1+v*(size[1]+2),mid[2]+.03*size[2]*(u===.5&&v===.5?1:0)]))});
  const slices=[G.horizontalSlice(mid[2]),G.planeSlice({origin:mid,normal:[.17,.31,1]}),G.patchSlice(curved)];
  for(const slice of slices){
    progress('native section '+slice.kind+' '+row.sections.length);
    const start=performance.now(),actual=G.section(body,slice);
    progress('operand section '+slice.kind+' '+row.sections.length);
    const reference=G.section(expected,slice);
    assert.deepEqual(actual.open,[],'constructed section is open');assert.deepEqual(reference.open,[],'reference section is open');
    const error=G.regionArea(G.difference(actual.loops,reference.loops))+G.regionArea(G.difference(reference.loops,actual.loops));
    const perimeter=reference.loops.reduce((sum,loop)=>sum+loop.reduce((value,p,i)=>value+Math.hypot(...p.map((x,k)=>x-loop[(i+1)%loop.length][k])),0),0);
    const allowance=BOOLEAN_TOLERANCE_MM*(perimeter+1)*2;
    row.sections.push({kind:slice.kind,ms:performance.now()-start,errorMm2:error,allowanceMm2:allowance});
    assert.ok(error<=allowance,'section differs from independent operand composition: '+error+' > '+allowance);
  }
  progress('output admission');
  const meshStart=performance.now(),[mesh]=await G.constructSolids([body],{toleranceMm:.02});
  assert.equal(mesh===null,body.empty);row.meshMs=performance.now()-meshStart;row.triangles=mesh?.triangles.length??0;
  row.totalMs=performance.now()-started;return row;
}
async function watchedCase(index,timeoutMs){
  const child=fork(fileURLToPath(import.meta.url),[],{env:{...process.env,SAAM_BOOLEAN_STRESS_CASE:index},execArgv:[],stdio:['ignore','ignore','pipe','ipc']}),started=performance.now();
  child.stderr.resume();
  const latest={stage:'fixture',row:null};
  const row=await new Promise(resolve=>{
    const timer=setTimeout(()=>{child.kill();resolve({...latest.row,index,stage:latest.stage,ok:false,timeout:true,error:'Case watchdog interrupted construction, sectioning or output conversion.'});},timeoutMs);
    child.on('message',result=>{if(result.progress){latest.stage=result.stage;latest.row=result.row;return;}clearTimeout(timer);child.kill();resolve(result);});
    child.once('error',error=>{clearTimeout(timer);resolve({index,ok:false,error:error.message,stack:error.stack});});
    child.once('exit',code=>{clearTimeout(timer);resolve({index,ok:false,error:'Case process exited with '+code});});
  });
  return {...row,wallMs:performance.now()-started};
}
if(!process.env.SAAM_BOOLEAN_STRESS_CASE){
  const argument=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
  const examples=(await readdir(new URL('./boolean-examples/',import.meta.url))).filter(name=>/^\d.*\.mjs$/.test(name)).sort();
  const count=Number(argument('--cases',examples.length)),single=argument('--case',null),output=resolve(argument('--output','.local/surface-boolean-stress.json'));
  assert.ok(Number.isSafeInteger(count)&&count>0);
  const ids=single===null?examples.slice(0,count):examples.filter(name=>single.split(',').some(id=>name===id||name.startsWith(id))),results=[];
  assert.ok(ids.length>0,'No saved example matches the requested case.');
  await mkdir(dirname(output),{recursive:true});
  for(const index of ids){
    results.push(await watchedCase(index,30000));
    await writeFile(output,JSON.stringify({toleranceMm:BOOLEAN_TOLERANCE_MM,caseTimeoutMs:30000,results},null,2)+'\n');
  }
  process.exitCode=results.every(row=>row.ok)?0:1;
}else{
  try{process.send({ok:true,...await runCase(process.env.SAAM_BOOLEAN_STRESS_CASE)});}
  catch(error){process.send({...activeCase.row,index:process.env.SAAM_BOOLEAN_STRESS_CASE,stage:activeCase.stage,ok:false,error:error.message,stack:error.stack,attempts:error.attempts});}
}
