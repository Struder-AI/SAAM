// Nominal MG400 centerline model derived from Dobot-Arm/MG400_ROS URDF.
// Units mm/degrees; base frame is that URDF's base_link, not a calibrated user frame.
// q2/q3 are absolute upper/forearm Y rotations because the parallelograms cancel
// their inherited rotations. q4 adds wrist yaw to q1. No DENSO model is included.
const rad=Math.PI/180,add=(a,b)=>a.map((v,i)=>v+b[i]),norm=v=>Math.hypot(...v);
const ry=(v,a)=>{const c=Math.cos(a*rad),s=Math.sin(a*rad);return [c*v[0]+s*v[2],v[1],-s*v[0]+c*v[2]];};
const rz=(v,a)=>{const c=Math.cos(a*rad),s=Math.sin(a*rad);return [c*v[0]-s*v[1],s*v[0]+c*v[1],v[2]];};
export const DOBOT_MODEL_DEFAULTS=Object.freeze({
  baseOriginMm:[-5,0,109],shoulderMm:[43.5007595118091,-35.7748756218899,118.995682641123],
  upperMm:[-1.0512570171516,35.7748756218898,175.001164344716],
  forearmMm:[174.969784055705,-17.0000000000335,3.25187137614585],
  wristMm:[65.9996239003897,17.0000000000371,31.000800715573],
  toolLengthMm:100,jointLimitsDeg:[[-160,160],[-25,85],[-25,105],[-360,360]],marginDeg:4,
  branch:'elbow-negative',basis:'Nominal official URDF linkage; simplified exact vertical wrist axis; user tool length is provisional. Not commissioned robot calibration.'
});
export function dobotGeometry(config={}){
  const g=structuredClone({...DOBOT_MODEL_DEFAULTS,...config});
  for(const k of ['baseOriginMm','shoulderMm','upperMm','forearmMm','wristMm'])if(!Array.isArray(g[k])||g[k].length!==3||!g[k].every(Number.isFinite))throw Error('Invalid Dobot '+k);
  if(!Number.isFinite(g.toolLengthMm)||g.toolLengthMm<0||!Number.isFinite(g.marginDeg)||g.marginDeg<0||g.marginDeg>=45||!['elbow-negative','elbow-positive'].includes(g.branch))throw Error('Invalid Dobot tool, margin or branch');
  if(g.jointLimitsDeg.length!==4||g.jointLimitsDeg.some(v=>v.length!==2||!v.every(Number.isFinite)||v[0]+2*g.marginDeg>=v[1]))throw Error('Invalid Dobot joint limits');
  if(Math.abs(g.shoulderMm[1]+g.upperMm[1]+g.forearmMm[1]+g.wristMm[1])>1e-6)throw Error('Dobot analytic model requires zero net lateral wrist offset');
  g.l1=Math.hypot(g.upperMm[0],g.upperMm[2]);g.l2=Math.hypot(g.forearmMm[0],g.forearmMm[2]);
  if(g.l1<=0||g.l2<=0)throw Error('Dobot links must be positive');
  g.phi1=Math.atan2(g.upperMm[2],g.upperMm[0])/rad;g.phi2=Math.atan2(g.forearmMm[2],g.forearmMm[0])/rad;
  return g;
}
export function dobotForward(g,joints){
  if(!Array.isArray(joints)||joints.length!==4||!joints.every(Number.isFinite))throw Error('Dobot needs four finite joint angles');
  const [q1,q2,q3,q4]=joints,shoulder=add(g.baseOriginMm,rz(g.shoulderMm,q1)),elbow=add(shoulder,rz(ry(g.upperMm,q2),q1)),fore=add(elbow,rz(ry(g.forearmMm,q3),q1)),wrist=add(fore,rz(g.wristMm,q1)),tcp=add(wrist,[0,0,-g.toolLengthMm]);
  const delta=(g.phi2-q3)-(g.phi1-q2),foldMarginDeg=Math.asin(Math.abs(Math.sin(delta*rad)))/rad,errors=[];
  for(let i=0;i<4;i++)if(joints[i]<g.jointLimitsDeg[i][0]+g.marginDeg-1e-7||joints[i]>g.jointLimitsDeg[i][1]-g.marginDeg+1e-7)errors.push(`J${i+1} exceeds reserved joint range`);
  if(foldMarginDeg<g.marginDeg)errors.push('Elbow approaches straight/folded singularity');
  if(Math.hypot(tcp[0]-g.baseOriginMm[0],tcp[1]-g.baseOriginMm[1])<1e-7)errors.push('Base-axis singularity');
  return {valid:!errors.length,errors,tcp,yawDeg:q1+q4,joints:[...joints],foldMarginDeg,branch:Math.sin(delta*rad)<0?'elbow-negative':'elbow-positive',points:[[g.baseOriginMm[0],g.baseOriginMm[1],0],g.baseOriginMm,shoulder,elbow,fore,wrist,tcp],toolAxis:[0,0,-1]};
}
export function dobotInverse(g,pose,{seed=[0,0,0,0]}={}){
  if(!pose.tcp||pose.tcp.length!==3||!pose.tcp.every(Number.isFinite)||!Number.isFinite(pose.yawDeg??0))throw Error('Invalid Dobot TCP/yaw');
  if(pose.toolAxis&&norm(pose.toolAxis.map((v,i)=>v-[0,0,-1][i]))>1e-7)throw Error('Dobot cannot tilt the tool');
  const [x,y,z]=pose.tcp.map((v,i)=>v-g.baseOriginMm[i]),rho=Math.hypot(x,y);
  if(rho<1e-8)return {valid:false,errors:['Base-axis singularity'],tcp:pose.tcp,points:[],joints:[]};
  const q1=Math.atan2(y,x)/rad,r=rho-g.shoulderMm[0]-g.wristMm[0],h=z+g.toolLengthMm-g.shoulderMm[2]-g.wristMm[2],c=(r*r+h*h-g.l1*g.l1-g.l2*g.l2)/(2*g.l1*g.l2);
  if(c<-1-1e-10||c>1+1e-10)return {valid:false,errors:['Outside nominal two-link reach'],tcp:pose.tcp,points:[],joints:[]};
  const delta=(g.branch==='elbow-negative'?-1:1)*Math.acos(Math.max(-1,Math.min(1,c))),a1=Math.atan2(h,r)-Math.atan2(g.l2*Math.sin(delta),g.l1+g.l2*Math.cos(delta)),a2=a1+delta;
  const q2=g.phi1-a1/rad,q3=g.phi2-a2/rad,q4=(pose.yawDeg??0)-q1;
  const windings=[-2,-1,0,1,2].map(k=>q4+360*k).filter(v=>v>=g.jointLimitsDeg[3][0]+g.marginDeg&&v<=g.jointLimitsDeg[3][1]-g.marginDeg).sort((a,b)=>Math.abs(a-seed[3])-Math.abs(b-seed[3]));
  const result=dobotForward(g,[q1,q2,q3,windings[0]??q4]);return {...result,requestedTcp:pose.tcp};
}
