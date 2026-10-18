// An ambient offset reference retains its chart, independent of fill or stacking.
import {prepareSurfaceOffset} from './surface-offset.mjs';
import {evaluateSurface} from './surface-evaluation.mjs';
import {requireThat,subtract,scale,normalize,cross,dot,add} from './tolerance.mjs';
import {surfaceReferenceRecord,numericalGeometryRecord} from './surface-record.mjs';
import {selectedSplinePatch} from './surface-region.mjs';
import {extendSurface} from './surface-extend.mjs';
export function offsetSurfaceChart(chart,depth,{shell,selection,tightness=1}={}){
  requireThat(Number.isFinite(depth)&&Number.isFinite(tightness)&&tightness>=0&&tightness<=1,'Surface offsets need finite depth and tightness from 0 to 1.');
  const patch=selection?.kind==='spline'&&tightness<1?selectedSplinePatch(shell,selection):null;
  const offsetField=patch?prepareSurfaceOffset({patch,periodicU:selection.periodicU}):null;
  const originalSurface=patch&&selection.extend?extendSurface(patch,selection.uvBounds):patch;
  const movedPatch=offsetField?offsetField.offsetPatch(depth*selection.normalSide):null;
  const movedSurface=movedPatch&&selection.extend?extendSurface(movedPatch,selection.uvBounds):movedPatch;
  const offsetPoint=(u,v)=>{
    const [[u0,u1],[v0,v1]]=selection.uvBounds,U=u0+u*(u1-u0),V=v0+v*(v1-v0),d=depth*selection.normalSide,loose=evaluateSurface(movedSurface,[U,V]).point;
    if(tightness===0)return loose;
    const exact=evaluateSurface(originalSurface,[U,V],d).point;
    return loose.map((x,k)=>x+tightness*(exact[k]-x));
  };
  const offsetChart=(depth,selectedChart=chart)=>offsetField?{...selectedChart,at:(u,v)=>{
    const actual=selectedChart.at(u,v),offset=offsetPoint(u,v);
    if(selectedChart.contactGeometry!=='final-deposited-beads')return {...actual,point:offset};
    // Preserve the declared fitted-vs-exact offset displacement, but anchor it
    // on the actual substrate and orient its normal component to that surface.
    const original=evaluateSurface(originalSurface,[selection.uvBounds[0][0]+u*(selection.uvBounds[0][1]-selection.uvBounds[0][0]),selection.uvBounds[1][0]+v*(selection.uvBounds[1][1]-selection.uvBounds[1][0])]);
    const displacement=subtract(offset,original.point),oldNormal=scale(original.normal,selection.normalSide),oldU=normalize(original.du),oldV=cross(oldNormal,oldU);
    const newU=normalize(subtract(actual.du,scale(actual.normal,dot(actual.du,actual.normal)))),newV=cross(actual.normal,newU);
    const transported=add(add(scale(newU,dot(displacement,oldU)),scale(newV,dot(displacement,oldV))),scale(actual.normal,dot(displacement,oldNormal)));
    return {...actual,point:add(actual.point,transported)};
  }}:selectedChart;
  const reference=offsetChart(depth);
  const exactAt=depth&&chart.at.derivatives?(u,v)=>chart.at.derivatives(u,v,{normalMm:depth}):(u,v)=>evaluateSurface(chart,[u,v],depth);
  exactAt.covers=chart.at.covers;
  if(!offsetField&&!depth&&chart.at.nativeImage)exactAt.nativeImage=chart.at.nativeImage;
  if(!offsetField&&chart.at.derivatives)exactAt.derivatives=(u,v,{normalMm=0,...options}={})=>chart.at.derivatives(u,v,{...options,normalMm:depth+normalMm});
  const output=offsetField?reference:{...chart,at:exactAt};
  return {...output,referenceRecord:{representation:'offset-chart',source:surfaceReferenceRecord(chart),depthMm:depth,
    geometry:patch?numericalGeometryRecord(shell):null,selection:selection??null,tightness}};
}
