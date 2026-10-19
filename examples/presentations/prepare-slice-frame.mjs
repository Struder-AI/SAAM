import {ROUNDING_MM} from '../../core/dimensions.mjs';
import {geometryOperations} from '../../core/geom/operations.mjs';
import {recipeDefaults,compileRecipe} from '../../core/print/plan.mjs';
import {preparePathGeometry,generateModelResults} from '../../core/print/generate.mjs';
import {defaults} from './slice-surface/design.mjs';
import {createRecipeFactory} from './slice-surface/recipe.mjs';
export function createFrameBuilder(){
const recipeFor=createRecipeFactory(geometryOperations(),recipeDefaults);
return async function build(index){
 const recipe=await recipeFor({...defaults,frame:index}),plan=compileRecipe(recipe.plan).plan;
 const model=await generateModelResults(plan,await preparePathGeometry(plan));
 return {plan,model,spec:recipe.spec};
}
}

export function depositionPreview(model){
 const moves=[];let seconds=0,volumeMm3=0;
 for(const result of model.results){if(!result.depositionFinalized)throw Error('Deposition is not finalized.');
 for(const op of result.operations)for(const stroke of op.strokes){
  if(stroke.closed)throw Error('Finalization must make closed strokes explicit.');
  for(let i=1;i<stroke.points.length;i++){
   const from=stroke.points[i-1],to=stroke.points[i],length=Math.hypot(...to.map((v,k)=>v-from[k]));if(length<=ROUNDING_MM)continue;
   const metadata=stroke.segmentMetadata?.[i-1]??{},volume=stroke.volumesMm3?.[i-1]??length*stroke.beadAreaMm2,speed=metadata.speedMmS??stroke.speedMmS,width=metadata.beadWidthMm??stroke.beadWidthMm;
   const duration=length/speed,normal=metadata.surfaceNormal,height=metadata.beadHeightMm??stroke.beadHeightMm??volume/(length*width);
   if(![volume,speed,width,height,...normal].every(Number.isFinite)||volume<0||speed<=0||height<=0)throw Error('Invalid native bead.');
   moves.push({line:moves.length+1,phase:op.phase,layer:op.layer,layerId:op.layerId,sliceStack:op.stackId??result.stackId??result.id,sliceIndex:op.layer,operation:op.id,from,to,extruding:volume>0,volumeMm3:volume,speedMmS:speed,startSeconds:seconds,durationSeconds:duration,lineWidthMm:width,surfaceNormal:normal,beadHeightMm:height,connector:Boolean(metadata.connector),toolAxisFrom:[0,0,-1],toolAxisTo:[0,0,-1],toolUpFrom:[0,1,0],toolUpTo:[0,1,0]});
   seconds+=duration;volumeMm3+=volume;
  }
 }}
 if(!moves.length)throw Error('No native deposition.');
 return {moves,events:[],summary:{motionSeconds:seconds,volumeMm3,moves:moves.length}};
}
