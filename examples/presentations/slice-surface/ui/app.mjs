import {drawFrame,loadStudioWindow} from './renderer.mjs';
import {exportMovie} from './movie.mjs';
const $=id=>document.getElementById(id),canvas=$('scene');
const state={design:null,frames:new Map(),current:0,playing:false,clock:null,job:null,loaded:false};
function options(){return {context:$('context').checked,wash:$('wash').checked};}
function failure(error){$('error').hidden=false;$('error').textContent=error.message??String(error);}
function status(message){$('status').textContent=message;}
function busy(active){
  for(const id of ['build','movie','snapshot','load'])$(id).disabled=active;
  $('movie').disabled=active||!complete();$('save').disabled=active||state.frames.size===0;
  $('cancel').hidden=!active;$('progress').hidden=!active;
}
function complete(){return state.design&&state.frames.size===Math.round(state.design.fps*state.design.durationSeconds)+1;}
async function api(path,body){
  const response=await fetch('/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const result=await response.json();if(!response.ok)throw Error(result.error??'Request failed');return result;
}
function paint(){
  const frame=state.frames.get(state.current);if(frame)drawFrame(canvas,frame,options());
  $('timeline').value=state.current;$('time').textContent=(state.current/30).toFixed(1)+' / '+state.design.durationSeconds.toFixed(1)+' s';
  for(const button of document.querySelectorAll('[data-frame]'))button.classList.toggle('active',Number(button.dataset.frame)===state.current);
}
async function getFrame(index){
  if(state.frames.has(index))return state.frames.get(index);
  const result=await api('preview',{design:{...state.design,frame:index},interactive:false});
  state.frames.set(index,result.preview);$('save').disabled=false;return result.preview;
}
function pause(){state.playing=false;$('play').textContent='Play';}
async function selectFrame(index){
  pause();state.current=index;paint();
  if(!state.frames.has(index)){
    status('Recalculating this slice…');await getFrame(index);
    if(state.current===index){paint();status('Slice ready. Build all frames for continuous playback.');}
  }
}
function tick(now){
  if(!state.playing)return;
  const index=Math.round((now-state.clock)/1000*30),last=Math.round(state.design.durationSeconds*30);
  state.current=Math.min(last,index);paint();
  if(index>=last){pause();status('Animation complete.');return;}
  requestAnimationFrame(tick);
}
function play(){
  if(state.playing){pause();return;}
  if(!complete()){status('Build all frames to play the complete animation.');return;}
  if(state.current>=state.design.durationSeconds*30)state.current=0;
  state.playing=true;state.clock=performance.now()-state.current/30*1000;$('play').textContent='Pause';requestAnimationFrame(tick);
}
function download(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function buildFrames(){
  if(state.job)return;pause();$('error').hidden=true;state.job=new AbortController();busy(true);
  try{
    const last=Math.round(state.design.durationSeconds*30);$('progress').max=last;
    for(let index=0;index<=last;index++){
      state.job.signal.throwIfAborted();await getFrame(index);$('progress').value=index;
      status('Building real slice paths · '+(index+1)+' / '+(last+1)+' frames');
      if(index%10===0){state.current=index;paint();await new Promise(resolve=>setTimeout(resolve,0));}
    }
    state.current=0;paint();$('play').disabled=false;status('All '+(last+1)+' frames ready · 20 seconds · 30 fps.');
  }catch(error){if(error.name==='AbortError')status('Build stopped. Completed frames are retained.');else failure(error);}
  finally{state.job=null;busy(false);}
}
async function movie(){
  if(state.job||!complete())return;pause();state.job=new AbortController();busy(true);$('error').hidden=true;
  const output=document.createElement('canvas');output.width=1920;output.height=1080;const view=options();
  try{
    const last=state.design.durationSeconds*30;
    const blob=await exportMovie({canvas:output,duration:state.design.durationSeconds,speed:1,signal:state.job.signal,
      draw:({seconds})=>drawFrame(output,state.frames.get(Math.min(last,Math.round(seconds*30))),view),
      onProgress:progress=>{status('Encoding video · '+Math.round(progress*100)+'%');$('progress').max=1;$('progress').value=progress;}});
    download(blob,'saam-slice-surfaces-studio-1080p.webm');status('Video exported · 1920 × 1080 · 30 fps · 22 seconds including final hold.');
  }catch(error){if(error.name==='AbortError')status('Video export cancelled.');else failure(error);}
  finally{state.job=null;busy(false);paint();}
}
async function saveCache(){
  const data={schema:'saam-slice-animation/1',design:state.design,frames:[...state.frames.values()]};
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  if(typeof CompressionStream==='function')download(await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob(),'saam-slice-surfaces.frames.json.gz');
  else download(blob,'saam-slice-surfaces.frames.json');
}
async function loadCache(file){
  pause();const bytes=new Uint8Array(await file.arrayBuffer()),compressed=bytes[0]===31&&bytes[1]===139;
  const text=compressed?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);
  const data=JSON.parse(text);
  if(data.schema!=='saam-slice-animation/1'||JSON.stringify(data.design)!==JSON.stringify(state.design)||!Array.isArray(data.frames))throw Error('This cache does not match the current animation design.');
  const frames=new Map();
  for(const frame of data.frames){
    if(!Number.isInteger(frame.frame)||frame.frame<0||frame.frame>state.design.durationSeconds*30||!Array.isArray(frame.paths)||!Array.isArray(frame.boundary)||frame.sizeMm!==state.design.sizeMm||frame.paths.some(path=>!Array.isArray(path.points)||path.points.some(point=>!Array.isArray(point)||point.length!==3||point.some(n=>!Number.isFinite(n)))))throw Error('Invalid cached frame.');
    frames.set(frame.frame,frame);
  }
  if(!frames.has(0))throw Error('The cache has no initial frame.');
  state.frames=frames;state.current=0;paint();$('play').disabled=!complete();busy(false);status('Loaded '+frames.size+' calculated frames.');
}
async function snapshot(){
  const response=await api('bundles',{design:{...state.design,frame:state.current}});$('snapshot-result').textContent='Saving the selected slice…';
  async function poll(){const job=await api('job');if(job.id!==response.id)return;
    if(job.stage==='failed'){$('snapshot-result').textContent=job.error;return;}
    if(job.stage==='complete'){$('snapshot-result').textContent='Saved: '+job.directory;return;}
    setTimeout(poll,600);
  }
  await poll();
}
$('play').onclick=play;$('restart').onclick=()=>selectFrame(0).catch(failure);
$('timeline').oninput=()=>selectFrame(Number($('timeline').value)).catch(failure);
for(const button of document.querySelectorAll('[data-frame]'))button.onclick=()=>selectFrame(Number(button.dataset.frame)).catch(failure);
for(const id of ['context','wash'])$(id).onchange=paint;
$('build').onclick=()=>buildFrames().catch(failure);$('movie').onclick=()=>movie().catch(failure);
$('cancel').onclick=()=>state.job?.abort();$('save').onclick=()=>saveCache().catch(failure);
$('load').onclick=()=>$('cache-file').click();$('cache-file').onchange=()=>{const file=$('cache-file').files[0];if(file)loadCache(file).catch(failure);};
$('still').onclick=()=>canvas.toBlob(blob=>{if(blob)download(blob,'saam-slice-'+String(state.current).padStart(4,'0')+'.png');});
$('fullscreen').onclick=()=>canvas.requestFullscreen().catch(failure);$('snapshot').onclick=()=>snapshot().catch(failure);
async function start(){
  await loadStudioWindow();
  const saved=await api('design');state.design=saved.design;$('timeline').max=state.design.durationSeconds*30;
  await getFrame(0);paint();state.loaded=true;status('Flat slice ready. Select a chapter, or build the complete animation.');
  const cache=await fetch('/preview.frames.json.gz');
  if(cache.ok){status('Loading calculated animation…');await loadCache(await cache.blob());}
}
start().catch(failure);
