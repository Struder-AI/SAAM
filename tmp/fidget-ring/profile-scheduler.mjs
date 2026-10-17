import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const child=spawn(process.execPath,['--inspect-brk=0','tmp/fidget-ring/diagnose-scheduler.mjs',...process.argv.slice(2)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
const state={next:1,pending:new Map(),stderr:'',socket:null,finished:false,paused:null};
child.stdout.on('data',b=>process.stdout.write(b));
child.stderr.on('data',async b=>{
  state.stderr+=String(b);
  const url=state.stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)?.[0];
  if(!url||state.socket)return;
  state.socket=new WebSocket(url);
  state.socket.onmessage=e=>{
    const m=JSON.parse(e.data),p=state.pending.get(m.id);
    if(p){state.pending.delete(m.id);if(m.error)p.reject(m.error);else p.resolve(m.result);}
    if(m.method==='Debugger.paused'&&state.paused)state.paused(m.params);
    else if(m.method==='Debugger.paused')awaitResume();
  };
  state.socket.onopen=async()=>{
    await send('Debugger.enable');await send('Profiler.enable');await send('Profiler.start');await send('Runtime.runIfWaitingForDebugger');
    setTimeout(stop,15000);
  };
});
function send(method,params={}){
  return new Promise((resolve,reject)=>{
    const id=state.next++;state.pending.set(id,{resolve,reject});state.socket.send(JSON.stringify({id,method,params}));
  });
}
function awaitResume(){send('Debugger.resume');}
async function stop(){
  if(state.finished)return;state.finished=true;
  try{
    const paused=new Promise(resolve=>{state.paused=resolve;});
    await send('Debugger.pause');
    const frames=(await paused).callFrames;
    const captures=[];
    for(const f of frames){
      const expressions={queryPair:'JSON.stringify({a:a.ref,b:b?.ref,stats,pending:pending.length})',nozzleHits:'JSON.stringify({unit:unit.label,seen:seen.size})',resolveSourceOrder:'JSON.stringify({history,visited:access.visited.size,accessLayers:accessLayers.size,supportLayers:supportLayers.size})'};
      if(expressions[f.functionName]){
        const value=await send('Debugger.evaluateOnCallFrame',{callFrameId:f.callFrameId,expression:expressions[f.functionName],returnByValue:true});
        captures.push({function:f.functionName,value});
      }
    }
    writeFileSync('tmp/fidget-ring/scheduler-paused.json',JSON.stringify({frames:frames.map(f=>({function:f.functionName,location:f.location})),captures},null,2));
    console.log(JSON.stringify({captures},null,2));
    const {profile}=await send('Profiler.stop');
    writeFileSync('tmp/fidget-ring/scheduler.cpuprofile',JSON.stringify(profile));
    const byId=new Map(profile.nodes.map(n=>[n.id,n])),counts=new Map();
    for(const id of profile.samples??[])counts.set(id,(counts.get(id)||0)+1);
    console.log(JSON.stringify({profileMs:(profile.endTime-profile.startTime)/1000,samples:profile.samples.length,top:[...counts].sort((a,b)=>b[1]-a[1]).slice(0,18).map(([id,count])=>({count,...byId.get(id).callFrame}))},null,2));
  }finally{state.socket.close();child.kill();}
}
setTimeout(()=>{if(!state.finished){child.kill();process.exitCode=1;}},50000).unref();
