// Slice records for heat-set reinforcement, written into the recipe by
// apply_heat_set: around each bore a six-loop annulus owner, six beads wide,
// and each fin a solid, fixed-angle owner with no loops whose rows
// stop half a bead inside the fin (no fill overlap). Every owner is ordinary slice data
// with a geometry volume in the part's own frame; the core slices them like
// any other owner, and the part's default owner takes the rest.
import {sliceAssignment} from '../../../core/print/slices.mjs';
import {dimensions,heatSetAssignmentId,legacyHeatSetAssignmentId} from './feature.mjs';

export const HEAT_SET_SLICE_PREFIX='heat-set-';
const SIDES=96,LIFT=1e-3;

// A closed prism between two polygons, counterclockwise seen from above.
function prism(bottom,top){
  const n=bottom.length,vertices=[...bottom,...top],triangles=[];
  for(let k=1;k+1<n;k++)triangles.push([0,k+1,k],[n,n+k,n+k+1]);
  for(let i=0;i<n;i++){const j=(i+1)%n;triangles.push([i,j,n+j],[i,n+j,n+i]);}
  return {shape:'mesh',vertices,triangles,source:null};
}

// feature, part id (null for a single part), process -> slice assignments.
export function heatSetSlices(feature,part,{lineWidthMm},{existingIds=new Set()}={}){
  const {diameterMm,depthMm}=dimensions(feature),[x,y,mouth]=feature.positionMm,w=lineWidthMm;
  const floor=mouth-depthMm+LIFT,top=mouth+LIFT,radial=diameterMm/2+6*w;
  const ring=z=>Array.from({length:SIDES},(_,i)=>[x+radial*Math.cos(2*Math.PI*i/SIDES),y+radial*Math.sin(2*Math.PI*i/SIDES),z]);
  const flat={fillDensity:0,solidTop:0,solidBottom:0};
  const canonical=heatSetAssignmentId(feature,part),legacy=legacyHeatSetAssignmentId(feature);
  const retain=(current,prior)=>existingIds.has(current)?current:existingIds.has(prior)?prior:current;
  const name=retain(canonical,legacy);
  const annulus=sliceAssignment({id:name,part,loops:6,...flat,within:[{kind:'geometry',geometry:prism(ring(floor),ring(top))}]});
  // A gusset's radial reach grows linearly from the floor to finLengthMm at
  // the face, its width tapering from twice the fin width at the annulus to
  // the fin width at the tip; a fin starts where it reaches one bead.
  const finWidth=Math.max(w,Math.round(feature.finWidthMm/w)*w),root=2*finWidth;
  const tip=length=>finWidth*(2-length/feature.finLengthMm);
  if(feature.finLengthMm<w)return [annulus];
  const start=floor+depthMm*w/feature.finLengthMm;
  const fins=Array.from({length:feature.finCount},(_,n)=>{
    const degrees=feature.finAngleDeg+n*360/feature.finCount,a=degrees*Math.PI/180,u=[Math.cos(a),Math.sin(a)],v=[-u[1],u[0]];
    const at=(r,t,z)=>[x+r*u[0]+t*v[0],y+r*u[1]+t*v[1],z];
    const face=(length,z)=>[at(radial,-root/2,z),at(radial+length,-tip(length)/2,z),at(radial+length,tip(length)/2,z),at(radial,root/2,z)];
    const across=((degrees+90)%360+540)%360-180;
    return sliceAssignment({id:retain(`${canonical}--fin-${n}`,`${legacy}-fin-${n}`),part,loops:0,fillDensity:1,solidTop:0,solidBottom:0,fillOverlap:0,
      rotateFill:false,fillAnglesDeg:[across],within:[{kind:'geometry',geometry:prism(face(w,start),face(feature.finLengthMm,top))}]});
  });
  return [annulus,...fins];
}
