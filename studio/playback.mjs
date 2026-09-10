import {bedPoint,rotateZ,interpolateDirections} from '../core/path/pose.mjs';
export function advancePlayback(seconds, elapsedMs, speed, duration) {
  return Math.min(duration, Math.max(0, seconds + Math.max(0, elapsedMs) / 1000 * speed));
}
export function frameAtTime(moves, seconds) {
  if(!moves.length)return {completed:0,active:-1,fraction:0,point:null};
  let low=0,high=moves.length;
  while(low<high){const mid=(low+high)>>1;if(moves[mid].startSeconds<=seconds)low=mid+1;else high=mid;}
  const index=low-1;
  if(index<0)return {completed:0,active:-1,fraction:0,point:moves[0].from};
  const move=moves[index],elapsed=Math.max(0,Math.min(move.durationSeconds,seconds-move.startSeconds));
  let fraction=Math.max(0,Math.min(1,elapsed/move.durationSeconds));
  if(move.interpolation==='rest-to-rest-linear'&&move.controllerLengthMm>0&&move.accelerationMmS2>0&&move.peakSpeedMmS>0){
    const acceleration=move.accelerationMmS2,ramp=move.peakSpeedMmS/acceleration;
    const cruiseEnd=move.durationSeconds-ramp;
    const traveled=elapsed<ramp ? acceleration*elapsed*elapsed/2
      : elapsed<=cruiseEnd ? acceleration*ramp*ramp/2+move.peakSpeedMmS*(elapsed-ramp)
      : move.controllerLengthMm-acceleration*(move.durationSeconds-elapsed)**2/2;
    fraction=Math.max(0,Math.min(1,traveled/move.controllerLengthMm));
  }
  const result={completed:index+(fraction>=1?1:0),active:index,fraction,point:move.from.map((v,i)=>v+(move.to[i]-v)*fraction)};
  if(Number.isFinite(move.rotaryFromDeg)){
    result.rotaryDeg=move.rotaryFromDeg+(move.rotaryToDeg-move.rotaryFromDeg)*fraction;
    const center=move.rotaryCenterMm,from=bedPoint(move.from,move.rotaryFromDeg,center),to=bedPoint(move.to,move.rotaryToDeg,center);
    result.point=bedPoint(from.map((v,i)=>v+(to[i]-v)*fraction),result.rotaryDeg,center,true);
    const dirs=interpolateDirections({toolAxis:rotateZ(move.toolAxisFrom,move.rotaryFromDeg),toolUp:rotateZ(move.toolUpFrom,move.rotaryFromDeg)},
      {toolAxis:rotateZ(move.toolAxisTo,move.rotaryToDeg),toolUp:rotateZ(move.toolUpTo,move.rotaryToDeg)},fraction);
    result.toolAxis=rotateZ(dirs.toolAxis,-result.rotaryDeg);
  }
  return result;
}
export function displayPoint(point,rotaryDeg,center,followPlate){return followPlate?point:bedPoint(point,rotaryDeg,center);}

// Video time is independent of encoding speed. Include the complete final pose,
// then a two-second final hold, including the outgoing layer's fade.
export function movieTimeline(duration,speed,fps=30) {
  if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(speed)||speed<=0)throw new Error('A movie needs a toolpath and a positive playback speed.');
  const count=Math.ceil((duration/speed+2)*fps)+1;
  return {count,durationSeconds:count/fps,frame(index){
    return {seconds:Math.min(duration,index/fps*speed),now:index/fps*1000,
      timestamp:Math.round(index/fps*1e6),duration:Math.round((index+1)/fps*1e6)-Math.round(index/fps*1e6)};
  }};
}

