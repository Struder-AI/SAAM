// Motifs use sleeve coordinates, never independent world XYZ.
import {distance,requireThat} from '../../../core/geom/tolerance.mjs';
import {depositionStroke,maximumPathAngle} from '../../../core/path/deposition.mjs';
const sameSurfacePoint=(a,b)=>Math.abs((a[0]-b[0])-Math.round(a[0]-b[0]))<=1e-10&&Math.abs(a[1]-b[1])<=1e-9;
const offsetAt=(path,i)=>Array.isArray(path.offsetMm)?path.offsetMm.at(i):(path.offsetMm??0);
const joined=(a,b)=>sameSurfacePoint(a.points.at(-1),b.points[0])&&Math.abs(offsetAt(a,-1)-offsetAt(b,0))<=1e-9;

// A motif's offset direction comes from this already-converged single-wall
// guide path's own per-vertex normals (built once against the actual
// section), blended smoothly across its vertices — never a fresh offset
// contour rebuilt from the section per sample, so the host's own facet
// density cannot leak into how many mapping attempts a motif point needs.
function guideAt(guide,u) {
  const {times,normals}=guide;
  const clamped=Math.max(times[0],Math.min(times.at(-1),u));
  let lo=0,hi=times.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(times[mid]<=clamped)lo=mid;else hi=mid;}
  const span=times[lo+1]-times[lo],t=span?(clamped-times[lo])/span:0;
  const n0=normals[lo],n1=normals[lo+1];
  const nx=n0[0]+t*(n1[0]-n0[0]),ny=n0[1]+t*(n1[1]-n0[1]),normalLength=Math.hypot(nx,ny);
  return {nx:normalLength?nx/normalLength:0,ny:normalLength?ny/normalLength:0};
}

