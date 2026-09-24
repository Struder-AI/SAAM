import {add,sub,scale,dot,cross,norm,mv,mm,transpose,identity,rotation,rigid,validateRigid} from './rigid.mjs';

// Nominal VS-068A4 standard-flange centerlines from DENSO's VS-068 drawing:
// https://www.denso-wave.com/fsys/en/robot/product/five-six/vs068-087/en_VS-068-W.pdf
// Cross-checked against the supplied WINCAPS VS068 model joint pivots.
// These are MODEL angles, not calibrated RC8A encoders/FIG. At zero: shoulder
// offset +X, upper arm +Z, forearm +X with +20 mm Z offset, flange +X.
export const DENSO_MODEL_DEFAULTS=Object.freeze({shoulderHeightMm:395,shoulderOffsetMm:30,upperMm:340,forearmMm:340,
  elbowOffsetMm:20,flangeMm:80,toolLengthMm:70});
export function densoGeometry(config={}){
  const g={...DENSO_MODEL_DEFAULTS,...config};
  for(const key of Object.keys(DENSO_MODEL_DEFAULTS))if(!Number.isFinite(g[key])||g[key]<=0)throw Error('Invalid DENSO '+key);
  // Nominal flange axes in the wrist model: flange +Z = model +X,
  // flange +X = model -Z. This defines the model's J6 zero, not an encoder zero.
  const wristFromFlange=[[0,0,1],[0,1,0],[-1,0,0]],nozzleToPresentation=[[-1,0,0],[0,1,0],[0,0,-1]];
  if(g.flangeFromTool){
    validateRigid(g.flangeFromTool);
    const [x,y,z]=g.flangeFromTool.translationMm;
    const toolVectors=[[0,0,z],[x,y,0]].filter(v=>norm(v)>1e-9).map(v=>mv(wristFromFlange,v));
    return {...g,toolVectors,toolRotation:mm(mm(wristFromFlange,g.flangeFromTool.rotation),nozzleToPresentation),toolReachMm:toolVectors.reduce((s,v)=>s+norm(v),0)};
  }
  return {...g,toolVectors:[[g.toolLengthMm,0,0]],toolRotation:[[0,0,-1],[0,1,0],[1,0,0]],toolReachMm:g.toolLengthMm};
}
export function densoForward(g,joints){
  if(joints.length!==6||!joints.every(Number.isFinite))throw Error('DENSO needs six finite model joint angles');
  let R=identity(),p=[0,0,0];const points=[p],axes=[],origins=[];
  const turn=(axis,i)=>{axes.push(mv(R,axis));origins.push(p);R=mm(R,rotation(axis,joints[i]*Math.PI/180));};
  const move=v=>{p=add(p,mv(R,v));points.push(p);};
  turn([0,0,1],0);move([g.shoulderOffsetMm,0,g.shoulderHeightMm]);turn([0,1,0],1);move([0,0,g.upperMm]);
  turn([0,1,0],2);move([g.forearmMm,0,g.elbowOffsetMm]);turn([1,0,0],3);turn([0,1,0],4);turn([1,0,0],5);
  move([g.flangeMm,0,0]);for(const vector of g.toolVectors)move(vector);
  const presentation=mm(R,g.toolRotation);
  return {tcp:p,rotation:presentation,points,axes,origins,joints:[...joints]};
}
// Recover the wrist from a target TCP using the complete installed tool transform.
export function densoWristFromPose(g,pose){
  const wristRotation=mm(pose.rotation,transpose(g.toolRotation));
  const offset=g.toolVectors.reduce((p,v)=>add(p,v),[g.flangeMm,0,0]);
  return sub(pose.tcp,mv(wristRotation,offset));
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
  if(s<1e-10){
    if(c>=0)return scale(v,.5);
    // At a half-turn the antisymmetric part vanishes. Recover the axis
    // from R + I, choosing its largest component for numerical stability.
    const k=[0,1,2].reduce((best,i)=>r[i][i]>r[best][best]?i:best,0);
    const axis=[0,0,0];axis[k]=Math.sqrt(Math.max(0,(r[k][k]+1)/2));
    for(let i=0;i<3;i++)if(i!==k)axis[i]=(r[i][k]+r[k][i])/(4*axis[k]);
    return scale(axis,Math.PI/norm(axis));
  }
  return scale(v,Math.atan2(s,c)/(2*s));
}
export function densoInverse(g,pose,{seed}={}){
  validateRigid(rigid(pose.tcp,pose.rotation));
  if(!seed||seed.length!==6||!seed.every(Number.isFinite))throw Error('DENSO nominal IK requires an explicit model-angle seed');
  let q=[...seed];const lever=g.upperMm;
  const sign=v=>Math.abs(v)<1e-5?0:Math.sign(v);
  const branch=q=>[sign(g.forearmMm*Math.cos(q[2]*Math.PI/180)+g.elbowOffsetMm*Math.sin(q[2]*Math.PI/180)),sign(Math.sin(q[4]*Math.PI/180))];
  const chosen=branch(seed);
  // The damped step keeps reducing the pose residual while the seed branch can
  // reach the target. Iteration ends on that residual, not on a step count: a
  // solve that stops approaching the pose is the real failure.
  let best=Infinity,stalls=0;
  try{for(let iteration=0;;iteration++){
    const s=densoForward(g,q),p=sub(pose.tcp,s.tcp),r=rotationError(pose.rotation,s.rotation);
    if(norm(p)<1e-5&&norm(r)<1e-7){
      if(branch(q).some((v,i)=>v&&chosen[i]&&v!==chosen[i]))return {valid:false,errors:['DENSO solve leaves the declared elbow/wrist seed branch']};
      return {...s,valid:true,errors:[],iterations:iteration};
    }
    const residual=norm(p)+norm(r)*lever;
    if(residual<best*(1-1e-9))
      {best=residual;stalls=0;}
    else if(++stalls>=8)
      return {valid:false,errors:[`DENSO nominal IK stopped approaching the requested pose from the declared model seed after ${iteration} iterations`]};
    const columns=s.axes.map((axis,i)=>[...cross(axis,sub(s.tcp,s.origins[i])),...scale(axis,lever)]),error=[...p,...scale(r,lever)];
    const normal=columns.map((c,i)=>columns.map((d,j)=>dot(c,d)+(i===j?.1:0))),rhs=columns.map(c=>dot(c,error)),delta=linear(normal,rhs);
    const factor=Math.min(1,.15/Math.max(...delta.map(Math.abs)));q=q.map((v,i)=>v+delta[i]*factor*180/Math.PI);
    if(!q.every(Number.isFinite))return {valid:false,errors:['DENSO nominal IK left the model with a nonfinite joint angle']};
  }}catch(error){return {valid:false,errors:[error.message]};}
}
