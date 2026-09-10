import { advancePlayback, frameAtTime } from './playback.mjs';
import {hasSkill,regionRows,recipeRows,robotRows} from './settings.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const token=$('meta[name="saam-token"]').content;
const exportedThisSession=new Set();
const exportKey=()=>state?.printId+':'+state?.exportHash;
let state,tab='geometry',selected=null,yaw=-0.78,tilt=0.62,zoom=1,playing=false,frame=0,busy=false,fitBounds=null,seconds=0,lastFrame=0,polling=false,reconnecting=false;
const canvas=$('#canvas'),ctx=canvas.getContext('2d');
let polygons=[],drag=null,moved=false;
const message=(text,error=false)=>{$('#message').textContent=text;$('#message').classList.toggle('error',error);};
const duration=()=>state?.program?.summary.motionSeconds??0;
const clock=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
const round2=v=>Number(v).toFixed(2);
const materialFact=program=>program.summary.materialModel==='relay-estimate'
  ? ['Material estimate',round2(program.summary.estimatedRelayVolumeMm3)+' mm³ from relay timing; unverified']
  : [program.envelope?'Part material':'Material',round2(program.summary.filamentMm/1000)+' m of filament'];
const materialSetup=state=>state.plan.setup.dobot
  ? ['Extrusion','External relay control · '+state.plan.setup.material]
  : ['Material',state.plan.setup.material+' · '+state.plan.setup.nozzleC+'°C'];
const vaseSettings=state=>{
  if(state.plan.composition?.regions?.length)return [];
  const vase=state.plan.skills?.['vase-wall'];
  return vase?.enabled?[
    ['Vase wall','One continuous spiral; '+(vase.endTransition==='level'?'level rim':'spiral rim')],
    ['Vase component',vase.part??'Part'],
    ['Vase height range',vase.zStartMm+'–'+(vase.zEndMm??'geometry top')+' mm above component base'],
    ['Spiral sampling',vase.sampleStepMm+' mm maximum step · '+vase.toleranceMm+' mm tolerance']
  ]:[];
};
function machineSettings(state,rows){
  const d=state.plan.setup.dobot;
  if(!d)return rows;
  const omitted=new Set(['Bed temperature','Build volume temperature','Retraction','Cooling fan','Filament diameter','Material flow limit']);
  return [...rows.filter(([name])=>!omitted.has(name)),...robotRows(state.plan)];
}
function stop(){playing=false;lastFrame=0;cancelAnimationFrame(frame);$('#play').textContent='Play';}
function activity(text=''){
  $('#activity').hidden=!text;$('#activity-label').textContent=text;
  $('main').setAttribute('aria-busy',String(!!text));
}
async function working(text,task){
  if(busy)return;busy=true;stop();activity(text);if(state)render();$('#open-print').disabled=true;
  // Paint the indicator before local parsing/drawing can occupy the UI thread.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  try{return await task();}
  finally{busy=false;activity();$('#open-print').disabled=false;if(state)render();}
}

