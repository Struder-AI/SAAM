// Slice records for heat-set reinforcement, written into the recipe by
// apply_heat_set: around each bore a six-loop annulus owner, six beads wide,
// and each fin a solid, fixed-angle owner with no loops whose rows
// stop half a bead inside the fin (no fill overlap). Every owner is ordinary slice data
// with a geometry volume in the part's own frame; the core slices them like
// any other owner, and the part's default owner takes the rest.
import {dimensions,heatSetAssignmentId,legacyHeatSetAssignmentId,borePoint} from './feature.mjs';

export const HEAT_SET_SLICE_PREFIX='heat-set-';
// copies core/dimensions.mjs PRINT_RESOLUTION_MM; this runtime has no release-relative imports
const PRINT_RESOLUTION_MM=1e-3;
// The owner volumes rise by print resolution so no layer lies on their faces: for
// a vertical bore a layer at the mouth height falls inside, one at the floor below.
const SIDES=96,LIFT=PRINT_RESOLUTION_MM;

// A closed prism between two polygons, counterclockwise seen from above.
function prism(bottom,top){
  const n=bottom.length,vertices=[...bottom,...top],triangles=[];
  for(let k=1;k+1<n;k++)triangles.push([0,k+1,k],[n,n+k,n+k+1]);
  for(let i=0;i<n;i++){const j=(i+1)%n;triangles.push([i,j,n+j],[i,n+j,n+i]);}
  return {shape:'mesh',vertices,triangles,source:null};
}

// feature, part id (null for a single part), process -> slice assignments.
export function heatSetSlices(feature,part,{lineWidthMm},{existingIds=new Set()}={}){
  // Bore-frame points (radius, angle, distance s outward from the mouth), lifted.
  const {diameterMm,depthMm}=dimensions(feature),w=lineWidthMm,radial=diameterMm/2+6*w;
  const lifted=(r,a,s)=>borePoint(feature,r,a,s).map((c,i)=>i===2?c+LIFT:c);
  const ring=s=>Array.from({length:SIDES},(_,i)=>lifted(radial,2*Math.PI*i/SIDES,s));
  const flat={fillDensity:0,solidTop:0,solidBottom:0};
  const canonical=heatSetAssignmentId(feature,part),legacy=legacyHeatSetAssignmentId(feature);
  const retain=(current,prior)=>existingIds.has(current)?current:existingIds.has(prior)?prior:current;
  const name=retain(canonical,legacy);
  const annulus={id:name,part,loops:6,...flat,within:[{kind:'geometry',geometry:prism(ring(-depthMm),ring(0))}]};
  // A gusset's radial reach grows linearly from the floor to finLengthMm at
  // the face, its width tapering from twice the fin width at the annulus to
  // the fin width at the tip; a fin starts where it reaches one bead.
  const finWidth=Math.max(w,Math.round(feature.finWidthMm/w)*w),root=2*finWidth;
  const tip=length=>finWidth*(2-length/feature.finLengthMm);
  if(feature.finLengthMm<w)return [annulus];
  const start=-depthMm+depthMm*w/feature.finLengthMm;
  const fins=Array.from({length:feature.finCount},(_,n)=>{
    // Radial distance r and offset t across the fin, as a radius and angle about the axis.
    const a=(feature.finAngleDeg+n*360/feature.finCount)*Math.PI/180,at=(r,t,s)=>lifted(Math.hypot(r,t),a+Math.atan2(t,r),s);
    const face=(length,s)=>[at(radial,-root/2,s),at(radial+length,-tip(length)/2,s),at(radial+length,tip(length)/2,s),at(radial,root/2,s)];
    // Rows run across the fin: its direction projected onto the layer.
    const side=borePoint(feature,1,a+Math.PI/2,0).map((c,i)=>c-feature.positionMm[i]);
    const across=((Math.atan2(side[1],side[0])*180/Math.PI)%360+540)%360-180;
    return {id:retain(`${canonical}--fin-${n}`,`${legacy}-fin-${n}`),part,loops:0,fillDensity:1,solidTop:0,solidBottom:0,fillOverlap:0,
      rotateFill:false,fillAnglesDeg:[across],within:[{kind:'geometry',geometry:prism(face(w,start),face(feature.finLengthMm,0))}]};
  });
  return [annulus,...fins];
}
