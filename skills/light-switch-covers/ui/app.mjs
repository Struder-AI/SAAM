const WHEEL_ZOOM_DISTANCE_PX=1000;
import {familySVG,familyVisual} from './gallery.mjs';
import {renderCover} from './renderer.mjs';
import {coverSTL} from './stl.mjs';
const $=id=>document.getElementById(id);
const state={design:null,result:null,busy:false,revision:0,timer:null,pending:false,job:null,camera:{x:.35,y:-.3,zoom:1,drag:null}};
const numbers=['width','height','pitch','thickness','cornerRadius','rearPocketDepth','rimWidth','screwDiameter','screwHeadDiameter','countersinkDepth','labelSize','reliefDepth'];
const fields=[...numbers,'country','installation','coverage','treatment','faceOrientation','plateColor','textColor','decorationPrompt'];
const presets={toggle:[10.31,23.8,60.325],rocker:[33.274,66.802,96.825],blank:[10,10,60.325],custom:[20,30,60.325]};
async function read(path){const response=await fetch(path);const value=await response.json();if(!response.ok)throw Error(value.error);return value;}
async function post(path,design){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({design})});const value=await response.json();if(!response.ok)throw Error(value.error);return value;}
const resources=await read('/api/resources'),saved=await read('/api/design');state.design=saved.design;state.job=saved.job;
function draw(){renderCover($('preview'),state.result,state.camera);}
function message(error){$('message').textContent=error.message??String(error);}
function invalidate(){state.revision++;state.result=null;for(const id of ['stl','parts','handoff'])$(id).disabled=true;$('status').textContent='Design changed · preview to update';$('handoffResult').hidden=true;draw();}
function schedulePreview(){clearTimeout(state.timer);if(state.design.familyId!=='na-wallplate'){referencePreview();return;}state.timer=setTimeout(build,250);}
function referencePreview(){
 const family=resources.catalog.families.find(item=>item.id===state.design.familyId)??resources.catalog.families.at(-1),visual=familyVisual(family);
 $('preview').hidden=true;$('familyReference').hidden=false;$('familyReference').innerHTML=familySVG(family);$('status').textContent='Selected family · reference illustration';$('dimensions').textContent=visual.caption;$('message').textContent='Enter measured dimensions and mounting details, then preview the geometry. This family is a reference illustration.';
}
function chooseFamily(id){
 clearTimeout(state.timer);state.pending=false;state.design.familyId=id;
 if(id==='na-wallplate'){state.design.coverage='standard';state.design.installation='flush';state.design.pitch=46.0375;state.design.devices=['LIGHTS','PORCH'].map(label=>({...resources.initialDesign.devices[0],label}));resizePreset();}
 else state.design.coverage='custom';
 sync();invalidate();schedulePreview();$('familyDialog').close();
}
function gallery(){
 const search=$('gallerySearch').value.trim().toLowerCase(),local=$('galleryScope').value==='local';
 const matches=resources.catalog.families.filter(family=>(!local||family.regionHints.includes(state.design.country)||family.id==='custom-measured')&&(family.name+' '+family.regionHints.join(' ')+' '+family.notes).toLowerCase().includes(search));
 $('familyGallery').replaceChildren();$('galleryCount').textContent=matches.length+' cover families · dimensions in mm';
 for(const family of matches){
  const visual=familyVisual(family),card=document.createElement('button');card.type='button';card.className='familyCard';card.dataset.familyId=family.id;card.setAttribute('aria-pressed',String(family.id===state.design.familyId));card.innerHTML=familySVG(family);
  for(const [className,text] of [['familyState',family.id==='na-wallplate'?'Draft template':'Research reference'],['familyName',family.name],['familyDimension',visual.caption],['familyDimensionKind',visual.size?visual.kind:'Measured / model-specific'],['familyDetail',visual.detail],['familyRegion',family.regionHints.join(' · ')]]){const item=document.createElement('span');item.className=className;item.textContent=text;card.append(item);}
  card.onclick=()=>chooseFamily(family.id);$('familyGallery').append(card);
 }
 if(!matches.length)$('familyGallery').textContent='No matching families. Try all locations or clear your search.';
}
function families(){
 const family=resources.catalog.families.find(item=>item.id===state.design.familyId)??resources.catalog.families[0],visual=familyVisual(family);$('familyPicker').innerHTML=familySVG(family);
 const info=document.createElement('span');info.className='pickerInfo';for(const [tag,text] of [['strong',family.name],['span',visual.caption],['small','Browse cover gallery →']]){const item=document.createElement(tag);item.textContent=text;info.append(item);}$('familyPicker').append(info);$('familyNote').textContent=(family.id==='na-wallplate'?'':'Research reference only: enter measured dimensions. ')+family.notes;gallery();
}
function syncOrientation(){const raised=['raised','two-color'].includes(state.design.treatment);if(raised)state.design.faceOrientation='up';$('faceOrientation').value=state.design.faceOrientation;$('faceOrientation').disabled=raised;const flush=state.design.treatment==='two-color-flush';$('letterDepthLabel').textContent=state.design.treatment==='recessed'?'Recess depth · mm':flush?'Inlay depth · mm':'Letter height · mm';$('reliefDepth').disabled=false;$('reliefDepth').value=state.design.reliefDepth;$('reliefDepth').title=flush?'Depth within the plate; letters are flush with its face.':'';}
function deviceFields(){
 $('devices').replaceChildren();
 for(const [i,device] of state.design.devices.entries()){
  const box=document.createElement('div');box.className='device';box.innerHTML='<div class="deviceTitle">POSITION '+(i+1)+' · LEFT TO RIGHT</div><div class="pair"><label>Opening<select data-key="kind"><option value="toggle">Toggle</option><option value="rocker">Rocker / GFCI</option><option value="blank">Blank</option><option value="custom">Measured rectangle</option></select></label><label>Label placement<select data-key="labelPosition"><option value="bottom">Below</option><option value="top">Above</option></select></label></div><label>What does it do?<input data-key="label" maxlength="80"></label><details><summary>Opening & screw measurements</summary><div class="pair"><label>Width · mm<input data-key="width" type="number" step="0.01"></label><label>Height · mm<input data-key="height" type="number" step="0.01"></label></div><label>Screw spacing · mm<input data-key="screwPitch" type="number" step="0.01"></label></details>';
  for(const input of box.querySelectorAll('[data-key]')){input.value=device[input.dataset.key];input.addEventListener('input',()=>{const key=input.dataset.key;device[key]=input.type==='number'?Number(input.value):input.value;if(key==='kind'){[device.width,device.height,device.screwPitch]=presets[device.kind];deviceFields();}invalidate();schedulePreview();});}$('devices').append(box);
 }
}
function sync(){for(const id of fields)$(id).value=state.design[id];$('count').value=state.design.devices.length;syncOrientation();families();deviceFields();}
function resizePreset(){if(state.design.coverage==='custom')return;const [width,height]={standard:[69.85,114.3],midway:[79.4,123.8],oversize:[88.9,133.4]}[state.design.coverage];state.design.width=width+(state.design.devices.length-1)*state.design.pitch;state.design.height=height;$('width').value=state.design.width;$('height').value=height;}
async function build(){
 if(state.busy){state.pending=true;return;}state.busy=true;$('build').disabled=true;$('status').textContent='Building geometry…';$('message').textContent='';const revision=state.revision,snapshot=structuredClone(state.design);
 try{const built=await post('/api/preview',snapshot);if(revision!==state.revision)return;await post('/api/design',built.design);if(revision!==state.revision)return;state.design=built.design;state.result=built.preview;syncOrientation();$('preview').hidden=false;$('familyReference').hidden=true;$('status').textContent='Geometry preview · fit unverified';$('dimensions').textContent=state.result.width.toFixed(2)+' × '+state.result.height.toFixed(2)+' mm · face '+state.result.printFace;$('message').textContent=state.result.warnings.join('\n')+(state.design.installation==='surface-square-overlay'?'\nOverlay only: retain the original metal cover; measure its fasteners and device clearances.':'');for(const id of ['stl','handoff'])$(id).disabled=false;$('parts').disabled=!state.result.materials.length;draw();}
 catch(error){invalidate();message(error);$('status').textContent='Adjust your design';}
 finally{state.busy=false;$('build').disabled=false;if(state.pending){state.pending=false;schedulePreview();}}
}
function download(blob,name){const anchor=document.createElement('a'),url=URL.createObjectURL(blob);anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function showJob(job){
 if(!job)return;state.job=job;$('handoffResult').hidden=false;$('handoff').disabled=!['complete','failed'].includes(job.stage);
 $('handoffResult').textContent=job.stage==='complete'?'Print bundle created: '+job.directory+'\nOpen cover in Studio, choose your printer/materials and review supports. For two-color printing, configure two logical filaments and assign plate/labels to them.':job.stage==='failed'?'Bundle creation failed: '+job.error:'Creating cover bundle… '+job.completed+'/'+job.total;
}
$('design').onsubmit=event=>{event.preventDefault();void build();};
for(const id of fields)$(id).addEventListener('input',()=>{state.design[id]=numbers.includes(id)?Number($(id).value):$(id).value;syncOrientation();if(id==='country')families();if(id==='coverage')resizePreset();if(id==='installation'&&state.design.installation==='surface-square-overlay'){state.design.coverage='custom';state.design.width=101.6;state.design.height=101.6;state.design.rearPocketDepth=0;sync();}invalidate();schedulePreview();});
$('count').onchange=()=>{const count=Number($('count').value);while(state.design.devices.length<count)state.design.devices.push({...resources.initialDesign.devices[0],label:''});state.design.devices.length=count;resizePreset();deviceFields();invalidate();schedulePreview();};
$('familyPicker').onclick=()=>{gallery();$('familyDialog').showModal();};$('closeGallery').onclick=()=>$('familyDialog').close();$('gallerySearch').oninput=gallery;$('galleryScope').onchange=gallery;
$('save').onclick=()=>download(new Blob([JSON.stringify(state.design,null,2)],{type:'application/json'}),'switch-cover-design.json');
$('load').onchange=async()=>{try{const design=JSON.parse(await $('load').files[0].text());const response=await post('/api/preview',design);state.design=response.design;sync();invalidate();await build();}catch(error){message(error);}};
$('clearMotifs').onclick=()=>{state.design.decoration=[];invalidate();schedulePreview();};
$('stl').onclick=()=>{if(state.result)download(coverSTL(state.result.mesh),'switch-cover.stl');};
$('parts').onclick=()=>{for(const part of state.result?.materials??[])download(coverSTL(part),part.id+'.stl');};
$('handoff').onclick=async()=>{try{$('handoff').disabled=true;showJob(await post('/api/bundles',structuredClone(state.design)));}catch(error){message(error);$('handoff').disabled=!state.result;}};
window.addEventListener('saam-workspace-event',async event=>{
 if(event.detail.kind.startsWith('workspace-bundles-'))showJob(await read('/api/job'));
 if(event.detail.kind==='workspace-design-updated'&&event.detail.source==='agent'){const current=await read('/api/design');state.design=current.design;sync();invalidate();schedulePreview();}
});
const canvas=$('preview');canvas.onpointerdown=event=>{state.camera.drag=[event.clientX,event.clientY];canvas.setPointerCapture(event.pointerId);};canvas.onpointermove=event=>{if(!state.camera.drag)return;state.camera.y+=(event.clientX-state.camera.drag[0])*.01;state.camera.x+=(event.clientY-state.camera.drag[1])*.01;state.camera.drag=[event.clientX,event.clientY];draw();};canvas.onpointerup=()=>{state.camera.drag=null;};canvas.onpointercancel=()=>{state.camera.drag=null;};canvas.onwheel=event=>{event.preventDefault();state.camera.zoom=Math.max(.5,Math.min(2.5,state.camera.zoom*Math.exp(-event.deltaY/WHEEL_ZOOM_DISTANCE_PX)));draw();};
$('front').onclick=()=>{state.camera.x=0;state.camera.y=0;draw();};$('orbit').onclick=()=>{state.camera.x=.45;state.camera.y=-.4;draw();};$('back').onclick=()=>{state.camera.x=Math.PI;state.camera.y=0;draw();};new ResizeObserver(draw).observe(canvas);
$('fireSafety').onclick=()=>$('fireSafetyDialog').showModal();$('closeFireSafety').onclick=()=>$('fireSafetyDialog').close();$('fireSafetyDialog').addEventListener('close',()=>sessionStorage.setItem('saam-cover-fire-safety','shown'));if(sessionStorage.getItem('saam-cover-fire-safety')!=='shown')$('fireSafetyDialog').showModal();
sync();if(state.design.familyId==='na-wallplate')await build();else referencePreview();showJob(state.job);
