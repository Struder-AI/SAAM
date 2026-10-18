// Fit an axially authored blind volume against a solid's complete boundary.
// All calculations use the profile frame; no build direction is assumed.
import {tessellateSolid} from './boolean-display.mjs';
import {rodFrame,invert,point,dot,cross,subtract} from './frame.mjs';
import {requireThat} from './tolerance.mjs';
import {CONSTRUCTION_TOLERANCE_MM,PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';

const boundaryMeshes=new WeakMap();
async function boundaryMesh(solid,toleranceMm){
  if(!boundaryMeshes.has(solid))boundaryMeshes.set(solid,new Map());
  const cached=boundaryMeshes.get(solid);
  if(!cached.has(toleranceMm))cached.set(toleranceMm,tessellateSolid(solid,{toleranceMm}));
  return cached.get(toleranceMm);
}
function clipPolygon(polygon,normal,offset){
  const output=[];
  for(const [i,b] of polygon.entries()){
    const a=polygon[(i+polygon.length-1)%polygon.length],da=dot(normal,a)-offset,db=dot(normal,b)-offset;
    if((da>0)!==(db>0))output.push(a.map((v,k)=>v+da/(da-db)*(b[k]-v)));
    if(db<=0)output.push(b);
  }
  return output;
}
// A circumscribed polygon encloses each circular section. Its radial excess,
// boundary approximation and stopping guard share the physical accuracy budget.
export async function enclosedAxialProfile(solid,{positionMm,axis,profile,wallMm,floorMm,
  toleranceMm=CONSTRUCTION_TOLERANCE_MM}={}){
  requireThat(solid?.bounds&&!solid.empty&&[positionMm,axis].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))&&Math.hypot(...axis)>0,
    'An enclosed axial profile needs a nonempty host and a finite position and axis.');
  requireThat(Array.isArray(profile)&&profile.length>=2&&profile[0][0]===0&&profile.every(([s,r],i)=>
    Number.isFinite(s)&&Number.isFinite(r)&&r>0&&(!i||s>profile[i-1][0])),
    'An enclosed axial profile needs increasing [distance, radius] pairs starting at zero.');
  requireThat([wallMm,floorMm,toleranceMm].every(v=>Number.isFinite(v)&&v>0),'Enclosed profile clearances must be positive.');
  const accuracy=Math.min(toleranceMm,wallMm/4,floorMm/4),mesh=await boundaryMesh(solid,accuracy);
  const frame=invert(rodFrame(positionMm,positionMm.map((v,k)=>v+axis[k]))),vertices=mesh.vertices.map(p=>point(frame,p));
  const requestedDepthMm=profile.at(-1)[0],state={depth:requestedDepthMm,radius:0},envelope=[];
  for(const [s,r] of profile){state.radius=Math.max(state.radius,r);envelope.push([s,state.radius+wallMm]);}
  envelope.push([requestedDepthMm+floorMm,state.radius+wallMm]);
  for(let segment=1;segment<envelope.length;segment++){
    const [from,r0]=envelope[segment-1],[to,r1]=envelope[segment],slope=(r1-r0)/(to-from),intercept=r0-slope*from;
    if(from>state.depth+floorMm+accuracy)break;
    const count=Math.max(8,Math.ceil(Math.PI/Math.acos(Math.max(r0,r1)/(Math.max(r0,r1)+accuracy))));
    const sides=Array.from({length:count},(_,i)=>[Math.cos(2*Math.PI*i/count),Math.sin(2*Math.PI*i/count),-slope]);
    for(const indices of mesh.triangles){
      const triangle=indices.map(i=>vertices[i]),normal=cross(subtract(triangle[1],triangle[0]),subtract(triangle[2],triangle[0]));
      // Along the homothetic axial flow, this signed value distinguishes entry
      // from exit on the entire triangle. Tangent/uncertain boundaries constrain.
      const direction=normal[2]*intercept+slope*dot(normal,triangle[0]);
      if(direction < -ROUNDING_MM*Math.hypot(...normal)*(1+Math.abs(slope)))continue;
      const cut={polygon:clipPolygon(triangle,[0,0,-1],-from+accuracy)};
      cut.polygon=clipPolygon(cut.polygon,[0,0,1],Math.min(to,state.depth+floorMm)+accuracy);
      for(const side of sides){
        if(!cut.polygon.length)break;
        cut.polygon=clipPolygon(cut.polygon,side,intercept+accuracy*Math.hypot(...side));
      }
      if(cut.polygon.length)state.depth=Math.min(state.depth,Math.min(...cut.polygon.map(p=>p[2]))-floorMm-accuracy);
    }
  }
  requireThat(state.depth>PRINT_RESOLUTION_MM,'The cavity cannot retain its wall and floor within the host boundary.');
  if(state.depth===requestedDepthMm)return {profile:profile.map(p=>[...p]),depthMm:requestedDepthMm,requestedDepthMm,accuracyMm:accuracy};
  const retained=profile.filter(([s])=>s<state.depth).map(p=>[...p]),index=profile.findIndex(([s])=>s>=state.depth);
  const [s0,r0]=profile[index-1],[s1,r1]=profile[index];
  retained.push([state.depth,r0+(r1-r0)*(state.depth-s0)/(s1-s0)]);
  return {profile:retained,depthMm:state.depth,requestedDepthMm,accuracyMm:accuracy};
}
