// Bundle's operation-plan value boundary. This module neither executes a recipe
// nor resolves defaults/providers. Unfinished operation intent is representable.
import {types} from 'node:util';
import {jsonChunks} from '../json-chunks.mjs';
import {z} from 'zod';
import recipeSchema from './recipe.schema.json' with {type:'json'};
const recipeDefinition=z.fromJSONSchema(recipeSchema);

function dataCopy(value,active=new Set()){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||types.isProxy(value))throw TypeError('Recipe definitions contain finite data, not executable or native values.');
  if(active.has(value))throw TypeError('Recipe definition data cannot contain a cycle.');
  const prototype=Object.getPrototypeOf(value),array=Array.isArray(value);
  if(!array&&prototype!==Object.prototype&&prototype!==null)throw TypeError('Recipe definitions use plain data records.');
  active.add(value);
  try{
    const descriptors=Object.getOwnPropertyDescriptors(value),entries=[];
    if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'))throw TypeError('Recipe definitions use string field names.');
    for(const [key,descriptor] of Object.entries(descriptors)){
      if(array&&key==='length')continue;
      if(!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)throw TypeError('Recipe definitions contain ordinary data fields, not accessors.');
      if(array&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length))throw TypeError('Recipe arrays contain indexed values only.');
      entries.push([key,dataCopy(descriptor.value,active)]);
    }
    if(array){
      if(entries.length!==value.length)throw TypeError('Recipe arrays cannot contain missing elements.');
      return Object.freeze(entries.map(([,item])=>item));
    }
    return Object.freeze(Object.fromEntries(entries));
  }finally{active.delete(value);}
}

// Capture ordinary durable inputs at the owner boundary, before any await.
// Native values must instead be handed off through their producer's artifact
// contract. They cannot acquire a JSON representation by running toJSON/getters.
export const captureRecipeData=value=>dataCopy(value);

// Input is admitted finite data (or parsed saved JSON). Preserve negative zero
// as JSON's -0 token, and stream strings through the existing bounded encoder.
export function* recipeDataChunks(value){
  if(typeof value!=='object'||value===null){yield* Object.is(value,-0)?['-0']:jsonChunks(value);return;}
  if(Array.isArray(value)){
    yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';yield* recipeDataChunks(value[i]);}yield ']';return;
  }
  yield '{';let first=true;
  for(const key of Object.keys(value)){if(!first)yield ',';first=false;yield* jsonChunks(key);yield ':';yield* recipeDataChunks(value[key]);}
  yield '}';
}

export function captureOperationRecipes(recipes){
  if(!Array.isArray(recipes))throw TypeError('Supply operation recipe records.');
  const captured=dataCopy(recipes),ids=new Set();
  for(const recipe of captured){
    const checked=recipeDefinition.safeParse(recipe);
    if(!checked.success)throw TypeError('Invalid operation recipe: '+checked.error.issues.map(issue=>(issue.path.join('.')||'recipe')+': '+issue.message).join('; '));
    if(ids.has(recipe.id))throw TypeError('Duplicate operation recipe id: '+recipe.id);ids.add(recipe.id);
  }
  return captured;
}

// Data dependencies are explicit value reads. Manufacturing `after` records are
// carried by produced work and are deliberately not interpreted here.
export function recipeDependencies(recipes){
  return new Map(recipes.map(recipe=>[recipe.id,new Set(Object.values(recipe.inputs??{}).flatMap(link=>link.recipe?[link.recipe]:[]))]));
}
