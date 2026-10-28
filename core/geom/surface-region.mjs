// A rectangular surface chart shared by surface pattern producers. Native
// spline evaluation or an explicitly mapped triangle strip; no inverse mapping.
import {mappedSurface} from './surface-evaluation.mjs';
import {requireThat,subtract,cross,normalize,scale,add,distance} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,TOLERANCE} from '../dimensions.mjs';
import {numericalGeometryRecord} from './surface-record.mjs';
import {referencePatch,selectedFace} from './reference-surface.mjs';
import {extendSurface} from './surface-extend.mjs';
import {surfaceNeighborhood} from './surface-neighborhood.mjs';
import {faceTrimRegion} from './surface-trim.mjs';
import {intersect} from '../region/intersection.mjs';
import {validateSplineSolid} from './spline-solid.mjs';

export function validateSurfaceSelection(s){
  requireThat(s&&['spline','mesh-strip'].includes(s.kind),'Surface selection kind must be spline or mesh-strip.');
  const keys=s.kind==='spline'?['kind','normalSide','patch','periodicU','uvBounds']:['kind','normalSide','periodicU','rows'];
  const missing=keys.filter(k=>!Object.hasOwn(s,k)),unexpected=Object.keys(s).filter(k=>!keys.includes(k)&&!(s.kind==='spline'&&k==='extend'));
  const contract=s.kind==='spline'?'patch, periodicU:boolean, normalSide:1|-1 and uvBounds (two increasing native UV intervals)':'rows (a rectangular grid of native vertex indices), periodicU:boolean and normalSide:1|-1';
  requireThat(!missing.length,`Missing surface selection fields: ${missing.join(', ')}. Required: ${contract}.`);
  requireThat(!unexpected.length,`Unexpected surface selection fields: ${unexpected.join(', ')}.`);
  requireThat(typeof s.periodicU==='boolean','Surface selection periodicU must be boolean.');
  requireThat([1,-1].includes(s.normalSide),'Surface selection normalSide must be 1 or -1.');
  requireThat(s.extend===undefined||typeof s.extend==='boolean','Surface selection extend must be boolean.');
  if(s.kind==='spline'){
    requireThat(typeof s.patch==='string'&&s.patch.length>0||s.patch&&typeof s.patch==='object','Surface selection patch must name a native patch or contain an authored patch.');
    requireThat(Array.isArray(s.uvBounds)&&s.uvBounds.length===2&&s.uvBounds.every(b=>Array.isArray(b)&&b.length===2&&b.every(Number.isFinite)&&b[1]>b[0]),'Surface selection uvBounds must contain two increasing finite intervals in native UV parameters.');
    if(typeof s.patch!=='string')validateSplineSolid({shape:'spline',patches:[s.patch]});
  }
  else requireThat(Array.isArray(s.rows)&&s.rows.length>=2&&s.rows.every(r=>Array.isArray(r)&&r.length===s.rows[0].length&&r.length>=2&&r.every(i=>Number.isInteger(i)&&i>=0)),'Mesh-strip rows must be a rectangular grid of native vertex indices.');
}

