import {geometryOperations} from '../../core/geom/operations.mjs';
import {recipeDefaults,compileRecipe} from '../../core/print/plan.mjs';
import {preparePathGeometry,generateModelResults} from '../../core/print/generate.mjs';
import {prepareSliceLayer} from '../../core/print/slice-preparation.mjs';
import {sliceContextResult} from '../../core/print/slices.mjs';
import {finalizeDepositionResult} from '../../core/print/finalize.mjs';
import {layerStrokes} from '../../core/region/layer-strokes.mjs';
import {defaults,animationAt,surfaceFor,surfaceSpec,endingPose} from './slice-surface/design.mjs';
import {createRecipeFactory} from './slice-surface/recipe.mjs';
export function createFrameBuilder(){
const G=geometryOperations(),ordinary=createRecipeFactory(G,recipeDefaults);
let initialMask;
return async function build(index){
 const a=animationAt(index/30),d={...defaults,frame:index};
 if(!['cladding','bridge'].includes(a.mode)){
  const recipe=await ordinary(d);recipe.plan.slices.assignments[0].fillPattern=a.pattern;recipe.plan.slices.assignments[0].fillDensity=a.density;
  const plan=compileRecipe(recipe.plan).plan,model=await generateModelResults(plan,await preparePathGeometry(plan));return {plan,model};
 }
 const spec=surfaceFor(d,a),shell=G.buildGeometry({shape:'spline',patches:[spec]}),slice=G.patchSlice(shell.patches[0]);
 if(!initialMask){const [box]=await G.constructGeometry([{operation:'box',size:[24,24,24]}]);const wave=surfaceSpec(d,endingPose());initialMask=G.section(G.buildGeometry(box.geometry),G.patchSlice(G.buildGeometry({shape:'spline',patches:[wave]}).patches[0])).loops;}
 const q=a.mode==='cladding'?Math.min(1,a.morph*3):a.morph;
 const region=q===1?[[[0,0],[1,0],[1,1],[0,1]]]:initialMask.map(loop=>loop.map(p=>{const delta=p.map(n=>n-.5),scale=.5/Math.max(...delta.map(Math.abs));return p.map((n,k)=>n+(delta[k]*scale+.5-n)*q);}));
 const source={...recipeDefaults(),geometry:{shape:'spline',patches:[spec]},process:{lineWidthMm:.45,firstLayerMm:.2,layerMm:.2,primeLine:null},slices:{version:1,assignments:[{id:'presentation-slice',loops:a.loops,fillDensity:a.density,fillPattern:'rectilinear',fillAnglesDeg:[a.angle],rotateFill:false,solidTop:0,solidBottom:0,fillOverlap:.15,sampleStepMm:.65,surface:{kind:'spline',patch:spec.name,periodicU:false,normalSide:1,uvBounds:[[0,1],[0,1]]},stack:{firstLayerMm:.2,layerMm:.2,direction:'normal'},within:[{kind:'normal-band',fromMm:-.2,toMm:0}]}]}};
 const plan=compileRecipe(source).plan,settings=plan.slices.assignments[0],direction=a.mode==='bridge'?[0,0,1]:G.evaluateSurface(slice,[.5,.5]).normal;
 let layer=prepareSliceLayer({settings,layers:[]},{process:plan.process},{index:0,ordinal:0,slice,region,heightMm:.2,pitchMm:.45,gap:{normalMm:.2},direction,settings,firstBedLayer:false});
 layer.preparedStrokes=layerStrokes(region,layer.strokeSettings);
 const record={spec:{id:'presentation-slice',settings,layers:[layer],totalLayerCount:1},context:{process:plan.process,report:{owner:'presentation-slice'}},referenceStack:{layers:[layer]},stackId:'presentation-slice'};
 const result=finalizeDepositionResult(sliceContextResult(record),plan);return {plan,model:{results:[result],summary:{slices:{layers:1}}},spec};
}
}