// Narrow WebM writer: one VP8/VP9 track, millisecond timestamps, seekable
// keyframe clusters. No audio, streaming or manufacturing-export changes.
// Element definitions: https://www.webmproject.org/docs/container/
export function createMovieWebM({width,height,codec,fps=30,durationSeconds}) {
  const bytes=value=>{
    const out=[];do{out.unshift(value%256);value=Math.floor(value/256);}while(value);return new Uint8Array(out);
  };
  const size=value=>{
    let length=1;while(value>=2**(7*length)-1)length++;
    const out=new Uint8Array(length);
    for(let i=length-1;i>=0;i--){out[i]=value%256;value=Math.floor(value/256);}
    out[0]|=1<<(8-length);return out;
  };
  const element=(id,...parts)=>new Blob([bytes(id),size(parts.reduce((n,p)=>n+(p.size??p.byteLength),0)),...parts]);
  const uint=(id,value)=>element(id,bytes(value));
  const string=(id,value)=>element(id,new TextEncoder().encode(value));
  const float=(id,value)=>{const data=new Uint8Array(8);new DataView(data.buffer).setFloat64(0,value);return element(id,data);};
  const header=element(0x1a45dfa3,uint(0x4286,1),uint(0x42f7,1),uint(0x42f2,4),uint(0x42f3,8),string(0x4282,'webm'),uint(0x4287,4),uint(0x4285,2));
  const info=element(0x1549a966,uint(0x2ad7b1,1e6),string(0x4d80,'SAAM Studio'),string(0x5741,'SAAM Studio'),float(0x4489,durationSeconds*1000));
  const tracks=element(0x1654ae6b,element(0xae,uint(0xd7,1),uint(0x73c5,1),uint(0x83,1),uint(0x9c,0),string(0x86,codec==='vp8'?'V_VP8':'V_VP9'),uint(0x23e383,Math.round(1e9/fps)),element(0xe0,uint(0xb0,width),uint(0xba,height))));
  const clusters=[],cues=[];let blocks=[],clusterTime=0,clusterBytes=0,lastTime=-1,frames=0;
  function finishCluster(){if(blocks.length){const cluster=element(0x1f43b675,uint(0xe7,clusterTime),...blocks);clusters.push(cluster);clusterBytes+=cluster.size;blocks=[];}}
  // Fixed-size positions keep SeekHead's own length stable when resolved.
  const position=value=>{const data=new Uint8Array(8);new DataView(data.buffer).setBigUint64(0,BigInt(value));return element(0x53ac,data);};
  const seek=(id,offset)=>element(0x4dbb,element(0x53ab,bytes(id)),position(offset));
  const seekHead=(infoAt,tracksAt,cuesAt)=>element(0x114d9b74,seek(0x1549a966,infoAt),seek(0x1654ae6b,tracksAt),seek(0x1c53bb6b,cuesAt));
  const prefixSize=seekHead(0,0,0).size+info.size+tracks.size;
  return {
    add(chunk){
      const time=Math.round(chunk.timestamp/1000),key=chunk.type==='key';
      if(time<lastTime||(!frames&&!key))throw new Error('Video encoder returned an invalid frame order.');
      if(blocks.length&&(key||time-clusterTime>32767))finishCluster();
      if(!blocks.length){clusterTime=time;if(key)cues.push(element(0xbb,uint(0xb3,time),element(0xb7,uint(0xf7,1),uint(0xf1,prefixSize+clusterBytes))));}
      const data=new Uint8Array(4+chunk.byteLength),offset=time-clusterTime;
      data.set([0x81,(offset>>8)&255,offset&255,key?0x80:0]);chunk.copyTo(data.subarray(4));
      blocks.push(element(0xa3,data));lastTime=time;frames++;
    },
    finish(){
      if(!frames)throw new Error('The video encoder produced no frames.');
      finishCluster();const headSize=seekHead(0,0,0).size;
      const head=seekHead(headSize,headSize+info.size,prefixSize+clusterBytes);
      return new Blob([header,element(0x18538067,head,info,tracks,...clusters,element(0x1c53bb6b,...cues))],{type:'video/webm'});
    }
  };
}

export async function exportMovie({canvas,duration,speed,draw,onProgress=()=>{},signal,
  VideoEncoder=globalThis.VideoEncoder,VideoFrame=globalThis.VideoFrame,
  yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}) {
  if(!VideoEncoder||!VideoFrame)throw new Error('Movie export needs WebCodecs. Open this Studio URL in a current Chrome or Edge browser.');
  const fps=30,timeline=movieTimeline(duration,speed,fps);
  const check=()=>{signal?.throwIfAborted();};check();
  let config;
  for(const codec of ['vp09.00.10.08','vp8']) {
    const candidate={codec,width:canvas.width,height:canvas.height,framerate:fps,bitrate:8_000_000,latencyMode:'realtime'};
    try{if((await VideoEncoder.isConfigSupported(candidate)).supported){config=candidate;break;}}catch{}
  }
  check();
  if(!config)throw new Error('This browser cannot encode a WebM movie at this viewer size. Try a smaller window or current Chrome or Edge.');
  const mux=createMovieWebM({...config,fps,durationSeconds:timeline.durationSeconds});
  let failure;
  const encoder=new VideoEncoder({output:chunk=>{try{mux.add(chunk);}catch(error){failure=error;}},error:error=>{failure=error;}});
  const abort=()=>{if(encoder.state!=='closed')encoder.close();};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    encoder.configure(config);
    for(let index=0;index<timeline.count;index++) {
      check();if(failure)throw failure;
      const frame=timeline.frame(index);draw(frame);
      const videoFrame=new VideoFrame(canvas,{timestamp:frame.timestamp,duration:frame.duration});
      try{encoder.encode(videoFrame,{keyFrame:index%fps===0});}finally{videoFrame.close();}
      // Bound encoder backlog and yield to progress/cancel without waiting for
      // playback or requestAnimationFrame. Hidden tabs can still export.
      if(index%8===7){await encoder.flush();check();if(failure)throw failure;onProgress((index+1)/timeline.count);await yieldTask();}
    }
    await encoder.flush();check();if(failure)throw failure;
    onProgress(1);return mux.finish();
  } finally {signal?.removeEventListener('abort',abort);if(encoder.state!=='closed')encoder.close();}
}
