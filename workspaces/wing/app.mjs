import {createAssemblyRenderer} from './renderer.mjs';
const $=id=>document.getElementById(id),renderer=createAssemblyRenderer(),canvas=$('model');
canvas.replaceWith(renderer.canvas);renderer.canvas.id='model';renderer.canvas.setAttribute('aria-label','Interactive aircraft with printable wing sections');
const view={design:null,preview:null,selected:null,mode:'assembled',yaw:-.45,tilt:.75,zoom:1,pan:[0,0],request:0,drag:null,job:null,invalid:false};
const controls=[
  ['Planform'],['spanMm','Span',300,1800,20,' mm'],['chordMm','Root chord',100,250,5,' mm'],['taper','Tip / root chord',.75,1,.025,''],['camber','Camber',0,.04,.005,''],['thickness','Thickness ratio',.1,.18,.01,''],['wingletHeightMm','Winglet height',40,160,5,' mm'],
  ['Print sections'],['sectionHeightMm','Maximum section height',40,280,5,' mm'],['flaps','Separate flaps'],['flapStart','Flap starts · half-span',.1,.7,.025,''],['flapEnd','Flap ends · half-span',.3,.9,.025,''],['flapChord','Flap chord fraction',.2,.32,.01,''],
  ['Construction'],['rodDiameterMm','Reinforcement rod',2,8,.5,' mm'],['pivotDiameterMm','Pivot rod',2,5,.5,' mm'],['clearanceMm','Radial clearance',.1,.5,.05,' mm'],['beadWidthMm','Bead width',.35,.6,.05,' mm'],['layerMm','Layer height',.15,.3,.025,' mm']
];
function settings(){
  const form=$('settings');form.replaceChildren();
  for(const [key,title,min,max,step,unit] of controls){
    if(!title){const div=document.createElement('div');div.className='group';div.textContent=key;form.append(div);continue;}
    const label=document.createElement('label');label.className='field';const span=document.createElement('span'),text=document.createElement('span'),output=document.createElement('output'),input=document.createElement('input');
    text.textContent=title;span.append(text,output);input.dataset.key=key;input.setAttribute('aria-label',title);
    if(key==='flaps'){input.type='checkbox';input.checked=view.design.flaps;label.append(span,input);}
    else{Object.assign(input,{type:'range',min,max,step,value:view.design[key]});output.textContent=Number(view.design[key].toFixed(3))+unit;input.dataset.unit=unit;label.append(span,input);}
    form.append(label);
  }
}
async function api(path,body){const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),result=await response.json();if(!response.ok)throw Error(result.error??'Request failed.');return result;}
function error(message){$('error').hidden=!message;$('error').textContent=message??'';}
async function update(design){
  const request=++view.request;$('export').disabled=true;
  try{const r=await api('/api/design',{design,machineId:$('machine').value});if(request!==view.request)return;view.invalid=false;view.design=r.design;view.preview=r.preview;if(!r.preview.pieces.some(p=>p.id===view.selected))view.selected=r.preview.pieces[0].id;error();settings();pieces();draw();}
  catch(e){if(request===view.request){view.invalid=true;error(e.message);}}
  finally{if(request===view.request)$('export').disabled=view.invalid||!!view.job&&!['complete','failed'].includes(view.job.stage);}
}
$('settings').onchange=e=>{const key=e.target.dataset.key;if(!key)return;const value=key==='flaps'?e.target.checked:+e.target.value;update({...view.design,[key]:value});};
$('settings').oninput=e=>{const key=e.target.dataset.key;if(key&&key!=='flaps')e.target.previousElementSibling.querySelector('output').textContent=Number((+e.target.value).toFixed(3))+e.target.dataset.unit;};
$('settings').onsubmit=e=>e.preventDefault();
$('machine').onchange=()=>update(view.design);
function pieces(){
  $('pieces').replaceChildren();
  for(const p of view.preview.pieces){const b=document.createElement('button');b.className='piece'+(p.id===view.selected?' active':'');const name=document.createElement('span'),info=document.createElement('small');name.textContent=p.id;info.textContent=(p.toMm-p.fromMm).toFixed(1)+' mm'+(p.integratedTip?' · tip':'');b.append(name,info);b.onclick=()=>{view.selected=p.id;pieces();draw();};$('pieces').append(b);}
  const d=view.design;$('stats').textContent=`${d.spanMm} mm span · ${view.preview.pieces.length} prints · ${d.layerMm} mm layers`;
  document.querySelector('.legend p').textContent=`${d.rodDiameterMm} mm reinforcement rods · ${d.pivotDiameterMm} mm pivot · ${d.clearanceMm} mm radial clearance`;
}
function assembly(){
  const parts=view.mode==='print'?[]:[...view.preview.context],chosen=view.preview.pieces.find(p=>p.id===view.selected),list=view.mode==='print'?[chosen]:view.preview.pieces;
  for(const piece of list){
    const faces=[],lines=[],index=view.preview.cuts.findIndex(c=>c>=piece.toMm-1e-6)-1;
    const sense=piece.integratedTip?-1:1;
    const place=(point,span)=>view.mode==='print'?[point[0],piece.hand*sense*point[1],piece.integratedTip?piece.toMm-span:span-piece.fromMm]:[piece.hand*(span+(view.mode==='exploded'?index*28:0)),point[0]+(piece.kind==='flap'&&view.mode==='exploded'?35:0),point[1]];
    for(let i=1;i<piece.sections.length;i++){
      const a=piece.sections[i-1],b=piece.sections[i];
      for(let j=0;j<a.points.length;j++){const k=(j+1)%a.points.length;faces.push([place(a.points[j],a.span),place(a.points[k],a.span),place(b.points[k],b.span),place(b.points[j],b.span)]);}
    }
    for(const s of [piece.sections[0],piece.sections.at(-1)]){lines.push([...s.points,s.points[0]].map(p=>place(p,s.span)));faces.push(s.points.map(p=>place(p,s.span)));}
    if($('wire').checked){const span=(piece.fromMm+piece.toMm)/2;lines.push([...piece.route,piece.route[0]].map(p=>place(p,span)));}
    parts.push({id:piece.id,group:'skin',color:piece.id===view.selected?'#d89954':piece.kind==='flap'?'#769d88':'#bdcbbc',faces,lines});
  }
  if($('rods').checked&&view.mode!=='print')for(const rod of view.preview.rods){
    const end=view.preview.rodEndMm,r=rod.diameterMm/2,faces=[],n=12,cy=rod.centerMm;
    for(let i=0;i<n;i++){const a=i*2*Math.PI/n,b=(i+1)*2*Math.PI/n;faces.push([[-end,rod.xMm+r*Math.cos(a),cy+r*Math.sin(a)],[end,rod.xMm+r*Math.cos(a),cy+r*Math.sin(a)],[end,rod.xMm+r*Math.cos(b),cy+r*Math.sin(b)],[-end,rod.xMm+r*Math.cos(b),cy+r*Math.sin(b)]]);}
    parts.push({group:'rods',color:'#51677a',faces,lines:[]});
  }
  if(view.mode==='print'){
    const points=parts.flatMap(p=>p.faces.flat()),low=[Infinity,Infinity],high=[-Infinity,-Infinity];
    for(const p of points)for(let k=0;k<2;k++){low[k]=Math.min(low[k],p[k]-10);high[k]=Math.max(high[k],p[k]+10);}
    const bed=[[low[0],low[1],-.2],[high[0],low[1],-.2],[high[0],high[1],-.2],[low[0],high[1],-.2]];
    parts.push({group:'bed',color:'#d6dcd2',faces:[bed],lines:[[...bed,bed[0]]]});
  }
  return parts;
}
function draw(){
  if(!view.preview)return;
  const parts=assembly(),box=$('viewport').getBoundingClientRect(),width=box.width,height=box.height,all=parts.flatMap(p=>p.faces.flat()),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of all)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  const center=min.map((v,i)=>(v+max[i])/2),extent=Math.max(...max.map((v,i)=>v-min[i])),scale=Math.min(width*.84,height*1.2)/extent*view.zoom,cy=Math.cos(view.yaw),sy=Math.sin(view.yaw),ct=Math.cos(view.tilt),st=Math.sin(view.tilt);
  const project=p=>{const [x,y,z]=p.map((v,i)=>v-center[i]),u=cy*x-sy*y,v=sy*x+cy*y;return [width/2+u*scale+view.pan[0],height/2+(ct*v-st*z)*scale+view.pan[1],st*v+ct*z];};
  renderer.draw(parts,project,width,height,devicePixelRatio,$('wire').checked);
  const selected=view.preview.pieces.find(p=>p.id===view.selected);
  $('view-note').textContent=view.mode==='print'?(selected.integratedTip?'Flat outer winglet face on the bed · Wing grows toward the root':'Section joint on the bed · Span upright'):'Drag to orbit · Shift-drag to pan · Scroll to zoom · Fuselage and tail are display context only';
  drawSection();
}
function drawSection(){
  const selected=view.preview.pieces.find(p=>p.id===view.selected),c=$('section'),box=c.getBoundingClientRect(),ratio=devicePixelRatio,w=box.width,h=box.height;
  c.width=Math.round(w*ratio);c.height=Math.round(h*ratio);const ctx=c.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,w,h);
  const route=selected.route,min=[Infinity,Infinity],max=[-Infinity,-Infinity];for(const p of route)for(let k=0;k<2;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  const scale=Math.min((w-20)/(max[0]-min[0]),(h-35)/(max[1]-min[1])),point=p=>[10+(p[0]-min[0])*scale,h/2-((p[1]-(max[1]+min[1])/2)*scale)];
  ctx.beginPath();for(const [i,p] of [...route,route[0]].entries()){const q=point(p);if(!i)ctx.moveTo(...q);else ctx.lineTo(...q);}ctx.lineWidth=Math.max(1,view.design.beadWidthMm*scale);ctx.strokeStyle='#426c55';ctx.lineJoin='round';ctx.stroke();
  const start=point(route[0]);ctx.beginPath();ctx.arc(...start,3,0,Math.PI*2);ctx.fillStyle='#c17d38';ctx.fill();
  $('section-note').textContent=`${selected.id} · ${selected.fromMm.toFixed(1)}–${selected.toMm.toFixed(1)} mm from the root. One connected extrusion route; skin turns inward around the rod passages.`;
}
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{view.mode=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));view.zoom=1;view.pan=[0,0];draw();};
for(const id of ['wire','rods'])$(id).onchange=draw;$('fit').onclick=()=>{view.zoom=1;view.pan=[0,0];draw();};
renderer.canvas.onpointerdown=e=>{renderer.canvas.setPointerCapture(e.pointerId);view.drag={x:e.clientX,y:e.clientY,pan:e.shiftKey||e.button===2};};
renderer.canvas.onpointermove=e=>{if(!view.drag)return;const dx=e.clientX-view.drag.x,dy=e.clientY-view.drag.y;if(view.drag.pan){view.pan=[view.pan[0]+dx,view.pan[1]+dy];}else{view.yaw+=dx*.008;view.tilt=Math.max(-1.5,Math.min(1.5,view.tilt+dy*.008));}view.drag={...view.drag,x:e.clientX,y:e.clientY};draw();};
renderer.canvas.onpointerup=()=>view.drag=null;renderer.canvas.oncontextmenu=e=>e.preventDefault();renderer.canvas.onwheel=e=>{e.preventDefault();view.zoom=Math.max(.25,Math.min(8,view.zoom*Math.exp(-e.deltaY*.001)));draw();};
new ResizeObserver(draw).observe($('viewport'));
function save(){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(view.design,null,2)],{type:'application/json'}));a.href=url;a.download='wing-design.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('save').onclick=save;$('load').onclick=()=>$('file').click();$('file').onchange=async e=>{try{const d=JSON.parse(await e.target.files[0].text());await update(d);settings();}catch(e){error(e.message);}finally{$('file').value='';}};
function jobDisplay(job){
  view.job=job;if(!job)return;$('export').disabled=view.invalid||!['complete','failed'].includes(job.stage);
  $('progress').textContent=job.stage==='complete'?`${job.total} bundles created`:job.stage==='failed'?'Export stopped: '+job.error:`${job.completed} / ${job.total} · ${job.piece??'Preparing'}…`;
  $('results').replaceChildren();const path=document.createElement('code');path.textContent=job.directory;$('results').append(path);
  if(job.stage==='complete'){
    const p=document.createElement('p'),copy=document.createElement('button');p.textContent='All wing parts are saved together in this folder. One request handles the whole set.';
    copy.textContent='Copy request for all parts';copy.onclick=async()=>{try{await navigator.clipboard.writeText(`Generate and check every wing print bundle listed in export.json in ${job.directory}, then open the set for review in Studio. Handle the whole folder as one task; preserve each part’s workspace construction requirements.`);copy.textContent='Copied';}catch(e){error(e.message);}};
    $('results').append(p,copy);
  }
}
async function poll(){try{const job=await api('/api/job');jobDisplay(job);if(job&&!['complete','failed'].includes(job.stage))setTimeout(poll,1000);}catch(e){error(e.message);}}
$('export').onclick=async()=>{try{error();$('export').disabled=true;jobDisplay(await api('/api/export',{design:view.design,machineId:$('machine').value}));poll();}catch(e){error(e.message);$('export').disabled=false;}};
try{const result=await api('/api/design');view.design=result.design;view.preview=result.preview;view.selected=result.preview.pieces[0].id;settings();pieces();draw();if(result.job){jobDisplay(result.job);poll();}}catch(e){error(e.message);}
