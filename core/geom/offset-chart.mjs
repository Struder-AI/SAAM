// An ambient offset reference retains its chart, independent of fill or stacking.
import {prepareSurfaceOffset} from './surface-offset.mjs';
import {evaluateSurface} from './surface-evaluation.mjs';
import {requireThat,subtract,scale,normalize,cross,dot,add} from './tolerance.mjs';
export function offsetSurfaceChart(chart,depth,{shell,selection,tightness=1}={}){
  const patch=selection?.kind==='spline'&&tightness<1?shell.patches?.find(p=>p.name===selection.patch):null;
  requireThat(patch!==undefined,'Selected native spline patch is missing.');
  const offsetField=patch?prepareSurfaceOffset({patch,periodicU:selection.periodicU}):null;
  const offsetPoint=(u,v,depth)=>{
    const [[u0,u1],[v0,v1]]=selection.uvBounds,U=u0+u*(u1-u0),V=v0+v*(v1-v0),d=depth*selection.normalSide,loose=offsetField.at(U,V,d);
    if(tightness===0)return loose;
    const exact=offsetField.exactAt(U,V,d);
    return loose.map((x,k)=>x+tightness*(exact[k]-x));
  };
  const offsetChart=(depth,selectedChart=chart)=>offsetField?{...selectedChart,at:(u,v)=>{
    const actual=selectedChart.at(u,v),offset=offsetPoint(u,v,depth);
    if(selectedChart.contactGeometry!=='final-deposited-beads')return {...actual,point:offset};
    // Preserve the declared fitted-vs-exact offset displacement, but anchor it
    // on the actual substrate and orient its normal component to that surface.
    const original=evaluateSurface(patch,[selection.uvBounds[0][0]+u*(selection.uvBounds[0][1]-selection.uvBounds[0][0]),selection.uvBounds[1][0]+v*(selection.uvBounds[1][1]-selection.uvBounds[1][0])]);
    const displacement=subtract(offset,original.point),oldNormal=scale(original.normal,selection.normalSide),oldU=normalize(original.du),oldV=cross(oldNormal,oldU);
    const newU=normalize(subtract(actual.du,scale(actual.normal,dot(actual.du,actual.normal)))),newV=cross(actual.normal,newU);
    const transported=add(add(scale(newU,dot(displacement,oldU)),scale(newV,dot(displacement,oldV))),scale(actual.normal,dot(displacement,oldNormal)));
    return {...actual,point:add(actual.point,transported)};
  }}:selectedChart;
  const reference=offsetChart(depth);
  return offsetField?reference:{...chart,at:(u,v)=>evaluateSurface(chart,[u,v],depth)};
}
