import {normalize,surfaceSpec} from './design.mjs';
// This recipe deliberately leaves the rest of the cube between widely spaced slices.
export function createRecipeFactory(Geometry,recipeDefaults){
  const cache={size:null,geometry:null,solid:null};
  return async function sliceRecipe(input){
    const d=normalize(input),spec=surfaceSpec(d);
    if(cache.size!==d.sizeMm){
      const [box]=await Geometry.constructGeometry([{operation:'box',size:[d.sizeMm,d.sizeMm,d.sizeMm]}]);
      cache.geometry=box.geometry;cache.solid=Geometry.buildGeometry(box.geometry);cache.size=d.sizeMm;
    }
    const slice=Geometry.patchSlice(Geometry.buildGeometry({shape:'spline',patches:[spec]}).patches[0]);
    const pitchMm=d.sizeMm*40,firstLayerMm=.2;
    const calibration=Geometry.sliceStack({base:slice,pitchMm,firstLayerMm},cache.solid.bounds);
    const assignment={id:'presentation-slice',loops:2,fillDensity:d.fillDensity,fillPattern:'rectilinear',fillAnglesDeg:[45],rotateFill:false,solidTop:0,solidBottom:0,fillOverlap:.15,spacingFactor:1,sampleStepMm:d.sampleStepMm,
      surface:{kind:'spline',patch:spec,offsetMm:-calibration.firstTranslationMm},stack:{firstLayerMm,layerMm:pitchMm}};
    const plan={...recipeDefaults(),geometry:cache.geometry,process:{lineWidthMm:d.lineWidthMm,firstLayerMm,layerMm:.2,primeLine:null},slices:{version:1,assignments:[assignment]}};
    return {plan,spec,design:d};
  };
}
