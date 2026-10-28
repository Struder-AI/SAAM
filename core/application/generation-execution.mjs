// Runtime owns the admitted whole-plan solve and its worker lifetime.
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {requireThat} from '../private/bundle/numeric.mjs';
import {runComputationJob} from '../print/computation-job.mjs';
import {heldBundleInstance} from '../print/studio-ownership.mjs';
import {getObservationFlow,withObservationFlow,observeContractArtifact,observeContractValue} from '../contracts/observations.mjs';
import {joinSaamPath} from '../path/saampath.mjs';
import {pathSummary} from '../path/curve-path.mjs';
import {summarizePath} from '../path/motion-report.mjs';
import {schedulingNozzleInputs} from '../machine/nozzle.mjs';
import {installedMachine} from '../machine/profile.mjs';

export function createGenerationExecution({Bundle,Construction,sourceIdentity,contract=null,version}){
async function prepareGeneration(directory,{onProgress}={}){
  const state=await Bundle.readGenerationInputs(directory),source=await generationSource(state.plan);
  return withInputRevision(state,async()=>{
    onProgress?.({stage:'Preparing geometry'});
    const {path,artifact}=await prepareToolpath(state,{onProgress,source});
    const pathReport=summarizePath(path,state.plan.process.lineWidthMm);
    const result={pathArtifact:artifact,summary:pathSummary(path),pathReport};
    return {directory:state.dir,revision:state.revision,editRevision:state.editRevision,source:{release:source.release,hash:source.hash},result};
  });
}

function withInputRevision(state,action){
  const flow=getObservationFlow();
  return flow?withObservationFlow({...flow,inputRevision:state.revision},action):action();
}

// Generation-source currency is checked only when working on a print. Saved
// viewing and delivery do not load extensions or reinterpret source versions.
async function generationSource(plan){
  return sourceIdentity?sourceIdentity(plan):{release:null,hash:null};
}

function staleGenerationSource(state,source){
  const saved=state.review.path?.source;
  return Boolean(state.review.path
    &&(source.release!==null&&saved?.release!==source.release||source.hash!==null&&saved?.hash!==source.hash));
}

async function requireGenerationSource(state,expected){
  if(!sourceIdentity)return;
  const source=await generationSource(state.plan);
  if(source.release===expected?.release&&source.hash===expected?.hash)return;
  if(source.missing)throw source.missing;
  throw Error('Generation source changed during calculation. Generate again using the current scripts.');
}

async function prepareToolpath(state,{onProgress,source}={}){
  const saved=state.review.path,reuse=state.artifacts.path==='current'&&!staleGenerationSource(state,source);
  if(source.missing&&!reuse)throw source.missing;
  const previous=reuse?await Bundle.readGenerationPath(state):null;
  if(reuse)onProgress?.({stage:'Reusing saved SAAMpath'});
  const id=reuse?saved.id:randomUUID(),file=reuse?saved.file:`paths/${id}.json`;
  let work,scheduleResult,scheduleFile;
  // Settings resolves the part's machine label to its installed profile's nozzles.
  const machine=installedMachine(state.machineId);
  requireThat(!state.machineId||machine,`The ${state.machineId} machine is not installed here. Install it or select another printer before generating.`);
  const nozzleTypes=schedulingNozzleInputs(machine,state.plan),requireSuppliedNozzles=Boolean(machine);
  // These receivers own persistence, not numerical generation or scheduling.
  const outcome=await Construction({plan:state.plan,sourcePathId:id,work:previous?.deposition,
    schedule:previous?.schedule,scheduleId:reuse?saved.scheduleId:null,
    nozzleTypes,requireSuppliedNozzles},
    {onProgress,results:{
      async work(result){
        work=result.value;
        const retainedIdentity=reuse?null:await Bundle.retainGenerationArtifact(state.dir,{file,value:work});
        const observation=observeContractArtifact({wireId:'construction-work-results',typeId:'work',implementationSchema:work.schema,
          stageId:'constructed-source',consumerId:'prepareToolpath:'+id,file:resolve(state.dir,file),artifactId:id,retainedIdentity});
        // Retain the prepared input descriptor beside its exact source capture.
        // Inspection supplies no receipt or input back to Construction.
        observeContractValue({wireId:'construction-scheduling',phase:'request-context',typeId:'schedule-request',
          stageId:'prepared-scheduling-input',consumerId:'startScheduling:'+id,
          value:{sourcePathId:id,nozzleTypes,requireSuppliedNozzles,
            work:{artifactId:id,valueId:observation.valueId??null,observationId:observation.id??null},observationalCallbacks:['onProgress']}});
      },
      async schedule(result){
        scheduleResult=result;
        const unchanged=reuse&&result.value===previous.schedule;
        scheduleFile=unchanged?saved.scheduleFile:`paths/${id}.${result.id}.schedule.json`;
        const retainedIdentity=unchanged?null:await Bundle.retainGenerationArtifact(state.dir,{file:scheduleFile,value:result.value});
        observeContractArtifact({wireId:'scheduling-results',typeId:'schedule',implementationSchema:result.value.schema,
          stageId:'scheduled-source',consumerId:'prepareToolpath:'+id,file:resolve(state.dir,scheduleFile),artifactId:result.id,retainedIdentity});
      }
    }});
  requireThat(outcome.status==='completed',outcome.message??'Construction failed.');
  const path=joinSaamPath({sourcePathId:id,deposition:work,schedule:scheduleResult.value});
  const qualification=scheduleResult.qualification,limitations=[...new Set([...(work.summary.limitations??[]),
    ...(qualification.status==='failed'?[qualification.message]:[])])];
  const artifact={id,file,scheduleFile,scheduleId:scheduleResult.id,inputId:state.pathInputId,contract,
    sourceSchema:work.schema,qualification,
    ...(source.hash!==null?{source:{release:source.release,hash:source.hash}}:{}),
    ...(limitations.length?{limitations}:{})};
  return {path,artifact};
}

// Observations are kept only where the caller says: the operation flow Runtime
// opens for every command, or the paths this generation was invoked with
// (Studio passes its own). A direct call with neither, such as a development
// script, runs without retaining observations rather than writing to a home it
// was not given.
async function generateBundle(directory, { development = false, signal, onProgress, beforeCommit, paths } = {}) {
  if(!getObservationFlow()&&paths)return withObservationFlow({directory:resolve(paths.state,'contract-observations'),operation:'generate_toolpath',bundleId:directory},async function generateObserved(){return generateBundle(directory,{development,signal,onProgress,beforeCommit});});
  const state=await Bundle.readGenerationInputs(directory),source=await generationSource(state.plan);
  signal?.throwIfAborted();
  const current=await currentGenerationCandidate(directory,state,source);
  if(current){
    await requireGenerationSource(state,source);
    if(development||current.checks.mode==='production')return current.checks;
    await beforeCommit?.();
    await requireGenerationSource(state,source);
    const confirmed=await currentGenerationCandidate(directory,state,source);
    requireThat(confirmed&&confirmed.checks.mode==='development'
      &&confirmed.current.outputId===current.current.outputId
      &&confirmed.current.revision===current.current.revision,
    'The reviewed export changed before promotion. Generate it again.');
    const checks={...confirmed.checks,mode:'production'};
    await Bundle.publishGenerationResults(directory,{directory:state.dir,revision:confirmed.current.revision,editRevision:confirmed.current.editRevision,promoteOutputId:confirmed.current.outputId,checks});
    return checks;
  }
  return runComputationJob(new URL('./generation-worker.mjs',import.meta.url),
    {directory:state.dir,editRevision:state.editRevision,development,instance:heldBundleInstance(state.dir),observationFlow:getObservationFlow()&&{...getObservationFlow(),inputRevision:state.revision}},
    {signal,progress:onProgress,beforeCommit:beforeCommit??(()=>{}),subject:'Generation'});
}

async function commitGeneration(directory,prepared,{development=false,onProgress,beforeCommit}={}){
  const state=await Bundle.readGenerationInputs(directory);
  requireThat(state.dir===prepared.directory&&state.editRevision===prepared.editRevision&&state.revision===prepared.revision,
    'The print changed during generation. Review the updated print.');
  await beforeCommit?.();
  await requireGenerationSource(state,prepared.source);
  const checks=generationChecks(state,prepared.result,development);
  onProgress?.({stage:'Saving your toolpath'});
  await Bundle.publishGenerationResults(directory,{...prepared,checks});
  return checks;
}
async function currentGenerationCandidate(directory,state,source){
  if(!state.review.generation||staleGenerationSource(state,source))return null;
  const current=await Bundle.readGenerationInputs(directory);
  if(!current.program||current.programError||!current.completedOutput?.current)return null;
  // Checks that do not match their path are stale: generation replaces them.
  const checks=current.review.generation.checks;
  return checks?.schema==='saam-path-checks/1'&&checks.result==='pass'&&checks.mode===current.review.generation?.mode?{checks,current}:null;
}

function generationChecks(state,{pathReport:report,summary,pathArtifact},development){
  return {
    schema: 'saam-path-checks/1', result: 'pass', mode: development ? 'development' : 'production',
    generatorVersion: version,
    moves: report.moves,
    volumeMm3: Number(report.volumeMm3.toFixed(3)),
    estimatedMinutes: Number((report.seconds / 60).toFixed(1)),
    travel: summary.travel,
    shortTravel: report.shortTravel,
    surfaceDomain: summary.surfaceDomain ?? null,
    qualification:pathArtifact.qualification??{status:'neutral'},
    limitations: [...new Set([...(summary.limitations??[]),...(report.limitations??[]),...(pathArtifact.limitations??[])])],
  };
}

return Object.freeze({generateBundle,prepareGeneration,commitGeneration});
}
