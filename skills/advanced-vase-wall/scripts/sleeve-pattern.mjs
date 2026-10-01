import {distance,requireThat} from '../../../core/private/extensions/numeric.mjs';
// Patterns use sleeve coordinates, never independent world XYZ.

import {maximumPathAngle} from '../../../core/path/deposition.mjs';
import {patternCourses} from './sleeve-boundary-courses.mjs';
import {sampleCurveIntervals} from '../../../core/path/curve-sampling.mjs';
const sameSurfacePoint=(a,b)=>Math.abs((a[0]-b[0])-Math.round(a[0]-b[0]))<=1e-10&&Math.abs(a[1]-b[1])<=1e-9;
const offsetAt=(path,i)=>Array.isArray(path.offsetMm)?path.offsetMm.at(i):(path.offsetMm??0);
const joined=(a,b)=>sameSurfacePoint(a.points.at(-1),b.points[0])&&Math.abs(offsetAt(a,-1)-offsetAt(b,0))<=1e-9;

export function validateSleevePattern(pattern,mode='continuous') {
  if(pattern===null)return;
  requireThat(pattern&&Object.keys(pattern).sort().join()==='advance,paths,repeats','Vase pattern needs explicit paths, advance and repeats. Legacy tile records require explicit bundle migration.');
  requireThat(Array.isArray(pattern.advance)&&pattern.advance.length===2&&pattern.advance.every(Number.isFinite)&&pattern.advance[1]>0,'Pattern advance is [perimeter turns, rise in mm], with positive rise.');
  requireThat(Number.isSafeInteger(pattern.repeats)&&pattern.repeats>=1,'Pattern repeats must be a positive safe integer.');
  const paths=pattern.paths;
  requireThat(Array.isArray(paths)&&paths.length>0,'A sleeve pattern needs ordered deposition paths.');
  for(const path of paths) {
    requireThat(path&&['beadHeightMm,points','beadHeightMm,offsetMm,points'].includes(Object.keys(path).sort().join()),'Each pattern path needs points and beadHeightMm, with optional offsetMm.');
    requireThat(Array.isArray(path.points)&&path.points.length>=2&&path.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),'Pattern points must be [unwrapped perimeter turns, height in mm], not XYZ.');
    const heights=Array.isArray(path.beadHeightMm)?path.beadHeightMm:path.points.map(()=>path.beadHeightMm);
    requireThat(heights.length===path.points.length&&heights.every(h=>Number.isFinite(h)&&h>=0),'Pattern beadHeightMm must be nonnegative or one height per point.');
    const offsets=Array.isArray(path.offsetMm)?path.offsetMm:path.points.map(()=>path.offsetMm??0);
    requireThat(offsets.length===path.points.length&&offsets.every(Number.isFinite),'Pattern offsetMm must be finite or one finite offset per point.');
    for(let i=1;i<path.points.length;i++) {
      requireThat(distance(path.points[i-1],path.points[i])>0||offsets[i-1]!==offsets[i],'Remove duplicate consecutive pattern points.');
      requireThat(heights[i-1]+heights[i]>0,'Split travel into separate pattern paths; zero-deposition segments are not pattern paths.');
    }
  }
  requireThat(paths[0].points[0][1]>=0,'The first pattern point cannot start below the selected print height.');
  if(mode==='continuous') {
    for(let i=1;i<pattern.paths.length;i++)requireThat(joined(pattern.paths[i-1],pattern.paths[i]),'Continuous pattern paths must meet on the sleeve, including offset; select segmented mode for gaps.');
    if(pattern.repeats>1)requireThat(joined(pattern.paths.at(-1),{...pattern.paths[0],points:[pattern.paths[0].points[0].map((v,k)=>v+pattern.advance[k])]}),
      'Continuous pattern repetitions must meet on the sleeve after advance; select segmented mode for gaps.');
  }
}

