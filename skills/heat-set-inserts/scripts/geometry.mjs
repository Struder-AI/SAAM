import {heatSetFeature,dimensions,heatSetTemplate,borePoint} from './feature.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

// -> {geometry, notes}. Each bore is ordinary geometry along its axis, cut as
// placed; setting the insert is a later physical step. Notes say what would
// affect it: material over the mouth within the insert length, a face below
// the mouth, or a bore breaking out beyond its floor. No material is empty
// geometry with a note.
export async function compileHeatSet(base,features,{buildGeometry,constructSolids,toleranceMm=0.01}={}){
  requireThat([buildGeometry,constructSolids].every(value=>typeof value==='function'),
    'Heat-set needs Geometry buildGeometry and constructSolids operations.');
  const normalized=features.map(heatSetFeature),shell=buildGeometry(base);
  requireThat(normalized.length>0,'Choose at least one heat-set feature.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0,'Invalid heat-set tolerance.');
  // A loft between rings at distances s outward from the mouth along the bore.
  const prism=(f,r,from,to)=>{
    const segments=Math.max(32,Math.ceil(Math.PI/Math.acos(Math.max(-1,1-toleranceMm/r))));
    const ring=s=>Array.from({length:segments},(_,i)=>borePoint(f,r,2*Math.PI*i/segments,s));
    return {operation:'loft',rings:[ring(from),ring(to)],centers:[borePoint(f,0,0,from),borePoint(f,0,0,to)]};
  };
  const t=toleranceMm,bores=[],checks=[];
  for(const f of normalized){
    const {diameterMm,depthMm,lengthMm}=dimensions(f),r=diameterMm/2;
    bores.push(prism(f,r,-depthMm,2*t));
    checks.push([f,'material lies over its mouth within the insert length; the bore is cut as placed.',{operation:'intersection',operands:[shell,prism(f,r,2*t,2*t+lengthMm)]}],
      [f,'the face lies below the mouth at part of its rim; the bore is shallower there.',{operation:'difference',operands:[prism(f,r,-3*t,-t),shell]}],
      [f,'the bore breaks out beyond its floor.',{operation:'difference',operands:[prism(f,r,-depthMm-3*t,-depthMm-t),shell]}]);
  }
  const [mesh,...found]=await constructSolids([{operation:'difference',operands:[shell,...bores]},...checks.map(([,,request])=>request)],{toleranceMm});
  const notes=[...(mesh?mesh.notes??[]:['The heat-set holes leave no material.']),...checks.flatMap(([f,note],i)=>found[i]?[`Heat-set ${f.id}: ${note}`]:[])];
  return {geometry:{...heatSetTemplate(),base:structuredClone(base),features:normalized,toleranceMm,vertices:mesh?.vertices??[],triangles:mesh?.triangles??[]},notes};
}
