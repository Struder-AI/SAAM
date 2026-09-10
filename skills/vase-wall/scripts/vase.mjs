// One continuous wall from the shared geometry section query. Polar phase is
// fixed about one interior point; section vertex ordering never controls seams.
import {createSectionQuery} from '../../../core/geom/query.mjs';
import {loopArea,pointInRegion,dedupe,pointSegmentDistance} from '../../../core/region/region2d.mjs';
import {offsetRegion} from '../../../core/region/offset.mjs';
import {requireThat,distance} from '../../../core/geom/tolerance.mjs';

export const VASE_WALL_DEFAULTS={zStartMm:0,zEndMm:null,endTransition:'spiral',sampleStepMm:1,toleranceMm:0.02,boundaryToleranceMm:0.02,minFeatureMm:0.4,maxPoints:100000};
// Ten-nanometer integer grid: independent of contour/chord and boundary
// tolerances, and avoids Clipper's large-integer path for ordinary part sizes.
const OFFSET_PRECISION_MM=0.00001;
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];

function convexLoop(loops) {
  requireThat(loops.length===1&&loopArea(loops[0])>0,'Vase wall requires one outer section loop without holes or multiple islands.');
  const loop=dedupe(loops[0]);
  requireThat(loop.length>=3,'Vase wall section collapsed.');
  for(let i=0;i<loop.length;i++) {
    const a=sub(loop[(i+1)%loop.length],loop[i]),b=sub(loop[(i+2)%loop.length],loop[(i+1)%loop.length]);
    requireThat(cross(a,b)>=-1e-7*Math.hypot(...a)*Math.hypot(...b),'Vase wall currently requires convex sections; concave sections are unsupported.');
  }
  return loop;
}

function rayPoint(loop,center,angle) {
  const direction=[Math.cos(angle),Math.sin(angle)];let radius=Infinity;
  for(let i=0;i<loop.length;i++) {
    const a=loop[i],edge=sub(loop[(i+1)%loop.length],a),den=cross(direction,edge);
    if(Math.abs(den)<1e-12)continue;
    const delta=sub(a,center),t=cross(delta,edge)/den,u=cross(delta,direction)/den;
    if(t>0&&u>=-1e-9&&u<=1+1e-9)radius=Math.min(radius,t);
  }
  requireThat(Number.isFinite(radius),'Vase wall lost its fixed interior phase origin.');
  return [center[0]+radius*direction[0],center[1]+radius*direction[1]];
}