// One chart per backend: the sampler and its knot/cell breaks. The selected
// chart is chosen once, so the sampled evaluation stays a named stage.
export function selectedSplinePatch(shell,spec){
  const patch=typeof spec.patch==='string'?selectedFace(shell,spec.patch):{...referencePatch(spec.patch),name:spec.patch.name,
    ...(spec.patch.trimLoops===undefined?{}:{trimLoops:spec.patch.trimLoops})};
  requireThat(patch,'Selected native spline patch is missing.');
  return patch;
}
function splinePatchChart(shell,spec,neighborhood){
  const patch=selectedSplinePatch(shell,spec);
  const [u,v]=spec.uvBounds;
  if(neighborhood){
    const normalRangeMm=(neighborhood.normalRangeMm??[0,0]).map(value=>value*spec.normalSide).sort((a,b)=>a-b);
    const prepared=surfaceNeighborhood(patch,{...neighborhood,normalRangeMm,periodicU:spec.periodicU,boundsUv:spec.uvBounds});
    const domains=prepared.boundsUv.map((bounds,k)=>bounds.map(value=>(value-spec.uvBounds[k][0])/(spec.uvBounds[k][1]-spec.uvBounds[k][0])));
    const chart=mappedSurface(prepared.surface,prepared.boundsUv,domains,spec);
    const selected=faceTrimRegion(patch).map(loop=>loop.map(uv=>uv.map((value,k)=>(value-spec.uvBounds[k][0])/(spec.uvBounds[k][1]-spec.uvBounds[k][0]))));
    return {...chart,regionUv:intersect(selected,[[[0,0],[1,0],[1,1],[0,1]]]),neighborhood:{...prepared.report,boundsUv:prepared.boundsUv,referenceBoundsUv:prepared.referenceBoundsUv}};
  }
  if(spec.extend){
    requireThat(!spec.periodicU||u[0]===patch.domainU[0]&&u[1]===patch.domainU[1],'A periodic U seam keeps its original domain; extend V only.');
    return mappedSurface(extendSurface(patch,spec.uvBounds),spec.uvBounds,[[0,1],[0,1]],spec);
  }
  requireThat(u[0]>=patch.domainU[0]&&u[1]<=patch.domainU[1]&&v[0]>=patch.domainV[0]&&v[1]<=patch.domainV[1],'Selected UV region exceeds the native patch.');
  return mappedSurface(patch,spec.uvBounds,[[0,1],[0,1]],spec);
}
function meshStripChart(shell,spec){
  requireThat(shell.kind==='triangle-mesh','Mesh-strip selection requires native mesh geometry.');
  const rows=spec.rows,nu=rows.length-1,nv=rows[0].length-1;
  requireThat(rows.flat().every(i=>i<shell.vertices.length),'Mesh strip references an absent vertex.');
  const faces=new Set(shell.triangles.map(t=>[...t].sort((a,b)=>a-b).join(','))),normals=new Map(),cells=[];
  const addFace=t=>{requireThat(faces.has([...t].sort((a,b)=>a-b).join(',')),'Mesh chart cell does not match native triangles.');
    const n=cross(subtract(shell.vertices[t[1]],shell.vertices[t[0]]),subtract(shell.vertices[t[2]],shell.vertices[t[0]]));
    for(const i of t)normals.set(i,add(normals.get(i)??[0,0,0],n));};
  for(let i=0;i<nu;i++){cells[i]=[];for(let j=0;j<nv;j++){
    const [a,b,c,d]=[rows[i][j],rows[i+1][j],rows[i+1][j+1],rows[i][j+1]];
    const ac=faces.has([a,b,c].sort((a,b)=>a-b).join(','));
    const ts=ac?[[a,b,c],[a,c,d]]:[[a,b,d],[b,c,d]];ts.forEach(addFace);cells[i][j]={a,b,c,d,ac};
  }}
  for(const [id,n] of normals)normals.set(id,scale(normalize(n),spec.normalSide));
  const at=(u,v)=>{
    const i=Math.min(nu-1,Math.floor(u*nu)),j=Math.min(nv-1,Math.floor(v*nv)),x=u*nu-i,y=v*nv-j,{a,b,c,d,ac}=cells[i][j];
    let ids,w;
    if(ac){if(y<=x){ids=[a,b,c];w=[1-x,x-y,y];}else{ids=[a,c,d];w=[1-y,x,y-x];}}
    else if(x+y<=1){ids=[a,b,d];w=[1-x-y,x,y];}else{ids=[b,c,d];w=[1-y,x+y-1,1-x];}
    const blend=fn=>[0,1,2].map(k=>ids.reduce((s,id,n)=>s+fn(id)[k]*w[n],0));
    const point=blend(id=>shell.vertices[id]),normal=normalize(blend(id=>normals.get(id)));
    // One-sided cell derivatives; the reference remains the actual triangles.
    const du=scale(subtract(shell.vertices[ac?(y<=x?b:c):(x+y<=1?b:c)],shell.vertices[ac?(y<=x?a:d):(x+y<=1?a:d)]),nu);
    const dv=scale(subtract(shell.vertices[ac?(y<=x?c:d):(x+y<=1?d:c)],shell.vertices[ac?(y<=x?b:a):(x+y<=1?a:b)]),nv);
    return {point,normal,du,dv};
  };
  return {at,breaksU:Array.from({length:nu+1},(_,i)=>i/nu),breaksV:Array.from({length:nv+1},(_,i)=>i/nv)};
}

export function surfaceRegion(shell,spec,neighborhood=null){
  validateSurfaceSelection(spec);
  requireThat(!neighborhood||spec.kind==='spline','Automatic offset neighborhoods need a selected native surface.');
  const chart=spec.kind==='spline'?splinePatchChart(shell,spec,neighborhood):meshStripChart(shell,spec),domains=[chart.domainU??[0,1],chart.domainV??[0,1]];
  const sample=(u,v)=>{requireThat([u,v].every((value,k)=>value>=domains[k][0]&&value<=domains[k][1]),'Surface sample outside selected neighborhood.');return chart.at(u,v);};
  if(chart.at.derivatives)sample.derivatives=chart.at.derivatives;
  if(chart.at.nativeImage)sample.nativeImage=chart.at.nativeImage;
  sample.covers=chart.at.covers;
  if(spec.periodicU)for(let j=0;j<=16;j++){
    const a=sample(0,j/16),b=sample(1,j/16);
    // Same point at print resolution; the normal match is a direction judgement whose value
    // predates the classes (mesh-strip normals are interpolated, so a stricter bound is deferred).
    requireThat(distance(a.point,b.point)<PRINT_RESOLUTION_MM&&distance(a.normal,b.normal)<(100*TOLERANCE.domainFraction),'Periodic surface seam must match in position and normal.');
  }
  return {at:sample,domainU:domains[0],domainV:domains[1],breaksU:chart.breaksU,breaksV:chart.breaksV,periodicU:spec.periodicU,backend:spec.kind,
    ...(chart.neighborhood?{neighborhood:chart.neighborhood,regionUv:chart.regionUv}:{}),
    referenceRecord:{representation:'surface-region',geometry:numericalGeometryRecord(shell),selection:spec,...(neighborhood?{neighborhood}:{})}};
}
