// Motifs use sleeve coordinates, never independent world XYZ.
import {distance,requireThat} from '../../../core/geom/tolerance.mjs';
import {depositionStroke,maximumPathAngle,trimVanishingEnd} from '../../../core/path/deposition.mjs';
import {isTiledMotif,tileVaseMotif} from './motif.mjs';
import {patternCourses} from './boundary-courses.mjs';
const sameSurfacePoint=(a,b)=>Math.abs((a[0]-b[0])-Math.round(a[0]-b[0]))<=1e-10&&Math.abs(a[1]-b[1])<=1e-9;
const offsetAt=(path,i)=>Array.isArray(path.offsetMm)?path.offsetMm.at(i):(path.offsetMm??0);
const joined=(a,b)=>sameSurfacePoint(a.points.at(-1),b.points[0])&&Math.abs(offsetAt(a,-1)-offsetAt(b,0))<=1e-9;

export function validateVasePattern(pattern,mode='continuous') {
  if(pattern===null)return;
  const tiled=isTiledMotif(pattern);
  requireThat(pattern&&Object.keys(pattern).sort().join()===(tiled?'cellsPerTurn,courseRiseMm,motif,repeats,tiltDeg':'advance,paths,repeats'),'Vase pattern needs paths, advance and repeats, or one motif with cellsPerTurn, courseRiseMm, repeats and tiltDeg.');
  if(tiled){
    requireThat(mode==='continuous','Single-motif tiling always connects cells; use continuous mode.');
    requireThat(Number.isSafeInteger(pattern.cellsPerTurn)&&pattern.cellsPerTurn>0,'Motif cellsPerTurn must be a positive safe integer.');
    requireThat(Number.isFinite(pattern.courseRiseMm)&&pattern.courseRiseMm>0,'Motif courseRiseMm must be positive.');
    requireThat(Number.isFinite(pattern.tiltDeg),'Motif tiltDeg must be finite.');
  }else requireThat(Array.isArray(pattern.advance)&&pattern.advance.length===2&&pattern.advance.every(Number.isFinite)&&pattern.advance[1]>0,'Pattern advance is [perimeter turns, rise in mm], with positive rise.');
  requireThat(Number.isSafeInteger(pattern.repeats)&&pattern.repeats>=1,'Pattern repeats must be a positive safe integer.');
  const paths=tiled?[pattern.motif]:pattern.paths;
  requireThat(Array.isArray(paths)&&paths.length>0,'A sleeve motif needs ordered deposition paths.');
  for(const path of paths) {
    requireThat(path&&['beadHeightMm,points','beadHeightMm,offsetMm,points'].includes(Object.keys(path).sort().join()),'Each motif path needs points and beadHeightMm, with optional offsetMm.');
    requireThat(Array.isArray(path.points)&&path.points.length>=2&&path.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),'Motif points must be [unwrapped perimeter turns, height in mm], not XYZ.');
    const heights=Array.isArray(path.beadHeightMm)?path.beadHeightMm:path.points.map(()=>path.beadHeightMm);
    requireThat(heights.length===path.points.length&&heights.every(h=>Number.isFinite(h)&&h>=0),'Motif beadHeightMm must be nonnegative or one height per point.');
    const offsets=Array.isArray(path.offsetMm)?path.offsetMm:path.points.map(()=>path.offsetMm??0);
    requireThat(offsets.length===path.points.length&&offsets.every(Number.isFinite),'Motif offsetMm must be finite or one finite offset per point.');
    for(let i=1;i<path.points.length;i++) {
      requireThat(distance(path.points[i-1],path.points[i])>0||offsets[i-1]!==offsets[i],'Remove duplicate consecutive motif points.');
      requireThat(heights[i-1]+heights[i]>0,'Split travel into separate motif paths; zero-deposition segments are not motifs.');
    }
  }
  requireThat(paths[0].points[0][1]>=0,'The first motif point cannot start below the selected print height.');
  if(tiled){
    const path=pattern.motif,first=path.points[0],last=path.points.at(-1);
    const bead=path.beadHeightMm;
    requireThat(first[0]===0&&last[0]===1&&first[1]===last[1]&&offsetAt(path,0)===offsetAt(path,-1)
      &&(!Array.isArray(bead)||bead[0]===bead.at(-1)),
      'A tiled motif must run from cell u=0 to u=1 with identical endpoint height, offset and bead height; revise the motif, not a connector or travel gap.');
    return;
  }
  if(mode==='continuous') {
    for(let i=1;i<pattern.paths.length;i++)requireThat(joined(pattern.paths[i-1],pattern.paths[i]),'Continuous motif paths must meet on the sleeve, including offset; select segmented mode for gaps.');
    if(pattern.repeats>1)requireThat(joined(pattern.paths.at(-1),{...pattern.paths[0],points:[pattern.paths[0].points[0].map((v,k)=>v+pattern.advance[k])]}),
      'Continuous motif repetitions must meet on the sleeve after advance; select segmented mode for gaps.');
  }
}

