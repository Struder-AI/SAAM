// Browser/Node reference model: six vertical prismatic actuators, fixed rods,
// spherical endpoints. Coordinates are nozzle TCP mm; rotations are radians internally.
export const RAD=Math.PI/180;
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const mul=(a,s)=>a.map(v=>v*s);
export const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm=a=>Math.hypot(...a);
const unit=a=>mul(a,1/norm(a));
const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,dot(unit(a),unit(b)))))/RAD;
export const matvec=(m,v)=>m.map(r=>dot(r,v));
const transpose=m=>m[0].map((_,i)=>m.map(r=>r[i]));
const mm=(a,b)=>a.map(r=>transpose(b).map(c=>dot(r,c)));
export const identity=()=>[[1,0,0],[0,1,0],[0,0,1]];
export function rotationVector(v){
  const t=norm(v);if(t<1e-14)return identity();const [x,y,z]=mul(v,1/t),c=Math.cos(t),s=Math.sin(t),d=1-c;
  return [[c+x*x*d,x*y*d-z*s,x*z*d+y*s],[y*x*d+z*s,c+y*y*d,y*z*d-x*s],[z*x*d-y*s,z*y*d+x*s,c+z*z*d]];
}
// Tilt toward azimuth, with independent spin about the tool's own Z axis.
export function orientation(tiltDeg=0,azimuthDeg=0,spinDeg=0){
  const a=azimuthDeg*RAD;
  return mm(rotationVector([-Math.sin(a)*tiltDeg*RAD,Math.cos(a)*tiltDeg*RAD,0]),rotationVector([0,0,spinDeg*RAD]));
}
export const DEFAULT_GEOMETRY=Object.freeze({towerRadiusMm:180,railSeparationMm:50,railTiltDeg:0,railToeDeg:0,railReferenceHeightMm:0,platformRadiusMm:55,platformPairMm:120,platformClockDeg:0,platformPairSkewDeg:0,rodLengthMm:450,rodDiameterMm:6,plateThicknessMm:6,plateRimMm:5,toolLengthMm:120,jointConeDeg:90,marginDeg:4,operatingTiltDeg:45,minSingularRatio:0.02,railMinMm:0,railMaxMm:900});
export function validateGeometry(g){
  for(const key of Object.keys(DEFAULT_GEOMETRY))if(!Number.isFinite(g[key]))throw Error(`Invalid geometry ${key}`);
  for(const k of ['towerRadiusMm','railSeparationMm','platformRadiusMm','platformPairMm','rodLengthMm','toolLengthMm'])if(g[k]<=0)throw Error(`${k} must be positive`);
  if(Math.abs(g.railToeDeg)>40||g.rodDiameterMm<=0||g.plateThicknessMm<=0||g.plateRimMm<0)throw Error('Invalid toe angle or body dimensions');
  if(Math.abs(g.railTiltDeg)>30||g.railReferenceHeightMm<0||g.towerRadiusMm-g.railReferenceHeightMm*Math.tan(g.railTiltDeg*RAD)<=0)throw Error('Invalid rail inclination or reference radius');
  if(g.marginDeg<0||g.jointConeDeg<=g.marginDeg||g.jointConeDeg>180||g.operatingTiltDeg<0||g.operatingTiltDeg+g.marginDeg>=90||g.minSingularRatio<=0||g.minSingularRatio>=1||g.railMaxMm<=g.railMinMm)throw Error('Invalid angular, singularity or track limits');
  return g;
}
export function geometry(config=DEFAULT_GEOMETRY){
  const g=validateGeometry({...DEFAULT_GEOMETRY,...config}),rails=[],anchors=[],railDirections=[];
  for(let t=0;t<3;t++)for(const sign of [-1,1]){
    const a=t*2*Math.PI/3,e=[Math.cos(a),Math.sin(a),0],f=[-e[1],e[0],0];
    const radial=[e[0]*Math.sin(g.railTiltDeg*RAD),e[1]*Math.sin(g.railTiltDeg*RAD),Math.cos(g.railTiltDeg*RAD)],toe=g.railToeDeg*RAD/2;
    const direction=add(mul(radial,Math.cos(toe)),mul(f,sign*Math.sin(toe))),mid=add(add(mul(e,g.towerRadiusMm),mul(f,sign*g.railSeparationMm/2)),[0,0,g.railReferenceHeightMm]);
    rails.push(sub(mid,mul(direction,g.railReferenceHeightMm/direction[2])));railDirections.push(direction);
    const pairDirection=add(mul(f,Math.cos(g.platformPairSkewDeg*RAD)),mul(e,Math.sin(g.platformPairSkewDeg*RAD)));
    anchors.push(matvec(rotationVector([0,0,g.platformClockDeg*RAD]),add(mul(e,g.platformRadiusMm),mul(pairDirection,sign*g.platformPairMm/2))));
  }
  const rest=anchors.map((p,i)=>{const d=sub(add(p,[0,0,g.toolLengthMm]),rails[i]),a=railDirections[i],v=dot(d,a),q=g.rodLengthMm**2-dot(d,d)+v*v;if(q<=0)throw Error('Neutral pose is unreachable');return unit(sub(d,mul(a,v+Math.sqrt(q))));});
  return {...g,rails,railDirections,anchors,rest,rotationScaleMm:Math.max(...anchors.map(norm))};
}
// Rail coordinates are distance along the rail from its intersection with Z=0.
// At zero inclination they are identical to the original carriage Z heights.
export const carriagePoint=(g,i,s)=>add(g.rails[i],mul(g.railDirections[i],s));
// Optional inward carriage bracket: the kinematic line is the spherical pivot
// trajectory; the physical rail body is radially outward by this offset.
export function railBodyPoint(g,i,s){const a=Math.floor(i/2)*2*Math.PI/3,d=g.railMountOffsetMm??0;return add(carriagePoint(g,i,s),[d*Math.cos(a),d*Math.sin(a),0]);}
// Design-family constraint, separate from general six-rod IK. Each tower pair
// occupies its own outward-facing 120-degree sector, and the six anchors form
// a convex perimeter in A1,A2,B1,B2,C1,C2 order (up to cyclic rotation).
export function pairedEdgeLayout(g){
  const errors=[],points=g.anchors;
  for(let i=0;i<6;i++){
    const a=Math.floor(i/2)*2*Math.PI/3,p=points[i],radial=p[0]*Math.cos(a)+p[1]*Math.sin(a),tangent=-p[0]*Math.sin(a)+p[1]*Math.cos(a);
    if(radial<=0||Math.abs(tangent)>=Math.sqrt(3)*radial-1e-8)errors.push(`${'ABC'[Math.floor(i/2)]}${i%2+1} leaves its tower's plate sector`);
  }
  const order=points.map((p,i)=>({i,a:Math.atan2(p[1],p[0])})).sort((p,q)=>p.a-q.a).map(p=>p.i);
  if(order.some((v,i)=>(order[(i+1)%6]-v+6)%6!==1))errors.push('Tower pairs interleave around the plate');
  for(let i=0;i<6;i++){
    const a=points[i],b=points[(i+1)%6],c=points[(i+2)%6];
    if((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])<=1e-8){errors.push('Paired edges do not form a convex six-anchor perimeter');break;}
  }
  return {passed:errors.length===0,errors,order:order.map(i=>`${'ABC'[Math.floor(i/2)]}${i%2+1}`)};
}
// Explicit study envelope: pivot hull + 5 mm planar rim, 6 mm plate thickness.
export function plateEnvelopeMinimumZ(points,rotation,{plateRimMm=5,plateThicknessMm=6}={}){const nz=Math.abs(rotation[2][2]);return Math.min(...points.map(p=>p[2]))-plateRimMm*Math.sqrt(Math.max(0,1-nz*nz))-plateThicknessMm/2*nz;}
// Small symmetric Jacobi eigensolver for singular values of the normalized 6x6 constraint matrix.
export function singularValues(a){
  const b=mm(transpose(a),a),n=b.length;
  for(let iter=0;iter<100;iter++){
    let p=0,q=1;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(Math.abs(b[i][j])>Math.abs(b[p][q])){p=i;q=j;}
    if(Math.abs(b[p][q])<1e-12)break;
    const phi=0.5*Math.atan2(2*b[p][q],b[q][q]-b[p][p]),c=Math.cos(phi),s=Math.sin(phi),pp=b[p][p],qq=b[q][q],pq=b[p][q];
    for(let k=0;k<n;k++)if(k!==p&&k!==q){const kp=b[k][p],kq=b[k][q];b[k][p]=b[p][k]=c*kp-s*kq;b[k][q]=b[q][k]=s*kp+c*kq;}
    b[p][p]=c*c*pp-2*s*c*pq+s*s*qq;b[q][q]=s*s*pp+2*s*c*pq+c*c*qq;b[p][q]=b[q][p]=0;
  }
  return b.map((r,i)=>Math.sqrt(Math.max(0,r[i]))).sort((x,y)=>x-y);
}
export function solveLinear(a,b){
  const m=a.map((r,i)=>[...r,b[i]]),n=b.length;
  for(let i=0;i<n;i++){
    let p=i;for(let j=i+1;j<n;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;
    if(Math.abs(m[p][i])<1e-12)throw Error('Singular pose');[m[p],m[i]]=[m[i],m[p]];
    const d=m[i][i];for(let k=i;k<=n;k++)m[i][k]/=d;
    for(let j=0;j<n;j++)if(j!==i){const f=m[j][i];for(let k=i;k<=n;k++)m[j][k]-=f*m[i][k];}
  }
  return m.map(r=>r[n]);
}
export function determinant(a){
  const m=a.map(r=>[...r]);let d=1;
  for(let i=0;i<m.length;i++){let p=i;for(let j=i+1;j<m.length;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;
    if(Math.abs(m[p][i])<1e-14)return 0;if(p!==i){[m[p],m[i]]=[m[i],m[p]];d=-d;}d*=m[i][i];
    for(let j=i+1;j<m.length;j++){const f=m[j][i]/m[i][i];for(let k=i+1;k<m.length;k++)m[j][k]-=f*m[i][k];}}
  return d;
}
export function inverse(g,pose,{ignoreTrack=false,diagnostics=true}={}){
  const tcp=pose.tcp,R=pose.rotation??orientation(pose.tiltDeg,pose.azimuthDeg,pose.spinDeg);
  if(!Array.isArray(tcp)||tcp.length!==3||!tcp.every(Number.isFinite))throw Error('TCP requires three finite coordinates');
  if(!Array.isArray(R)||R.length!==3||R.some(r=>!Array.isArray(r)||r.length!==3||!r.every(Number.isFinite)))throw Error('Invalid rotation');
  const rt=mm(R,transpose(R));if(rt.some((r,i)=>r.some((v,j)=>Math.abs(v-(i===j?1:0))>1e-7))||Math.abs(determinant(R)-1)>1e-7)throw Error('Rotation must be right-handed orthonormal');
  const platform=add(tcp,matvec(R,[0,0,g.toolLengthMm])),points=g.anchors.map(a=>add(platform,matvec(R,a))),heights=[],carriages=[],rows=[],errors=[];
  const minPlateEnvelopeZMm=plateEnvelopeMinimumZ(points,R,g);
  if(g.checkPlateBedClearance&&minPlateEnvelopeZMm<2)errors.push('Plate envelope below 2 mm bed clearance');
  let minRodElevationDeg=90,maxJointDeflectionDeg=0;
  for(let i=0;i<6;i++){
    const p=points[i],rail=g.rails[i],axis=g.railDirections[i],d=sub(p,rail),v=dot(d,axis),q=g.rodLengthMm**2-dot(d,d)+v*v;
    if(q<=0)return {valid:false,errors:[`Rod ${i+1} cannot reach (upper branch)`],tcp,rotation:R,platform,points,heights,carriages};
    const dz=Math.sqrt(q),h=v+dz,c=carriagePoint(g,i,h),u=unit(sub(p,c)),lever=matvec(R,g.anchors[i]);
    heights.push(h);carriages.push(c);rows.push([...u,...mul(cross(lever,u),1/g.rotationScaleMm)]);
    minRodElevationDeg=Math.min(minRodElevationDeg,Math.asin(dz/g.rodLengthMm)/RAD);
    maxJointDeflectionDeg=Math.max(maxJointDeflectionDeg,angle(u,g.rest[i]),angle(matvec(transpose(R),u),g.rest[i]));
    if(!ignoreTrack&&(h<g.railMinMm||h>g.railMaxMm))errors.push(`Carriage ${i+1} exceeds working track`);
  }
  if(minRodElevationDeg<g.marginDeg)errors.push('Rod elevation reserve below limit');
  if(maxJointDeflectionDeg>g.jointConeDeg-g.marginDeg)errors.push('Spherical joint angular reserve below limit');
  const sv=diagnostics?singularValues(rows):null,ratio=sv?sv[0]/sv[5]:null;
  if(ratio!==null&&ratio<g.minSingularRatio)errors.push('Near parallel singularity');
  return {valid:!errors.length,errors,tcp,rotation:R,platform,points,heights,carriages,rows,minPlateEnvelopeZMm,minRodElevationDeg,maxJointDeflectionDeg,singularRatio:ratio,determinant:determinant(rows),tiltDeg:angle(matvec(R,[0,0,1]),[0,0,1])};
}
// Seeded forward solve stays local; callers must supply the preceding pose.
// Returns failure instead of silently selecting another assembly mode.
export function forward(g,heights,seed,{toleranceMm=1e-7,maxIterations=35}={}){
  if(heights.length!==6||!heights.every(Number.isFinite))throw Error('Six finite carriage heights required');
  let tcp=[...seed.tcp],R=seed.rotation??orientation(seed.tiltDeg,seed.azimuthDeg,seed.spinDeg);
  for(let iteration=0;iteration<maxIterations;iteration++){
    const rows=[],residual=[];
    for(let i=0;i<6;i++){const lever=matvec(R,add(g.anchors[i],[0,0,g.toolLengthMm])),p=add(tcp,lever),d=sub(p,carriagePoint(g,i,heights[i])),u=unit(d);residual.push(norm(d)-g.rodLengthMm);rows.push([...u,...cross(lever,u)]);}
    if(Math.max(...residual.map(Math.abs))<toleranceMm){const result=inverse(g,{tcp,rotation:R});if(result.heights.length!==6||result.heights.some((h,i)=>Math.abs(h-heights[i])>toleranceMm*10))throw Error('Forward result leaves upper assembly branch');return {...result,iterations:iteration};}
    const delta=solveLinear(rows,residual.map(v=>-v));
    const scale=Math.min(1,10/Math.max(1e-12,norm(delta.slice(0,3))),0.1/Math.max(1e-12,norm(delta.slice(3))));
    tcp=add(tcp,mul(delta.slice(0,3),scale));R=mm(rotationVector(mul(delta.slice(3),scale)),R);
  }
  throw Error('Forward kinematics did not converge from supplied seed');
}

// Deterministic disk × tilt-cone × spin grid. This is sampled evidence, not a
// continuous workspace proof or a collision/dynamics certification.
export function assessCylinder(g,{diameterMm=200,heightMm=200,radialSteps=4,azimuthSteps=24,tiltSteps=5,heightSteps=4,spinValues=[0],reserve=true,stopEarly=false}={}){
  if(reserve){
    const options={diameterMm,heightMm,radialSteps,azimuthSteps,tiltSteps,heightSteps,spinValues,stopEarly,reserve:false};
    const operating=assessCylinder(g,options);
    if(!operating.passed&&stopEarly)return operating;
    const raw=geometry({...g,marginDeg:0,operatingTiltDeg:g.operatingTiltDeg+g.marginDeg,checkPlateBedClearance:false});
    const probe=assessCylinder(raw,{...options,spinValues:[...new Set(spinValues.flatMap(s=>[s-g.marginDeg,s,s+g.marginDeg]))]});
    return {...operating,passed:operating.passed&&probe.passed,samples:operating.samples+probe.samples,failures:operating.failures+probe.failures,worst:operating.worst??probe.worst,kinematicProbeTiltDeg:raw.operatingTiltDeg,requiredJointConeDeg:Math.max(operating.requiredJointConeDeg??0,probe.maxJointDeflectionDeg??0),coverage:'Operating poses supply carriage travel and analytical angular margins. Expanded orientation grid probes raw kinematic limits with zero additional margin; no collision-free operation at the probe tilt is required. Sampled evidence only.'};
  }
  if(!Number.isFinite(diameterMm)||diameterMm<0||!Number.isFinite(heightMm)||heightMm<0||![radialSteps,azimuthSteps,tiltSteps].every(v=>Number.isInteger(v)&&v>0)||!spinValues.length||!spinValues.every(Number.isFinite))throw Error('Invalid assessment grid');
  const limit=g.operatingTiltDeg+(reserve?g.marginDeg:0),neutral=inverse(g,{tcp:[0,0,0]},{ignoreTrack:true}),branch=Math.sign(neutral.determinant);
  if(!Number.isInteger(heightSteps)||heightSteps<1)throw Error('Invalid height sampling');
  const vertical=g.railTiltDeg===0,zSteps=vertical||heightMm===0?0:heightSteps;
  let samples=0,failures=0,minHeight=Infinity,maxHeight=-Infinity,minBed=Infinity,maxBed=-Infinity,minRatio=Infinity,minElevation=90,maxJoint=0,worst=null;
  for(let iz=0;iz<=zSteps;iz++)for(let ir=0;ir<=radialSteps;ir++)for(let ip=0;ip<(ir?azimuthSteps:1);ip++)for(let it=0;it<=tiltSteps;it++)for(let ia=0;ia<(it?azimuthSteps:1);ia++)for(const spin of spinValues){
    const a=ip*2*Math.PI/azimuthSteps,r=diameterMm/2*ir/radialSteps,pose={tcp:[r*Math.cos(a),r*Math.sin(a),zSteps?heightMm*iz/zSteps:0],tiltDeg:limit*it/tiltSteps,azimuthDeg:ia*360/azimuthSteps,spinDeg:spin},s=inverse(g,pose,{ignoreTrack:true});samples++;
    if(s.heights.length===6){minHeight=Math.min(minHeight,...s.heights);maxHeight=Math.max(maxHeight,...s.heights);if(!iz){minBed=Math.min(minBed,...s.heights);maxBed=Math.max(maxBed,...s.heights);}minRatio=Math.min(minRatio,s.singularRatio);minElevation=Math.min(minElevation,s.minRodElevationDeg);maxJoint=Math.max(maxJoint,s.maxJointDeflectionDeg);}
    if(!s.valid||Math.sign(s.determinant)!==branch){failures++;worst??={pose,reasons:[...s.errors,...(Math.sign(s.determinant)!==branch?['Assembly determinant changes sign']:[])]};if(stopEarly)return {passed:false,samples,failures,worst};}
  }
  if(vertical)maxHeight+=heightMm;
  const workingTrackMm=maxHeight-minHeight,overheadMm=workingTrackMm-heightMm;
  return {passed:failures===0,samples,failures,diameterMm,heightMm,testedTiltDeg:limit,spinValues,grid:{radialSteps,azimuthSteps,tiltSteps,heightSteps:zSteps},heightIndependentReach:vertical,minSingularRatio:minRatio,minRodElevationDeg:minElevation,maxJointDeflectionDeg:maxJoint,requiredJointConeDeg:maxJoint+g.marginDeg,carriageAtBedMm:[minBed,maxBed],overheadMm,workingTrackMm,railIntervalMm:[minHeight,maxHeight],fitsConfiguredTrack:minHeight>=g.railMinMm&&maxHeight<=g.railMaxMm,worst,coverage:'Sampled kinematics only; no collisions, loads, tolerances or continuous-domain proof'};
}

export function findCylinder(g,{maxDiameterMm=400,toleranceMm=1,...options}={}){
  if(!Number.isFinite(maxDiameterMm)||maxDiameterMm<=0||!Number.isFinite(toleranceMm)||toleranceMm<=0)throw Error('Invalid diameter search range');
  const probe=d=>assessCylinder(g,{...options,diameterMm:d,stopEarly:true});
  const center=probe(0);if(!center.passed)return {diameterMm:0,centerReachable:false,limitedBySearchCap:false,firstFailure:center.worst,assessment:assessCylinder(g,{...options,diameterMm:0})};
  let lo=0,hi=maxDiameterMm,limitedBySearchCap=probe(hi).passed;
  if(limitedBySearchCap)lo=hi;
  else while(hi-lo>toleranceMm){const mid=(lo+hi)/2;if(probe(mid).passed)lo=mid;else hi=mid;}
  return {diameterMm:lo,centerReachable:true,limitedBySearchCap,bracketMm:[lo,hi],assessment:assessCylinder(g,{...options,diameterMm:lo}),coverage:'Bisection using sampled disks; geometric radius only, track fit reported separately. Not a certified continuous maximum.'};
}
