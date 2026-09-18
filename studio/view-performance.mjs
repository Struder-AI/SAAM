// Interactive redraw timing, reported to the Studio server so an agent can read
// viewer performance from the person's own browser without instrumenting the page.
const summary=values=>{
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;
  const at=f=>+sorted[Math.min(sorted.length-1,Math.floor(sorted.length*f))].toFixed(1);
  return {median:at(.5),p90:at(.9),max:at(1)};
};
// A burst is one continuous drag, zoom or playback run. A drag ends on pointer
// release; the idle timer must outlast the slowest frames worth diagnosing. drawMs is main-thread
// time inside draw(); intervalMs is the spacing the person actually sees. A long
// interval with a short draw means the GPU or compositor is the limit.
export function summarizeBurst(kind,frames,context={}){
  return {kind,frames:frames.length,intervalMs:summary(frames.slice(1).map((f,i)=>f.start-frames[i].start)),
    drawMs:summary(frames.map(f=>f.drawMs)),materialMs:summary(frames.map(f=>f.materialMs)),
    // Per-level timings show what each motion-quality level costs on this machine.
    byQuality:Object.fromEntries([...new Set(frames.map(f=>f.quality??0))].sort().map(q=>{const at=frames.filter(f=>(f.quality??0)===q);return [q,{frames:at.length,drawMs:summary(at.map(f=>f.drawMs))}];})),...context};
}
// Motion quality follows measured frame cost, so a CPU rasterizer, a weak GPU,
// a large window and a large print all settle wherever this machine stays
// responsive. Level 0 is full detail; still frames and exports always use it.
// Stepping up needs sustained headroom, and a step up that is immediately
// reverted doubles that requirement so the level does not oscillate.
export function createMotionQuality({levels=3,slowMs=50,fastMs=25,window=4,patience=45,initial=0}={}){
  let level=Math.min(levels,initial),recent=[],good=0,need=patience,raisedAt=-Infinity,frames=0;
  return {
    get level(){return level;},
    sample(costMs){
      frames++;recent.push(costMs);if(recent.length>window)recent.shift();
      good=costMs<fastMs?good+1:0;
      const median=[...recent].sort((a,b)=>a-b)[recent.length>>1];
      if(recent.length===window&&median>slowMs&&level<levels){
        if(frames-raisedAt<=window*2)need=Math.min(need*2,720);
        level++;recent=[];good=0;
      }else if(good>=need&&level>0){level--;recent=[];good=0;raisedAt=frames;}
      return level;
    }
  };
}
export function createViewPerformance({report,context=()=>({}),idleMs=5000,minFrames=3,setTimer=setTimeout,clearTimer=clearTimeout}){
  let kind=null,frames=[],timer=0;
  function flush(){
    clearTimer(timer);timer=0;
    if(frames.length>=minFrames)report(summarizeBurst(kind,frames,context()));
    frames=[];kind=null;
  }
  return {
    frame(nextKind,sample){
      if(!nextKind)return;
      if(kind&&nextKind!==kind)flush();
      kind=nextKind;frames.push(sample);clearTimer(timer);timer=setTimer(flush,idleMs);
    },
    flush
  };
}
