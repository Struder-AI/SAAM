// Section-derived spirals and sleeve-relative patterns share stroke semantics.
import {createSectionQuery} from '../geom/query.mjs';
import {cleanPlanarLoop} from '../geom/polyline.mjs';
import {loopArea,dedupe,pointSegmentDistance,pointInRegion} from '../region/region2d.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {requireThat,distance} from '../geom/tolerance.mjs';
import {contourPath} from '../geom/contour-path.mjs';
import {depositCurves,maximumPathAngle,trimVanishingEnd} from '../path/deposition.mjs';
import {spiralProfile,spiralHeight,spiralBeadCurve} from '../path/curve-construction.mjs';
import {mappedSleevePatternResult} from '../path/sleeve-pattern.mjs';
import {prepareContourFamily} from '../geom/prepared-contours.mjs';
import {createFittedSleeveReference,createAutomaticSleeveReference} from '../geom/sleeve-reference.mjs';
import {validateSleevePattern} from '../path/sleeve-pattern.mjs';
import {section as geometrySection,horizontalSlice} from '../geom/slice.mjs';
import {planarPolicy} from '../path/builder.mjs';
import {depositedCurveSegments,curveSupportsPoint} from '../path/deposited-curves.mjs';

export const SLEEVE_DEFAULTS={zStartMm:0,zEndMm:null,endTransition:'level',pattern:null,pathMode:'continuous',meshSleeve:null,sampleStepMm:1,toleranceMm:0.02,boundaryToleranceMm:0.02,minFeatureMm:0.4,sleeveToleranceMm:0.08};
export const sleeveAssignment=({id,...options})=>structuredClone({id,construction:'sleeve',part:null,filament:null,process:null,after:[],...SLEEVE_DEFAULTS,...options});
export const RIM_DEFAULTS={steps:[2],minFeatureMm:.4};
export const rimAssignment=({id,...options})=>structuredClone({id,construction:'rim',part:null,filament:null,process:null,after:[],source:null,...RIM_DEFAULTS,...options});

export function validateRimAssignment(a,{parts}={}){
  requireThat(a&&a.construction==='rim'&&Object.keys(a).sort().join()===Object.keys(rimAssignment({id:a.id})).sort().join(),'Invalid rim assignment fields.');
  requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id),'Invalid rim assignment id.');
  requireThat(a.part===null||parts?.includes(a.part),'Rim names an unknown part.');
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Rim filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Rim after lists operation ids.');
  requireThat(typeof a.source==='string'&&/^[a-z][a-z0-9-]*$/.test(a.source)&&a.source!==a.id,'Rim source names a separate sleeve assignment.');
  requireThat(Array.isArray(a.steps)&&a.steps.length>=1&&a.steps.length<=50&&a.steps.every(n=>Number.isInteger(n)&&n>=1),'Rim steps need 1–50 entries, each a positive whole number of loops.');
  requireThat(Number.isFinite(a.minFeatureMm)&&a.minFeatureMm>=.05&&a.minFeatureMm<=5,'Rim minimum section feature must be .05–5 mm.');
}

