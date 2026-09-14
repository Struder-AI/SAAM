// Explicit design-motion source for Studio studies. Not a controller dialect.
export function interpretMachineStudy(source,{moves=[]}={}){
  const s=typeof source==='string'?JSON.parse(source):source;
  if(s?.schema!=='saam-machine-study-source/1'||s.orientation!=='euler-xyz'||!Array.isArray(s.moves)||!s.moves.length)throw Error('Invalid machine study source');
  const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw Error('Invalid study '+name);return [...v];};
  let from=vector(s.initial?.tcp,'initial TCP'),anglesFrom=vector(s.initial?.anglesDeg,'initial angles'),seconds=0,volume=0;
  for(const [i,command] of s.moves.entries()){
    const to=vector(command.tcp,'TCP'),anglesTo=vector(command.anglesDeg,'angles'),dt=command.seconds,amount=command.volumeMm3??0;
    if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(amount)||amount<0)throw Error('Invalid study duration or volume');
    const length=Math.hypot(...to.map((v,j)=>v-from[j]));
    moves.push({from,to,anglesFrom,anglesTo,interpolation:s.orientation,startSeconds:seconds,durationSeconds:dt,
      line:i+1,file:'motion.json',extruding:amount>0,volumeMm3:amount,commandedVolumeMm3:amount,phase:typeof command.phase==='string'?command.phase:amount>0?'study':'travel',
      operation:typeof command.operation==='string'?command.operation:'mechanism-study',layer:Number.isInteger(command.layer)?command.layer:0,fan:0,speedMmS:length/dt});
    seconds+=dt;volume+=amount;from=to;anglesFrom=anglesTo;
  }
  return {moves,events:[],seconds,volumeMm3:volume,language:'machine-study',notice:'Mechanism study only. Authored motion and nominal kinematics; no machine program or print approval.',
    summary:{motionSeconds:seconds,moves:moves.length,volumeMm3:volume,extrusionMoves:moves.filter(m=>m.extruding).length}};
}
