// Existing surface charts share point, normal and first-derivative evaluation.
// Coordinates retain their native units; offsets are physical millimetres.
import {evaluate} from './nurbs.mjs';
import {heightSlicePoint,heightSliceNormal} from './height-slice.mjs';
import {cross,normalize,distance,requireThat} from './tolerance.mjs';

const rings=new WeakMap();
function sleeveRing(layer,u){
  let ring=rings.get(layer);
  if(!ring){
    requireThat(layer.curves?.length===1&&layer.curves[0].closed,'Sleeve layers require one closed boundary loop.');
    const points=layer.curves[0].points,lengths=[0];
    for(let i=0;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i],points[(i+1)%points.length]));
    requireThat(lengths.at(-1)>0,'Sleeve boundary collapsed.');
    ring={points,lengths};rings.set(layer,ring);
  }
  const {points,lengths}=ring,total=lengths.at(-1),d=((u%1)+1)%1*total;
  let i=1;while(i<lengths.length-1&&lengths[i]<=d)i++;
  const a=points[i-1],b=points[i%points.length],span=lengths[i]-lengths[i-1],t=(d-lengths[i-1])/span;
  return {point:a.map((x,k)=>x+(b[k]-x)*t),du:a.map((x,k)=>(b[k]-x)*total/span)};
}

export function evaluateSurface(surface,[u,v],normalMm=0){
  let e;
  if(surface.cp||surface.kind==='patch')e=evaluate(surface.patch??surface,u,v);
  else if(surface.kind==='plane')e={point:surface.origin.map((x,k)=>x+u*surface.xAxis[k]+v*surface.yAxis[k]),normal:surface.normal,du:surface.xAxis,dv:surface.yAxis};
  else if(surface.kind==='height-field'){
    const point=heightSlicePoint(surface,[u,v]),normal=heightSliceNormal(surface,[u,v]);
    e={point,normal,du:[1,0,-normal[0]/normal[2]],dv:[0,1,-normal[1]/normal[2]]};
  }else if(surface.kind==='sleeve-chart'){
    const layers=surface.layers;
    requireThat(layers?.length>=2,'A sleeve reference needs at least two boundary layers.');
    requireThat(v>=-1e-9&&v<=layers.length-1+1e-9,'Sleeve curve lies outside the along-coordinate domain.');
    const coordinate=Math.max(0,Math.min(layers.length-1,v)),i=Math.min(layers.length-2,Math.floor(coordinate)),t=coordinate-i;
    const a=sleeveRing(layers[i],u),b=sleeveRing(layers[i+1],u),du=a.du.map((x,k)=>x+t*(b.du[k]-x)),dv=b.point.map((x,k)=>x-a.point[k]);
    e={point:a.point.map((x,k)=>x+t*dv[k]),du,dv,normal:normalize(cross(du,dv))};
  }else if(surface.kind==='slice-chart')return evaluateSurface(surface.slice,[u,v],normalMm);
  else {requireThat(typeof surface.at==='function','Unsupported surface chart.');e=surface.at(u,v);}
  requireThat(Number.isFinite(normalMm),'Surface normal offset must be finite.');
  requireThat(!normalMm||e.normal,'Surface has a singular tangent at this chart point.');
  return {...e,reference:e.point,point:normalMm?e.point.map((x,k)=>x+normalMm*e.normal[k]):e.point,u,v};
}

// An affine chart selection preserves native parameters and derivative units.
export function mappedSurface(surface,bounds,domain,{normalSide=1,periodicU=false}={}){
  const scale=bounds.map((b,k)=>(b[1]-b[0])/(domain[k][1]-domain[k][0]));
  const breaks=(knots,b,k)=>[domain[k][0],...new Set([...(knots??[])].filter(x=>x>b[0]&&x<b[1]).map(x=>domain[k][0]+(x-b[0])/scale[k])),domain[k][1]];
  const at=(u,v)=>{
    const coordinates=[u,v];
    requireThat(coordinates.every((x,k)=>{const t=(x-domain[k][0])/(domain[k][1]-domain[k][0]);return t>=-1e-9&&t<=1+1e-9;}),'Surface sample outside selected region.');
    const uv=coordinates.map((x,k)=>bounds[k][0]+Math.max(0,Math.min(domain[k][1]-domain[k][0],x-domain[k][0]))*scale[k]),e=evaluateSurface(surface,uv);
    requireThat(e.normal,'Surface has a singular tangent at this chart point.');
    return {...e,uv,normal:e.normal.map(x=>x*normalSide),du:e.du?.map(x=>x*scale[0]),dv:e.dv?.map(x=>x*scale[1])};
  };
  return {at,source:surface,domainU:domain[0],domainV:domain[1],breaksU:breaks(surface.knotsU,bounds[0],0),breaksV:breaks(surface.knotsV,bounds[1],1),periodicU};
}
