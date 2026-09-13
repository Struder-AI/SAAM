// Fast profile checks for this axisymmetric wavy part. No triangle collision engine.
import {readFile,writeFile} from 'node:fs/promises';
import {geometry,inverse,orientation,matvec} from '../../core/machine/split-delta.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function radialProfiles(mesh){
  const rings=new Map();for(const [x,y,z]of mesh.vertices){const r=Math.hypot(x,y);if(r<1e-6)continue;const row=rings.get(z)??[];row.push(r);rings.set(z,row);}
  return [...rings].sort((a,b)=>a[0]-b[0]).map(([z,r])=>{if(Math.max(...r)-Math.min(...r)>1e-5)throw Error('This fast study requires circular horizontal profiles');return [z,Math.max(...r)];});
}
// Exact centerline/radial-frustum intersection via a quadratic. Radial padding
// includes rod radius and 1 mm clearance; slope factor conservatively offsets sides.
export function rodHitsProfiles(a,b,profiles,scale,{radiusMm=3,clearanceMm=1,topMm=Infinity,shellMm=.8}={}){
  const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],pad=radiusMm+clearanceMm;
  for(let i=1;i<profiles.length;i++){
    const z0=profiles[i-1][0]*scale,z1=Math.min(topMm,profiles[i][0]*scale);if(z1<z0)break;
    let lo=0,hi=1;if(Math.abs(dz)<1e-10){if(a[2]<z0-pad||a[2]>z1+pad)continue;}else{let t0=(z0-pad-a[2])/dz,t1=(z1+pad-a[2])/dz;if(t0>t1)[t0,t1]=[t1,t0];lo=Math.max(0,t0);hi=Math.min(1,t1);if(lo>hi)continue;}
    const slope=(profiles[i][1]-profiles[i-1][1])/(profiles[i][0]-profiles[i-1][0]),r0=(profiles[i-1][1]+shellMm)*scale+slope*(a[2]-z0)+pad*Math.hypot(1,slope),rd=slope*dz;
    const A=dx*dx+dy*dy-rd*rd,B=2*(a[0]*dx+a[1]*dy-r0*rd),C=a[0]**2+a[1]**2-r0*r0;
    const q=t=>(A*t+B)*t+C;let t=q(lo)<q(hi)?lo:hi;if(A>0){const v=-B/(2*A);if(v>lo&&v<hi&&q(v)<q(t))t=v;}
    if(q(t)<=0)return {profile:i,zMm:a[2]+dz*t};
  }
  return null;
}
function radiusAt(profiles,z,scale){const local=z/scale;for(let i=1;i<profiles.length;i++)if(local<=profiles[i][0]){const [z0,r0]=profiles[i-1],[z1,r1]=profiles[i];return scale*(r0+(r1-r0)*(local-z0)/(z1-z0)+.8);}return 0;}
function radialSegment(a,b){const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/d)):0;return Math.hypot(a[0]+t*dx,a[1]+t*dy);}
// Circumscribed 12-sided plate prism, 5 mm rim and 6 mm thickness. Its horizontal
// cuts are compared to the part profiles, plus cuts at <=2 mm vertical spacing.
export function plateHitsProfiles(state,g,profiles,scale,topMm=Infinity){
  const n=12,rr=(g.rotationScaleMm+g.plateRimMm)/Math.cos(Math.PI/n),vertices=[];
  for(const h of [-g.plateThicknessMm/2,g.plateThicknessMm/2])for(let i=0;i<n;i++){const q=matvec(state.rotation,[rr*Math.cos(i*2*Math.PI/n),rr*Math.sin(i*2*Math.PI/n),h]);vertices.push(q.map((v,k)=>v+state.platform[k]));}
  const low=Math.max(0,Math.min(...vertices.map(v=>v[2]))),high=Math.min(topMm,profiles.at(-1)[0]*scale,Math.max(...vertices.map(v=>v[2])));if(low>high)return null;
  const edges=[];for(let i=0;i<n;i++){edges.push([i,(i+1)%n],[i+n,(i+1)%n+n],[i,i+n]);}
  const cuts=new Set([low,high]);for(const [z]of profiles)if(z*scale>low&&z*scale<high)cuts.add(z*scale);for(let z=low;z<=high;z+=2)cuts.add(z);
  for(const z of cuts){const ps=[];for(const [i,j]of edges){const a=vertices[i],b=vertices[j];if(z<Math.min(a[2],b[2])-1e-9||z>Math.max(a[2],b[2])+1e-9)continue;const t=Math.abs(b[2]-a[2])<1e-10?0:(z-a[2])/(b[2]-a[2]);ps.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}if(!ps.length)continue;
    const c=ps.reduce((s,p)=>[s[0]+p[0]/ps.length,s[1]+p[1]/ps.length],[0,0]);ps.sort((a,b)=>Math.atan2(a[1]-c[1],a[0]-c[0])-Math.atan2(b[1]-c[1],b[0]-c[0]));
    const area=ps.reduce((sum,a,i)=>{const b=ps[(i+1)%ps.length];return sum+a[0]*b[1]-a[1]*b[0];},0);
    let inside=ps.length>=3&&area>1e-7,min=Infinity;for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length];if((b[0]-a[0])*(-a[1])-(b[1]-a[1])*(-a[0])< -1e-8)inside=false;min=Math.min(min,radialSegment(a,b));}
    if(inside||min<=radiusAt(profiles,z,scale)+1)return {zMm:z};
  }return null;
}
export function checkCladding(g,poses,profiles,scale,{attackDeg=0,stageHeightMm=Infinity,stopEarly=true,includePlate=true}={}){
  let rodCount=0,plateCount=0,invalidCount=0,worst=null,samples=0;
  for(const pose of poses){
    const R=orientation(pose.tiltDeg,pose.azimuthDeg+attackDeg,0),s=inverse(g,{tcp:pose.tcp.map(v=>v*scale),rotation:R},{diagnostics:false}),top=Math.min(profiles.at(-1)[0]*scale,Math.ceil(pose.tcp[2]*scale/stageHeightMm)*stageHeightMm||Infinity);samples++;
    let rod=null;for(let i=0;i<s.carriages.length;i++){const hit=rodHitsProfiles(s.points[i],s.carriages[i],profiles,scale,{topMm:top,radiusMm:g.rodDiameterMm/2});if(hit){rod={rod:i+1,...hit};break;}}
    const plate=includePlate?plateHitsProfiles(s,g,profiles,scale,top):null;if(rod)rodCount++;if(plate)plateCount++;if(!s.valid)invalidCount++;
    if(rod||plate||!s.valid){worst??={action:pose.action,tcp:s.tcp,rod,plate,errors:s.errors};if(stopEarly)return {passed:false,samples,worst,rodCount,plateCount,invalidCount};}
  }return {passed:!worst,samples,worst,rodCount,plateCount,invalidCount};
}
async function main(){
  const dir='Prints/development/splitty-inward-5',study=JSON.parse(await readFile(dir+'/study.json','utf8')),g=geometry(study.results[0].config),plan=JSON.parse(await readFile('Prints/development/wavy-vase-crossed-helices/plan.json','utf8')),path=JSON.parse(await readFile('Prints/development/split-delta-wavy-preview/path.saampath','utf8')),profiles=radialProfiles(plan.geometry);
  const all=path.actions.map((a,i)=>({...a,index:i})).filter(a=>a.kind==='move'&&a.phase?.startsWith('cladding')).map(a=>({tcp:a.to,action:a.index,tiltDeg:Math.min(40,Math.acos(Math.max(-1,Math.min(1,-a.pose.toolAxis[2])))*180/Math.PI),azimuthDeg:Math.atan2(-a.pose.toolAxis[1],-a.pose.toolAxis[0])*180/Math.PI}));
  const coarse=all.filter((p,i)=>i%Math.ceil(all.length/400)===0||i===all.length-1),results=[];
  for(const attackDeg of [0,-15,15,-30,30]){
    let lo=.25,hi=study.results[0].scale;const first=checkCladding(g,coarse,profiles,lo,{attackDeg});if(!first.passed){results.push({attackDeg,scale:0,first});continue;}
    while(hi-lo>.02){const mid=(lo+hi)/2;if(checkCladding(g,coarse,profiles,mid,{attackDeg}).passed)lo=mid;else hi=mid;}
    results.push({attackDeg,scale:Math.floor(lo*100)/100,bracket:[lo,hi],firstFailure:checkCladding(g,coarse,profiles,hi,{attackDeg}).worst});
  }
  const current=checkCladding(g,coarse,profiles,study.results[0].scale,{stopEarly:false});
  let chosen=results.find(r=>r.attackDeg===0),scale=chosen.scale,full=checkCladding(g,all,profiles,scale,{stopEarly:false});
  while(!full.passed&&scale>.25){scale=Math.round((scale-.05)*100)/100;full=checkCladding(g,all,profiles,scale,{stopEarly:true});}
  const report={config:study.results[0].config,profileCount:profiles.length,claddingPoses:all.length,currentScale:study.results[0].scale,current,approachComparison:results,selected:{attackDeg:0,scale,diameterMm:24.399867887378893*scale,heightMm:30*scale,full},assumptions:'Circular profiles from source mesh, inflated by all four cladding shells (0.8 source mm); rods radius 3 mm plus 1 mm clearance; conservative plate prism with 5 mm rim / 6 mm thickness / 1 mm profile clearance; hotend excluded. Existing wall-first ordering, full part height. Rod/frustum intersections analytical; plate cuts <=2 mm. Poses are cladding source endpoints, not continuous swept-body certification.'};
  await writeFile(dir+'/cladding-clearance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
