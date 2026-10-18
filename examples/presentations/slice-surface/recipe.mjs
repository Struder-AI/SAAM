import {normalize,surfaceSpec,surfaceFor,endingPose,animationAt} from './design.mjs';
// This recipe deliberately leaves the rest of the cube between widely spaced slices.
export function createRecipeFactory(Geometry,recipeDefaults){
  const cache={size:null,geometry:null,solid:null,mask:null};
  return async function sliceRecipe(input){
    const d=normalize(input),animation=animationAt(d.frame/d.fps),spec=surfaceFor(d,animation);
    const common={id:'presentation-slice',loops:animation.loops,fillDensity:animation.density,fillPattern:'rectilinear',fillAnglesDeg:[animation.angle],rotateFill:false,solidTop:0,solidBottom:0,fillOverlap:.15,spacingFactor:1,sampleStepMm:d.sampleStepMm};
    if(cache.size!==d.sizeMm){
      const [box]=await Geometry.constructGeometry([{operation:'box',size:[d.sizeMm,d.sizeMm,d.sizeMm]}]);
      cache.geometry=box.geometry;cache.solid=Geometry.buildGeometry(box.geometry);cache.size=d.sizeMm;cache.mask=null;
    }
    if(['cladding','bridge'].includes(animation.mode)){
      cache.mask??=Geometry.section(cache.solid,Geometry.patchSlice(Geometry.buildGeometry({shape:'spline',patches:[surfaceSpec(d,endingPose())]}).patches[0])).loops;
      const q=animation.morph,regionUv=q===1?[[[0,0],[1,0],[1,1],[0,1]]]:cache.mask.map(loop=>loop.map(p=>{
        const delta=p.map(n=>n-.5),scale=.5/Math.max(...delta.map(Math.abs));return p.map((n,k)=>n+(delta[k]*scale+.5-n)*q);
      }));
      const assignment={...common,regionUv,
        surface:{kind:'spline',patch:spec.name,periodicU:animation.mode==='cladding'&&q===1,normalSide:1,uvBounds:[[0,1],[0,1]]},
        stack:{firstLayerMm:.2,layerMm:.2,direction:'normal'},within:[{kind:'normal-band',fromMm:-.2,toMm:0}]};
      return {plan:{...recipeDefaults(),geometry:{shape:'spline',patches:[spec]},process:{lineWidthMm:d.lineWidthMm,firstLayerMm:.2,layerMm:.2,primeLine:null},slices:{version:1,assignments:[assignment]}},spec,design:d,animation};
    }
    if(animation.mode==='intro'){
      const assignment={...common,fillPattern:animation.pattern,surface:{kind:'plane',origin:[0,0,animation.pose.heightMm-.2],normal:[0,0,1],xAxis:[1,0,0]},stack:{firstLayerMm:.2,layerMm:d.sizeMm*40}};
      const plan={...recipeDefaults(),geometry:cache.geometry,process:{lineWidthMm:d.lineWidthMm,firstLayerMm:.2,layerMm:.2,primeLine:null},slices:{version:1,assignments:[assignment]}};
      return {plan,spec,design:d,animation};
    }
    const slice=Geometry.patchSlice(Geometry.buildGeometry({shape:'spline',patches:[spec]}).patches[0]);
    const pitchMm=d.sizeMm*40,firstLayerMm=.2;
    const calibration=Geometry.sliceStack({base:slice,pitchMm,firstLayerMm},cache.solid.bounds);
    const assignment={...common,
      surface:{kind:'spline',patch:spec,offsetMm:-calibration.firstTranslationMm},stack:{firstLayerMm,layerMm:pitchMm}};
    const plan={...recipeDefaults(),geometry:cache.geometry,process:{lineWidthMm:d.lineWidthMm,firstLayerMm,layerMm:.2,primeLine:null},slices:{version:1,assignments:[assignment]}};
    return {plan,spec,design:d,animation};
  };
}
