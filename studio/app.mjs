import { advancePlayback, frameAtTime } from './playback.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const token=$('meta[name="saam-token"]').content;
let state,tab='geometry',selected='sloping-face',yaw=-0.78,tilt=0.62,zoom=1,playing=false,frame=0,busy=false,fitBounds=null,seconds=0,lastFrame=0,polling=false,reconnecting=false;
const canvas=$('#canvas'),ctx=canvas.getContext('2d');
let polygons=[],drag=null,moved=false;
const names={'sloping-face':'Sloped face',base:'Bottom','front-side':'Front','back-side':'Back','high-end':'Tall end','low-end':'Low end'};
const message=(text,error=false)=>{$('#message').textContent=text;$('#message').classList.toggle('error',error);};
const duration=()=>state?.program?.summary.motionSeconds??0;
const clock=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
function stop(){playing=false;lastFrame=0;cancelAnimationFrame(frame);$('#play').textContent='Play';}
async function api(route,data) {
  const response=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify(data)});
  if(!response.ok)throw new Error((await response.json()).error);
  return response;
}
async function refresh(follow=false) {
  const response=await fetch('/api/state');if(!response.ok)throw new Error((await response.json()).error);
  const next=await response.json(),previous=state;state=next;
  if(previous?.exportHash!==next.exportHash){stop();seconds=duration();fitBounds=null;}
  if(!previous)tab=state.geometryApproved?(state.planApproved?'toolpath':'plan'):'geometry';
  else if(follow&&previous.planHash!==state.planHash){tab=state.geometryApproved?'plan':'geometry';message('Updated from chat.');}
  else if(follow&&state.planApproved&&!previous.program&&state.program)tab='toolpath';
  render();
}
function table(entries) {
  const dl=document.createElement('dl');
  for(const [key,value]of entries){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;row.append(dt,dd);dl.append(row);}
  return dl;
}
function render() {
  const {geometry:g,setup:s,process:p}=state.plan;
  const high=g.baseMm+g.runMm*Math.tan(g.angleDeg*Math.PI/180);
  const stage={geometry:1,plan:2,toolpath:3}[tab];
  $('#stage-label').textContent='STEP '+stage+' OF 3';
  $('#view-title').textContent={geometry:'Your geometry',plan:'Your geometry',toolpath:'Your toolpath'}[tab];
  $('#prompt').textContent={geometry:'Look at the geometry.',plan:'Look at the settings.',toolpath:'Review the toolpath.'}[tab];
  $('#guidance').textContent={geometry:'Check the shape and size before continuing.',plan:'Confirm how this part will be printed.',toolpath:'Play it through, then confirm and export.'}[tab];
  const geometryFacts=[['Size',g.runMm+' × '+g.widthMm+' mm'],['Height',g.baseMm+'–'+high.toFixed(2)+' mm'],['Slope',g.angleDeg+'°']];
  const settingFacts=[['Material',s.material+' · '+s.nozzleC+'°C'],['Nozzle','#'+(s.tool+1)+' · '+s.core],['Layer height',p.layerMm+' mm'],['Sloped layers',p.skinLayers+' × '+p.skinNormalMm+' mm'],['Travel height',high.toFixed(2)+' + '+p.liftMm+' mm']];
  const programFacts=state.program?[['Layers',state.pathSummary.planarLayers+' flat + '+p.skinLayers+' sloped'],['Estimated motion',Math.round(duration()/60)+' min'],['Material',(state.program.summary.filamentMm/1000).toFixed(2)+' m of PLA']]:[];
  $('#facts').replaceChildren(table(tab==='geometry'?geometryFacts:tab==='plan'?settingFacts:programFacts));
  $('#more-settings').hidden=tab!=='plan';
  $('#settings-detail').replaceChildren(table([
    ['Bed temperature',s.bedC+'°C'],['Build volume temperature',s.buildVolumeC+'°C'],['First layer',p.firstLayerMm+' mm'],['Line width',p.lineWidthMm+' mm'],
    ['Flat / sloped speed',p.planarSpeedMmS+' / '+p.skinSpeedMmS+' mm/s'],['First-layer speed',p.firstLayerSpeedMmS+' mm/s'],
    ['Travel / lift speed',p.travelSpeedMmS+' / '+p.zSpeedMmS+' mm/s'],['Retraction',p.retractMm+' mm at '+p.retractSpeedMmS+' mm/s'],
    ['Cooling fan',p.fanPercent+'%'],['Minimum layer time',p.minimumLayerSeconds+' s'],['Material flow limit',p.maxFlowMm3S+' mm³/s'],
    ['Filament diameter',s.filamentMm+' mm'],['Placement','X '+state.plan.placement.xMm+' / Y '+state.plan.placement.yMm+' mm'],
    ['Fill','Solid; direction reverses each layer'],['Sloped passes','Back and forth'],['Startup',state.setupBasis]
  ]));
  const ready=tab==='geometry'||(tab==='plan'&&state.geometryApproved)||(tab==='toolpath'&&state.planApproved&&state.program&&state.review.generation?.mode==='production');
  $('#confirm').disabled=!ready||busy;
  $('#confirm').textContent=tab==='geometry'?(state.geometryApproved?'Continue to settings':'Confirm geometry'):tab==='plan'?(state.planApproved?'View toolpath':'Confirm settings'):state.toolpathApproved?'Export G-code':'Confirm & export';
  $('#review-note').textContent=tab==='toolpath'?(state.programError??(!state.program?'The toolpath will appear after you confirm the settings.':!state.planApproved?'Preview only. Confirm geometry and settings before export.':'Clearance is your check for this demo.')):'';
  $('#playback').hidden=tab!=='toolpath'||!state.program;
  $('#scrub').max=duration();$('#scrub').value=seconds;
  $$('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.classList.toggle('done',!!state[{geometry:'geometryApproved',plan:'planApproved',toolpath:'toolpathApproved'}[b.dataset.tab]]);b.disabled=b.dataset.tab==='plan'&&!state.geometryApproved||b.dataset.tab==='toolpath'&&!state.program;});
  draw();
}
function selectFeature(id){selected=id;$('#selection').textContent=names[id]??id;draw();}
function setTab(next){if(!state)return;tab=next;stop();render();}

function project(point) {
  const g=state.plan.geometry,height=g.baseMm+g.runMm*Math.tan(g.angleDeg*Math.PI/180);
  const bounds=tab==='toolpath'&&fitBounds?fitBounds:{min:[0,0,0],max:[g.runMm,g.widthMm,height]};
  const size=bounds.max.map((v,i)=>Math.max(1,v-bounds.min[i]));
  const x=point[0]-(bounds.min[0]+bounds.max[0])/2,y=point[1]-(bounds.min[1]+bounds.max[1])/2,z=point[2]-(bounds.min[2]+bounds.max[2])/2;
  const u=x*Math.cos(yaw)-y*Math.sin(yaw),v=x*Math.sin(yaw)+y*Math.cos(yaw);
  const scale=Math.min(canvas.clientWidth/(size[0]+size[1])*1.1,canvas.clientHeight/(size[2]+Math.max(size[0],size[1]))*.9)*zoom;
  return [canvas.clientWidth/2+u*scale,canvas.clientHeight*.53+(v*Math.sin(tilt)-z*Math.cos(tilt))*scale,v*Math.cos(tilt)+z*Math.sin(tilt)];
}
function segment(a,b,color,width=1){ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
function draw() {
  if(!state)return;
  const ratio=devicePixelRatio||1;
  if(canvas.width!==Math.round(canvas.clientWidth*ratio)||canvas.height!==Math.round(canvas.clientHeight*ratio)){canvas.width=Math.round(canvas.clientWidth*ratio);canvas.height=Math.round(canvas.clientHeight*ratio);}
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);
  const g=state.plan.geometry;
  for(let x=-10;x<=g.runMm+10;x+=5)segment(project([x,-10,0]),project([x,g.widthMm+10,0]),'#dbe1d4',.6);
  for(let y=-10;y<=g.widthMm+10;y+=5)segment(project([-10,y,0]),project([g.runMm+10,y,0]),'#dbe1d4',.6);
  const pts=state.geometry.vertices.map(project);
  polygons=state.geometry.faces.map((face,i)=>({id:state.geometry.labels[i],points:face.map(j=>pts[j]),depth:face.reduce((sum,j)=>sum+pts[j][2],0)/4})).sort((a,b)=>a.depth-b.depth);
  for(const polygon of polygons) {
    ctx.beginPath();polygon.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
    ctx.fillStyle=tab==='toolpath'?'rgba(206,216,194,.11)':polygon.id===selected?'#cedcab':'#dbe3d0';
    ctx.fill();ctx.strokeStyle=tab==='toolpath'?'#a6b99b88':'#81947d';ctx.lineWidth=.9;ctx.stroke();
  }
  if(tab==='toolpath'&&state.program) {
    const moves=state.program.moves,at=frameAtTime(moves,seconds),count=at.completed,placement=state.plan.placement;
    const local=p=>[p[0]-placement.xMm,p[1]-placement.yMm,p[2]];
    for(let i=0;i<count;i++) {
      const move=moves[i];if(!move.extruding&&!$('#travel').checked)continue;
      const color=move.extruding?(move.phase==='inclined'?'#d97735':move.phase==='prime'?'#5b92a3':'#80977788'):'#8795ab66';
      segment(project(local(move.from)),project(local(move.to)),color,move.phase==='inclined'?1.25:.7);
    }
    const current=moves[at.active];
    if(current&&at.fraction<1&&(current.extruding||$('#travel').checked))segment(project(local(current.from)),project(local(at.point)),current.phase==='inclined'?'#d97735':'#809777',1.25);
    if(at.point){const p=project(local(at.point)),q=project(local([at.point[0],at.point[1],at.point[2]+3]));segment(p,q,'#273e36',3);ctx.beginPath();ctx.arc(p[0],p[1],3,0,Math.PI*2);ctx.fillStyle='#273e36';ctx.fill();
      $('#time-label').textContent=clock(seconds)+' / '+clock(duration());
    }
  }
  const origin=project([0,0,0]);segment(origin,project([5,0,0]),'#b26751',1.5);segment(origin,project([0,5,0]),'#659a7a',1.5);segment(origin,project([0,0,5]),'#638599',1.5);
  ctx.font='10px Segoe UI';ctx.fillStyle='#71836b';ctx.fillText('5 mm grid',18,canvas.clientHeight-18);
  if(tab!=='toolpath'){const polygon=polygons.find(p=>p.id===selected);if(polygon){const center=polygon.points.reduce((s,p)=>[s[0]+p[0]/4,s[1]+p[1]/4],[0,0]);ctx.fillStyle='#31432c';ctx.fillText(names[selected]??selected,center[0]-25,center[1]);}}
}

function inPolygon(x,y,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drag=[e.clientX,e.clientY];moved=false;};
canvas.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag[0],dy=e.clientY-drag[1];if(Math.abs(dx)+Math.abs(dy)>2)moved=true;yaw+=dx*.008;tilt=Math.max(-1.5,Math.min(1.5,tilt+dy*.008));drag=[e.clientX,e.clientY];draw();};
canvas.onpointerup=e=>{drag=null;if(!moved&&tab!=='toolpath'){const rect=canvas.getBoundingClientRect();const hit=[...polygons].reverse().find(p=>inPolygon(e.clientX-rect.left,e.clientY-rect.top,p.points));if(hit)selectFeature(hit.id);}};
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.08,Math.min(4,zoom*Math.exp(-e.deltaY*.001)));draw();},{passive:false});
canvas.onkeydown=e=>{if(e.key==='ArrowLeft')yaw-=.1;else if(e.key==='ArrowRight')yaw+=.1;else if(e.key==='ArrowUp')tilt-=.1;else if(e.key==='ArrowDown')tilt+=.1;else return;e.preventDefault();draw();};
new ResizeObserver(draw).observe(canvas);
$$('[data-view]').forEach(b=>b.onclick=()=>{const mode=b.dataset.view;if(mode==='iso'){yaw=-.78;tilt=.62;}if(mode==='side'){yaw=0;tilt=0;}if(mode==='top'){yaw=0;tilt=Math.PI/2;}draw();});
$('#reset-view').onclick=()=>{zoom=1;yaw=-.78;tilt=.62;fitBounds=null;$('#fit-program').textContent='Fit all moves';draw();};
$('#fit-program').onclick=()=>{
  if(fitBounds){fitBounds=null;$('#fit-program').textContent='Fit all moves';}
  else {
    fitBounds={min:[0,0,0],max:[state.plan.geometry.runMm,state.plan.geometry.widthMm,0]};
    for(const move of state.program.moves)for(const p of [move.from,move.to])for(let i=0;i<3;i++){
      const v=p[i]-(i===0?state.plan.placement.xMm:i===1?state.plan.placement.yMm:0);
      fitBounds.min[i]=Math.min(fitBounds.min[i],v);fitBounds.max[i]=Math.max(fitBounds.max[i],v);
    }
    $('#travel').checked=true;$('#fit-program').textContent='Fit part';
  }
  zoom=1;draw();
};
$$('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
async function approval(stage){await api('approve',{stage,actor:'Local user',revision:state.revision});await refresh();}
async function download(){const response=await api('deliver',{}),url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='wedge.gcode';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#confirm').onclick=async()=>{
  if(busy||!state)return;busy=true;render();message('');
  try{
    if(tab==='geometry'){if(!state.geometryApproved)await approval('geometry');tab='plan';}
    else if(tab==='plan'){if(!state.planApproved)await approval('plan');if(!state.program||state.review.generation?.mode!=='production'){message('Preparing your toolpath…');await api('generate',{development:false});await refresh();}tab='toolpath';}
    else {if(!state.toolpathApproved)await approval('toolpath');await download();}
    message('');
  }catch(e){message(e.message,true);}
  finally{busy=false;render();}
};
$('#travel').onchange=draw;
$('#scrub').oninput=()=>{stop();seconds=Number($('#scrub').value);draw();};
$('#play').onclick=()=>{if(playing){stop();return;}if(seconds>=duration())seconds=0;playing=true;lastFrame=0;$('#play').textContent='Pause';frame=requestAnimationFrame(animate);};
function animate(now){
  if(!playing)return;
  if(lastFrame)seconds=advancePlayback(seconds,now-lastFrame,Number($('#playback-speed').value),duration());
  lastFrame=now;$('#scrub').value=seconds;draw();
  if(seconds>=duration()){stop();return;}frame=requestAnimationFrame(animate);
}
async function poll(){
  if(polling||busy)return;polling=true;
  try{
    const response=await fetch('/api/revision');if(!response.ok)throw new Error('Reconnecting to your print…');
    const next=await response.json();
    if(reconnecting)message('');
    if(!state||reconnecting||next.fingerprint!==state.fingerprint)await refresh(true);
    reconnecting=false;
  }catch(e){reconnecting=true;$('#confirm').disabled=true;message('Your print is updating. Reconnecting…');}
  finally{polling=false;}
}
refresh().catch(e=>message(e.message,true));
setInterval(poll,1000);
