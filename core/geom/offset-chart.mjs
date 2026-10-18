// An ambient offset reference retains its chart, independent of fill or stacking.
import {prepareSurfaceOffset} from './surface-offset.mjs';
import {evaluateSurface} from './surface-evaluation.mjs';
import {requireThat,normalize,cross} from './tolerance.mjs';
import {surfaceReferenceRecord,numericalGeometryRecord} from './surface-record.mjs';
import {selectedSplinePatch} from './surface-region.mjs';
import {extendSurface} from './surface-extend.mjs';
export function offsetSurfaceChart(chart,depth,{shell,selection,nativePatch=null,tightness=1}={}){
  requireThat(Number.isFinite(depth)&&Number.isFinite(tightness)&&tightness>=0&&tightness<=1,'Surface offsets need finite depth and tightness from 0 to 1.');
  const patch=tightness<1?(nativePatch??(selection?.kind==='spline'?selectedSplinePatch(shell,selection):null)):null;
  const normalSide=selection?.normalSide??1;
  const offsetField=patch?prepareSurfaceOffset({patch,periodicU:selection?.periodicU??chart.periodicU??false}):null;
  const extensionBounds=chart.neighborhood?.referenceBoundsUv??(selection?.extend?selection.uvBounds:nativePatch?[chart.domainU,chart.domainV]:null);
  const movedPatch=offsetField?offsetField.offsetPatch(depth*normalSide):null;
  const movedSurface=movedPatch&&extensionBounds?extendSurface(movedPatch,extensionBounds):movedPatch;
  const fittedAt=(u,v)=>{
    const [[u0,u1],[v0,v1]]=selection?.uvBounds??[[0,1],[0,1]],U=u0+u*(u1-u0),V=v0+v*(v1-v0),moved=evaluateSurface(movedSurface,[U,V]);
    const loose={point:moved.point,du:moved.du.map(value=>value*(u1-u0)),dv:moved.dv.map(value=>value*(v1-v0))};
    const exact=tightness?chart.at.derivatives(u,v,{normalMm:depth}):null;
    const blend=key=>exact?loose[key].map((value,k)=>value+tightness*(exact[key][k]-value)):loose[key];
    const du=blend('du'),dv=blend('dv');
    return {point:blend('point'),du,dv,normal:normalize(cross(du,dv)).map(value=>value*normalSide)};
  };
  const exactAt=depth&&chart.at.derivatives?(u,v)=>chart.at.derivatives(u,v,{normalMm:depth}):(u,v)=>evaluateSurface(chart,[u,v],depth);
  const at=offsetField?fittedAt:exactAt;
  at.covers=chart.at.covers;
  if(!depth&&chart.at.nativeImage)at.nativeImage=chart.at.nativeImage;
  if(!offsetField&&chart.at.derivatives)exactAt.derivatives=(u,v,{normalMm=0,...options}={})=>chart.at.derivatives(u,v,{...options,normalMm:depth+normalMm});
  return {...chart,at,referenceRecord:{representation:'offset-chart',source:surfaceReferenceRecord(chart),depthMm:depth,
    geometry:patch?numericalGeometryRecord(shell):null,selection:selection??null,...(nativePatch?{nativePatch:numericalGeometryRecord(nativePatch)}:{}),tightness}};
}
