// Geometry/reference -> mapped curve courses; no volume or operation assembly.
import {createSectionQuery} from './query.mjs';
import {cleanPlanarLoop} from './polyline.mjs';
import {loopArea,dedupe,pointSegmentDistance,pointInRegion} from '../region/region2d.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {requireThat,distance} from './tolerance.mjs';
import {contourPath} from './contour-path.mjs';
import {maximumPathAngle} from '../path/deposition.mjs';
import {spiralProfile,spiralHeight,spiralBeadCurve} from '../path/curve-construction.mjs';
import {mappedSleevePatternCurves} from '../path/sleeve-pattern.mjs';
import {prepareContourFamily} from './prepared-contours.mjs';
import {createFittedSleeveReference,createAutomaticSleeveReference} from './sleeve-reference.mjs';
const OFFSET_PRECISION_MM=.00001;
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

export function constructContourSleeve({shell,assignment,process,machine,zStartMm=null,zEndMm=null,onProgress}) {
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
  const boundaryFamily=()=>{
    const levels=[start];for(let z=start+pitch;z<end-1e-9;z+=pitch)levels.push(z);levels.push(end);
    const layers=levels.map((z,index)=>{
      let points;
      if(reference){const count=Math.max(16,Math.ceil(reference.referenceLengthMm/settings.sampleStepMm));points=Array.from({length:count},(_,i)=>reference.map(reference.pointAt(i/count,z,0)));}
      else {const curve=section(z).curve;points=curve.breakpoints().slice(0,-1).map(n=>[...n.p,z]);}
      const normal=[0,0,1],frameSamples=points.map(p=>({point:[p[0],p[1],0],u:[1,0,0],v:[0,1,0],normal}));
      return {index,heightMm:index?z-levels[index-1]:firstHeight,offsetMm:z-start,slice:{kind:'plane',origin:[0,0,z],normal,xAxis:[1,0,0],yAxis:[0,1,0]},curves:[{closed:true,points,frameSamples}]};
    });
    return {direction:[0,0,1],pitchMm:pitch,firstLayerMm:firstHeight,layers};
  };
  if(settings.pattern!==null){
    if(reference){const result=mappedSleevePatternCurves({settings,process,base,start,end,firstHeight,referenceLengthMm:reference.referenceLengthMm,mapping:{reference},mappingErrorMm:reference.mappingErrorMm,onProgress});return {...result,family:boundaryFamily(),report:{...result.report,sectionQueries:0,nudgedSections:0,...reference.report()}};}
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
    const result=mappedSleevePatternCurves({settings,process,base,start,end,firstHeight,referenceLengthMm:section(start).curve.length,mapping:{contours:prepared},mappingErrorMm,onProgress});
    return {...result,family:boundaryFamily(),report:{...result.report,sectionQueries,nudgedSections,offsetPrecisionMm:OFFSET_PRECISION_MM,...prepared.report()}};
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
  return {family:boundaryFamily(),courses:[{key:'wall',layerIdSuffix:':continuous',phase:'vase-wall',layer:0,rank:start,curves:[curve],join:{mode:'ordered'},fanPercent:process.fanPercent,trimEnd:settings.endTransition==='level',travel:{kind:'clearance',clearanceZ:end+process.liftMm}}],
    levelBoundary:settings.endTransition==='level'?{zMm:end,widthMm:width,startIndex:times.findIndex(t=>t>=spiralTurns-1e-9)}:null,
    report:{startMm:start,endMm:end,baseTopMm:base,turns,spiralTurns,endTransition:settings.endTransition,levelRimMm:settings.endTransition==='level'?end:null,points:points.length,sectionQueries,nudgedSections,offsetPrecisionMm:OFFSET_PRECISION_MM,
      speedMmS:speed,maximumAngleDeg,...reference?.report(),
      scope:'One outer section with arc-length correspondence from a fixed projected seam; concavity is supported while the inset remains one loop. Sampled topology and boundary checks; no physical validation.'}};
}