// Studio reviews more than one kind of print. Everything that depends on which
// package produced the bundle lives here; the viewer, approvals and playback
// below are shared. A print names its kind in its own state.
const views={
  wedge:{
    eyebrow:'WEDGE DEMO',skinPhase:'inclined',skinLabel:'Sloped layers',exportName:'wedge.gcode',
    names:{'sloping-face':'Roof',base:'Bottom','front-side':'Front','back-side':'Back','right-side':'Right','left-side':'Left','high-end':'Tall end','low-end':'Low end'},
    facts(state,tab) {
      const {geometry:g,setup:s,process:p}=state.plan,roof=state.geometry.roof;
      const high=roof?.maxHeightMm??g.baseMm+g.runMm*Math.tan(g.angleDeg*Math.PI/180);
      if(tab==='geometry') {
        if(!roof)return [['Size',g.runMm+' × '+g.widthMm+' mm'],['Height',g.baseMm+'–'+high.toFixed(2)+' mm'],['Slope',g.angleDeg+'°']];
        const bounds=state.geometry.boundsMm,directions=[];
        if(Math.abs(roof.a)>1e-10)directions.push(roof.a>0?'right':'left');
        if(Math.abs(roof.b)>1e-10)directions.push(roof.b>0?'back':'front');
        return [['Size',round2(bounds.max[0])+' × '+round2(bounds.max[1])+' mm'],['Height',round2(roof.minHeightMm)+'–'+round2(high)+' mm'],
          ['Roof slope',round2(roof.angleDeg)+'°'],['Rises toward',directions.join(' + ')||'Level']];
      }
      if(tab==='plan')return [materialSetup(state),['Nozzle',(state.machine.tools.find(t=>t.index===s.tool)?.label??'#'+(s.tool+1))+' · '+s.core],['Layer height',p.layerMm+' mm'],
        ['Sloped layers',p.skinLayers+' × '+p.skinNormalMm+' mm'],['Travel height',high.toFixed(2)+' + '+p.liftMm+' mm']];
      return state.program?[['Layers',state.pathSummary.planarLayers+' flat + '+p.skinLayers+' sloped'],
        [state.program.envelope?'Printing motion':'Estimated motion',Math.round(duration()/60)+' min'],materialFact(state.program)]:[];
    },
    settings(state) {
      const {setup:s,process:p}=state.plan;
      return [['Bed temperature',s.bedC+'°C'],['Build volume temperature',s.buildVolumeC+'°C'],['First layer',p.firstLayerMm+' mm'],['Line width',p.lineWidthMm+' mm'],
        ['Flat / sloped speed',p.planarSpeedMmS+' / '+p.skinSpeedMmS+' mm/s'],['First-layer speed',p.firstLayerSpeedMmS+' mm/s'],
        ['Travel / lift speed',p.travelSpeedMmS+' / '+p.zSpeedMmS+' mm/s'],['Retraction',p.retractMm+' mm at '+p.retractSpeedMmS+' mm/s'],
        ['Cooling fan',p.fanPercent+'%'],['Minimum layer time',p.minimumLayerSeconds+' s'],['Material flow limit',p.maxFlowMm3S+' mm³/s'],
        ['Filament diameter',s.filamentMm+' mm'],['Placement','X '+state.plan.placement.xMm+' / Y '+state.plan.placement.yMm+' mm'],
        ['Fill','Solid; direction reverses each layer'],['Sloped passes','Back and forth'],['Startup',state.setupBasis]];
    }
  },
  shell:{
    eyebrow:'DEVELOPMENT PREVIEW',skinPhase:'draped-skin',skinLabel:'Draped skin',exportName:'part.gcode',
    // Faces are named by the shape that built them, so the label is the name.
    names:{},
    facts(state,tab) {
      const {geometry:g,setup:s,process:p}=state.plan,fill=state.plan.skills['full-fill'],skin=state.plan.skills['draped-skin'],normal=state.plan.skills['planar-infill'];
      const shape={assembly:'Assembly',box:'Box',wedge:'Wedge',"spline-top":'Spline top surface',"spline-shell":'Tapered spline shell',"vertical-spline-shell":'Vertical spline shell'}[g.shape]??g.shape;
      if(tab==='geometry') {
        const bounds=state.geometry.boundsMm;
        const rows=[['Shape',shape],['Footprint',round2(bounds.max[0]-bounds.min[0])+' × '+round2(bounds.max[1]-bounds.min[1])+' mm'],['Height',round2(bounds.max[2]-bounds.min[2])+' mm']];
        if(g.shape==='spline-top'||g.shape==='spline-shell')rows.push(['Surface',g.cpU+' × '+g.cpV+' control points']);
        if(g.shape==='spline-shell')rows.push(['Side taper','Long sides in '+g.longSideInsetMm+' mm · short sides out '+g.shortSideOutsetMm+' mm']);
        if(g.shape==='vertical-spline-shell'){
          rows.push(['Surface',g.cpU+' × '+g.cpV+' control points']);
          rows.push(['Vertical wall outline','X out '+g.xBulgeMm+' mm · Y in '+g.yInsetMm+' mm']);
        }
        if(g.shape==='assembly')for(const part of g.parts)rows.push([part.id,part.geometry.shape+' at '+[part.xMm,part.yMm,part.zMm].join(', ')+' mm']);
        return rows;
      }
      if(tab==='plan'&&state.plan.composition?.regions?.length)return [materialSetup(state),
        ['Nozzle',(state.machine.tools.find(t=>t.index===s.tool)?.label??'#'+(s.tool+1))+' · '+s.core],['Layer height',p.layerMm+' mm'],...regionRows(state.plan)];
      if(tab==='plan')return [materialSetup(state),['Nozzle',(state.machine.tools.find(t=>t.index===s.tool)?.label??'#'+(s.tool+1))+' · '+s.core],['Layer height',p.layerMm+' mm'],
        ['Body',normal?.enabled?normal.perimeters+' walls + '+Math.round(normal.density*100)+'% infill':fill.enabled?fill.perimeters+' perimeters + solid fill':'Not printed'],...vaseSettings(state),
        ['Solid surfaces',normal?.enabled&&fill.enabled?fill.bottomLayers+' bottom / '+fill.topLayers+' top layers':'—'],
        ['Draped skin',skin.enabled?skin.layers+' × '+skin.normalMm+' mm along the surface':'None'],['Fill sequencing',(state.plan.composition?.batchLayers??1)+' layer(s) per component'],['Filled components',fill.parts?.join(', ')||'All'],['Roof component',skin.part??'Part roof']];
      if(!state.program)return [];
      const limit=state.pathSummary?.nonplanarLimit;
      const rows=[['Layers',(state.pathSummary?.fullFill?.layers??0)+' flat + '+(state.pathSummary?.drapedSkin?.skinLayers??0)+' draped'],
        [state.program.envelope?'Printing motion':'Estimated motion',Math.round(duration()/60)+' min'],materialFact(state.program)];
      if(hasSkill(state.plan,'vase-wall'))rows.push(['Vase wall','Continuous spiral within its assigned region']);
      if(state.plan.composition?.regions?.length)rows.push(...regionRows(state.plan));
      if(limit) {
        rows.push(['Surface not skinned',limit.excludedAreaPercent+'% steeper than '+limit.effectiveMaxAngleDeg+'°']);
        if(limit.experimentalOverride)rows.push(['Experimental override',limit.effectiveMaxAngleDeg+'° versus the profile’s '+limit.machineMaxAngleDeg+'°']);
      }
      return rows;
    },
    settings(state) {
      const {setup:s,process:p}=state.plan,fill=state.plan.skills['full-fill'],skin=state.plan.skills['draped-skin'];
      const contract=state.machine.outputs.find(o=>o.id===state.plan.output)?.constraints;
      const declaredLimit=state.machine.nonplanar?.maxAngleDeg,effectiveLimit=skin.maxAngleDegOverride??declaredLimit;
      return [['Bed temperature',s.bedC+'°C'],['Build volume temperature',s.buildVolumeC===0?'Heating off':s.buildVolumeC+'°C'],
        ...(contract?.bedType?[['Build surface',contract.bedType==='textured_plate'?'Textured PEI':contract.bedType],['Startup purge',contract.startupPurgeC+'°C · up to '+contract.startupPurgeFlowMm3S+' mm³/s']]:[]),
        ['First layer',p.firstLayerMm+' mm'],['Line width',p.lineWidthMm+' mm'],
        ['Flat / skin speed',p.planarSpeedMmS+' / '+p.skinSpeedMmS+' mm/s'],['First-layer speed',p.firstLayerSpeedMmS+' mm/s'],
        ['Travel / lift speed',p.travelSpeedMmS+' / '+p.zSpeedMmS+' mm/s'],['Retraction',p.retractMm+' mm at '+p.retractSpeedMmS+' mm/s'],
        ['Cooling fan',p.fanPercent+'%'],['Minimum layer time',p.minimumLayerSeconds+' s'],['Material flow limit',p.maxFlowMm3S+' mm³/s'],
        ['Filament diameter',s.filamentMm+' mm'],['Placement','X '+state.plan.placement.xMm+' / Y '+state.plan.placement.yMm+' mm'],
        ['Machine non-planar limit',(declaredLimit??'—')+'° (profile declaration)'],
        ['Travel','Comb up to '+p.maxCombMm+' mm; otherwise clear the whole plan by '+p.liftMm+' mm'],
        ['Startup',state.setupBasis]];
    }
  }
};
const view=()=>views[state?.kind==='shell'?'shell':'wedge'];
const label=id=>view().names[id]??id.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());

