import {add,sub,scale,dot,cross,norm,mv,mm,rotation,rigid,validateRigid} from './rigid.mjs';
import {singularValues} from './split-delta.mjs';

// Design dimensions, not a measured machine. Three delta parallelograms keep
// the carrier level; Rx(pitch) Ry(tilt) is a two-axis, roll-constrained gimbal.
export const TILTY_DEFAULTS=Object.freeze({towerRadiusMm:180,platformRadiusMm:35,pairSpacingMm:30,
  rodLengthMm:350,tiltRodLengthMm:350,toolLengthMm:70,rearLengthMm:120,rearRadiusMm:20,
  railMinMm:249.5,tiltRailMinMm:[284.3,287.4,287.4],railMaxMm:650,maxTiltDeg:40,marginDeg:4,minSingularRatio:.02});
export function tiltyGeometry(config={}){
  const g={...TILTY_DEFAULTS,...config};
  for(const key of Object.keys(TILTY_DEFAULTS))if(key!=='tiltRailMinMm'&&!Number.isFinite(g[key]))throw Error('Invalid Tilty '+key);
  if(!Array.isArray(g.tiltRailMinMm)||g.tiltRailMinMm.length!==3||!g.tiltRailMinMm.every(v=>Number.isFinite(v)&&v<g.railMaxMm))throw Error('Invalid Tilty tilt rail minima');
  g.tiltRailMinMm=[...g.tiltRailMinMm];
  for(const key of ['towerRadiusMm','platformRadiusMm','pairSpacingMm','rodLengthMm','tiltRodLengthMm','toolLengthMm','rearLengthMm','rearRadiusMm'])if(g[key]<=0)throw Error(key+' must be positive');
  if(g.railMaxMm<=g.railMinMm||g.maxTiltDeg<=0||g.maxTiltDeg>=85)throw Error('Invalid Tilty travel or tilt limit');
  if(g.marginDeg<0||g.marginDeg+g.maxTiltDeg>=90||g.minSingularRatio<=0||g.minSingularRatio>=1)throw Error('Invalid Tilty singularity reserve');
  g.towers=Array.from({length:3},(_,i)=>{const a=i*2*Math.PI/3;return [Math.cos(a),Math.sin(a),0];});return g;
}
export const gimbalRotation=(pitch,tilt)=>mm(rotation([1,0,0],pitch),rotation([0,1,0],tilt));
// The tip stays in the rail cylinder. The carrier center stays in a concentric
// disk of radius towerRadius-platformRadius. Within that disk at least one of
// the three main reach centers is no farther than that radius from the carrier.
// This bounds height conservatively; the solver owns the coupled boundaries.
export function tiltyBounds(g){
  const r=g.towerRadiusMm-g.platformRadiusMm,vertical=g.toolLengthMm*Math.cos(g.maxTiltDeg*Math.PI/180);
  return {min:[-g.towerRadiusMm,-g.towerRadiusMm,0],max:[g.towerRadiusMm,g.towerRadiusMm,g.railMaxMm-Math.sqrt(Math.max(0,g.rodLengthMm**2-r*r))-vertical]};
}
export function tiltyInverse(g,{tcp,rotation:R}){
  validateRigid(rigid(tcp,R));
  const tilt=Math.asin(Math.max(-1,Math.min(1,R[0][2]))),pitch=Math.atan2(-R[1][2],R[2][2]),expected=gimbalRotation(pitch,tilt);
  if(expected.some((row,i)=>row.some((v,j)=>Math.abs(v-R[i][j])>1e-6)))return {valid:false,errors:['Requested tool roll is incompatible with the two-axis gimbal']};
  const platform=add(tcp,mv(R,[0,0,g.toolLengthMm])),mainHeights=[],tiltHeights=[],rods=[],errors=[],margins=[],rows=[];
  let minRodElevationDeg=90;
  const solve=(p,rail,length,minimum=g.railMinMm)=>{const dx=p[0]-rail[0],dy=p[1]-rail[1],q=length*length-dx*dx-dy*dy;
    margins.push((q-1e-8)/length);
    if(q<=1e-8)errors.push('Rod cannot reach on the upper carriage branch');
    const dz=Math.sqrt(Math.max(0,q)),elevation=Math.asin(Math.min(1,dz/length))*180/Math.PI;
    minRodElevationDeg=Math.min(minRodElevationDeg,elevation);margins.push(elevation-g.marginDeg);
    if(elevation<g.marginDeg-1e-7)errors.push('Rod elevation reserve below limit');
    const h=p[2]+dz;margins.push(h-minimum,g.railMaxMm-h);
    if(h<minimum||h>g.railMaxMm)errors.push('Carriage exceeds configured rail travel');return h;};
  try{for(let i=0;i<3;i++){
    const e=g.towers[i],t=[-e[1],e[0],0],rail=scale(e,g.towerRadiusMm),anchor=add(platform,scale(e,g.platformRadiusMm));
    const h=solve(anchor,rail,g.rodLengthMm);mainHeights.push(h);
    rows.push([...scale(sub(anchor,add(rail,[0,0,h])),1/g.rodLengthMm),0,0]);
    for(const side of [-1,1]){const offset=scale(t,side*g.pairSpacingMm/2);rods.push({from:add(add(rail,[0,0,h]),offset),to:add(anchor,offset),kind:'main',tower:i});}
    const rear=add(platform,mv(R,add(scale(e,g.rearRadiusMm),[0,0,g.rearLengthMm]))),ht=solve(rear,rail,g.tiltRodLengthMm,g.tiltRailMinMm[i]);tiltHeights.push(ht);
    // Constraint Jacobian in carrier XYZ and lever-scaled gimbal angles.
    // Three main rows plus three tilt rows constrain five coordinates.
    const u=scale(sub(rear,add(rail,[0,0,ht])),1/g.tiltRodLengthMm),lever=sub(rear,platform),angleScale=Math.hypot(g.rearLengthMm,g.rearRadiusMm);
    rows.push([...u,dot(u,cross([1,0,0],lever))/angleScale,dot(u,cross([0,Math.cos(pitch),Math.sin(pitch)],lever))/angleScale]);
    rods.push({from:add(rail,[0,0,ht]),to:rear,kind:'tilt',tower:i});
  }}catch(error){errors.push(error.message);}
  const tiltMargin=g.maxTiltDeg-Math.acos(Math.max(-1,Math.min(1,R[2][2])))*180/Math.PI;margins.push(tiltMargin);
  if(tiltMargin< -1e-7)errors.push('Hotend exceeds configured tilt cone');
  const contain=(margin,message)=>{margins.push(margin);if(margin< -1e-7)errors.push(message);};
  contain(tcp[2],'Nozzle is below the bed');
  contain(g.towerRadiusMm-Math.hypot(tcp[0],tcp[1]),'Nozzle exceeds rail radius');
  contain(g.towerRadiusMm-g.platformRadiusMm-Math.hypot(platform[0],platform[1]),'Carrier plate exceeds rail radius');
  const tiltRods=rods.filter(r=>r.kind==='tilt');
  // The modeled tilt plate is the triangle joining its three ball joints.
  // A cylinder and each envelope half-space are convex: endpoint checks contain
  // the complete triangular plate and straight rods, not just sampled points.
  for(const rod of tiltRods)contain(g.towerRadiusMm-Math.hypot(rod.to[0],rod.to[1]),'Tilt plate exceeds rail radius');
  for(let i=0;i<3;i++){
    // Each paired main arm defines one side of the main-arm envelope. Extend
    // those side planes upward because tilt carriages sit above the main ones.
    const e=g.towers[i],dz=mainHeights[i]-platform[2],out=g.towerRadiusMm-g.platformRadiusMm-dot(e,platform),normal=[dz*e[0],dz*e[1],-out],length=Math.hypot(dz,out);
    for(const rod of tiltRods)for(const p of [rod.from,rod.to])contain((dz*g.platformRadiusMm-dot(normal,sub(p,platform)))/Math.max(1e-9,length),'Tilt assembly crosses main-arm envelope');
  }
  const sv=singularValues(rows),singularRatio=sv[0]/sv[4];margins.push((singularRatio-g.minSingularRatio)*g.rodLengthMm);
  if(!Number.isFinite(singularRatio)||singularRatio<g.minSingularRatio)errors.push('Near parallel singularity');
  return {valid:!errors.length,errors,margins,tcp,rotation:R,platform,mainHeights,tiltHeights,rods,gimbalRadians:[pitch,tilt],minRodElevationDeg,singularRatio};
}

