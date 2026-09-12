// Opt-in diagnosis of one existing shell print through its real generator and
// exporter. Reads the bundle; writes only benchmark reports, never approvals.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {Session} from 'node:inspector/promises';

const args=process.argv.slice(2),directory=args[0];
if(!directory||directory.startsWith('--'))throw new Error('Usage: node scripts/bench/print.mjs <print-directory> [--out <report-directory>] [--cpu]');
const output=path.resolve(args.includes('--out')?args[args.indexOf('--out')+1]:'.local/print-benchmark');
const input=path.resolve(directory);
if(output===input||output.startsWith(input+path.sep))throw new Error('Write benchmark reports outside the print directory.');
await mkdir(output,{recursive:true});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={node:process.version,cpu:os.cpus()[0]?.model,parallelism:os.availableParallelism(),started:new Date().toISOString(),stagesMs:{},input:{}};
const inspector=args.includes('--cpu')?new Session():null;
if(inspector){inspector.connect();await inspector.post('Profiler.enable');}
async function stage(name,fn){
  if(inspector)await inspector.post('Profiler.start');
  const start=performance.now();let result;
  try{result=await fn();}
  finally{
    report.stagesMs[name]=performance.now()-start;
    if(inspector){const {profile}=await inspector.post('Profiler.stop');await writeFile(path.join(output,name+'.cpuprofile'),JSON.stringify(profile));}
    await writeFile(path.join(output,'timing.json'),JSON.stringify(report,null,2)+'\n');
    console.log(`${name}: ${(report.stagesMs[name]/1000).toFixed(3)} s`);
  }
  return result;
}
try{
  const [generation,planning,exports,geometry]=await stage('runtime',()=>Promise.all([
    import('../../core/print/generate.mjs'),import('../../core/print/plan.mjs'),
    import('../../core/export/registry.mjs'),import('../../core/print/geometry.mjs')]));
  const [plan,machine]=await stage('read-and-parse',async()=>Promise.all(['plan.json','machine.json'].map(async name=>{
    const bytes=await readFile(path.join(input,name));report.input[name]={bytes:bytes.length,sha256:digest(bytes)};return JSON.parse(bytes);
  })));
  // A fresh benchmark process has no earlier geometry-ingestion result. Keep
  // this cold cost separate from generation after geometry is already loaded.
  await stage('geometry-and-plan',()=>planning.validatePlan(plan,machine));
  const native=generation.hasMesh(plan.geometry)?null:await stage('native-runtime',geometry.rhino);
  const toolpath=await stage('generate',()=>generation.generatePath(plan,machine,native));
  const {bytes,program}=await stage('export-and-interpret',()=>exports.exportAndInterpretProgram(toolpath,plan,machine,
    {generatorVersion:planning.VERSION,buildDate:planning.BUILD_DATE}));
  report.afterLoadMs=report.stagesMs.generate+report.stagesMs['export-and-interpret'];
  report.result={actions:toolpath.actions.length,moves:program.moves.length,exportBytes:Buffer.byteLength(bytes),exportSha256:digest(bytes),travel:toolpath.summary.travel};
  report.qualification='Generator and checked export only; no Studio transport/rendering, delivery or physical execution. CPU profiling adds overhead. Compare identical input hashes and comparable machine load.';
  await writeFile(path.join(output,'timing.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`After geometry load: ${(report.afterLoadMs/1000).toFixed(3)} s; ${program.moves.length} moves`);
}finally{inspector?.disconnect();}
