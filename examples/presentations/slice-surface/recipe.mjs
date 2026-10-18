import {normalize,surfaceSpec,animationAt,claddingSpec,bridgeSpec} from './design.mjs';
// This recipe deliberately leaves the rest of the cube between widely spaced slices.
export function createRecipeFactory(Geometry,recipeDefaults){
  const cache={size:null,geometry:null,solid:null};
  return async function sliceRecipe(input){
    const d=normalize(input),animation=animationAt(d.frame/d.fps),spec=animation.mode==='cladding'?claddingSpec(d,animation):animation.mode==='bridge'?bridgeSpec(d,animation):surfaceSpec(d,animation.pose);
    const common={id:'presentation-slice',loops:animation.loops,fillDensity:animation.density,fillPattern:'rectilinear',fillAnglesDeg:[animation.angle],rotateFill:false,solidTop:0,solidBottom:0,fillOverlap:.15,spacingFactor:1,sampleStepMm:d.sampleStepMm};
    if(animation.mode==='cladding'){
      const assignment={...common,surface:{kind:'spline',patch:spec.name,periodicU:animation.wrap===1,normalSide:1,uvBounds:[[0,1],[0,1]]},stack:{firstLayerMm:.2,layerMm:.2,direction:'normal',offsetTightness:1},within:[{kind:'normal-band',fromMm:-.2,toMm:0}],fillOrder:{kind:'surface-cells',directions:['axial'],toleranceMm:.01}};
      const plan={...recipeDefaults(),geometry:{shape:'spline',patches:[spec]},process:{lineWidthMm:d.lineWidthMm,firstLayerMm:.2,layerMm:.2,primeLine:null},slices:{version:1,assignments:[assignment]}};
      return {plan,spec,design:d,animation};
    }
    if(cache.size!==d.sizeMm){
      const [box]=await Geometry.constructGeometry([{operation:'box',size:[d.sizeMm,d.sizeMm,d.sizeMm]}]);
      cache.geometry=box.geometry;cache.solid=Geometry.buildGeometry(box.geometry);cache.size=d.sizeMm;
    }
    if(animation.mode==='intro'){
      const assignment={...common,fillPattern:animation.gyroidMix===1?'gyroid':'rectilinear',surface:{kind:'plane',origin:[0,0,animation.pose.heightMm-.2],normal:[0,0,1],xAxis:[1,0,0]},stack:{firstLayerMm:.2,layerMm:d.sizeMm*40}};
      const plan={...recipeDefaults(),geometry:cache.geometry,process:{lineWidthMm:d.lineWidthMm,firstLayerMm:.2,layerMm:.2,primeLine:null},slices:{version:1,assignments:[assignment]}};
      return {plan,spec,design:d,animation};
    }
    const slice=Geometry.patchSlice(Geometry.buildGeometry({shape:'spline',patches:[spec]}).patches[0]);
    const pitchMm=d.sizeMm*40,firstLayerMm=.2;
    const calibration=Geometry.sliceStack({base:slice,pitchMm,firstLayerMm},cache.solid.bounds);
    const assignment={...common,
      surface:{kind:'spline',patch:spec,offsetMm:animation.mode==='bridge'?0:-calibration.firstTranslationMm},stack:animation.mode==='bridge'?{firstLayerMm:.2,layerMm:.2}:{firstLayerMm,layerMm:pitchMm},...(animation.mode==='bridge'?{within:[{kind:'surface-domain',loopsUv:[[[0,0],[1,0],[1,1],[0,1]]],fromLayer:-1,toLayer:0}]}:{})};
    const plan={...recipeDefaults(),geometry:cache.geometry,process:{lineWidthMm:d.lineWidthMm,firstLayerMm,layerMm:.2,primeLine:null},slices:{version:1,assignments:[assignment]}};
    return {plan,spec,design:d,animation};
  };
}
