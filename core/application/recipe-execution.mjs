// One submitted Bundle job resolves authored recipe references internally.
// Recipes do not own jobs, subscriptions or background regeneration lifetimes.
import {captureOperationRecipes,captureRecipeData,recipeDependencies} from '../print/operation-recipes.mjs';
import {runBundleSolve} from './bundle-execution.mjs';

const failure=(id,error)=>({recipe:id,message:String(error?.message??error)});
function inputIdentities(recipe,available){
  return Object.fromEntries(Object.entries(recipe.inputs??{}).map(([name,link])=>[name,link.recipe?
    {recipe:link.recipe,revision:available.get(link.recipe)?.revision,result:available.get(link.recipe)?.id,output:link.output}:{value:link.value}]));
}
function matchesInputs(recipe,result,available){
  const expected=inputIdentities(recipe,available),actual=result.inputs;
  if(!actual||Object.keys(actual).length!==Object.keys(expected).length)return false;
  return Object.entries(expected).every(([name,identity])=>{
    const observed=actual[name];return observed&&Object.keys(observed).length===Object.keys(identity).length&&
      Object.entries(identity).every(([key,value])=>value!==undefined&&observed[key]===value);
  });
}
function descendants(roots,dependencies){
  const affected=new Set(roots);
  for(let changed=true;changed;){changed=false;for(const [id,inputs] of dependencies)
    if(!affected.has(id)&&[...inputs].some(input=>affected.has(input))){affected.add(id);changed=true;}}
  return affected;
}
function neededRecipes(targets,byId,dependencies,available){
  const needed=new Set(),pending=[...targets];
  while(pending.length){const id=pending.pop();if(needed.has(id)||available.has(id))continue;needed.add(id);
    if(byId.has(id))pending.push(...dependencies.get(id));}
  return needed;
}
async function invokeConstruction(Construction,request,scope){
  let work,schedule,accepting=true;
  function admitDelivery(value,what){
    if(!accepting)throw Error('Construction delivered '+what+' after its command settled.');
    scope.signal?.throwIfAborted();
    if(!value||typeof value.id!=='string'||!value.id||value.value===undefined)throw Error('Construction delivered no identified '+what+'.');
  }
  const results={
    work(value){admitDelivery(value,'work');if(work)throw Error('Construction delivered work twice.');work=value;return {status:'completed',id:value.id};},
    schedule(value){admitDelivery(value,'schedule');if(schedule)throw Error('Construction delivered a schedule twice.');
      if(!work||value.workId!==work.id)throw Error('Construction delivered a schedule for different work.');schedule=value;return {status:'completed',id:value.id};}
  };
  let outcome;
  try{outcome=await Construction.command(request,{...scope,results});}
  finally{accepting=false;}
  scope.signal?.throwIfAborted();
  if(!['completed','failed'].includes(outcome?.status))throw Error('Construction returned no command outcome.');
  if(!work)throw Error(outcome?.message??'Construction completed without delivering work.');
  if(outcome?.status==='completed'&&!schedule)throw Error('Construction completed without delivering its schedule.');
  // Work survives a failed schedule. The command reply supplies no result data;
  // only the named retention receivers above can populate these outputs.
  return {id:schedule?.id??work.id,outputs:{work:work.value,...(schedule?{schedule:schedule.value}:{})},
    ...(outcome?.status!=='completed'?{status:'partial',findings:[{stage:'scheduling',message:outcome?.message??'Scheduling did not complete.'}]}:{}),
    ...(schedule?.qualification?{guarantees:{scheduling:schedule.qualification}}:{})};
}
function invokeOwner(ports,recipe,inputs,scope){
  const request={operation:recipe.operation?.name,arguments:recipe.arguments??{},inputs,
    recipe:{id:recipe.id,revision:recipe.revision},...(recipe.operation?.extensionId?{extensionId:recipe.operation.extensionId}:{}),
    ...(recipe.operation?.entry?{entry:recipe.operation.entry}:{})};
  if(!request.operation)throw Error('Recipe operation is unfinished.');
  // Every branch is a distinct typed plug. The receiving owner admits its own
  // named operation; a caller-controlled property is never invoked as code.
  switch(recipe.operation?.owner){
    case 'geometry':return ports.Geometry.query(request,scope);
    case 'regions':return ports.Regions.query(request,scope);
    case 'toolpath':return invokeConstruction(ports.Construction,request,scope);
    case 'scheduling':throw Error('Deprecated scheduling recipe. Construction starts Scheduler for the submitted Bundle.');
    case 'extensions':return ports.Extensions.query(request,scope);
    default:throw Error('Recipe has no admitted operation owner.');
  }
}

