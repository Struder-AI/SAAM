// Bounded directional unfolding of a closed contour. Radius and traversal order
// are retained; weighted isotonic regression regularizes only polar angle.
// A fixed arc-length quadrature gives section vertex splits no new fit weight.
import {requireThat} from './tolerance.mjs';
import {prepareSleeveContact} from './sleeve-contact.mjs';
const TAU=2*Math.PI;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

export function regularizeDirectionalContour(curve,anchor,{toleranceMm,samples=8192,logRadiusSlopeTarget=256}={}){
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0&&Number.isInteger(samples)&&samples>=32&&samples<=16384,
    'Directional contour needs positive tolerance and a fixed sample count from32 to16384.');
  requireThat(Array.isArray(anchor)&&anchor.length===2&&anchor.every(Number.isFinite),'Directional contour needs a finite XY center.');
  const points=Array.from({length:samples},(_,i)=>curve.at(i/samples));
  let samplingErrorMm=0;
  // Both source and sampled polylines are piecewise linear in normalized arc
  // length. Their difference attains maximum norm at a union breakpoint.
  for(const {u,p} of curve.breakpoints()){
    const scaled=Math.min(samples,u*samples),i=Math.min(samples-1,Math.floor(scaled)),t=scaled-i;
    const a=points[i],b=points[(i+1)%samples],q=a.map((v,k)=>v+t*(b[k]-v));
    samplingErrorMm=Math.max(samplingErrorMm,distance(p,q));
  }
  requireThat(samplingErrorMm<toleranceMm,
    `Directional contour fixed sampling error ${samplingErrorMm.toFixed(6)} mm exceeds detail tolerance ${toleranceMm} mm; increase its fixed sample count.`);
  const available=toleranceMm-samplingErrorMm,radii=points.map(p=>distance(p,anchor));
  requireThat(radii.every(r=>r>1e-8),'Directional contour touches its fitted center.');
  const theta=points.map(p=>Math.atan2(p[1]-anchor[1],p[0]-anchor[0])),angles=[theta[0]];
  let turn=0;
  for(let i=1;i<=samples;i++){
    const delta=theta[i%samples]-theta[i-1];
    turn+=Math.atan2(Math.sin(delta),Math.cos(delta));angles.push(theta[0]+turn);
  }
  requireThat(Math.abs(turn-TAU)<1e-8,'Directional contour must wind once counterclockwise around its fitted center.');
  // Fixed positive spacing keeps the inverse radial query single-valued. The
  // constrained weighted projection remains continuous as source points move.
  const step=Math.min(available/(4*Math.max(...radii)*samples),TAU/(samples*16));
  // A positive angle alone still permits arbitrarily steep radial walls. Give
  // radial variation angular room, while the same correspondence constraint
  // rejects any source that cannot accommodate that conditioning within budget.
  requireThat(Number.isFinite(logRadiusSlopeTarget)&&logRadiusSlopeTarget>0,'Directional conditioning needs a positive log-radius slope target.');
  const prefix=[0];
  for(let i=1;i<=samples;i++)prefix.push(prefix.at(-1)+Math.max(step,Math.abs(Math.log(radii[i%samples]/radii[i-1]))/logRadiusSlopeTarget));
  requireThat(prefix[samples]<TAU,'Directional contour radial variation exceeds its angular conditioning budget.');
  const minimum=angles[0],maximum=angles[samples]-prefix[samples],blocks=[];
  let feasibleMinimum=minimum;
  for(let i=1;i<samples;i++){
    const weight=radii[i]**2,value=angles[i]-prefix[i];
    const angularBound=2*Math.asin(Math.min(1,available/(2*radii[i]))),lower=Math.max(minimum,value-angularBound),upper=Math.min(maximum,value+angularBound);
    feasibleMinimum=Math.max(feasibleMinimum,lower);
    requireThat(feasibleMinimum<=upper,'Directional fold cannot be unfolded within the detail tolerance after fixed sampling; increase detailToleranceMm or fixed sample count.');
    blocks.push({first:i,last:i,weight,sum:value*weight,lower,upper});
    while(blocks.length>1){
      const a=blocks.at(-2),b=blocks.at(-1);
      const mean=block=>Math.max(block.lower,Math.min(block.upper,block.sum/block.weight));
      if(mean(a)<=mean(b))break;
      blocks.splice(-2,2,{first:a.first,last:b.last,weight:a.weight+b.weight,sum:a.sum+b.sum,lower:Math.max(a.lower,b.lower),upper:Math.min(a.upper,b.upper)});
    }
  }
  const adjusted=[...angles];
  for(const block of blocks){
    const mean=Math.max(block.lower,Math.min(block.upper,block.sum/block.weight));
    for(let i=block.first;i<=block.last;i++)adjusted[i]=mean+prefix[i];
  }
  let angularAdjustmentMm=0,movedVertices=0;
  const loop=points.map((p,i)=>{
    const q=[anchor[0]+radii[i]*Math.cos(adjusted[i]),anchor[1]+radii[i]*Math.sin(adjusted[i])],d=distance(p,q);
    angularAdjustmentMm=Math.max(angularAdjustmentMm,d);if(d>1e-9)movedVertices++;return q;
  });
  const correspondenceErrorMm=samplingErrorMm+angularAdjustmentMm;
  // Corresponding edges are linear interpolations of paired endpoints. Thus
  // endpoint displacement bounds the whole-edge displacement, in both senses.
  requireThat(correspondenceErrorMm<=toleranceMm+1e-10,
    `Directional folds need ${correspondenceErrorMm.toFixed(6)} mm of contour adjustment, above detail tolerance ${toleranceMm} mm.`);
  let maxChordLogRadiusSlope=0;
  for(let i=0;i<loop.length;i++){
    const a=loop[i].map((v,k)=>v-anchor[k]),b=loop[(i+1)%loop.length].map((v,k)=>v-anchor[k]),e=b.map((v,k)=>v-a[k]);
    const denominator=a[0]*e[1]-a[1]*e[0];
    maxChordLogRadiusSlope=Math.max(maxChordLogRadiusSlope,Math.abs((a[0]*e[0]+a[1]*e[1])/denominator),Math.abs((b[0]*e[0]+b[1]*e[1])/denominator));
  }
  return {loop,report:{samples,samplingErrorMm,angularAdjustmentMm,correspondenceErrorMm,movedVertices,minimumAngleStep:step,logRadiusSlopeTarget,maxChordLogRadiusSlope}};
}

export function prepareRegularizedSleeveContact({curveAt,anchorAt,side='inside',toleranceMm=.05,samples=8192}){
  const report={regularizedSections:0,maxSamplingErrorMm:0,maxAngularAdjustmentMm:0,maxCorrespondenceErrorMm:0};
  const contact=prepareSleeveContact({side,anchorAt,loopsAt:z=>{
    const result=regularizeDirectionalContour(curveAt(z),anchorAt(z),{toleranceMm,samples});
    report.regularizedSections++;
    for(const [key,source] of [['maxSamplingErrorMm','samplingErrorMm'],['maxAngularAdjustmentMm','angularAdjustmentMm'],['maxCorrespondenceErrorMm','correspondenceErrorMm']])report[key]=Math.max(report[key],result.report[source]);
    return [result.loop];
  }});
  return {at:contact.at,report:()=>({...contact.report,...report})};
}