// Forward inspection accepts all six actuators and rejects inconsistent redundant
// tilt positions. Seeded least squares solves five pose coordinates, never six.
export function tiltyForward(g,heights,seed,{toleranceMm=1e-6,maxIterations=40}={}){
  if(heights.length!==6||!heights.every(Number.isFinite))throw Error('Tilty needs six finite carriage positions');
  let x=[...seed.tcp,...(seed.gimbalRadians??[0,0])];
  const evaluate=v=>tiltyInverse(g,{tcp:v.slice(0,3),rotation:gimbalRotation(v[3],v[4])});
  for(let n=0;n<maxIterations;n++){
    const s=evaluate(x),h=[...s.mainHeights??[],...s.tiltHeights??[]];if(h.length!==6)throw Error('Forward seed cannot reach');
    const r=h.map((v,i)=>v-heights[i]);
    if(Math.max(...r.map(Math.abs))<toleranceMm)return s;
    const cols=x.map((_,j)=>{const y=[...x],step=j<3?1e-4:1e-6;y[j]+=step;const p=evaluate(y);return [...p.mainHeights,...p.tiltHeights].map((v,i)=>(v-h[i])/step);});
    const a=cols.map((c,i)=>[...cols.map((d,j)=>dot(c,d)+(i===j?1e-8:0)),-dot(c,r)]);
    for(let i=0;i<5;i++){let p=i;for(let j=i+1;j<5;j++)if(Math.abs(a[j][i])>Math.abs(a[p][i]))p=j;[a[i],a[p]]=[a[p],a[i]];
      if(Math.abs(a[i][i])<1e-12)throw Error('Tilty forward singularity');const d=a[i][i];for(let k=i;k<=5;k++)a[i][k]/=d;
      for(let j=0;j<5;j++)if(j!==i){const f=a[j][i];for(let k=i;k<=5;k++)a[j][k]-=f*a[i][k];}}
    const delta=a.map(row=>row[5]),factor=Math.min(1,10/Math.max(1e-12,norm(delta.slice(0,3))),.1/Math.max(1e-12,norm(delta.slice(3))));x=x.map((v,i)=>v+delta[i]*factor);
  }
  throw Error('Incompatible Tilty actuator positions or forward solve did not converge');
}