export function validateVasePattern(pattern,mode='continuous') {
  if(pattern===null)return;
  requireThat(pattern&&Object.keys(pattern).sort().join()==='advance,paths,repeats','Vase pattern needs paths, advance and repeats.');
  requireThat(Array.isArray(pattern.advance)&&pattern.advance.length===2&&pattern.advance.every(Number.isFinite)&&pattern.advance[1]>0,'Pattern advance is [perimeter turns, rise in mm], with positive rise.');
  requireThat(Number.isSafeInteger(pattern.repeats)&&pattern.repeats>=1,'Pattern repeats must be a positive safe integer.');
  requireThat(Array.isArray(pattern.paths)&&pattern.paths.length>0,'A sleeve motif needs ordered deposition paths.');
  for(const path of pattern.paths) {
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
  requireThat(pattern.paths[0].points[0][1]>=0,'The first motif point cannot start below the selected print height.');
  if(mode==='continuous') {
    for(let i=1;i<pattern.paths.length;i++)requireThat(joined(pattern.paths[i-1],pattern.paths[i]),'Continuous motif paths must meet on the sleeve, including offset; select segmented mode for gaps.');
    if(pattern.repeats>1)requireThat(joined(pattern.paths.at(-1),{...pattern.paths[0],points:[pattern.paths[0].points[0].map((v,k)=>v+pattern.advance[k])]}),
      'Continuous motif repetitions must meet on the sleeve after advance; select segmented mode for gaps.');
  }
}

export function mappedPatternResult({settings,process,machine,id,after,base,start,end,firstHeight,guide,exactPoint,budgetSetting,sectionReport}) {
  const pattern=settings.pattern,continuous=settings.pathMode==='continuous',role=continuous?'vase-wall':'segmented-path';
  const paths=[],maxPoints=settings.maxPoints;let count=0,maximumAngleDeg=0,minZ=Infinity,maxZ=-Infinity;
  const budget=()=>{throw new Error(`Vase mapped-pattern point budget exhausted for ${id}; increase ${budgetSetting} from ${maxPoints}. No complete pattern generated.`);};
  const emitPath=(vertices,heights,layer)=>{
    const at=(a,b,t)=>{
      const u=a[0]+(b[0]-a[0])*t,z=start+a[1]+(b[1]-a[1])*t;
      requireThat(z>=start-1e-9&&z<=end+1e-9,'Mapped motif exceeds its selected sleeve height interval; adjust repeats, advance or motif heights.');
      const offsetMm=(a[2]??0)+((b[2]??0)-(a[2]??0))*t;
      // The base position is always the exact single-wall lookup at this
      // exact (u,z) — the same cheap query the guide itself was built from,
      // not an offset reconstruction. Only the *direction* to perturb along
      // comes from the guide, blended smoothly across its vertices so a
      // depth offset does not jump wherever the host has a sharp corner.
      const [x,y]=exactPoint(u,z);
      if(offsetMm===0)return [x,y,z];
      const {nx,ny}=guideAt(guide,u);
      requireThat(nx!==0||ny!==0,`Vase motif guide normal collapsed near turn ${u}; the guide path may be degenerate there.`);
      return [x+offsetMm*nx,y+offsetMm*ny,z];
    };
    const points=[at(vertices[0],vertices[0],0)],segmentHeights=[];
    if(++count>maxPoints)budget();
    const append=(a,b,ha,hb,pa,pb,depth=0)=>{
      // A guide/base host profile that passes very close to itself can leave
      // a near-zero-length edge in that height's own offset contour — a
      // genuine discontinuity in the exact-position lookup, not chord error,
      // so no depth resolves it. 24 levels already narrows the interval far
      // past any real feature or the machine's own resolution. a[1] and b[1]
      // (height) are linearly interpolated same as everything else here, so
      // they still share this interval's height by depth 24 — this is an
      // in-plane jump, not a Z jump, so the extra stroke only ever crosses
      // other material already on the *same* layer, exactly what vase mode
      // already does everywhere a loop overlaps its neighbor. No collision
      // risk with the layer below; accept the point (see vase.mjs's match).
      if(depth<24) {
        const mid=a.map((v,k)=>(v+b[k])/2),pm=at(mid,mid,0);
        const error=Math.max(...[.25,.5,.75].map(t=>distance(t===.5?pm:at(a,b,t),pa.map((v,k)=>v+(pb[k]-v)*t))));
        if(distance(pa,pb)>settings.sampleStepMm||error>settings.toleranceMm/2||Math.abs(a[1]-b[1])>settings.minFeatureMm/2) {
          append(a,mid,ha,(ha+hb)/2,pa,pm,depth+1);append(mid,b,(ha+hb)/2,hb,pm,pb,depth+1);return;
        }
      } else if(distance(pa,pb)>process.lineWidthMm){
        console.warn(`vase-wall: accepted a ${distance(pa,pb).toFixed(2)}mm in-plane jump near motif coordinates ${b.join(', ')} where the guide profile passes very close to itself; the extra stroke lands on the current layer only.`);
      }
      if(++count>maxPoints)budget();points.push(pb);
      // Only the authored motif deposits; the guide supplies no material.
      const h=(ha+hb)/2;
      requireThat(h>0,'Motif segments must deposit material.');
      segmentHeights.push(h);
    };
    for(let i=1;i<vertices.length;i++) {
      const a=vertices[i-1],b=vertices[i],ha=heights[i-1],hb=heights[i];
      // Bound angular progress before adaptive mapping; full turns must not alias.
      const pieces=Math.max(1,Math.ceil(Math.abs(b[0]-a[0])*16));
      if(pieces>maxPoints-count)budget();
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
  for(let repeat=0;repeat<pattern.repeats;repeat++)for(const path of pattern.paths) {
    const vertices=path.points.map((p,i)=>[...p.map((v,k)=>v+repeat*pattern.advance[k]),offsetAt(path,i)]);
    const heights=Array.isArray(path.beadHeightMm)?path.beadHeightMm:path.points.map(()=>path.beadHeightMm);
    emitPath(vertices,heights,repeat+1);
  }
  return {id,operations:[{id:id+':wall',layerId:id+':pattern',phase:continuous?'vase-wall':'segmented-paths',layer:0,rank:minZ,after,
    strokes:paths,order:'given',continuous,fanPercent:process.fanPercent,
    travelPolicy:{maxCombMm:0,constantClearanceZ:maxZ+process.liftMm,clearanceFor:()=>maxZ+process.liftMm},clearanceZ:maxZ+process.liftMm}],
    report:{mode:continuous?'continuous-sleeve-pattern':'segmented-sleeve-pattern',startMm:minZ,endMm:maxZ,baseTopMm:base,paths:paths.length,repeats:pattern.repeats,
      points:count,maxPoints,...sectionReport(),levelRimMm:null,maximumAngleDeg,volumeMm3:paths.reduce((sum,s)=>sum+s.volumesMm3.reduce((a,b)=>a+b,0),0),
      scope:'Repeated motifs mapped to actual inset sleeve sections. Only supplied motif strokes deposit, with nominal bead heights; arbitrary crossing contact and strength are not inferred.'}};
}