export function vaseWallResult({shell,plan,machine,id='vase-wall',after=[],zStartMm=null,zEndMm=null,budgetSetting='skills.vase-wall.maxPoints'}) {
  const settings={...VASE_WALL_DEFAULTS,...plan.skills['vase-wall']},process=plan.process;
  const width=process.lineWidthMm,pitch=process.layerMm,base=zStartMm??(shell.bounds.min[2]+settings.zStartMm);
  const firstHeight=Math.abs(base-shell.bounds.min[2])<1e-9?process.firstLayerMm:pitch;
  const start=base+firstHeight,end=zEndMm??(settings.zEndMm===null?shell.bounds.max[2]:shell.bounds.min[2]+settings.zEndMm);
  requireThat(base>=shell.bounds.min[2]&&end<=shell.bounds.max[2]+1e-9&&end>start+1e-9,'Vase wall needs room for its first ring and a rising wall; choose zStartMm/zEndMm inside the geometry.');
  requireThat(settings.boundaryToleranceMm<width/4,'Vase boundaryToleranceMm must be smaller than one quarter of the bead width.');
  const maxSectionQueries=Math.min(Number.MAX_SAFE_INTEGER,settings.maxPoints*4);
  function exhausted(kind,used,limit,z) {
    const next=Math.min(Number.MAX_SAFE_INTEGER,settings.maxPoints*2);
    throw new Error(`Vase ${kind} budget exhausted for ${id}: ${used}/${limit} at Z ${z.toFixed(6)} mm (wall ${start.toFixed(6)}–${end.toFixed(6)} mm). Increase ${budgetSetting} from ${settings.maxPoints} to ${next} or higher and retry; this changes the compute allowance, not contour quality. No complete wall was generated.`);
  }
  const cache=new Map();let center,nudgedSections=0;
  const sectionAt=createSectionQuery(shell,{minFeatureMm:settings.minFeatureMm});
  function section(z) {
    const key=z.toFixed(10);if(cache.has(key))return cache.get(key);
    if(cache.size>=maxSectionQueries)exhausted('section query',cache.size,maxSectionQueries,z);
    const cut=sectionAt(z);
    requireThat(Math.abs(cut.nudgedByMm??0)<=settings.boundaryToleranceMm,'Vase section nudge exceeds boundaryToleranceMm.');
    if(cut.nudgedByMm)nudgedSections++;
    const outer=convexLoop(cut.loops),inset=offsetRegion([outer],-width/2,{precisionMm:OFFSET_PRECISION_MM,arcToleranceMm:settings.boundaryToleranceMm/4});
    requireThat(inset.length===1&&loopArea(inset[0])>0,`Vase wall inward offset is empty, split or collapsed at Z ${z.toFixed(6)} mm for bead width ${width} mm.`);
    // Eroding a convex region preserves convexity. Rechecking every inset
    // corner rejects harmless integer-grid rounding near collinear vertices.
    // Keep collapse, common-origin and sampled standoff checks below.
    const loop=dedupe(inset[0]);
    requireThat(loop.length>=3,'Vase wall section collapsed.');
    center??=loop.reduce((sum,p)=>[sum[0]+p[0]/loop.length,sum[1]+p[1]/loop.length],[0,0]);
    requireThat(pointInRegion(center,[loop]),'Vase sections must retain a common interior origin; section collapse, major drift or topology change is unsupported.');
    const value={outer,loop};cache.set(key,value);return value;
  }
  section(start);
  // t=0..1 is a flat foundation ring; subsequent turns rise by exactly pitch.
  const spiralTurns=1+(end-start)/pitch,turns=spiralTurns+(settings.endTransition==='level'?1:0);
  const zAt=t=>t<=1?start:Math.min(end,start+(t-1)*pitch);
  function point(t) {
    const z=zAt(t),{loop,outer}=section(z),xy=rayPoint(loop,center,t*2*Math.PI);
    const standoff=outer.reduce((best,p,i)=>Math.min(best,pointSegmentDistance(xy,p,outer[(i+1)%outer.length])),Infinity);
    requireThat(Math.abs(standoff-width/2)<=settings.boundaryToleranceMm,'Vase centerline does not preserve the declared bead-width boundary within boundaryToleranceMm.');
    return [...xy,z];
  }
  const points=[point(0)],times=[0];
  function append(a,b,pa,pb,depth=0) {
    requireThat(depth<24,'Vase contour cannot meet the locked chord tolerance within the subdivision limit.');
    const mid=(a+b)/2,pm=point(mid),linear=pa.map((v,i)=>(v+pb[i])/2);
    if(distance(pa,pb)>settings.sampleStepMm||distance(pm,linear)>settings.toleranceMm/2||pb[2]-pa[2]>settings.minFeatureMm/2) {
      append(a,mid,pa,pm,depth+1);append(mid,b,pm,pb,depth+1);return;
    }
    if(points.length>=settings.maxPoints)exhausted('point',points.length,settings.maxPoints,pb[2]);
    points.push(pb);times.push(b);
  }
  // At most 1/16 turn per initial interval avoids aliasing an entire revolution.
  for(let t=0;t<turns-1e-10;) {
    const next=Math.min(turns,t<spiralTurns-1e-10?spiralTurns:Infinity,(Math.floor(t*16+1e-8)+1)/16);
    append(t,next,points.at(-1),point(next));t=next;
  }
  const lengths=points.slice(1).map((p,i)=>distance(points[i],p)),turnLengths=new Map();
  const maximumAngleDeg=points.slice(1).reduce((best,p,i)=>Math.max(best,Math.atan2(p[2]-points[i][2],Math.hypot(p[0]-points[i][0],p[1]-points[i][1]))*180/Math.PI),0);
  requireThat(Number.isFinite(machine?.nonplanar?.maxAngleDeg)&&maximumAngleDeg<=machine.nonplanar.maxAngleDeg+1e-8,'Vase wall rise exceeds the machine declared non-planar angle limit.');
  for(let i=0;i<lengths.length;i++) {
    const turn=Math.floor((times[i]+times[i+1])/2);turnLengths.set(turn,(turnLengths.get(turn)??0)+lengths[i]);
  }
  // One speed for the entire uninterrupted stroke; use the shortest full turn
  // to meet minimum cooling time by slowing deposition, never parking per turn.
  const completeLengths=[...turnLengths].filter(([turn])=>turn+1<=turns+1e-9).map(([,length])=>length);
  const speed=Math.min(process.planarSpeedMmS,process.firstLayerSpeedMmS,
    process.minimumLayerSeconds>0?Math.min(...completeLengths)/process.minimumLayerSeconds:Infinity);
  // Over the foundation ring the first rising turn fills only the local gap:
  // its thickness ramps from zero to pitch, avoiding a doubled first bead.
  const volumesMm3=lengths.map((length,i)=>{
    const middle=(times[i]+times[i+1])/2;
    return length*width*(times[i+1]<=1+1e-9?firstHeight:zAt(middle)-zAt(middle-1));
  });
  const stroke={role:'vase-wall',closed:false,points,volumesMm3,speedMmS:speed,
    segmentMetadata:times.slice(1).map((t,i)=>({layer:Math.floor((times[i]+t)/2)}))};
  return {id,operations:[{id:id+':wall',layerId:id+':continuous',phase:'vase-wall',layer:0,rank:start,
    after,strokes:[stroke],order:'given',continuous:true,fanPercent:process.fanPercent,
    travelPolicy:{maxCombMm:0,clearanceFor:()=>end+process.liftMm},clearanceZ:end+process.liftMm}],
    report:{startMm:start,endMm:end,baseTopMm:base,turns,spiralTurns,endTransition:settings.endTransition,levelRimMm:settings.endTransition==='level'?end:null,points:points.length,maxPoints:settings.maxPoints,sectionQueries:cache.size,maxSectionQueries,nudgedSections,offsetPrecisionMm:OFFSET_PRECISION_MM,
      volumeMm3:volumesMm3.reduce((sum,v)=>sum+v,0),speedMmS:speed,maximumAngleDeg,
      scope:'One convex outer section with a persistent interior origin; sampled topology and boundary checks. Overhang and bridging are process choices reviewed in Studio; no physical validation.'}};
}
