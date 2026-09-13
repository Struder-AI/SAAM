import {dobotInverse} from './dobot-kinematics.mjs';
// Consume the interpreted Lua command positions and rest-to-rest timing.
// Model coordinates must be deliberately aligned with the configured user/tool
// frame by the caller; nominal demo transforms are never installation calibration.
export function sampleDobotProgram(program,g,{yawDeg=0,stepSeconds=0.05,maxSamples=300000}={}){
  if(!program.moves?.length||!Number.isFinite(yawDeg)||!Number.isFinite(stepSeconds)||stepSeconds<=0)throw Error('Invalid Dobot preview input');
  const samples=[];let seed=[0,0,0,0],volume=0;
  const record=(tcp,seconds,m,extruding,amount)=>{
    const result=dobotInverse(g,{tcp,yawDeg},{seed});if(!result.valid)throw Error(`${m.file}:${m.line}: ${result.errors.join('; ')}`);seed=result.joints;
    if(samples.length>=maxSamples)throw Error('Dobot kinematic sample budget exceeded');
    samples.push({tcp,joints:seed,seconds,extruding,volumeMm3:amount,line:m.line,file:m.file});
  };
  record(program.moves[0].controllerFrom,0,program.moves[0],false,0);
  for(const m of program.moves){
    const from=m.controllerFrom,to=m.controllerTo,n=Math.max(1,Math.ceil(m.durationSeconds/stepSeconds));
    if(!from||!to||!Number.isFinite(m.accelerationMmS2)||m.accelerationMmS2<=0)throw Error('Dobot preview requires interpreted controller coordinates and acceleration');
    record(from,m.startSeconds,m,false,volume);
    for(let j=1;j<=n;j++){
      const t=m.durationSeconds*j/n,ramp=m.peakSpeedMmS/m.accelerationMmS2,T=m.durationSeconds;
      const distance=t<ramp ? 0.5*m.accelerationMmS2*t*t : t>T-ramp ? m.controllerLengthMm-0.5*m.accelerationMmS2*(T-t)**2 : 0.5*m.accelerationMmS2*ramp*ramp+m.peakSpeedMmS*(t-ramp);
      const u=Math.max(0,Math.min(1,distance/m.controllerLengthMm)),tcp=from.map((v,i)=>v+(to[i]-v)*u);
      record(tcp,m.startSeconds+t,m,m.extruding,volume+m.commandedVolumeMm3*u);
    }
    volume+=m.commandedVolumeMm3;
  }
  return {schema:'saam-dobot-kinematic-preview/1',samples,seconds:program.seconds,volumeMm3:volume,summary:program.summary,coverage:'Nominal calibrated-frame assumption, interpreted Lua CP=0 timing and model IK. No physical calibration, collisions or hardware execution.'};
}
