// Member layers (3.0 → Slice, 3.0 → Extensions): the layers a Slice member is
// constructed from are the same layers Recipe.slices gives extensions.
import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../print/plan.mjs';
import {sliceAssignment} from '../print/slice-records.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {boxMesh} from './fixtures/mesh.mjs';
import {preparePathGeometry,generateModelResults} from '../print/generate.mjs';
import {recipeTools} from '../print/recipe-tools.mjs';

function memberPlan(){
  const plan=defaults(loadMachine('ultimaker-s5'));
  plan.geometry={shape:'assembly',parts:[{id:'block',xMm:0,yMm:0,zMm:0,geometry:boxMesh(12,10,2)}]};
  plan.process.minimumLayerSeconds=0;
  plan.slices.assignments=[
    sliceAssignment({id:'base',part:'block',fillDensity:1,within:[{kind:'slab',fromMm:0,toMm:1}]}),
    sliceAssignment({id:'skin',part:'block',fillDensity:1,surface:{kind:'slice',assignment:'base'},within:[]}),
  ];
  return plan;
}
// Comparable member layers: index, surface origin and material region.
const comparable=layers=>layers.map(layer=>({index:layer.index,origin:layer.slice.origin?.map(v=>Math.round(v*1e6)/1e6)??null,
  region:JSON.stringify(layer.region)}));
async function constructedLayers(plan,assignment){
  const geometry=await preparePathGeometry(plan);
  const {results}=await generateModelResults(plan,geometry);
  const result=results.find(result=>result.report.owner===assignment&&result.referenceStack);
  assert.ok(result,'Construction produced the '+assignment+' member');
  return result.referenceStack.layers;
}

for(const assignment of ['base','skin'])
  test(`Recipe.slices gives the ${assignment} member the layers Construction slices`,async()=>{
    const plan=memberPlan();
    const given=await recipeTools(plan).slices({assignment,part:'block'});
    assert.equal(given.assignment,assignment);
    assert.equal(given.part,'block');
    assert.ok(given.layers.length>0);
    assert.deepEqual(comparable(given.layers),comparable(await constructedLayers(plan,assignment)));
  });

test('Recipe.slices names an unknown or non-Slice assignment as a failure',async()=>{
  const plan=memberPlan();
  await assert.rejects(recipeTools(plan).slices({assignment:'missing',part:'block'}),/ordinary Slice assignment/);
});
