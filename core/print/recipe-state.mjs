// Passive Bundle storage. plan.json remains the only mutable commit point;
// this owner follows no execution graph and invokes no operation/default host.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {replaceJsonFile} from '../file-write.mjs';
import {manifestRevision} from './manifest-identity.mjs';
import {withBundleWriteLock} from './bundle-lock.mjs';
import {requireBundleInstance} from './studio-ownership.mjs';
import {recordBundleRuntime} from './bundle-runtime.mjs';
import {captureOperationRecipes,captureRecipeData,recipeDataChunks} from './operation-recipes.mjs';

const schema='saam-operation-recipes/1';
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>typeof value==='string'&&value.length>0;
// JSON.parse gave Bundle sole ownership of this tree. Freeze that tree in
// place instead of making another whole-value copy for immutable transfer.
function freezeSaved(value){
  if(typeof value==='number'&&!Number.isFinite(value))throw Error('Saved recipe values must be finite.');
  if(value&&typeof value==='object'){for(const item of Object.values(value))freezeSaved(item);Object.freeze(value);}
  return value;
}
function ids(values){
  if(!Array.isArray(values)||values.some(value=>!identity(value))||new Set(values).size!==values.length)throw TypeError('Supply distinct recipe ids.');
  return values;
}
function graphFor(document){
  if(!['saam-print-bundle/2','saam-print-bundle/3'].includes(document?.bundle?.schema))throw Error('Deprecated print bundle layout.');
  const graph=document.bundle.operationRecipes??{schema,definitions:[],values:[],results:[],outcomes:[]};
  if(graph.schema!==schema||!['definitions','values','results','outcomes'].every(key=>Array.isArray(graph[key])))throw Error('Unsupported saved operation recipes.');
  captureOperationRecipes(graph.definitions);
  for(const key of ['values','results','outcomes']){
    const names=graph[key].map(item=>key==='values'?item?.id:item?.recipe);
    if(names.some(name=>!identity(name))||new Set(names).size!==names.length)throw Error('Invalid saved recipe '+key+'.');
  }
  return graph;
}
function capturedEdits(edits){
  if(!Array.isArray(edits))throw TypeError('Supply recipe edits.');
  const saved=captureRecipeData(edits);ids(saved.map(edit=>edit?.id));
  for(const edit of saved){
    if(!record(edit)||!(edit.expectedRevision===null||identity(edit.expectedRevision)))throw TypeError('Each recipe edit supplies its expected saved revision, or null for a new recipe.');
    if(edit.definition!==null){
      if(!record(edit.definition)||Object.hasOwn(edit.definition,'id')||Object.hasOwn(edit.definition,'revision'))throw TypeError('Supply an operation definition separately from its id and revision.');
      captureOperationRecipes([{...edit.definition,id:edit.id,revision:'pending'}]);
    }
  }
  return saved;
}
function capturedValues(values){
  const saved=captureRecipeData(values);if(!Array.isArray(saved))throw TypeError('Supply identified saved values.');
  ids(saved.map(value=>value?.id));
  if(saved.some(value=>!record(value)||!Object.hasOwn(value,'value')))throw TypeError('Supply each saved value.');
  return saved;
}
function capturedPublication(candidate){
  const saved=captureRecipeData(candidate);
  if(!record(saved))throw TypeError('Supply a recipe publication.');
  ids(saved.targets);
  if(!['recipes','values','resultInputs','results','failures'].every(key=>Array.isArray(saved[key])))throw TypeError('Supply captured recipe/value/result guards, results and failures.');
  ids(saved.recipes.map(item=>item?.id));ids(saved.values.map(item=>item?.id));
  ids(saved.resultInputs.map(item=>item?.recipe));
  if(saved.recipes.some(item=>!record(item)||!(item.revision===null||identity(item.revision)))||saved.values.some(item=>!record(item)||typeof item.present!=='boolean'))throw TypeError('Supply captured input presence and revisions.');
  if(saved.resultInputs.some(item=>!record(item)||!(item.id===null||identity(item.id))||typeof item.available!=='boolean'))throw TypeError('Supply captured saved-result identity and availability.');
  ids(saved.results.map(item=>item?.recipe));ids(saved.failures.map(item=>item?.recipe));
  for(const result of saved.results)if(!identity(result.id)||!identity(result.revision)||!record(result.inputs)||!record(result.outputs)||!saved.targets.includes(result.recipe))throw TypeError('Supply identified named result values for the requested recipes.');
  if(saved.failures.some(item=>typeof item.message!=='string'))throw TypeError('Supply each scoped failure message.');
  return saved;
}
function selectedInputs(graph,targets){
  const byId=new Map(graph.definitions.map(recipe=>[recipe.id,recipe])),needed=new Set(),todo=[...targets],valueIds=new Set();
  while(todo.length){
    const id=todo.pop();if(needed.has(id))continue;needed.add(id);
    for(const link of Object.values(byId.get(id)?.inputs??{}))if(link.recipe)todo.push(link.recipe);else valueIds.add(link.value);
  }
  return {recipes:Object.freeze(graph.definitions.filter(recipe=>needed.has(recipe.id))),
    values:Object.freeze(graph.values.filter(value=>valueIds.has(value.id)).map(({id,value})=>Object.freeze([id,value]))),
    resultInputs:resultInputs(graph,needed)};
}
function resultInputs(graph,needed){
  const definitions=new Map(graph.definitions.map(recipe=>[recipe.id,recipe])),results=new Map(graph.results.map(result=>[result.recipe,result])),outcomes=new Map(graph.outcomes.map(outcome=>[outcome.recipe,outcome]));
  return Object.freeze([...needed].map(recipe=>{
    const result=results.get(recipe),outcome=outcomes.get(recipe);
    return Object.freeze({recipe,id:result?.id??null,available:Boolean(result&&result.revision===definitions.get(recipe)?.revision&&outcome?.status==='completed'&&outcome.result===result.id&&outcome.revision===result.revision)});
  }));
}
function staleInputs(graph,candidate){
  const revisions=new Map(graph.definitions.map(recipe=>[recipe.id,recipe.revision])),values=new Set(graph.values.map(value=>value.id));
  const results=new Map(resultInputs(graph,candidate.resultInputs.map(item=>item.recipe)).map(item=>[item.recipe,item]));
  return candidate.recipes.some(item=>(revisions.get(item.id)??null)!==item.revision)||candidate.values.some(item=>values.has(item.id)!==item.present)||
    candidate.resultInputs.some(item=>{const current=results.get(item.recipe);return item.id!==current.id||item.available!==current.available;});
}
function requireReadSet(graph,candidate){
  const guarded=new Map(candidate.recipes.map(item=>[item.id,item.revision])),values=new Map(candidate.values.map(item=>[item.id,item.present]));
  const results=new Set(candidate.resultInputs.map(item=>item.recipe));
  const {recipes}=selectedInputs(graph,candidate.targets),byId=new Map(graph.definitions.map(recipe=>[recipe.id,recipe]));
  for(const id of guarded.keys())if(!results.has(id))throw TypeError('A publication must guard every captured saved result.');
  for(const id of candidate.targets)if(!guarded.has(id))throw TypeError('A publication must guard every requested recipe.');
  for(const recipe of recipes){
    if(!guarded.has(recipe.id))throw TypeError('A publication must guard every required recipe.');
    for(const link of Object.values(recipe.inputs??{}))if(link.recipe?!guarded.has(link.recipe):!values.has(link.value))throw TypeError('A publication must guard every required input, including absence.');
  }
  for(const result of candidate.results){
    const recipe=byId.get(result.recipe);
    if(!recipe||result.revision!==guarded.get(result.recipe))throw TypeError('A result must identify its captured recipe revision.');
    const links=Object.entries(recipe.inputs??{});
    if(Object.keys(result.inputs).length!==links.length)throw TypeError('A result must retain its exact captured input identities.');
    for(const [name,link] of links){
      const observed=result.inputs[name];
      if(!record(observed)||(link.recipe?
        observed.recipe!==link.recipe||observed.revision!==guarded.get(link.recipe)||!identity(observed.result)||observed.output!==link.output:
        observed.value!==link.value||values.get(link.value)!==true))throw TypeError('A result input differs from its captured definition.');
    }
  }
}

