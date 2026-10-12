import {requireThat,normalize,cross,dot,distance} from '../private/toolpath/numeric.mjs';
import {transportCurveFrames} from './curve-frame.mjs';
import {widenPlanarStrokes} from '../geom/stroke-topology.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
// Deferred shape judgement: a band crossing itself should be judged at print resolution,
// but two segments either side of one shorter segment would then read as crossing.
const CROSSING_MM=1e-7;


// A width rule as read: unknown fields are named in ignored, and a rule without
// positive width, ordered positive bead range and spacing, or with a zero or
// non-XYZ initialNormal, is null (the curve keeps its own bead width).
const WIDTH_RULE_FIELDS=['widthMm','beadRangeMm','spacingFactor','initialNormal'];
export function readWidthRule(rule){
  if(rule===undefined)return {rule:undefined,ignored:[]};
  const known=rule&&typeof rule==='object'?Object.fromEntries(Object.entries(rule).filter(([key])=>WIDTH_RULE_FIELDS.includes(key))):null;
  const ignored=known?Object.keys(rule).filter(key=>!WIDTH_RULE_FIELDS.includes(key)).map(key=>'widthRule.'+key):[];
  const {widthMm,beadRangeMm,spacingFactor=1,initialNormal}=known??{};
  const usable=known&&(initialNormal===undefined||Array.isArray(initialNormal)&&initialNormal.length===3&&initialNormal.every(Number.isFinite)&&Math.hypot(...initialNormal)>0)
    &&Number.isFinite(widthMm)&&widthMm>0&&Array.isArray(beadRangeMm)&&beadRangeMm.length===2&&beadRangeMm.every(w=>Number.isFinite(w)&&w>0)&&beadRangeMm[1]>=beadRangeMm[0]&&Number.isFinite(spacingFactor)&&spacingFactor>0;
  return usable?{rule:known,ignored}:{rule:undefined,ignored:['widthRule']};
}

// Wanted ink width -> one sized bead or the fewest side-by-side beads. The
// rule is one readWidthRule returned.
export function beadWidthRule(rule){
  const {widthMm,beadRangeMm,spacingFactor=1}=rule;
  const [min,max]=beadRangeMm,count=widthMm<=max?1:Math.ceil((widthMm/max-1)/spacingFactor)+1;
  const beadWidthMm=Math.max(min,widthMm/(1+(count-1)*spacingFactor));
  return {beadWidthMm,parallelCount:count,pitchMm:beadWidthMm*spacingFactor,strokeWidthMm:beadWidthMm*(1+(count-1)*spacingFactor)};
}

// Round-joined parallel pairs become closed loops; odd counts retain a center.
// Planar coordinates are physical millimetres, never unscaled native UV.
export const parallelBeadCurves=(curve,rule)=>parallelBeadGroup([curve],rule);
export function parallelBeadGroup(curves,rule){
  const curve=curves[0];
  const construction=beadWidthRule(rule);
  if(construction.parallelCount===1)return curves.map(curve=>({...curve,beadWidthMm:construction.beadWidthMm}));
  requireThat(curves.every(c=>!c.vary&&!c.poses),'Parallel construction must precede variable process and pose mapping.');
  const points=curves.flatMap(c=>c.points),origin=[...points[0]],end=points.find(p=>distance(p,origin)>PRINT_RESOLUTION_MM),x=normalize(end.map((v,i)=>v-origin[i]));
  let normal=null;for(const p of points){const n=cross(x,p.map((v,i)=>v-origin[i]));if(Math.hypot(...n)>PRINT_RESOLUTION_MM){normal=normalize(n);break;}}
  if(!normal){
    const seed=rule.initialNormal??(Math.abs(x[2])<.9?[0,0,1]:[0,1,0]),projected=cross(x,cross(seed,x));
    requireThat(Math.hypot(...projected)>ROUNDING_RELATIVE,'Width initialNormal must not be parallel to the source tangent.');
    normal=normalize(projected);
  }
  if(points.some(p=>Math.abs(dot(p.map((v,i)=>v-origin[i]),normal))>PRINT_RESOLUTION_MM))return curves.flatMap(source=>transportedBeadBand(source,construction,rule));
  if(!rule.initialNormal&&points.every(p=>Math.abs(p[2]-origin[2])<PRINT_RESOLUTION_MM)){origin[0]=0;origin[1]=0;x.splice(0,3,1,0,0);normal=[0,0,1];}
  const output=[];
  for(let k=0;k<Math.ceil(construction.parallelCount/2);k++){
    const radius=(construction.parallelCount-1)*construction.pitchMm/2-k*construction.pitchMm;
    if(radius<=PRINT_RESOLUTION_MM){output.push(...curves.map(c=>({...c,beadWidthMm:construction.beadWidthMm})));continue;}
    // Process scale: arc chord a sixteenth of the bead width, held between fixed bounds.
    for(const points of widenPlanarStrokes(curves,radius,{origin,xAxis:x,normal,arcToleranceMm:Math.max(.005,Math.min(.05,construction.beadWidthMm/16))}))output.push({...curve,closed:true,beadWidthMm:construction.beadWidthMm,points});
  }
  return output;
}


