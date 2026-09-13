// Explicit design-motion source for Studio studies. Not a controller dialect.
import {interpretSplitDelta} from './split-delta-player.mjs';
import {geometry} from '../machine/split-delta.mjs';

export function interpretSplitDeltaStudy(source,machine,setup={},options={}){
  if(machine.id!=='split-delta')throw Error('Splitty source requires its declared machine');
  const preview=interpretSplitDelta(source,geometry({...machine.kinematicModel,...setup.kinematicModel}));
  const samples=preview.samples,moves=[],sourceLines=[],area=Math.PI*((setup.filamentMm??1.75)/2)**2;
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i],dt=b.seconds-a.seconds;if(dt<=0)continue;
    moves.push({tcp:b.tcp,anglesDeg:b.abc,seconds:dt,volumeMm3:Math.max(0,b.e-a.e)*area});
    sourceLines.push(b.line);
  }
  const program=interpretMachineStudy({schema:'saam-machine-study-source/1',orientation:'euler-xyz',initial:{tcp:samples[0].tcp,anglesDeg:samples[0].abc},moves});
  program.moves.forEach((move,i)=>{move.line=sourceLines[i];move.file='motion.sdgcode';});
  if(options.moves){for(const move of program.moves)options.moves.push(move);program.moves=options.moves;}
  program.language='split-delta-preview';return program;
}
export function interpretMachineStudy(source,{moves=[]}={}){
  const s=typeof source==='string'?JSON.parse(source):source;
  if(s?.schema!=='saam-machine-study-source/1'||!['euler-xyz','gimbal-rx-ry'].includes(s.orientation)||!Array.isArray(s.moves)||!s.moves.length)throw Error('Invalid machine study source');
  const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw Error('Invalid study '+name);return [...v];};
  let from=vector(s.initial?.tcp,'initial TCP'),anglesFrom=vector(s.initial?.anglesDeg,'initial angles'),seconds=0,volume=0;
  for(const [i,command] of s.moves.entries()){
    const to=vector(command.tcp,'TCP'),anglesTo=vector(command.anglesDeg,'angles'),dt=command.seconds,amount=command.volumeMm3??0;
    if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(amount)||amount<0)throw Error('Invalid study duration or volume');
    if(s.orientation==='gimbal-rx-ry'&&(anglesFrom[2]!==0||anglesTo[2]!==0))throw Error('Two-axis gimbal has no independent roll coordinate');
    const length=Math.hypot(...to.map((v,j)=>v-from[j]));
    moves.push({from,to,anglesFrom,anglesTo,interpolation:s.orientation,startSeconds:seconds,durationSeconds:dt,
      line:i+1,file:'motion.json',extruding:amount>0,volumeMm3:amount,commandedVolumeMm3:amount,phase:amount>0?'study':'travel',
      operation:'mechanism-study',layer:0,fan:0,speedMmS:length/dt});
    seconds+=dt;volume+=amount;from=to;anglesFrom=anglesTo;
  }
  return {moves,events:[],seconds,volumeMm3:volume,language:'machine-study',notice:'Mechanism study only. Authored motion and nominal kinematics; no machine program or print approval.',
    summary:{motionSeconds:seconds,moves:moves.length,volumeMm3:volume,extrusionMoves:moves.filter(m=>m.extruding).length}};
}
