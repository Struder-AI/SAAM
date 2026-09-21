// First-principles development coupon: solid envelope minus path-routing cuts.
// Geometry output only; no machine commands or manufacturing approval.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {solidKernel,combineSolids} from '../../../core/geom/solid.mjs';
import {cleanTriangleSoup,encodeRepairSTL} from '../../../core/geom/mesh-repair.mjs';
import {makeMesh} from '../../../core/geom/mesh.mjs';
import {offsetRegion} from '../../../core/region/offset.mjs';
import {loopArea} from '../../../core/region/region2d.mjs';
import {parseDat,ordinate} from '../prototype/airfoils.mjs';
export const sampleDefaults={chordMm:200,spanMm:200,sparFractions:[.3,.6],boreMm:5,weldWidthMm:2.5,weldDepthMm:2.5,slitMm:.03,stiffenerDepthMm:1.5,stiffenerPitchMm:25,stiffenerAngleDeg:45,stiffenerPhaseMm:7.137,stiffenerFadeMm:3,beadWidthMm:.4,layerMm:.2};
export async function buildVaseSample(options={}){
 const p={...sampleDefaults,...options};
 for(const [k,v] of Object.entries(p))if(k!=='sparFractions'&&(!Number.isFinite(v)||v<=0))throw Error('Positive finite parameter required: '+k);
 if(p.stiffenerAngleDeg>=80)throw Error('This sample supports stiffener angles below 80 degrees.');
 const profile=parseDat(await readFile(new URL('../prototype/data/clarky.dat',import.meta.url),'utf8'));
 const k=await solidKernel(),M=k.Manifold,owned=[]; const keep=s=>(owned.push(s),s);
 const c=p.chordMm,h=p.spanMm;
 const y=(x,side)=>ordinate(profile,Math.max(0,Math.min(1,x/c)),side)*c;
 const area=a=>loopArea(a);
 const ccw=a=>area(a)>0?a:[...a].reverse();
 // Preserve UIUC Clark Y coordinates, including its finite trailing edge.
 const outline=ccw([...profile.upper.map(a=>a.map(v=>v*c)),...profile.lower.slice(1).reverse().map(a=>a.map(v=>v*c))]);
 const extrude=a=>keep(M.extrude([ccw(a)],h));
 const envelope=extrude(outline),cuts=[];
 const circle=(cx,cy,r,n=128)=>Array.from({length:n},(_,i)=>[cx+r*Math.cos(i*2*Math.PI/n),cy+r*Math.sin(i*2*Math.PI/n)]);
 const rect=(a,b,d,e)=>[[a,b],[d,b],[d,e],[a,e]];
 const spars=p.sparFractions.map(f=>{const x=f*c;return {x,y:(y(x,'upper')+y(x,'lower'))/2,diameterMm:p.boreMm};});
 // Rounded-bottom weld troughs: specified width and total depth.
 function trough(x,surface,side){
  const r=p.weldWidthMm/2,sgn=side==='upper'?-1:1,cy=surface+sgn*(p.weldDepthMm-r);
  const points=side==='upper'?[[x-r,40],[x-r,cy]]:[[x+r,-20],[x+r,cy]];
  for(let i=0;i<=32;i++){const a=side==='upper'?Math.PI+Math.PI*i/32:Math.PI*i/32;points.push([x+r*Math.cos(a),cy+r*Math.sin(a)]);}
  points.push(side==='upper'?[x+r,40]:[x-r,-20]);return extrude(points);
 }
 for(const s of spars){
  cuts.push(extrude(circle(s.x,s.y,p.boreMm/2)));
  cuts.push(trough(s.x,y(s.x,'upper'),'upper'),trough(s.x,y(s.x,'lower'),'lower'));
  // A single opening from upper trough to bore makes it part of the outer route.
  cuts.push(extrude(rect(s.x-p.slitMm/2,s.y,s.x+p.slitMm/2,40)));
  if(s.y-p.boreMm/2-(y(s.x,'lower')+p.weldDepthMm)<1)throw Error('Lower cap leaves less than 1 mm of CAD bridge to tube.');
 }
 // Leading edge groove opens from the nose; rounded internal terminus.
 const noseY=y(0,'upper'),r=p.weldWidthMm/2;
 const leading=[[-5,noseY-r],[p.weldDepthMm-r,noseY-r]];
 for(let i=0;i<=32;i++){const a=-Math.PI/2+Math.PI*i/32;leading.push([p.weldDepthMm-r+r*Math.cos(a),noseY+r*Math.sin(a)]);}
 leading.push([-5,noseY+r]);cuts.push(extrude(leading));
 // Skin-only diagonal cuts. Opposite slopes on upper/lower skins. Ramp the
 // penetration down at cap lands, preserving a material bridge at intersections.
 const collar=p.weldWidthMm/2+.9;
 const bays=[[8,spars[0].x-collar],[spars[0].x+collar,spars[1].x-collar],[spars[1].x+collar,.86*c]];
 const slope=Math.tan(p.stiffenerAngleDeg*Math.PI/180);
 for(const side of ['upper','lower']){
  const dir=side==='upper'?1:-1;
  const bands=[];
  for(const [a,b] of bays){
   const xs=[a,...profile[side].map(q=>q[0]*c).filter(x=>x>a&&x<b),a+p.stiffenerFadeMm,b-p.stiffenerFadeMm,b].sort((a,b)=>a-b);
   const outer=xs.map(x=>[x,y(x,side)+dir*.5]);
   const inner=xs.map(x=>[x,y(x,side)-dir*p.stiffenerDepthMm*Math.max(0,Math.min(1,(x-a)/p.stiffenerFadeMm,(b-x)/p.stiffenerFadeMm))]);
   bands.push(extrude([...outer,...inner.reverse()]));
  }
  const band=keep(M.union(bands));
  for(let b=-h*slope-p.stiffenerPitchMm+p.stiffenerPhaseMm;b<c+h*slope+p.stiffenerPitchMm;b+=p.stiffenerPitchMm){
   const block=keep(M.cube([p.slitMm,70,h]));
   const slab=keep(block.warp(v=>{v[0]+=b+dir*slope*v[2];v[1]-=25;}));
   const cut=keep(slab.intersect(band));if(!cut.isEmpty())cuts.push(cut);
  }
 }
 const cutter=keep(M.union(cuts)),rawSolid=keep(combineSolids(envelope,cutter,'subtract')),solid=keep(rawSolid.simplify(.0001));
 console.error('Validating generated mesh…');
 const raw=solid.getMesh(),vertices=[],triangles=[];
 for(let i=0;i<raw.vertProperties.length;i+=raw.numProp)vertices.push(Array.from(raw.vertProperties.slice(i,i+3)));
 for(let i=0;i<raw.triVerts.length;i+=3)triangles.push(Array.from(raw.triVerts.slice(i,i+3)));
 for(const v of vertices){if(Math.abs(v[2])<1e-6)v[2]=0;if(Math.abs(v[2]-h)<1e-6)v[2]=h;}
 const cleaned=cleanTriangleSoup({vertices,triangles});
 const mesh=makeMesh(cleaned.vertices,cleaned.triangles);
 const samples=[],counts={},offsetFailures=[];
 const criticalHeights=[...new Set(mesh.vertices.map(v=>v[2]))].filter(z=>z>0&&z<h).sort((a,b)=>a-b);
 let criticalChecks=0;
 for(const z0 of criticalHeights)for(const delta of [-.0001,.0001]){
  const z=z0+delta;if(z<=0||z>=h)continue;
  const sec=solid.slice(z),loops=sec.toPolygons();sec.delete();
  const inset=offsetRegion(loops,-p.beadWidthMm/2,{arcToleranceMm:.005});criticalChecks++;
  if(loops.length!==1||inset.length!==1)throw Error(`Orphan/split contour at feature transition Z=${z}: raw=${loops.length}, bead=${inset.length}`);
 }
 for(let i=0;i<Math.round(h/p.layerMm);i++){
  const z=(i+.5)*p.layerMm,section=solid.slice(z),loops=section.toPolygons();section.delete();
  const inset=offsetRegion(loops,-p.beadWidthMm/2,{arcToleranceMm:.005});
  counts[loops.length]=(counts[loops.length]??0)+1;
  if(inset.length!==1||area(inset[0])<=0)offsetFailures.push({z,loops:inset.length});
  samples.push({z,loops,inset});
 }
 if(Object.keys(counts).some(n=>n!=="1")||offsetFailures.length)throw Error("Orphan/split section detected; no sample exported.");
 const report={criticalChecks,cleanup:cleaned.removed,parameters:p,spars,bounds:mesh.bounds,vertices:mesh.vertices.length,triangles:mesh.triangles.length,rawSectionLoopCounts:counts,offsetFailures,sampledStations:samples.length,scope:'Geometry and sampled planar offset validation only; full rising spiral and physical deposition not validated.'};
 for(const s of owned.reverse())s.delete();
 return {mesh,samples,report};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const out=resolve(process.argv[2]||'Prints/development/clark-y-vase-200');await mkdir(out,{recursive:true});
 const result=await buildVaseSample();
 await writeFile(resolve(out,'sample.stl'),encodeRepairSTL(result.mesh));
 await writeFile(resolve(out,'geometry.json'),JSON.stringify({shape:'mesh',vertices:result.mesh.vertices,triangles:result.mesh.triangles,source:null}));
 await writeFile(resolve(out,'sections.json'),JSON.stringify(result.samples));
 await writeFile(resolve(out,'report.json'),JSON.stringify(result.report,null,2));console.log(JSON.stringify(result.report,null,2));
}
