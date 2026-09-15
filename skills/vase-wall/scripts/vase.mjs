// Section-derived spirals and sleeve-relative motifs share stroke semantics.
import {createSectionQuery} from '../../../core/geom/query.mjs';
import {cleanPlanarLoop} from '../../../core/geom/polyline.mjs';
import {loopArea,dedupe,pointSegmentDistance,pointInRegion} from '../../../core/region/region2d.mjs';
import {offsetRegion} from '../../../core/region/offset.mjs';
import {requireThat,distance} from '../../../core/geom/tolerance.mjs';
import {contourPath} from '../../../core/geom/contour-path.mjs';
import {depositionStroke,maximumPathAngle} from '../../../core/path/deposition.mjs';
import {mappedPatternResult} from './paths.mjs';

export const VASE_WALL_DEFAULTS={zStartMm:0,zEndMm:null,endTransition:'spiral',pattern:null,pathMode:'continuous',sampleStepMm:1,toleranceMm:0.02,boundaryToleranceMm:0.02,minFeatureMm:0.4,maxPoints:100000};
// Ten-nanometer integer grid: independent of contour/chord and boundary
// tolerances; shared Clipper2 offsets use this same grid by default.
const OFFSET_PRECISION_MM=0.00001;
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];

// Shared with skills/thick-lip: a rim finish freezes the same outer section
// vase-wall itself would have printed at the boundary Z, so it reuses this
// exact convexity/dedupe check rather than re-deriving it.
export function convexLoop(loops) {
  requireThat(loops.length===1&&loopArea(loops[0])>0,'Vase wall requires one outer section loop without holes or multiple islands.');
  const loop=dedupe(loops[0]);
  requireThat(loop.length>=3,'Vase wall section collapsed.');
  for(let i=0;i<loop.length;i++) {
    const a=sub(loop[(i+1)%loop.length],loop[i]),b=sub(loop[(i+2)%loop.length],loop[(i+1)%loop.length]);
    requireThat(cross(a,b)>=-1e-7*Math.hypot(...a)*Math.hypot(...b),'Vase wall currently requires convex sections; concave sections are unsupported.');
  }
  return loop;
}
function motifContour(outer,toleranceMm){
  // Start simplification at a geometric extreme, not an arbitrary triangle
  // seam that can slide along an edge as Z changes.
  let first=0;
  for(let i=1;i<outer.length;i++)if(outer[i][0]>outer[first][0]||(outer[i][0]===outer[first][0]&&outer[i][1]<outer[first][1]))first=i;
  outer=[...outer.slice(first),...outer.slice(0,first)];
  // Remove triangle seams before and after grid rounding. Otherwise rounding
  // a collinear split introduces a tiny corner that an inward offset amplifies.
  outer=cleanPlanarLoop(outer,toleranceMm);
  const origin=outer.reduce((a,p)=>a.map((v,k)=>Math.min(v,p[k])),[Infinity,Infinity]);
  const gridded=outer.map(p=>p.map((v,k)=>origin[k]+Math.round((v-origin[k])/OFFSET_PRECISION_MM)*OFFSET_PRECISION_MM));
  return cleanPlanarLoop(gridded,toleranceMm);
}
const pointInLoop=(p,loop)=>pointInRegion(p,[loop]);
function outerLoop(loops) {
  const outers=loops.filter(loop=>loopArea(loop)>0);
  requireThat(outers.length===1&&loops.length<=2,'Vase wall requires one outer section of a solid or closed sleeve, without multiple islands or multiple bores.');
  const loop=dedupe(outers[0]);
  requireThat(loop.length>=3,'Vase wall section collapsed.');
  return loop;
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
  const cache=new Map();let seam,nudgedSections=0,lastContours,lastValue,sectionQueries=0;
  const cacheSection=(key,value)=>{
    // Motifs revisit heights, but keeping every distinct height plus all its
    // offset contours makes memory grow with the entire print.
    if(settings.pattern&&cache.size>=256)cache.delete(cache.keys().next().value);
    cache.set(key,value);return value;
  };
  const sectionAt=createSectionQuery(shell,{minFeatureMm:settings.minFeatureMm});
  function section(z) {
    const key=z.toFixed(10);if(cache.has(key))return cache.get(key);
    if(sectionQueries>=maxSectionQueries)exhausted('section query',sectionQueries,maxSectionQueries,z);
    sectionQueries++;
    const cut=sectionAt(z);
    requireThat(Math.abs(cut.nudgedByMm??0)<=settings.boundaryToleranceMm,'Vase section nudge exceeds boundaryToleranceMm.');
    if(cut.nudgedByMm)nudgedSections++;
    // Straight walls repeat the same section at many distinct heights. Reuse
    // its construction only after comparing every coordinate exactly; changing
    // sections still construct their own offsets and arc-length correspondence.
    if(lastContours&&cut.loops.length===lastContours.length&&cut.loops.every((loop,i)=>
      loop.length===lastContours[i].length&&loop.every((p,j)=>p[0]===lastContours[i][j][0]&&p[1]===lastContours[i][j][1]))){
      return cacheSection(key,lastValue);
    }
    const rawOuter=outerLoop(cut.loops),outer=settings.pattern?motifContour(rawOuter,Math.min(settings.toleranceMm,settings.boundaryToleranceMm)/4):rawOuter;
    const offsetLoops=offsetRegion([outer],-width/2,{precisionMm:OFFSET_PRECISION_MM,arcToleranceMm:settings.boundaryToleranceMm/4});
    // A motif follows only the outer boundary. Interior offset holes do not
    // supply another wall; multiple outer components still cannot be mapped.
    const inset=settings.pattern?offsetLoops.filter(loop=>loopArea(loop)>0):offsetLoops;
    requireThat(inset.length===1&&loopArea(inset[0])>0,`Vase wall inward offset is empty, split or collapsed at Z ${z} mm for bead width ${width} mm.`);
    const loop=dedupe(inset[0]);
    requireThat(loop.length>=3,'Vase wall section collapsed.');
    const curve=contourPath(loop,seam);
    // Keep the projection anchor outside every section. The first seam itself
    // can lie inside later, expanding contours, where its nearest projection
    // switches between opposite edges of a corner and makes phase discontinuous.
    // A +X anchor preserves the initial maximum-X seam and remains exterior as
    // the wall changes height. Offset motifs translate this same anchor below.
    seam??=[shell.bounds.max[0]+width,curve.seam[1]];
    const holes=cut.loops.filter(loop=>loopArea(loop)<0);
    const value={outer,loop,curve,holes};lastContours=cut.loops;lastValue=value;return cacheSection(key,value);
  }
  section(start);
  // t=0..1 is a flat foundation ring; subsequent turns rise by exactly pitch.
  const spiralTurns=1+(end-start)/pitch,turns=spiralTurns+(settings.endTransition==='level'?1:0);
  const zAt=t=>t<=1?start:Math.min(end,start+(t-1)*pitch);
  // The ordinary single-wall centerline: one point per turn-position `t`,
  // queried directly against the actual host section. This is the only
  // place any print in this function reads section/offset geometry from the
  // mesh; everything below (the plain wall, and a motif's guide path) reuses
  // its already-converged points instead of re-deriving contours per sample.
  function exactPoint(u,z) {
    const {curve,outer,holes}=section(z),xy=curve.at(u);
    const standoff=outer.reduce((best,p,i)=>Math.min(best,pointSegmentDistance(xy,p,outer[(i+1)%outer.length])),Infinity);
    requireThat(Math.abs(standoff-width/2)<=settings.boundaryToleranceMm,'Vase centerline does not preserve the declared bead-width boundary within boundaryToleranceMm.');
    for(const hole of holes)requireThat(!pointInLoop(xy,hole)&&hole.every((p,i)=>pointSegmentDistance(xy,p,hole[(i+1)%hole.length])>=width/2-settings.boundaryToleranceMm),'Sleeve material is too thin for the selected bead width.');
    return [...xy,z];
  }
  const mappedPoint=t=>exactPoint(t,zAt(t));
  function buildCenterline(upperTurns,chordToleranceMm=settings.toleranceMm/2,sampleStepMm=settings.sampleStepMm) {
    const points=[mappedPoint(0)],times=[0];
    function append(a,b,pa,pb,depth=0) {
      requireThat(depth<24,'Vase contour cannot meet the locked chord tolerance within the subdivision limit.');
      const mid=(a+b)/2,pm=mappedPoint(mid),linear=pa.map((v,i)=>(v+pb[i])/2);
      if(distance(pa,pb)>sampleStepMm||distance(pm,linear)>chordToleranceMm||pb[2]-pa[2]>settings.minFeatureMm/2) {
        append(a,mid,pa,pm,depth+1);append(mid,b,pm,pb,depth+1);return;
      }
      if(points.length>=settings.maxPoints)exhausted('point',points.length,settings.maxPoints,pb[2]);
      points.push(pb);times.push(b);
    }
    // At most 1/16 turn per initial interval avoids aliasing an entire revolution.
    for(let t=0;t<upperTurns-1e-10;) {
      const next=Math.min(upperTurns,t<spiralTurns-1e-10?spiralTurns:Infinity,(Math.floor(t*16+1e-8)+1)/16);
      append(t,next,points.at(-1),mappedPoint(next));t=next;
    }
    return {points,times};
  }
  if(settings.pattern!==null){
    // Build the guide only as far as the motif's own authored turn range
    // actually reaches, with margin for a loop that locally runs backward or
    // ahead of its course boundary before returning to it — not the full
    // wall height's turn count, which can be far more than a motif with few
    // repeats ever samples.
    const authoredTurns=settings.pattern.paths.flatMap(p=>p.points.map(pt=>pt[0]));
    const guideTurns=settings.pattern.repeats+Math.max(1,...authoredTurns.map(Math.abs));
    const {points:guidePoints,times:guideTimes}=buildCenterline(guideTurns);
    // A per-vertex normal blended from both adjacent segments (not either
    // segment's own exact direction) so a motif offset varies smoothly along
    // the guide instead of jumping at each vertex the way a true polygon
    // offset would round with an arc. Pure vector math on the already-built
    // guide points; no further section query or offset reconstruction.
    const guideNormals=guidePoints.map((p,i)=>{
      const prev=guidePoints[Math.max(0,i-1)],next=guidePoints[Math.min(guidePoints.length-1,i+1)];
      const dx=next[0]-prev[0],dy=next[1]-prev[1],len=Math.hypot(dx,dy);
      return len?[dy/len,-dx/len]:[0,0];
    });
    return mappedPatternResult({settings,process,machine,id,after,base,start,end,firstHeight,exactPoint,
      guide:{points:guidePoints,times:guideTimes,normals:guideNormals},budgetSetting,
      sectionReport:()=>({sectionQueries,maxSectionQueries,nudgedSections,offsetPrecisionMm:OFFSET_PRECISION_MM})});
  }
  const {points,times}=buildCenterline(turns);
  const lengths=points.slice(1).map((p,i)=>distance(points[i],p)),turnLengths=new Map();
  const maximumAngleDeg=maximumPathAngle(points);
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
  const heightsMm=lengths.map((length,i)=>{
    const middle=(times[i]+times[i+1])/2;
    return times[i+1]<=1+1e-9?firstHeight:zAt(middle)-zAt(middle-1);
  });
  const stroke=depositionStroke({role:'vase-wall',points,heightsMm,widthMm:width,speedMmS:speed,
    segmentMetadata:times.slice(1).map((t,i)=>({layer:Math.floor((times[i]+t)/2)}))});
  const volumesMm3=stroke.volumesMm3;
  return {id,operations:[{id:id+':wall',layerId:id+':continuous',phase:'vase-wall',layer:0,rank:start,
    after,strokes:[stroke],order:'given',continuous:true,fanPercent:process.fanPercent,
    travelPolicy:{maxCombMm:0,clearanceFor:()=>end+process.liftMm},clearanceZ:end+process.liftMm}],
    report:{startMm:start,endMm:end,baseTopMm:base,turns,spiralTurns,endTransition:settings.endTransition,levelRimMm:settings.endTransition==='level'?end:null,points:points.length,maxPoints:settings.maxPoints,sectionQueries,maxSectionQueries,nudgedSections,offsetPrecisionMm:OFFSET_PRECISION_MM,
      volumeMm3:volumesMm3.reduce((sum,v)=>sum+v,0),speedMmS:speed,maximumAngleDeg,
      scope:'One outer section with arc-length correspondence from a fixed projected seam; concavity is supported while the inset remains one loop. Sampled topology and boundary checks; no physical validation.'}};
}