// Part bounds come from the display proxy both packages write, so the camera
// and the bed grid do not need to know which shape produced them.
function partBounds() {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of state.geometry.vertices)for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
  return {min,max};
}

async function api(route,data) {
  const response=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify({...data,printId:state?.printId})});
  if(!response.ok)throw new Error((await response.json()).error);
  return response;
}
async function refresh(follow=false,reopen=false) {
  const response=await fetch('/api/state');if(!response.ok)throw new Error((await response.json()).error);
  const next=await response.json(),previous=!reopen&&state?.printId===next.printId?state:null;state=next;
  if(previous?.exportHash!==next.exportHash){stop();seconds=duration();fitBounds=null;}
  if(!previous) {
    stop();selected=null;fitBounds=null;zoom=1;seconds=duration();
    tab=state.program?'toolpath':state.geometryApproved?'plan':'geometry';
    $('#kind-label').textContent=view().eyebrow+' · '+state.machine.name;
    $('#skin-label').textContent=view().skinLabel;
    document.title='SAAM Studio · '+state.printName;
    $('#open-print').title='Open print: '+state.printName;
  }
  else if(follow&&previous.planHash!==state.planHash){tab=state.geometryApproved?'plan':'geometry';message('Updated from chat.');}
  else if(follow&&state.planApproved&&!previous.program&&state.program)tab='toolpath';
  if(!selected||!state.geometry.labels.includes(selected))selectFeature(state.geometry.labels[0]);
  render();
}
function table(entries) {
  const dl=document.createElement('dl');
  for(const [key,value]of entries){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;row.append(dt,dd);dl.append(row);}
  return dl;
}
function render() {
  $('.machine').textContent=state.machine.name;
  const stage={geometry:1,plan:2,toolpath:3}[tab];
  $('#stage-label').textContent='STEP '+stage+' OF 3';
  $('#view-title').textContent={geometry:'Your geometry',plan:'Your geometry',toolpath:'Your toolpath'}[tab];
  $('#prompt').textContent={geometry:'Look at the geometry.',plan:'Look at the settings.',toolpath:'Review the toolpath.'}[tab];
  $('#guidance').textContent={geometry:'Check the shape and size before continuing.',plan:'Confirm how this part will be printed.',toolpath:'Play it through, then confirm and export.'}[tab];
  $('#facts').replaceChildren(table(view().facts(state,tab)));
  $('#more-settings').hidden=tab!=='plan';
  $('#settings-detail').replaceChildren(table([...machineSettings(state,view().settings(state)),...recipeRows(state.plan)]));
  $('#skin-label').textContent=hasSkill(state.plan,'vase-wall')?'Skin / spiral':view().skinLabel;
  const ready=tab==='geometry'||(tab==='plan'&&state.geometryApproved)||(tab==='toolpath'&&state.planApproved&&state.program&&state.review.generation?.mode==='production');
  $('#confirm').disabled=!ready||busy;
  $('#confirm').textContent=tab==='geometry'?(state.geometryApproved?'Continue to settings':'Confirm geometry'):tab==='plan'?(state.planApproved?'View toolpath':'Confirm settings'):state.toolpathApproved?(exportedThisSession.has(exportKey())?'Export again':'Export print file'):'Confirm & export';
  $('#review-note').textContent=state.outputAvailability??(tab==='toolpath'?(state.programError??(!state.program?'The toolpath will appear after you confirm the settings.':!state.planApproved?'Preview only. Confirm geometry and settings before export.':state.program.notice??state.program.envelope?.notice??'Clearance is your check for this demo.')):'');
  $('#playback').hidden=tab!=='toolpath'||!state.program;
  $('#scrub').max=duration();$('#scrub').value=seconds;
  $$('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.classList.toggle('done',!!state[{geometry:'geometryApproved',plan:'planApproved',toolpath:'toolpathApproved'}[b.dataset.tab]]);b.disabled=busy||b.dataset.tab==='plan'&&!state.geometryApproved||b.dataset.tab==='toolpath'&&!state.program;});
  draw();
}
function selectFeature(id){selected=id;$('#selection').textContent=label(id);draw();}
function setTab(next){if(!state)return;tab=next;stop();render();}

function project(point) {
  const bounds=tab==='toolpath'&&fitBounds?fitBounds:partBounds();
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
  const bounds=partBounds(),skinPhase=view().skinPhase;
  for(let x=bounds.min[0]-10;x<=bounds.max[0]+10;x+=5)segment(project([x,bounds.min[1]-10,0]),project([x,bounds.max[1]+10,0]),'#dbe1d4',.6);
  for(let y=bounds.min[1]-10;y<=bounds.max[1]+10;y+=5)segment(project([bounds.min[0]-10,y,0]),project([bounds.max[0]+10,y,0]),'#dbe1d4',.6);
  const pts=state.geometry.vertices.map(project);
  polygons=state.geometry.faces.map((face,i)=>({id:state.geometry.labels[i],points:face.map(j=>pts[j]),depth:face.reduce((sum,j)=>sum+pts[j][2],0)/face.length})).sort((a,b)=>a.depth-b.depth);
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
      const highlighted=move.phase===skinPhase||move.phase==='vase-wall';
      const color=move.extruding?(highlighted?'#d97735':move.phase==='prime'?'#5b92a3':'#80977788'):'#8795ab66';
      segment(project(local(move.from)),project(local(move.to)),color,highlighted?1.25:.7);
    }
    const current=moves[at.active];
    if(current&&at.fraction<1&&(current.extruding||$('#travel').checked))segment(project(local(current.from)),project(local(at.point)),current.phase===skinPhase?'#d97735':'#809777',1.25);
    if(at.point){const p=project(local(at.point)),q=project(local([at.point[0],at.point[1],at.point[2]+3]));segment(p,q,'#273e36',3);ctx.beginPath();ctx.arc(p[0],p[1],3,0,Math.PI*2);ctx.fillStyle='#273e36';ctx.fill();
      $('#time-label').textContent=clock(seconds)+' / '+clock(duration());
    }
  }
  const origin=project([0,0,0]);segment(origin,project([5,0,0]),'#b26751',1.5);segment(origin,project([0,5,0]),'#659a7a',1.5);segment(origin,project([0,0,5]),'#638599',1.5);
  ctx.font='10px Segoe UI';ctx.fillStyle='#71836b';ctx.fillText('5 mm grid',18,canvas.clientHeight-18);
  if(tab!=='toolpath'){const polygon=polygons.find(p=>p.id===selected);if(polygon){const center=polygon.points.reduce((s,p)=>[s[0]+p[0]/polygon.points.length,s[1]+p[1]/polygon.points.length],[0,0]);ctx.fillStyle='#31432c';ctx.fillText(label(selected),center[0]-25,center[1]);}}
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
    const part=partBounds();
    fitBounds={min:[part.min[0],part.min[1],0],max:[part.max[0],part.max[1],0]};
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
async function download(){
  const response=await api('deliver',{});
  if(!response.ok){const error=await response.json();throw new Error(error.error??'Export failed.');}
  const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');
  a.href=url;a.download=state.exportName??view().exportName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  exportedThisSession.add(exportKey());
}
$('#confirm').onclick=async()=>{
  if(busy||!state)return;message('');
  try{
    await working(tab==='toolpath'?'Checking and exporting your print…':tab==='plan'?'Saving settings and preparing your toolpath…':'Saving geometry confirmation…',async()=>{
    if(tab==='geometry'){if(!state.geometryApproved)await approval('geometry');tab='plan';}
    else if(tab==='plan'){if(!state.planApproved)await approval('plan');if(!state.program||state.review.generation?.mode!=='production'){activity('Generating and checking your toolpath…');await api('generate',{development:false});activity('Loading the checked toolpath…');await refresh();}tab='toolpath';}
    else {if(!state.toolpathApproved)await approval('toolpath');await download();}
    message('');
    });
  }catch(e){message(e.message,true);}
};
async function openPrint(path){
  if(busy)return;
  $('#picker-message').textContent='';$('#print-picker').close();
  try{await working('Opening and checking your saved print…',async()=>{await api('open',{path});await refresh(false,true);message('');});}
  catch(error){message(error.message,true);$('#picker-message').textContent=error.message;$('#print-picker').showModal();}
}
$('#open-print').onclick=async()=>{
  if(busy)return;$('#print-picker').showModal();$('#picker-message').textContent='Loading saved prints…';$('#print-list').replaceChildren();
  try{
    const response=await fetch('/api/prints');if(!response.ok)throw new Error('Could not list local prints.');
    const {prints}=await response.json();
    for(const print of prints){const button=document.createElement('button'),name=document.createElement('strong'),detail=document.createElement('span');
      name.textContent=print.name;detail.textContent=print.machine;button.append(name,detail);button.title=print.path;button.onclick=()=>openPrint(print.path);$('#print-list').append(button);}
    $('#picker-message').textContent=prints.length?'':'No saved prints found here. Enter a local print folder below.';
  }catch(error){$('#picker-message').textContent=error.message;}
};
$('#close-picker').onclick=()=>$('#print-picker').close();
$('#open-path').onsubmit=event=>{event.preventDefault();openPrint($('#print-path').value.trim());};
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
    if(!state||reconnecting||next.fingerprint!==state.fingerprint)await working('Loading and checking the updated print…',()=>refresh(true));
    reconnecting=false;
  }catch(e){reconnecting=true;$('#confirm').disabled=true;message('Your print is updating. Reconnecting…');}
  finally{polling=false;}
}
working('Loading and checking your print…',()=>refresh()).catch(e=>message(e.message,true));
setInterval(poll,1000);