export function createBundleRecipeState(directory,{bundleId}){
  if(!identity(bundleId))throw TypeError('Supply the admitted Bundle identity.');
  const dir=resolve(directory),file=resolve(dir,'plan.json');
  const target=id=>{if(id!==bundleId)throw TypeError('Recipe state belongs to a different Bundle.');};
  async function read(){const document=JSON.parse(await readFile(file,'utf8'));return {document,graph:freezeSaved(graphFor(document))};}
  async function publish(document,graph,change){
    const revision=randomUUID(),next={...document,bundle:{...document.bundle,revision,operationRecipes:graph}};
    await replaceJsonFile(file,recipeDataChunks(next));
    const result={status:'completed',bundleId,revision,...change};
    // The manifest is committed already. A separate attribution failure must
    // not report rollback or cause an unsafe automatic repeat of the edit.
    try{await recordBundleRuntime(dir);}catch(error){result.unfinished=[{step:'runtime-attribution',message:error.message}];}
    return result;
  }
  return Object.freeze({
    directory:dir,bundleId,
    async readRecipeInputs({bundleId:id,targets,includeResults=false}){
      target(id);const selected=ids(captureRecipeData(targets)),{document,graph}=await read();
      const inputs=selectedInputs(graph,selected),available=new Set(inputs.resultInputs.filter(item=>item.available).map(item=>item.recipe));
      return Object.freeze({bundleId,revision:manifestRevision(document),targets:selected,...inputs,
        ...(includeResults?{known:Object.freeze(graph.results.filter(result=>available.has(result.recipe)))}:{})});
    },
    async read(){
      const {document,graph}=await read();
      return Object.freeze({bundleId,revision:manifestRevision(document),...graph});
    },
    async save({edits,values=[]}){
      const changes=capturedEdits(edits),supplied=capturedValues(values);
      return withBundleWriteLock(dir,async()=>{
        await requireBundleInstance(dir);
        const {document,graph}=await read(),definitions=new Map(graph.definitions.map(recipe=>[recipe.id,recipe]));
        for(const edit of changes)if((definitions.get(edit.id)?.revision??null)!==edit.expectedRevision)throw Error('Recipe revision is stale: '+edit.id);
        const existing=new Set(graph.values.map(value=>value.id));
        if(supplied.some(value=>existing.has(value.id)))throw Error('Saved input value ids are immutable; supply a new id.');
        const recipes=[];
        for(const edit of changes){
          if(edit.definition===null){definitions.delete(edit.id);recipes.push({id:edit.id,revision:null});}
          else{const definition={...edit.definition,id:edit.id,revision:randomUUID()};definitions.set(edit.id,definition);recipes.push({id:edit.id,revision:definition.revision});}
        }
        return publish(document,{...graph,definitions:[...definitions.values()],values:[...graph.values,...supplied]},
          {recipes,values:supplied.map(value=>value.id)});
      },{wait:true});
    },
    async publishRecipeResults(candidate){
      const captured=capturedPublication(candidate);target(captured.bundleId);
      return withBundleWriteLock(dir,async()=>{
        await requireBundleInstance(dir);
        const {document,graph}=await read();
        if(staleInputs(graph,captured))return {status:'superseded',bundleId,revision:manifestRevision(document)};
        requireReadSet(graph,captured);
        const results=new Map(graph.results.map(result=>[result.recipe,result])),outcomes=new Map(graph.outcomes.map(item=>[item.recipe,item]));
        for(const result of captured.results)results.set(result.recipe,result);
        for(const recipe of captured.targets){
          const result=captured.results.find(item=>item.recipe===recipe),failure=captured.failures.find(item=>item.recipe===recipe);
          if(!result&&!failure)throw TypeError('A publication must state the outcome for every requested recipe.');
          if(result&&failure)throw TypeError('A recipe cannot succeed and fail in the same publication.');
          outcomes.set(recipe,result?{recipe,status:'completed',result:result.id,revision:result.revision}:{recipe,status:'failed',revision:captured.recipes.find(item=>item.id===recipe).revision,message:failure.message});
        }
        const next={...graph,results:[...results.values()],outcomes:[...outcomes.values()]};
        return publish(document,next,
          {results:captured.results.map(result=>({recipe:result.recipe,id:result.id})),failures:captured.failures,resultInputs:resultInputs(next,captured.recipes.map(item=>item.id))});
      },{wait:true});
    }
  });
}