export function createBundleRecipeExecution({Bundle,runJob,Geometry,Regions,Construction,Extensions}){
  if(typeof runJob!=='function')throw TypeError('Bundle execution requires its Runtime job host.');
  const ports={Geometry,Regions,Construction,Extensions};
  async function execute({bundleId,targets,changed,signal,progress,beforeCommit}){
    signal?.throwIfAborted();
    // Capture definitions before the first asynchronous query/operation. Values
    // stay under their producer's immutable/job-ownership guarantee.
    let snapshot=await Bundle.readRecipeInputs({bundleId,targets,includeResults:true});
    if(!Array.isArray(targets)||targets.some(id=>typeof id!=='string'||!id))throw TypeError('Supply the requested recipe result ids.');
    targets=[...new Set(targets)];
    const revision=snapshot.revision;
    const savedResults=new Map((snapshot.resultInputs??[]).map(item=>[item.recipe,{...item}]));
    const recipes=captureOperationRecipes(snapshot.recipes),byId=new Map(recipes.map(recipe=>[recipe.id,recipe]));
    const dependencies=recipeDependencies(recipes),affected=descendants(changed,dependencies),available=new Map(),external=new Map(snapshot.values??[]);
    const reuse=[...(snapshot.known??[])];
    snapshot=undefined;
    // Reuse includes captured producer-result identities, not just the local
    // definition revision. A changed upstream result invalidates its readers.
    for(let advanced=true;advanced;){advanced=false;for(const result of reuse){
      const recipe=byId.get(result.recipe),saved=savedResults.get(result.recipe);
      if(recipe&&!available.has(recipe.id)&&typeof result.id==='string'&&result.id&&result.outputs&&typeof result.outputs==='object'&&!Array.isArray(result.outputs)&&
        (!saved||saved.available&&saved.id===result.id)&&
        recipe.revision===result.revision&&!affected.has(recipe.id)&&[...dependencies.get(recipe.id)].every(id=>available.has(id))&&
        Object.values(recipe.inputs??{}).every(link=>link.recipe||external.has(link.value))&&matchesInputs(recipe,result,available)){
        available.set(recipe.id,result);advanced=true;
      }
    }}
    reuse.length=0;
    const selected=targets,selectedSet=new Set(selected),needed=neededRecipes(selected,byId,dependencies,available),pending=new Set(needed),failed=new Map(),completed=[],partial=new Set();
    const consumers=new Map();
    for(const id of needed)for(const producer of dependencies.get(id)??[])consumers.set(producer,(consumers.get(producer)??0)+1);
    const finish=id=>{
      pending.delete(id);
      for(const producer of dependencies.get(id)??[]){const count=consumers.get(producer)-1;consumers.set(producer,count);if(!count&&!selectedSet.has(producer))available.delete(producer);}
      if(!consumers.get(id)&&!selectedSet.has(id))available.delete(id);
    };
    const report=value=>{try{Promise.resolve(progress(value)).catch(()=>{});}catch{/* Observation cannot choose work. */}};
    try{
      while(pending.size){
        signal?.throwIfAborted();let advanced=false;
        for(const id of [...pending]){
          const recipe=byId.get(id);
          if(!recipe){failed.set(id,failure(id,Error('Required recipe is absent.')));finish(id);advanced=true;continue;}
          const required=dependencies.get(id);
          if([...required].some(producer=>pending.has(producer)))continue;
          const missing=[...required].find(producer=>!available.has(producer));
          if(missing!==undefined){failed.set(id,failure(id,Error('Required producer '+missing+' is unavailable.')));finish(id);advanced=true;continue;}
          const inputs=Object.fromEntries(Object.entries(recipe.inputs??{}).map(([name,link])=>[name,link.recipe?available.get(link.recipe).outputs?.[link.output]:external.get(link.value)]));
          const absent=Object.entries(recipe.inputs??{}).find(([name,link])=>link.recipe?!Object.hasOwn(available.get(link.recipe).outputs??{},link.output):!external.has(link.value));
          if(absent){failed.set(id,failure(id,Error('Required input '+absent[0]+' is unavailable.')));finish(id);advanced=true;continue;}
          report({recipe:id,stage:'Running operation',completed:completed.length,total:needed.size});
          try{
            const produced=await invokeOwner(ports,recipe,inputs,{signal,progress:report});
            signal?.throwIfAborted();
            if(!produced||typeof produced.id!=='string'||!produced.id||!produced.outputs||typeof produced.outputs!=='object'||Array.isArray(produced.outputs))throw Error('Operation owner returned no identified named output values.');
            const result={id:produced.id,recipe:id,revision:recipe.revision,inputs:inputIdentities(recipe,available),outputs:produced.outputs,
              ...(produced.status==='partial'?{status:'partial'}:{}),
              ...(produced.findings?{findings:produced.findings}:{}),...(produced.guarantees?{guarantees:produced.guarantees}:{})};
            if(produced.status==='partial')partial.add(id);
            available.set(id,result);completed.push(id);
          }catch(error){if(signal?.aborted)throw signal.reason;failed.set(id,failure(id,error));}
          finish(id);advanced=true;
        }
        if(!advanced){for(const id of pending)failed.set(id,failure(id,Error('Recipe input dependencies contain an unresolved cycle.')));pending.clear();}
      }
      signal?.throwIfAborted();
      // Known inputs also belong to the publication read set. A new edit cannot
      // slip through merely because its old value was available at admission.
      const readSet=neededRecipes(selected,byId,dependencies,new Map());
      // Absence is part of this captured read too. If a missing prerequisite
      // arrives before publication, its obsolete failure must not be selected.
      const requiredIdentities=[...readSet].map(id=>({id,revision:byId.get(id)?.revision??null}));
      // Publication receives exact captured identities and supplied results.
      // It must independently enforce current authority and reject stale input.
      const candidate={bundleId,revision,targets:[...selected],recipes:requiredIdentities,
        values:[...new Set([...readSet].flatMap(id=>Object.values(byId.get(id)?.inputs??{}).flatMap(link=>link.value?[link.value]:[])))].map(id=>({id,present:external.has(id)})),
        resultInputs:[...readSet].map(recipe=>savedResults.get(recipe)??{recipe,id:null,available:false}),
        results:selected.filter(id=>available.has(id)).map(id=>available.get(id)),failures:[...failed.values()]};
      await beforeCommit(candidate);
      const outcome=await Bundle.publishRecipeResults(candidate);
      return outcome.status==='completed'&&(failed.size||partial.size||candidate.results.some(result=>result.status==='partial'))
        ?{...outcome,publicationStatus:'completed',status:candidate.results.length?'partial':'failed'}:outcome;
    }finally{
      // No previous/current stream per intermediate. Dropping these references
      // releases job-owned values after publication or cancellation settles.
      available.clear();external.clear();
    }
  }
  async function run(input){
    // Submission is finite data. Executable control/observation hooks and saved
    // producer guarantees come only from their admitted owners below.
    const captured=captureRecipeData(input);
    for(const key of Object.keys(captured))if(!['bundleId','targets','changed'].includes(key))throw TypeError('Deprecated recipe submission field: '+key+'.');
    if(captured.bundleId!==Bundle.bundleId)throw TypeError('Submit the bound Bundle identity.');
    if(!Array.isArray(captured.targets)||captured.targets.some(id=>typeof id!=='string'||!id))throw TypeError('Supply the requested recipe result ids.');
    const changed=captured.changed??[];
    if(!Array.isArray(changed)||changed.some(id=>typeof id!=='string'||!id))throw TypeError('Supply changed recipe ids.');
    function executeSubmitted(scope){
      function beforePublication(){scope.signal.throwIfAborted();return scope.beforeCommit('Publishing Bundle result');}
      return execute({bundleId:captured.bundleId,targets:captured.targets,changed,signal:scope.signal,progress:scope.progress,beforeCommit:beforePublication});
    }
    function submitJob(){return runJob({bundleId:captured.bundleId},executeSubmitted);}
    return runBundleSolve(Bundle.directory,submitJob);
  }
  return Object.freeze({run});
}
