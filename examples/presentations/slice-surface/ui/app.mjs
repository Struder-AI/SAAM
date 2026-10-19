import {ROUNDING_MM} from './native/core/dimensions.mjs';
import {drawFrame,loadStudioWindow} from './renderer.mjs';
import {exportMovie} from './native/studio/playback.mjs';
const $=id=>document.getElementById(id),canvas=$('scene'),cache=new Map();let index,current=0,playing=false,job=null,drawing=Promise.resolve();
function status(text){$('status').textContent=text;}
function fail(error){$('error').hidden=false;$('error').textContent=error.message??String(error);console.error(error);}
async function frameAt(n){const key=index.canonical[n];if(!cache.has(key)){
 const promise=(async()=>{const response=await fetch('/frames/'+String(key).padStart(4,'0')+'.json.gz');if(!response.ok)throw Error('Missing native frame '+key);const text=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text();const frame=JSON.parse(text);if(!frame.program?.moves?.length)throw Error('Invalid native frame');frame.program.moves=frame.program.moves.filter(m=>Math.hypot(...m.to.map((v,k)=>v-m.from[k]))>ROUNDING_MM);return frame;})();
 cache.set(key,promise);while(cache.size>5)cache.delete(cache.keys().next().value);
 }return cache.get(key);}
async function paint(n,target=canvas){
 const frame=await frameAt(n),layer=frame.animation.layerIndex;
 const previous=frame.animation.mode==='intro'&&layer>0?await frameAt(Math.round((5+(layer-1)*.45+.2)*30)):null;
 const result=await drawFrame(target,frame,{context:$('context').checked,previous});
 if(target===canvas){$('timeline').value=n;$('time').textContent=(n/30).toFixed(1)+' / '+index.design.durationSeconds.toFixed(1)+' s';}
 return result;
}
function pause(){playing=false;$('play').textContent='Play';}
async function seek(n){if(job)return drawing;pause();current=Math.max(0,Math.min(index.canonical.length-1,Math.round(n)));drawing=drawing.then(()=>paint(current));return drawing;}
async function play(){
 if(playing){pause();return;}if(current>=index.canonical.length-1)current=0;playing=true;$('play').textContent='Pause';
 const started=performance.now()-current/30*1000;
 while(playing){current=Math.min(index.canonical.length-1,Math.round((performance.now()-started)/1000*30));await paint(current);if(current===index.canonical.length-1){pause();break;}await new Promise(requestAnimationFrame);}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function movie(){
 if(job)return;pause();job=new AbortController();for(const id of ['movie','play','timeline','restart','context','still'])$(id).disabled=true;$('cancel').hidden=false;$('progress').hidden=false;$('error').hidden=true;
 try{const output=document.createElement('canvas');output.width=1920;output.height=1080;
 const blob=await exportMovie({canvas:output,duration:index.design.durationSeconds,speed:1,signal:job.signal,draw:({seconds})=>paint(Math.min(index.canonical.length-1,Math.round(seconds*30)),output),onProgress:q=>{$('progress').value=q;status('Encoding native SAAM toolpaths · '+Math.round(q*100)+'%');}});
 download(blob,'saam-native-slice-showcase-1080p.webm');status('Video exported · 1080p · 30 fps · silent.');
 }catch(error){if(error.name==='AbortError')status('Export cancelled.');else fail(error);}finally{job=null;for(const id of ['movie','play','timeline','restart','context','still'])$(id).disabled=false;$('cancel').hidden=true;$('progress').hidden=true;await paint(current);}
}
$('play').onclick=()=>play().catch(fail);$('restart').onclick=()=>seek(0).catch(fail);$('timeline').oninput=()=>seek(Number($('timeline').value)).catch(fail);$('context').onchange=()=>seek(current).catch(fail);$('movie').onclick=()=>movie().catch(fail);$('cancel').onclick=()=>job?.abort();$('still').onclick=async()=>{await drawing;canvas.toBlob(b=>download(b,'saam-native-slice-'+current+'.png'));};$('fullscreen').onclick=()=>canvas.requestFullscreen().catch(fail);
window.presentation={seek,paint,frameAt,movie,get current(){return current;},get design(){return index?.design;}};
async function start(){await loadStudioWindow();const r=await fetch('/preview.index.json');if(!r.ok)throw Error('Native animation index is missing.');index=await r.json();$('timeline').max=index.canonical.length-1;await paint(0);$('play').disabled=false;$('movie').disabled=false;document.body.dataset.ready='true';status('Native SAAM toolpaths ready · '+index.uniqueFrames+' recalculated slices.');}
start().catch(fail);
