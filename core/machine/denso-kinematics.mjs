import {add,sub,scale,dot,cross,norm,mv,mm,transpose,identity,rotation,rigid,validateRigid} from './rigid.mjs';

// Nominal centerlines from DENSO VP-6242 dimension drawing 001050_1.pdf:
// https://www.denso-wave.com/fsys/en/robot/product/five-six/vp/001050_1.pdf
// These are MODEL angles, not calibrated RC8 encoders/FIG. At zero: upper arm
// vertical, forearm toward +X with +75 mm offset, flange toward +X.
export const DENSO_MODEL_DEFAULTS=Object.freeze({shoulderHeightMm:280,upperMm:210,forearmMm:210,
  elbowOffsetMm:75,flangeMm:70,toolLengthMm:70});
export function densoGeometry(config={}){
  const g={...DENSO_MODEL_DEFAULTS,...config};for(const key of Object.keys(DENSO_MODEL_DEFAULTS))if(!Number.isFinite(g[key])||g[key]<=0)throw Error('Invalid DENSO '+key);return g;
}
export function densoForward(g,joints){
  if(joints.length!==6||!joints.every(Number.isFinite))throw Error('DENSO needs six finite model joint angles');
  let R=identity(),p=[0,0,0];const points=[p],axes=[],origins=[];
  const turn=(axis,i)=>{axes.push(mv(R,axis));origins.push(p);R=mm(R,rotation(axis,joints[i]*Math.PI/180));};
  const move=v=>{p=add(p,mv(R,v));points.push(p);};
  turn([0,0,1],0);move([0,0,g.shoulderHeightMm]);turn([0,1,0],1);move([0,0,g.upperMm]);
  turn([0,1,0],2);move([g.forearmMm,0,g.elbowOffsetMm]);turn([1,0,0],3);turn([0,1,0],4);turn([1,0,0],5);
  move([g.flangeMm,0,0]);move([g.toolLengthMm,0,0]);
  // Map nozzle +X of the flange into presentation -Z, retaining flange +Y.
  const presentation=mm(R,[[0,0,-1],[0,1,0],[1,0,0]]);
  return {tcp:p,rotation:presentation,points,axes,origins,joints:[...joints]};
}
const linear=(a,b)=>{
  const m=a.map((row,i)=>[...row,b[i]]),n=b.length;
  for(let i=0;i<n;i++){let p=i;for(let j=i+1;j<n;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;[m[p],m[i]]=[m[i],m[p]];
    if(Math.abs(m[i][i])<1e-12)throw Error('Singular DENSO solve');const d=m[i][i];for(let k=i;k<=n;k++)m[i][k]/=d;
    for(let j=0;j<n;j++)if(j!==i){const f=m[j][i];for(let k=i;k<=n;k++)m[j][k]-=f*m[i][k];}}
  return m.map(row=>row[n]);
};
function rotationError(target,current){
  const r=mm(target,transpose(current)),v=[r[2][1]-r[1][2],r[0][2]-r[2][0],r[1][0]-r[0][1]],s=norm(v)/2,c=Math.max(-1,Math.min(1,(r[0][0]+r[1][1]+r[2][2]-1)/2));
  if(s<1e-10){if(c<0)throw Error('Seed orientation is opposite the target; choose another model seed');return scale(v,.5);}
  return scale(v,Math.atan2(s,c)/(2*s));
}
export function densoInverse(g,pose,{seed,maxIterations=90}={}){
  validateRigid(rigid(pose.tcp,pose.rotation));
  if(!seed||seed.length!==6||!seed.every(Number.isFinite))throw Error('DENSO nominal IK requires an explicit model-angle seed');
  let q=[...seed];const lever=g.upperMm;
  const sign=v=>Math.abs(v)<1e-5?0:Math.sign(v);
  const branch=q=>[sign(g.forearmMm*Math.cos(q[2]*Math.PI/180)+g.elbowOffsetMm*Math.sin(q[2]*Math.PI/180)),sign(Math.sin(q[4]*Math.PI/180))];
  const chosen=branch(seed);
  try{for(let iteration=0;iteration<maxIterations;iteration++){
    const s=densoForward(g,q),p=sub(pose.tcp,s.tcp),r=rotationError(pose.rotation,s.rotation);
    if(norm(p)<1e-5&&norm(r)<1e-7){
      if(branch(q).some((v,i)=>v&&chosen[i]&&v!==chosen[i]))return {valid:false,errors:['DENSO solve leaves the declared elbow/wrist seed branch']};
      return {...s,valid:true,errors:[],iterations:iteration};
    }
    const columns=s.axes.map((axis,i)=>[...cross(axis,sub(s.tcp,s.origins[i])),...scale(axis,lever)]),error=[...p,...scale(r,lever)];
    const normal=columns.map((c,i)=>columns.map((d,j)=>dot(c,d)+(i===j?.1:0))),rhs=columns.map(c=>dot(c,error)),delta=linear(normal,rhs);
    const factor=Math.min(1,.15/Math.max(...delta.map(Math.abs)));q=q.map((v,i)=>v+delta[i]*factor*180/Math.PI);
  }}catch(error){return {valid:false,errors:[error.message]};}
  return {valid:false,errors:['DENSO nominal IK did not converge from the declared model seed']};
}
