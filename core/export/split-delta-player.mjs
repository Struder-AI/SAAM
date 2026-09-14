// Standalone reference interpreter. Deliberately no heaters, IO or step generation.
// G21 G90 M82 G93/G94; G0/G1 XYZABC E F; G4 P(ms). ABC = extrinsic XYZ degrees
// (Rz(C) Ry(B) Rx(A)); XYZ is the nozzle TCP, E absolute filament mm, F mm/min.
import {RAD,rotationVector,inverse,matvec,norm,sub,add,mul,cross} from '../machine/split-delta.mjs';
export const eulerRotation=([a,b,c])=>{
  const x=rotationVector([a*RAD,0,0]),y=rotationVector([0,b*RAD,0]),z=rotationVector([0,0,c*RAD]);
  const columns=[[1,0,0],[0,1,0],[0,0,1]].map(v=>matvec(z,matvec(y,matvec(x,v))));
  return columns[0].map((_,i)=>columns.map(v=>v[i]));
};
function eulerFromRotation(m){
  const b=Math.asin(Math.max(-1,Math.min(1,-m[2][0])));
  if(Math.abs(Math.cos(b))<1e-7)throw Error('Euler conversion at gimbal lock');
  return [Math.atan2(m[2][1],m[2][2])/RAD,b/RAD,Math.atan2(m[1][0],m[0][0])/RAD];
}
function pathEuler(pose){
  if(!pose)return [0,0,0];
  if(pose.rotaryDeg!==undefined&&Math.abs(pose.rotaryDeg)>1e-8)throw Error('Split delta has no external rotary');
  const axis=pose.toolAxis,up=pose.toolUp;
  if(!axis||!up||axis.length!==3||up.length!==3||![...axis,...up].every(Number.isFinite)||Math.abs(norm(axis)-1)>1e-6||Math.abs(norm(up)-1)>1e-6)throw Error('SAAM pose needs unit toolAxis and toolUp');
  const z=mul(axis,-1),x=cross(up,z);if(Math.abs(norm(x)-1)>1e-6)throw Error('SAAM pose axes must be perpendicular');
  return eulerFromRotation(x.map((_,i)=>[x[i],up[i],z[i]]));
}
export function exportSplitDeltaPreview(path,{filamentMm=1.75}={}){
  if(!Number.isFinite(filamentMm)||filamentMm<=0)throw Error('Invalid filament diameter');
  const lines=['; SAAM SPLIT DELTA SIMULATION ONLY - NOT A HARDWARE PROGRAM','G21','G90','M82'];let e=0;
  const move=(p,r,f,extrusion)=>`G1 ${p.map((v,i)=>'XYZ'[i]+v.toFixed(6)).join(' ')} ${r.map((v,i)=>'ABC'[i]+v.toFixed(6)).join(' ')} F${f.toFixed(6)} E${extrusion.toFixed(6)}`;
  let r=pathEuler(path.initialPose);lines.push(move(path.initialPosition,r,600,e));
  for(const a of path.actions){
    if(a.kind==='move'){
      const timed=a.durationSeconds!==undefined;
      if((timed?(!Number.isFinite(a.durationSeconds)||a.durationSeconds<=0):(!Number.isFinite(a.speedMmS)||a.speedMmS<=0))||!Number.isFinite(a.volumeMm3)||a.volumeMm3<0||a.to.length!==3||!a.to.every(Number.isFinite))throw Error('Invalid SAAMpath move');
      if(a.pose)r=pathEuler(a.pose);e+=a.volumeMm3/(Math.PI*(filamentMm/2)**2);lines.push(timed?'G93':'G94',move(a.to,r,timed?60/a.durationSeconds:a.speedMmS*60,e));
    }else if(a.kind==='dwell'&&Number.isFinite(a.seconds)&&a.seconds>=0)lines.push(`G4 P${a.seconds*1000}`);
    else if(['retract','recover'].includes(a.kind)&&Number.isFinite(a.filamentMm)&&a.filamentMm>=0&&Number.isFinite(a.speedMmS)&&a.speedMmS>0){e+=(a.kind==='retract'?-1:1)*a.filamentMm;lines.push('G94',`G1 E${e.toFixed(6)} F${a.speedMmS*60}`);}
    else if(a.kind==='fan'&&Number.isFinite(a.percent)&&a.percent>=0&&a.percent<=100)lines.push(`; Fan intent ${a.percent}% (no IO in simulator)`);
    else throw Error(`Unsupported preview action ${a.kind}`);
  }
  return lines.join('\n')+'\n';
}
export function interpretSplitDelta(source,g,{maxStepMm=2,maxStepDeg=1,maxSamples=100000,initialTcp=[0,0,20],initialAbc=[0,0,0]}={}){
  if(typeof source!=='string'||source.length>10000000)throw Error('Invalid or oversized source');
  if(![maxStepMm,maxStepDeg,maxSamples].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid sampling limits');
  let xyz=[...initialTcp],abc=[...initialAbc],e=0,f=600,seconds=0,sign=null;
  const samples=[],commands=[];
  const record=(tcp,angles,line,time,extrusion)=>{
    const state=inverse(g,{tcp,rotation:eulerRotation(angles)});
    // XYZABC are exported to 6 decimal places; bound the angular quantization
    // error separately from the 4 degree mechanical reserve.
    if(!state.valid||state.tiltDeg>g.operatingTiltDeg+0.000002)throw Error(`Line ${line}: ${state.errors.join('; ')||'Operating tilt exceeded'}`);
    sign??=Math.sign(state.determinant);if(Math.sign(state.determinant)!==sign)throw Error(`Line ${line}: assembly mode change`);
    if(samples.length>=maxSamples)throw Error('Preview sample budget exceeded');
    samples.push({tcp,abc:angles,e:extrusion,seconds:time,line,heights:state.heights});
  };
  record(xyz,abc,0,0,e);
  let metric=false,absolute=false,absoluteE=false,inverseTime=false;
  for(const [idx,raw] of source.split(/\r?\n/).entries()){
    const line=idx+1,s=raw.replace(/;.*$/,'').trim().toUpperCase();if(!s)continue;
    const tokens=[...s.matchAll(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g)];
    if(s.replace(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g,'').trim())throw Error(`Line ${line}: unsupported syntax`);
    const words={};for(const [,key,value] of tokens){if(key in words)throw Error(`Line ${line}: duplicate ${key}`);words[key]=Number(value);if(!Number.isFinite(words[key]))throw Error(`Line ${line}: nonfinite word`);}
    const command=('G'in words?'G'+words.G:'M'in words?'M'+words.M:null);
    if(!command||('G'in words&&'M'in words))throw Error(`Line ${line}: one explicit command required`);
    const allowed=['G0','G1'].includes(command)?'GXYZABCEF':command==='G4'?'GP':command.startsWith('G')?'G':'M';
    if(Object.keys(words).some(k=>!allowed.includes(k)))throw Error(`Line ${line}: unsupported word`);
    if(command==='G21'){metric=true;continue;}if(command==='G90'){absolute=true;continue;}if(command==='M82'){absoluteE=true;continue;}
    if(command==='G93'){inverseTime=true;continue;}if(command==='G94'){inverseTime=false;continue;}
    if(!metric||!absolute||!absoluteE)throw Error(`Line ${line}: declare G21, G90 and M82 first`);
    if(command==='G4'){if(!Number.isFinite(words.P)||words.P<0)throw Error(`Line ${line}: invalid dwell`);seconds+=words.P/1000;record(xyz,abc,line,seconds,e);commands.push({line,command,seconds});continue;}
    if(!['G0','G1'].includes(command))throw Error(`Line ${line}: unsupported command ${command}`);
    const next=xyz.map((v,i)=>words['XYZ'[i]]??v),angles=abc.map((v,i)=>words['ABC'[i]]??v),nextE=words.E??e;f=words.F??f;if(f<=0)throw Error(`Line ${line}: feed must be positive`);
    const d=norm(sub(next,xyz)),da=Math.max(...sub(angles,abc).map(Math.abs));
    if(d<1e-10&&da>1e-10&&!inverseTime)throw Error(`Line ${line}: pure orientation moves need G93 inverse time`);
    if(inverseTime&&words.F===undefined)throw Error(`Line ${line}: G93 requires F on each move`);
    const duration=inverseTime?60/f:(d>0?d:Math.abs(nextE-e))/f*60,n=Math.max(1,Math.ceil(d/maxStepMm),Math.ceil(da/maxStepDeg));
    if(n+samples.length>maxSamples)throw Error(`Line ${line}: preview sample budget exceeded`);
    for(let j=1;j<=n;j++){const t=j/n;record(add(xyz,mul(sub(next,xyz),t)),add(abc,mul(sub(angles,abc),t)),line,seconds+duration*t,e+(nextE-e)*t);}
    seconds+=duration;xyz=next;abc=angles;e=nextE;commands.push({line,command,tcp:xyz,abc,e,seconds});
  }
  return {schema:'saam-split-delta-preview/1',samples,commands,seconds,coverage:'Sampled TCP/Euler interpolation with inverse kinematics; no acceleration planner, step pulses, thermal control, collision checking or hardware execution'};
}