export function mappedSleevePatternCurves({settings,process,base,start,end,firstHeight,referenceLengthMm,mapping,mappingErrorMm=0,onProgress}) {
  const pattern=settings.pattern;
  const continuous=settings.pathMode==='continuous',role=continuous?'vase-wall':'segmented-path';
  // Every course is authored and finite, and each mapped interval subdivides
  // until its tolerance is met or its midpoint stops being distinct from its
  // ends, so the pattern takes the points its tolerances need.
  const level=settings.endTransition==='level',paths=[];let count=0,maximumAngleDeg=0,minZ=Infinity,maxZ=-Infinity,maximumBeadHeightMm=0;
  const emitPath=(vertices,heights,layer,foundation)=>{
    const at=(a,b,t)=>{
      const u=a[0]+(b[0]-a[0])*t,z=start+a[1]+(b[1]-a[1])*t;
      requireThat(z>=start-1e-9&&z<=end+1e-9,'Mapped pattern exceeds its selected sleeve height interval; adjust repeats, advance or tile heights.');
      const depth=(a[2]??0)+((b[2]??0)-(a[2]??0))*t;
      return mapping.reference?mapping.reference.map(mapping.reference.pointAt(u,z,depth)):[...mapping.contours.at(u,z,depth),z];
    };
    const points=[at(vertices[0],vertices[0],0)],segmentHeights=[];
    count++;
    for(let i=1;i<vertices.length;i++) {
      const a=vertices[i-1],b=vertices[i],ha=heights[i-1],hb=heights[i];
      // Bound angular progress before adaptive mapping; full turns must not alias.
      const pieces=Math.max(1,Math.ceil(Math.abs(b[0]-a[0])*16));
      const samples=sampleCurveIntervals({at:t=>({point:at(a,b,t),chart:a.map((v,k)=>v+(b[k]-v)*t)}),
        cuts:Array.from({length:pieces+1},(_,j)=>j/pieces),stepMm:settings.sampleStepMm,toleranceMm:settings.toleranceMm/2-2*mappingErrorMm,
        chartSteps:[1/16,settings.minFeatureMm/2]});
      for(let j=1;j<samples.length;j++){
        count++;points.push(samples[j].point);
        // Only the authored pattern deposits; the guide supplies no material.
        const h=ha+(hb-ha)*(samples[j-1].t+samples[j].t)/2;
        requireThat(level?h>=0:h>0,'Pattern segments must deposit material.');
        maximumBeadHeightMm=Math.max(maximumBeadHeightMm,h);segmentHeights.push(h);
      }
    }
    if(continuous&&paths.length)requireThat(distance(paths.at(-1).points.at(-1),points[0])<=1e-9,'Mapped vase endpoints do not meet; use segmented mode for travel.');
    maximumAngleDeg=Math.max(maximumAngleDeg,maximumPathAngle(points));
    for(const p of points){minZ=Math.min(minZ,p[2]);maxZ=Math.max(maxZ,p[2]);}
    const length=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
    const speed=Math.min(process.planarSpeedMmS,process.firstLayerSpeedMmS,process.minimumLayerSeconds>0?length/process.minimumLayerSeconds:Infinity);
    paths.push({closed:false,points,heightsMm:segmentHeights,speedMmS:speed,role,segmentMetadata:segmentHeights.map((_,i)=>({layer,...(foundation?{contactRole:'foundation'}:{}),...(level&&Math.abs(points[i][2]-end)<1e-8&&Math.abs(points[i+1][2]-end)<1e-8?{boundaryRole:'rim'}:{})}))});
  };
  const total=pattern.repeats+(level?2:0);let completed=0;
  onProgress?.({stage:'Mapping vase pattern courses',completed:0,total});
  for(const course of patternCourses(pattern,{level,spanMm:end-start,firstHeightMm:firstHeight,referenceLengthMm})){
    for(const {vertices,heights} of course.paths)emitPath(vertices,heights,course.repeat+(level?2:1),course.repeat===(level?-1:0));
    onProgress?.({stage:'Mapping vase pattern courses',completed:++completed,total});
  }
  return {courses:[{key:'wall',layerIdSuffix:':pattern',phase:continuous?'vase-wall':'segmented-paths',layer:0,rank:minZ,curves:paths,join:{mode:continuous?'continuous':'separate'},fanPercent:process.fanPercent,trimEnd:level,travel:{kind:'clearance',clearanceZ:maxZ+process.liftMm,constant:true}}],
    levelBoundary:level?{zMm:end,widthMm:process.lineWidthMm,tailCount:pattern.paths.length}:null,
    report:{mode:continuous?'continuous-sleeve-pattern':'segmented-sleeve-pattern',startMm:minZ,endMm:maxZ,baseTopMm:base,paths:paths.length,repeats:pattern.repeats,
      points:count,endTransition:settings.endTransition,levelRimMm:level?end:null,...(level?{flatStartMm:start,boundaryCourses:2}:{}),maximumAngleDeg,maximumBeadHeightMm,
      scope:'Repeated tiles mapped to actual inset sleeve sections. Only supplied pattern strokes deposit, with nominal bead heights; arbitrary crossing contact and strength are not inferred.'}};
}