export function mappedPatternResult({settings,process,machine,id,after,base,start,end,firstHeight,referenceLengthMm,mappedPoint,mappingErrorMm=0,sectionReport,onProgress}) {
  const tiled=isTiledMotif(settings.pattern),pattern=tiled?tileVaseMotif(settings.pattern):settings.pattern;
  const continuous=settings.pathMode==='continuous',role=continuous?'vase-wall':'segmented-path';
  // Every course is authored and finite, and each mapped interval subdivides
  // until its tolerance is met or its midpoint stops being distinct from its
  // ends, so the pattern takes the points its tolerances need.
  const level=settings.endTransition==='level',paths=[];let count=0,maximumAngleDeg=0,minZ=Infinity,maxZ=-Infinity,maximumBeadHeightMm=0;
  const emitPath=(vertices,heights,layer)=>{
    const at=(a,b,t)=>{
      const u=a[0]+(b[0]-a[0])*t,z=start+a[1]+(b[1]-a[1])*t;
      requireThat(z>=start-1e-9&&z<=end+1e-9,'Mapped motif exceeds its selected sleeve height interval; adjust repeats, advance or motif heights.');
      return mappedPoint(u,z,(a[2]??0)+((b[2]??0)-(a[2]??0))*t);
    };
    const points=[at(vertices[0],vertices[0],0)],segmentHeights=[];
    count++;
    const append=(a,b,ha,hb,pa,pb)=>{
      const mid=a.map((v,k)=>(v+b[k])/2),pm=at(mid,mid,0);
      const error=Math.max(...[.25,.5,.75].map(t=>distance(t===.5?pm:at(a,b,t),pa.map((v,k)=>v+(pb[k]-v)*t))));
      if(distance(pa,pb)>settings.sampleStepMm||error>settings.toleranceMm/2-2*mappingErrorMm||Math.abs(a[1]-b[1])>settings.minFeatureMm/2) {
        requireThat(mid.some((v,k)=>v!==a[k])&&mid.some((v,k)=>v!==b[k]),`Sleeve mapping cannot meet the requested contour tolerance near motif coordinates ${a.join(', ')} to ${b.join(', ')}: the subdivided midpoint is no longer distinct from its ends.`);
        append(a,mid,ha,(ha+hb)/2,pa,pm);append(mid,b,(ha+hb)/2,hb,pm,pb);return;
      }
      count++;points.push(pb);
      // Only the authored motif deposits; the guide supplies no material.
      const h=(ha+hb)/2;
      requireThat(level?h>=0:h>0,'Motif segments must deposit material.');
      maximumBeadHeightMm=Math.max(maximumBeadHeightMm,h);
      segmentHeights.push(h);
    };
    for(let i=1;i<vertices.length;i++) {
      const a=vertices[i-1],b=vertices[i],ha=heights[i-1],hb=heights[i];
      // Bound angular progress before adaptive mapping; full turns must not alias.
      const pieces=Math.max(1,Math.ceil(Math.abs(b[0]-a[0])*16));
      for(let j=0;j<pieces;j++){
        const t0=j/pieces,t1=(j+1)/pieces,p=a.map((v,k)=>v+(b[k]-v)*t0),q=a.map((v,k)=>v+(b[k]-v)*t1);
        append(p,q,ha+(hb-ha)*t0,ha+(hb-ha)*t1,points.at(-1),at(q,q,0));
      }
    }
    if(continuous&&paths.length)requireThat(distance(paths.at(-1).points.at(-1),points[0])<=1e-9,'Mapped vase endpoints do not meet; use segmented mode for travel.');
    maximumAngleDeg=Math.max(maximumAngleDeg,maximumPathAngle(points));
    for(const p of points){minZ=Math.min(minZ,p[2]);maxZ=Math.max(maxZ,p[2]);}
    const length=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
    const speed=Math.min(process.planarSpeedMmS,process.firstLayerSpeedMmS,process.minimumLayerSeconds>0?length/process.minimumLayerSeconds:Infinity);
    paths.push(depositionStroke({points,heightsMm:segmentHeights,widthMm:process.lineWidthMm,speedMmS:speed,role,segmentMetadata:segmentHeights.map(()=>({layer}))}));
  };
  const total=pattern.repeats+(level?2:0);let completed=0;
  onProgress?.({stage:'Mapping vase motif courses',completed:0,total});
  for(const course of patternCourses(pattern,{level,spanMm:end-start,firstHeightMm:firstHeight,referenceLengthMm})){
    for(const {vertices,heights} of course.paths)emitPath(vertices,heights,course.repeat+(level?2:1));
    onProgress?.({stage:'Mapping vase motif courses',completed:++completed,total});
  }
  const strokes=level&&paths.length?[...paths.slice(0,-1),trimVanishingEnd(paths.at(-1))]:paths;
  return {id,...(level?{levelBoundary:{zMm:end,strokes:strokes.slice(-pattern.paths.length),widthMm:process.lineWidthMm}}:{}),operations:[{id:id+':wall',layerId:id+':pattern',phase:continuous?'vase-wall':'segmented-paths',layer:0,rank:minZ,after,
    strokes,order:'given',continuous,fanPercent:process.fanPercent,
    travelPolicy:{maxCombMm:0,constantClearanceZ:maxZ+process.liftMm,clearanceFor:()=>maxZ+process.liftMm}}],
    report:{mode:continuous?'continuous-sleeve-pattern':'segmented-sleeve-pattern',startMm:minZ,endMm:maxZ,baseTopMm:base,paths:paths.length,repeats:pattern.repeats,
      ...(tiled?{motifCellsPerTurn:settings.pattern.cellsPerTurn,motifPoints:settings.pattern.motif.points.length,tiltDeg:settings.pattern.tiltDeg}:{}),
      points:count,...sectionReport(),endTransition:settings.endTransition,levelRimMm:level?end:null,...(level?{flatStartMm:start,boundaryCourses:2}:{}),maximumAngleDeg,maximumBeadHeightMm,volumeMm3:strokes.reduce((sum,s)=>sum+s.volumesMm3.reduce((a,b)=>a+b,0),0),
      scope:'Repeated motifs mapped to actual inset sleeve sections. Only supplied motif strokes deposit, with nominal bead heights; arbitrary crossing contact and strength are not inferred.'}};
}