function transportedBeadBand(curve,construction,rule){
  const frame=transportCurveFrames(curve.points,{closed:curve.closed,initialNormal:rule.initialNormal}),duplicate=distance(curve.points[0],curve.points.at(-1))<PRINT_RESOLUTION_MM;
  const points=duplicate?curve.points.slice(0,-1):curve.points,frames=duplicate?frame.frames.slice(0,-1):frame.frames,output=[];
  for(let k=0;k<Math.ceil(construction.parallelCount/2);k++){
    const radius=(construction.parallelCount-1)*construction.pitchMm/2-k*construction.pitchMm;
    if(radius<=PRINT_RESOLUTION_MM){output.push({...curve,beadWidthMm:construction.beadWidthMm});continue;}
    const plus=points.map((p,i)=>p.map((v,a)=>v+radius*frames[i].v[a])),minus=points.map((p,i)=>p.map((v,a)=>v-radius*frames[i].v[a]));
    if(frame.closed){output.push({...curve,closed:true,points:plus,beadWidthMm:construction.beadWidthMm,frameReport:{method:'parallel-transport',seamCorrectionRad:frame.seamCorrectionRad}},{...curve,closed:true,points:minus.toReversed(),beadWidthMm:construction.beadWidthMm,frameReport:{method:'parallel-transport',seamCorrectionRad:frame.seamCorrectionRad}});continue;}
    // Process scale: cap arcs keep a fixed hundredth-of-a-mm chord (or the radius when smaller).
    const count=Math.max(2,Math.ceil(Math.PI/(2*Math.acos(Math.max(-1,1-Math.min(.01,radius)/radius))))),joined=[...plus];
    const cap=(index,sign,skipLast)=>{const {u,v}=frames[index],p=points[index];for(let j=1;j<=count-(skipLast?1:0);j++){const a=j*Math.PI/count;joined.push(p.map((x,k)=>x+radius*sign*(v[k]*Math.cos(a)+u[k]*Math.sin(a))));}};
    cap(points.length-1,1,false);joined.push(...minus.slice(0,-1).toReversed());cap(0,-1,true);
    output.push({...curve,closed:true,points:joined,beadWidthMm:construction.beadWidthMm,frameReport:{method:'parallel-transport',seamCorrectionRad:frame.seamCorrectionRad}});
  }
  for(const path of output){
    const p=path.closed?[...path.points,path.points[0]]:path.points;
    for(let i=1;i<p.length;i++)for(let j=i+2;j<p.length;j++){
      if(i===1&&j===p.length-1)continue;
      const a=p[i-1],u=p[i].map((v,k)=>v-a[k]),b=p[j-1],v=p[j].map((x,k)=>x-b[k]),w=a.map((x,k)=>x-b[k]);
      const aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w),den=aa*cc-bb*bb;
      if(aa<ROUNDING_MM**2||cc<ROUNDING_MM**2)continue;
      let s=den>ROUNDING_RELATIVE**2*aa*cc?Math.max(0,Math.min(1,(bb*ee-cc*dd)/den)):0,t=Math.max(0,Math.min(1,(bb*s+ee)/cc));
      s=Math.max(0,Math.min(1,(bb*t-dd)/aa));t=Math.max(0,Math.min(1,(bb*s+ee)/cc));
      requireThat(distance(a.map((x,k)=>x+s*u[k]),b.map((x,k)=>x+t*v[k]))>CROSSING_MM,`Spatial parallel band crosses itself at segments ${i-1} and ${j-1}; reduce width or revise the source curve.`);
    }
  }
  return output;
}