export function validateSleeveAssignment(a,{parts}={}){
  requireThat(a&&a.construction==='sleeve'&&Object.keys(a).sort().join()===Object.keys(sleeveAssignment({id:a.id})).sort().join(),'Invalid sleeve assignment fields.');
  requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id),'Invalid sleeve assignment id.');
  requireThat(a.part===null||parts?.includes(a.part),'Sleeve names an unknown part.');
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Sleeve filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Sleeve after lists operation ids.');
  requireThat(['continuous','segmented'].includes(a.pathMode),'Sleeve path mode must be continuous or segmented.');
  validateSleevePattern(a.pattern,a.pathMode);
  requireThat(a.pattern!==null||a.pathMode==='continuous','Segmented mode requires a sleeve pattern.');
  requireThat(['spiral','level'].includes(a.endTransition),'Sleeve ending transition must be spiral or level.');
  requireThat(Number.isFinite(a.zStartMm)&&a.zStartMm>=0&&(a.zEndMm===null||Number.isFinite(a.zEndMm)&&a.zEndMm>a.zStartMm),'Sleeve needs nonnegative start and null or greater end height.');
  const bounds={sampleStepMm:[.1,5],toleranceMm:[.002,.05],boundaryToleranceMm:[.002,.05],minFeatureMm:[.05,5],sleeveToleranceMm:[0,.5]};
  for(const [key,[low,high]] of Object.entries(bounds))requireThat(Number.isFinite(a[key])&&a[key]>=low&&a[key]<=high,`Sleeve ${key} must be ${low}–${high}.`);
  if(a.meshSleeve===null)return;
  const fit=a.meshSleeve;
  requireThat(fit&&Object.keys(fit).sort().join()==='circumferentialControls,contactSide,detailToleranceMm,fidelity,heightControls','Invalid mesh sleeve settings.');
  requireThat(Number.isFinite(fit.fidelity)&&fit.fidelity>=0&&fit.fidelity<=1&&['inside','outside'].includes(fit.contactSide),'Mesh sleeve needs fidelity 0–1 and inside/outside contact.');
  requireThat(Number.isInteger(fit.circumferentialControls)&&fit.circumferentialControls>=8&&fit.circumferentialControls<=48&&Number.isInteger(fit.heightControls)&&fit.heightControls>=4&&fit.heightControls<=32,'Mesh sleeve controls must be 8–48 circumferential and 4–32 along height.');
  requireThat(Number.isFinite(fit.detailToleranceMm)&&fit.detailToleranceMm>=.005&&fit.detailToleranceMm<=.5,'Mesh sleeve detail tolerance must be .005–.5 mm.');
}
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
function patternContour(outer,toleranceMm){
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

export function sleeveResult({shell,assignment,process,machine,id=assignment.id,after=assignment.after,zStartMm=null,zEndMm=null,onProgress}) {
  const settings=assignment;
  const width=process.lineWidthMm,pitch=process.layerMm,base=zStartMm??(shell.bounds.min[2]+settings.zStartMm);
  const firstHeight=Math.abs(base-shell.bounds.min[2])<1e-9?process.firstLayerMm:pitch;
  const start=base+firstHeight,end=zEndMm??(settings.zEndMm===null?shell.bounds.max[2]:shell.bounds.min[2]+settings.zEndMm);
  requireThat(base>=shell.bounds.min[2]&&end<=shell.bounds.max[2]+1e-9&&end>start+1e-9,'Vase wall needs room for its first ring and a rising wall; choose zStartMm/zEndMm inside the geometry.');
  requireThat(settings.boundaryToleranceMm<width/4,'Vase boundaryToleranceMm must be smaller than one quarter of the bead width.');
  // The wall takes as many points and section queries as its geometry, pitch
  // and tolerances require: turns are finite and each interval subdivides until
  // its midpoint stops being distinct from its ends, so there is no
  // construction cap to exhaust. Memory scales
  // with the emitted program like every other skill's output.
  const cache=new Map();let seam,nudgedSections=0,lastContours,lastValue,sectionQueries=0;
  const cacheSection=(key,value)=>{
    // Keeping every distinct height plus all its offset contours would make
    // memory grow with the entire print. The spiral visits heights in order
    // and patterns revisit only recent ones, so a short window suffices.
    if(cache.size>=256)cache.delete(cache.keys().next().value);
    cache.set(key,value);return value;
  };
  const reference=createFittedSleeveReference({shell,settings,start,end,width,onProgress})
    ??(settings.pattern===null?createAutomaticSleeveReference({shell,settings,start,end,width,onProgress}):null);
  const centerlineOffset=reference&&settings.meshSleeve?.contactSide==='outside'?width/2:-width/2;
  const sectionAt=reference?.sectionAt??createSectionQuery(shell,{minFeatureMm:settings.minFeatureMm});
  function section(z) {
    const key=z.toFixed(10);if(cache.has(key))return cache.get(key);
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
    // Fitted spline sections already have chord-controlled contours. A second,
    // coarser per-height RDP pass can switch retained vertices discontinuously
    // and defeat the tighter prepared-map allowance, forcing thousands of
    // offset rebuilds. Keep its original contour; mesh cuts still need removal
    // of collinear triangle seams before quantization and offsets: a raw
    // tessellation seam is a near-collinear step that an inward offset can split
    // off as a degenerate sliver, leaving the inset with two loops. Patterns
    // re-anchor and grid-round for phase stability through patternContour; the
    // standard wall only needs the seam removed. Fitted-sleeve and native spline
    // cuts are already chord-controlled and keep their exact contour.
    const rawOuter=outerLoop(cut.loops),seamTolerance=Math.min(settings.toleranceMm,settings.boundaryToleranceMm)/4;
    const meshCut=!reference&&shell.kind==='triangle-mesh';
    const outer=settings.pattern&&!reference?patternContour(rawOuter,seamTolerance):meshCut?cleanPlanarLoop(rawOuter,seamTolerance):rawOuter;
    const offsetLoops=offsetRegion([outer],centerlineOffset,{precisionMm:OFFSET_PRECISION_MM,arcToleranceMm:settings.boundaryToleranceMm/4});
    // A pattern follows only the outer boundary. Interior offset holes do not
    // supply another wall; multiple outer components still cannot be mapped.
    const inset=settings.pattern?offsetLoops.filter(loop=>loopArea(loop)>0):offsetLoops;
    requireThat(inset.length===1&&loopArea(inset[0])>0,`Vase wall ${centerlineOffset<0?'inward':'outward'} offset is empty, split or collapsed at Z ${z} mm for bead width ${width} mm.`);
    const loop=dedupe(inset[0]);
    requireThat(loop.length>=3,'Vase wall section collapsed.');
    const curve=contourPath(loop,seam);
    // Keep the projection anchor outside every section. The first seam itself
    // can lie inside later, expanding contours, where its nearest projection
    // switches between opposite edges of a corner and makes phase discontinuous.
    // A +X anchor preserves the initial maximum-X seam and remains exterior as
    // the wall changes height. Offset patterns translate this same anchor below.
    seam??=[shell.bounds.max[0]+width,curve.seam[1]];
    const holes=cut.loops.filter(loop=>loopArea(loop)<0);
    const value={outer,loop,curve,holes};lastContours=cut.loops;lastValue=value;return cacheSection(key,value);
  }
  if(!reference)section(start);
  // t=0..1 is a flat foundation ring; subsequent turns rise by exactly pitch.
  const profile=spiralProfile({startMm:start,endMm:end,pitchMm:pitch,firstHeightMm:firstHeight,levelEnd:settings.endTransition==='level'});
  const spiralTurns=profile.risingTurns,turns=profile.turns;
  const zAt=t=>spiralHeight(profile,t);
  const offsetCurves=new WeakMap();
  function mappedPoint(u,z,offsetMm=0) {
    const frame=section(z),{curve,outer,holes}=frame,xy=curve.at(u);
    const standoff=outer.reduce((best,p,i)=>Math.min(best,pointSegmentDistance(xy,p,outer[(i+1)%outer.length])),Infinity);
    requireThat(Math.abs(standoff-width/2)<=settings.boundaryToleranceMm,'Vase centerline does not preserve the declared bead-width boundary within boundaryToleranceMm.');
    for(const hole of holes)requireThat(!pointInLoop(xy,hole)&&hole.every((p,i)=>pointSegmentDistance(xy,p,hole[(i+1)%hole.length])>=width/2-settings.boundaryToleranceMm),'Sleeve material is too thin for the selected bead width.');
    if(offsetMm!==0){
      let curves=offsetCurves.get(frame);if(!curves){curves=new Map();offsetCurves.set(frame,curves);}
      let parallel=curves.get(offsetMm);
      if(!parallel){
        const loops=offsetRegion([outer],offsetMm+centerlineOffset,{precisionMm:OFFSET_PRECISION_MM,arcToleranceMm:settings.boundaryToleranceMm/4}).filter(loop=>loopArea(loop)>0);
        requireThat(loops.length===1&&loopArea(loops[0])>0,`Pattern offset contour split or collapsed at Z ${z} mm, offset ${offsetMm} mm; revise offsetMm or the host.`);
        parallel=contourPath(dedupe(loops[0]),[seam[0]+offsetMm,seam[1]]);
        if(curves.size>=32)curves.delete(curves.keys().next().value);
        curves.set(offsetMm,parallel);
      }
      return [...parallel.at(u),z];
    }
    return [...xy,z];
  }
  if(settings.pattern!==null){
    if(reference)return mappedSleevePatternResult({settings,process,machine,id,after,base,start,end,firstHeight,
      referenceLengthMm:reference.referenceLengthMm,mappedPoint:(u,z,offset)=>reference.map(reference.pointAt(u,z,offset)),
      mappingErrorMm:reference.mappingErrorMm,onProgress,sectionReport:()=>({sectionQueries:0,nudgedSections:0,...reference.report()})});
    const validatedFrames=new WeakSet();
    const curveAt=(z,offset)=>{
      const frame=section(z);
      if(!validatedFrames.has(frame)){
        for(const u of frame.curve.knots())mappedPoint(u,z,0);
        validatedFrames.add(frame);
      }
      if(offset===0)return frame.curve;
      mappedPoint(0,z,offset);
      return offsetCurves.get(frame).get(offset);
    };
    const mappingErrorMm=Math.min(settings.toleranceMm,settings.boundaryToleranceMm)/8;
    const prepared=prepareContourFamily({curveAt,startMm:start,endMm:end,stepMm:settings.minFeatureMm,toleranceMm:mappingErrorMm});
    return mappedSleevePatternResult({settings,process,machine,id,after,base,start,end,firstHeight,referenceLengthMm:section(start).curve.length,
      mappedPoint:(u,z,offset)=>{const p=[...prepared.at(u,z,offset),z];return reference?reference.map(p):p;},mappingErrorMm,onProgress,
      sectionReport:()=>({sectionQueries,nudgedSections,offsetPrecisionMm:OFFSET_PRECISION_MM,...prepared.report(),...reference?.report()})});
  }
  const point=t=>reference?reference.map(reference.pointAt(t,zAt(t),0)):mappedPoint(t,zAt(t));
  const points=[point(0)],times=[0];
  function append(a,b,pa,pb) {
    const mid=(a+b)/2,pm=point(mid),linear=pa.map((v,i)=>(v+pb[i])/2);
    if(distance(pa,pb)>settings.sampleStepMm||distance(pm,linear)>settings.toleranceMm/2||pb[2]-pa[2]>settings.minFeatureMm/2) {
      requireThat(mid>a&&mid<b,'Vase contour cannot meet the locked chord tolerance: the subdivided turn midpoint is no longer distinct from its ends.');
      append(a,mid,pa,pm);append(mid,b,pm,pb);return;
    }
    points.push(pb);times.push(b);
  }
  // At most 1/16 turn per initial interval avoids aliasing an entire revolution.
  for(let t=0;t<turns-1e-10;) {
    const next=Math.min(turns,t<spiralTurns-1e-10?spiralTurns:Infinity,(Math.floor(t*16+1e-8)+1)/16);
    append(t,next,points.at(-1),point(next));t=next;
  }
  const maximumAngleDeg=maximumPathAngle(points);
  requireThat(Number.isFinite(machine?.nonplanar?.maxAngleDeg)&&maximumAngleDeg<=machine.nonplanar.maxAngleDeg+1e-8,'Vase wall rise exceeds the machine declared non-planar angle limit.');
  const curve=spiralBeadCurve({profile,points,turns:times,role:'vase-wall',speedMmS:Math.min(process.planarSpeedMmS,process.firstLayerSpeedMmS),
    minimumTurnSeconds:process.minimumLayerSeconds});
  const speed=curve.speedMmS;
  const [depositedStroke]=depositCurves([curve],{widthMm:width});
  const stroke=settings.endTransition==='level'?trimVanishingEnd(depositedStroke):depositedStroke;
  const volumesMm3=stroke.volumesMm3,strokeTimes=times.slice(0,stroke.points.length);
  const rimStart=settings.endTransition==='level'?strokeTimes.findIndex(t=>t>=spiralTurns-1e-9):-1;
  const levelBoundary=rimStart>=0?{zMm:end,widthMm:width,strokes:[{...stroke,points:stroke.points.slice(rimStart),
    volumesMm3:volumesMm3.slice(rimStart),segmentMetadata:stroke.segmentMetadata.slice(rimStart)}]}:null;
  return {id,...(levelBoundary?{levelBoundary}:{}),operations:[{id:id+':wall',layerId:id+':continuous',phase:'vase-wall',layer:0,rank:start,
    after,strokes:[stroke],order:'given',continuous:true,fanPercent:process.fanPercent,
    travelPolicy:{maxCombMm:0,clearanceFor:()=>end+process.liftMm}}],
    report:{startMm:start,endMm:end,baseTopMm:base,turns,spiralTurns,endTransition:settings.endTransition,levelRimMm:settings.endTransition==='level'?end:null,points:stroke.points.length,sectionQueries,nudgedSections,offsetPrecisionMm:OFFSET_PRECISION_MM,
      volumeMm3:volumesMm3.reduce((sum,v)=>sum+v,0),speedMmS:speed,maximumAngleDeg,...reference?.report(),
      scope:'One outer section with arc-length correspondence from a fixed projected seam; concavity is supported while the inset remains one loop. Sampled topology and boundary checks; no physical validation.'}};
}


export function rimResult({shell,assignment,process,sourceAssignment,sourceResult}) {
  const settings=assignment,width=process.lineWidthMm,id=assignment.id;
  requireThat(sourceAssignment?.id===assignment.source&&sourceAssignment.construction==='sleeve'&&sourceAssignment.part===assignment.part,'A rim must name a sleeve assignment on the same part.');
  requireThat(sourceResult?.levelBoundary&&sourceAssignment.endTransition==='level','A rim needs its source sleeve to end with a level boundary.');
  requireThat(!sourceResult.report?.modulation?.changed,'A rim cannot yet consume a modulated sleeve: finalized width/flow and displaced rim contact gaps require explicit reconstruction.');
  const zStartMm=sourceResult.levelBoundary.zMm,after=[...new Set([...assignment.after,...sourceResult.operations.map(op=>op.id)])];
  const cut = geometrySection(shell, horizontalSlice(zStartMm), {minFeatureMm: settings.minFeatureMm}), outer = convexLoop(cut.loops);
  requireThat(Math.abs(cut.nudgedByMm ?? 0) <= settings.minFeatureMm / 4, 'Lip boundary section needed an unexpectedly large nudge; check the vase-wall ending Z.');
  const sourceWidth=sourceResult.levelBoundary.widthMm;
  requireThat(Number.isFinite(sourceWidth)&&sourceWidth>0,'A rim needs the finalized source bead width.');
  const sourcePoints=sourceResult.levelBoundary.strokes.flatMap(stroke=>stroke.points);
  requireThat(sourcePoints.every(p=>Math.abs(p[2]-zStartMm)<=1e-8&&Math.abs(Math.min(...outer.map((q,i)=>pointSegmentDistance(p,q,outer[(i+1)%outer.length])))-sourceWidth/2)<=sourceAssignment.boundaryToleranceMm),
    'The source rim differs from its frozen convex contour; patterned or fitted rim contact requires explicit reconstruction.');
  // insetMm is measured from the true (unbeaded) outer surface, exactly as
  // vase-wall measures its own single centerline (insetMm = width/2). A
  // centered ring set can need insetMm below that - even negative, an
  // outward dilation - once a step asks for more than a couple of
  // perimeters; that is the intended behavior; centering is not bounded to
  // stay inside the wall printed below it.
  function ringAt(insetMm) {
    const inset = offsetRegion([outer], -insetMm, {precisionMm: OFFSET_PRECISION_MM, arcToleranceMm: settings.minFeatureMm / 4});
    requireThat(inset.length === 1 && loopArea(inset[0]) > 0, `Lip ring offset ${insetMm.toFixed(3)} mm from the outer wall (positive = inward) collapsed; adjust the steps schedule.`);
    return cleanPlanarLoop(inset[0]);
  }
  const spacing = width, baselineInsetMm = sourceWidth / 2;
  const supporting=depositedCurveSegments([{id:sourceResult.id,strokes:sourceResult.levelBoundary.strokes}],{widthMm:sourceWidth});
  const centerline=ringAt(baselineInsetMm);
  for(let i=0;i<centerline.length;i++){
    const a=centerline[i],b=centerline[(i+1)%centerline.length],count=Math.max(1,Math.ceil(distance(a,b)/Math.min(sourceWidth/4,.1)));
    for(let j=0;j<=count;j++)requireThat(curveSupportsPoint(supporting,[a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count,zStartMm],zStartMm,{toleranceMm:sourceAssignment.boundaryToleranceMm}),
      'The source sleeve leaves a gap beneath the rim centerline; a continuous supporting rim is required.');
  }

  const operations = [];
  let previous = after, z = zStartMm;
  settings.steps.forEach((n, stepIndex) => {
    z += process.layerMm;
    // Rings are centered on the wall's own centerline (offset 0 from
    // baselineInsetMm), not flush with its outer face: for n rings, offsets
    // run symmetrically from -(n-1)/2 to +(n-1)/2 spacing units, so whatever
    // is printed here always straddles the exact same line the terminal
    // wall bead below it followed.
    const mid = (n - 1) / 2;
    const curves = Array.from({length: n}, (_, i) => ({
      role: `lip-step-${stepIndex}`, closed: true,
      points: ringAt(baselineInsetMm + (i - mid) * spacing).map(p => [...p, z])
    }));
    const strokes=depositCurves(curves,{widthMm:width,heightMm:process.layerMm,speedMmS:process.planarSpeedMmS});
    const operationId = `${id}:${operations.length}`;
    operations.push({
      id: operationId, layerId: 'lip:' + z, phase: 'planar', layer: operations.length, rank: z,
      after: [...previous], strokes, order: 'nearest', connectNearby: true,
      // Centered rings can lie outside the wall section; travel and ring-to-ring
      // connectors are checked against the material this step itself deposits.
      travelPolicy: planarPolicy(mid > 0 ? offsetRegion([outer], mid * spacing, {precisionMm: OFFSET_PRECISION_MM}) : [outer], {layerZ: z, liftMm: process.liftMm, maxCombMm: process.maxCombMm, lineWidthMm: width})
    });
    previous = [operationId];
  });
  return {
    id, operations,
    report: {
      steps: settings.steps, startMm: zStartMm, topMm: z,
      scope: 'Independently closed rings stacked above a level vase-wall rim, each step centered on the wall\'s own centerline rather than kept flush with its outer face; adjacent rings joined by a short printed connector, no continuous-spiral phase constraint to preserve. No physical validation.'
    }
  };
}
