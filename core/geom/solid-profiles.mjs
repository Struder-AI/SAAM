// Ordinary closed spline construction from corresponding numerical profiles.
import {authoredNurbs} from './nurbs.mjs';
import {point,rigid,validateRigid} from './frame.mjs';
import {requireThat,distance} from './tolerance.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';

export function polygonProfile(points){
  requireThat(Array.isArray(points)&&points.length>=3,'A polygon profile needs three vertices.');
  const closed=distance(points[0],points.at(-1))<=ROUNDING_MM?points:[...points,points[0]];
  const n=closed.length;
  return {degree:1,knots:Array.from({length:n+2},(_,i)=>i===0?0:i>=n?1:(i-1)/(n-1)),controlPoints:closed};
}
export function roundedRectangleProfile({widthMm,heightMm,radiusMm,centerMm=[0,0,0]}){
  requireThat([widthMm,heightMm].every(v=>Number.isFinite(v)&&v>0)&&Number.isFinite(radiusMm)&&radiusMm>=0&&2*radiusMm<=Math.min(widthMm,heightMm),'Rounded rectangle needs positive dimensions and a fitting corner radius.');
  requireThat(Array.isArray(centerMm)&&centerMm.length===3&&centerMm.every(Number.isFinite),'Rounded rectangle centerMm needs finite XYZ.');
  const x=widthMm/2,y=heightMm/2,r=radiusMm,[cx,cy,z]=centerMm;
  if(!r)return polygonProfile([[-x,-y],[x,-y],[x,y],[-x,y]].map(([a,b])=>[a+cx,b+cy,z]));
  const corners=[[x-r,-y+r,-1],[x-r,y-r,0],[-x+r,y-r,1],[-x+r,-y+r,2]],points=[],weights=[];
  for(const [a,b,quarter] of corners){
    const angle=quarter*Math.PI/2,start=[a+r*Math.cos(angle),b+r*Math.sin(angle)],end=[a+r*Math.cos(angle+Math.PI/2),b+r*Math.sin(angle+Math.PI/2)];
    const middle=[a+r*(Math.cos(angle)+Math.cos(angle+Math.PI/2)),b+r*(Math.sin(angle)+Math.sin(angle+Math.PI/2))];
    if(points.length){const last=points.at(-1);points.push(last.map((v,i)=>(v+start[i])/2),start);weights.push(1,1);}else{points.push(start);weights.push(1);}
    points.push(middle,end);weights.push(Math.SQRT1_2,1);
  }
  const last=points.at(-1),first=points[0];points.push(last.map((v,i)=>(v+first[i])/2),first);weights.push(1,1);
  const pieces=(points.length-1)/2;
  return {degree:2,knots:[0,0,0,...Array.from({length:pieces-1},(_,i)=>[(i+1)/pieces,(i+1)/pieces]).flat(),1,1,1],controlPoints:points.map(([a,b])=>[a+cx,b+cy,z]),weights};
}
export function loftProfiles({profiles,centers,name='profile'}){
  requireThat(Array.isArray(profiles)&&profiles.length>=2,'A profile loft needs at least two corresponding curves.');
  for(const profile of profiles)authoredNurbs(profile);
  const first=profiles[0],n=first.controlPoints.length;
  requireThat(profiles.every((p,i)=>p.degree===first.degree&&p.controlPoints.length===n&&p.knots.join()===first.knots.join()&&distance(p.controlPoints[0],p.controlPoints.at(-1))<=ROUNDING_MM),'Loft profiles need the same closed basis and corresponding controls.');
  const at=(profile,i)=>[...profile.controlPoints[i],profile.weights?.[i]??1];
  const middle=p=>[0,1,2].map(k=>p.controlPoints.slice(0,-1).reduce((sum,v)=>sum+v[k],0)/(n-1));
  const ends=centers??[middle(profiles[0]),middle(profiles.at(-1))];
  requireThat(ends.length===2&&ends.every(p=>p.length===3&&p.every(Number.isFinite)),'Loft cap centers need finite XYZ.');
  const cap=(name,p,center)=>({name,degreeU:p.degree,degreeV:1,knotsU:p.knots,controlPoints:p.controlPoints.map((_,i)=>[[...center,p.weights?.[i]??1],at(p,i)])});
  return {shape:'spline',patches:[{name:name+'-side',degreeU:first.degree,degreeV:1,knotsU:first.knots,
    controlPoints:Array.from({length:n},(_,i)=>profiles.map(p=>at(p,i)))},cap(name+'-start',first,ends[0]),cap(name+'-end',profiles.at(-1),ends[1])]};
}
export function boxGeometry(size){
  requireThat(Array.isArray(size)&&size.length===3&&size.every(v=>Number.isFinite(v)&&v>0),'Box dimensions must be positive.');
  const [x,y,z]=size;
  const faces=[['bottom',[[[0,0,0],[0,y,0]],[[x,0,0],[x,y,0]]]],['top',[[[0,0,z],[0,y,z]],[[x,0,z],[x,y,z]]]],
    ['front',[[[0,0,0],[0,0,z]],[[x,0,0],[x,0,z]]]],['back',[[[0,y,0],[0,y,z]],[[x,y,0],[x,y,z]]]],
    ['left',[[[0,0,0],[0,0,z]],[[0,y,0],[0,y,z]]]],['right',[[[x,0,0],[x,0,z]],[[x,y,0],[x,y,z]]]]];
  return {shape:'spline',patches:faces.map(([name,controlPoints])=>({name,degreeU:1,degreeV:1,controlPoints}))};
}
// Transform a physical geometry value; feature authoring records stay with clients.
export function transformGeometry(geometry,transform){
  validateRigid(transform);
  if(geometry.solid)return transformGeometry(geometry.solid,transform);
  if(geometry.shape==='spline')return {shape:'spline',patches:geometry.patches.map(p=>({...p,controlPoints:p.controlPoints.map(row=>row.map(v=>[...point(transform,v.slice(0,3)),...v.slice(3)]))}))};
  if(geometry.shape==='boolean')return {...geometry,operands:geometry.operands.map(g=>transformGeometry(g,transform))};
  if(geometry.shape==='assembly')return {...geometry,parts:geometry.parts.map(p=>({...p,xMm:0,yMm:0,zMm:0,geometry:transformGeometry(transformGeometry(p.geometry,rigid([p.xMm,p.yMm,p.zMm])),transform)}))};
  requireThat(Array.isArray(geometry.vertices)&&Array.isArray(geometry.triangles),'Transform needs ordinary physical geometry.');
  return {shape:'mesh',source:geometry.source??null,vertices:geometry.vertices.map(p=>point(transform,p)),triangles:geometry.triangles};
}
