import {familySVG,familyVisual} from './gallery.mjs';
const $=id=>document.getElementById(id),config=await fetch('/api/config').then(r=>r.json());
let design={...structuredClone(config.initialDesign),faceOrientation:config.initialDesign.faceOrientation??'down'},result=null,angleX=.35,angleY=-.3,zoom=1,busy=false,revision=0,previewTimer=null,pendingBuild=false;
const numbers=['width','height','pitch','thickness','cornerRadius','rearPocketDepth','rimWidth','screwDiameter','screwHeadDiameter','countersinkDepth','labelSize','reliefDepth'];
const fields=[...numbers,'country','installation','coverage','treatment','faceOrientation','plateColor','textColor','decorationPrompt'];
const presets={toggle:[10.31,23.8,60.325],rocker:[33.274,66.802,96.825],blank:[10,10,60.325],custom:[20,30,60.325]};
function invalidate(){revision++;result=null;for(const id of ['stl','parts','handoff'])$(id).disabled=true;$('status').textContent='Design changed · preview to update';$('handoffResult').hidden=true;draw();}
function schedulePreview(){clearTimeout(previewTimer);if(design.familyId!=='na-wallplate'){referencePreview();return;}previewTimer=setTimeout(()=>build(),250);}
function referencePreview(){
 const f=config.catalog.families.find(f=>f.id===design.familyId),v=familyVisual(f);
 $('preview').hidden=true;$('familyReference').hidden=false;$('familyReference').innerHTML=familySVG(f);
 $('status').textContent='Selected family · reference illustration';$('dimensions').textContent=v.caption;
 $('message').textContent='Enter the dimensions and mounting details of your cover, then preview the measured geometry.';
}
function chooseFamily(id){
 clearTimeout(previewTimer);pendingBuild=false;design.familyId=id;
 if(id==='na-wallplate'){
  design.coverage='standard';design.installation='flush';design.pitch=46.0375;
  design.devices=['LIGHTS','PORCH'].map(label=>({kind:'toggle',width:10.31,height:23.8,screwPitch:60.325,label,labelPosition:'bottom'}));
  resizePreset();sync();invalidate();schedulePreview();
 }else{design.coverage='custom';sync();invalidate();referencePreview();}
 $('familyDialog').close();
}
function families(){
 const f=config.catalog.families.find(f=>f.id===design.familyId)??config.catalog.families[0],v=familyVisual(f);
 $('familyPicker').innerHTML=familySVG(f);
 const info=document.createElement('span');info.className='pickerInfo';
 for(const [tag,text] of [['strong',f.name],['span',`${v.caption}${v.size?' · '+v.kind.toLowerCase():''}`],['small','Browse cover gallery →']]){const el=document.createElement(tag);el.textContent=text;info.append(el);}$('familyPicker').append(info);
 $('familyPicker').setAttribute('aria-label',`Choose cover family, currently ${f.name}`);
 $('familyNote').textContent=(f.id==='na-wallplate'?'':'Research reference only: enter measured dimensions for this format. ')+f.notes;
 gallery();
}
function gallery(){
 const search=$('gallerySearch').value.trim().toLowerCase(),local=$('galleryScope').value==='local';
 const families=config.catalog.families.filter(f=>(!local||f.regionHints.includes(design.country)||f.id==='custom-measured')&&`${f.name} ${f.regionHints.join(' ')} ${f.notes}`.toLowerCase().includes(search));
 $('familyGallery').replaceChildren();$('galleryCount').textContent=`${families.length} cover ${families.length===1?'family':'families'} · dimensions in mm`;
 for(const f of families){
  const v=familyVisual(f),card=document.createElement('button');card.type='button';card.className='familyCard';card.dataset.familyId=f.id;card.setAttribute('aria-pressed',String(f.id===design.familyId));card.setAttribute('aria-label',`${f.name}, ${v.caption}`);card.innerHTML=familySVG(f);
  for(const [cls,text] of [['familyState',f.id==='na-wallplate'?'Draft template':'Research reference'],['familyName',f.name],['familyDimension',v.caption],['familyDimensionKind',v.size?v.kind:'Measured / model-specific'],['familyDetail',v.detail],['familyRegion',f.regionHints.join(' · ')]]){const el=document.createElement('span');el.className=cls;el.textContent=text;card.append(el);}
  card.onclick=()=>chooseFamily(f.id);$('familyGallery').append(card);
 }
 if(!families.length){const p=document.createElement('p');p.textContent='No matching families. Try all locations or clear your search.';$('familyGallery').append(p);}
}
$('familyPicker').onclick=()=>{gallery();$('familyDialog').showModal();};$('closeGallery').onclick=()=>$('familyDialog').close();
$('gallerySearch').oninput=gallery;$('galleryScope').onchange=gallery;
function syncOrientation(){const raised=['raised','two-color'].includes(design.treatment);if(raised)design.faceOrientation='up';$('faceOrientation').value=design.faceOrientation;$('faceOrientation').disabled=raised;const flush=design.treatment==='two-color-flush';$('letterDepthLabel').textContent=design.treatment==='recessed'?'Recess depth · mm':'Letter height · mm';$('reliefDepth').disabled=flush;$('reliefDepth').value=flush?0:design.reliefDepth;$('reliefDepth').title=flush?'Flush letters have no height above the plate.':'';}
function sync(){for(const id of fields)$(id).value=design[id];syncOrientation();$('count').value=design.devices.length;families();deviceFields();}
function deviceFields(){
 $('devices').replaceChildren();design.devices.forEach((d,i)=>{
  const el=document.createElement('div');el.className='device';
  el.innerHTML=`<div class="deviceTitle">POSITION ${i+1} · LEFT TO RIGHT</div><div class="pair"><label>Opening<select data-key="kind"><option value="toggle">Toggle</option><option value="rocker">Rocker / GFCI</option><option value="blank">Blank</option><option value="custom">Measured rectangle</option></select></label><label>Label placement<select data-key="labelPosition"><option value="bottom">Below</option><option value="top">Above</option></select></label></div><label>What does it do?<input data-key="label" maxlength="80"></label><details><summary>Opening & screw measurements</summary><div class="pair"><label>Width · mm<input data-key="width" type="number" step="0.01"></label><label>Height · mm<input data-key="height" type="number" step="0.01"></label></div><label>Screw spacing · mm<input data-key="screwPitch" type="number" step="0.01"></label></details>`;
  for(const input of el.querySelectorAll('[data-key]')){input.value=d[input.dataset.key];input.addEventListener('input',()=>{const k=input.dataset.key;d[k]=input.type==='number'?Number(input.value):input.value;if(k==='kind'){[d.width,d.height,d.screwPitch]=presets[d.kind];deviceFields();}invalidate();schedulePreview();});}$('devices').append(el);
 });
}
for(const id of fields)$(id).addEventListener('input',()=>{design[id]=numbers.includes(id)?Number($(id).value):$(id).value;if(id==='treatment'&&['raised','two-color'].includes(design.treatment)){design.faceOrientation='up';$('faceOrientation').value='up';}syncOrientation();if(id==='country')families();if(id==='coverage')resizePreset();if(id==='installation'&&design.installation==='surface-square-overlay'){design.coverage='custom';design.width=101.6;design.height=101.6;design.rearPocketDepth=0;sync();}invalidate();schedulePreview();});
function resizePreset(){if(design.coverage==='custom')return;const [w,h]={standard:[69.85,114.3],midway:[79.4,123.8],oversize:[88.9,133.4]}[design.coverage];design.width=w+(design.devices.length-1)*design.pitch;design.height=h;$('width').value=design.width;$('height').value=h;}
$('count').addEventListener('change',()=>{const n=Number($('count').value);while(design.devices.length<n)design.devices.push({...config.initialDesign.devices[0],label:''});design.devices.length=n;resizePreset();deviceFields();invalidate();schedulePreview();});
const post=async(path,payload)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':config.token},body:JSON.stringify(payload)});if(!r.ok)throw Error((await r.json()).error);return r;};
async function build(){if(busy){pendingBuild=true;return;}busy=true;$('build').disabled=true;$('status').textContent='Building geometry…';$('message').textContent='';const started=revision,snapshot=structuredClone(design);try{const built=await post('/api/build',snapshot).then(r=>r.json());if(started!==revision)return;result=built;design.faceOrientation=built.design.faceOrientation;syncOrientation();$('preview').hidden=false;$('familyReference').hidden=true;$('status').textContent='Geometry preview · fit unverified';$('dimensions').textContent=`${result.width.toFixed(2)} × ${result.height.toFixed(2)} mm · ${result.printFace==='down'?'face down':'face up'}`;$('message').textContent=result.warnings.slice(0,-1).join('\n')+(design.installation==='surface-square-overlay'?'\nOverlay only: retain the original metal cover; measure its fasteners and device clearances.':'');for(const id of ['stl','handoff'])$(id).disabled=false;$('parts').disabled=!design.treatment.startsWith('two-color')||!result.materials.length;draw();}catch(e){invalidate();$('message').textContent=e.message;$('status').textContent='Adjust your design';}finally{busy=false;$('build').disabled=false;if(pendingBuild){pendingBuild=false;schedulePreview();}}}
$('design').addEventListener('submit',e=>{e.preventDefault();build();});
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('save').onclick=()=>download(new Blob([JSON.stringify(design,null,2)],{type:'application/json'}),'switch-cover-design.json');
$('load').onchange=async()=>{try{const d=JSON.parse(await $('load').files[0].text());if(d.schema!==design.schema||!Array.isArray(d.devices))throw Error('Choose a switch-cover design JSON.');await post('/api/build',d);design=d;sync();invalidate();await build();}catch(e){$('message').textContent=e.message;}};
$('clearMotifs').onclick=()=>{design.decoration=[];invalidate();};
$('stl').onclick=async()=>{try{download(await post('/api/stl',{id:result.id}).then(r=>r.blob()),'switch-cover.stl');}catch(e){$('message').textContent=e.message;}};
$('parts').onclick=async()=>{try{for(const m of result.materials)download(await post('/api/stl',{id:result.id,part:m.id}).then(r=>r.blob()),m.id.replace('/','-')+'.stl');}catch(e){$('message').textContent=e.message;}};
$('handoff').onclick=async()=>{try{$('handoff').disabled=true;const r=await post('/api/handoff',{id:result.id,machineId:$('machine').value}).then(r=>r.json());$('handoffResult').hidden=false;$('handoffResult').textContent=`Print created: ${r.directory}\nAsk Codex to read ${r.notesFile} and open this bundle in Studio.\n${r.printNotes.join('\n')}\n${r.command}`;$('message').textContent='Saved as unapproved geometry. Studio owns generation and final confirmation.';}catch(e){$('message').textContent=e.message;}finally{$('handoff').disabled=!result;}};
// Render the actual shared-kernel mesh; the saved geometry remains the sole model.
const canvas=$('preview'),ctx=canvas.getContext('2d');
function draw(){const b=canvas.getBoundingClientRect(),dpi=devicePixelRatio;canvas.width=b.width*dpi;canvas.height=b.height*dpi;ctx.scale(dpi,dpi);ctx.clearRect(0,0,b.width,b.height);if(!result)return;
 const down=result.printFace==='down',w=result.width,h=result.height,scale=Math.min(b.width/(w+35),b.height/(h+35))*zoom;
 const transform=p=>{let [x,y,z]=p;if(down){y=h-y;z=result.design.thickness+(result.faceOffset??0)-z;}x-=w/2;y-=h/2;const a=y*Math.cos(angleX)-z*Math.sin(angleX),c=y*Math.sin(angleX)+z*Math.cos(angleX);return [x*Math.cos(angleY)+c*Math.sin(angleY),a,-x*Math.sin(angleY)+c*Math.cos(angleY)];};
 let sets=result.materials.length?result.materials:[{...result.mesh,id:'base'}];
 const faces=[];for(const set of sets){const points=set.vertices.map(transform);for(const t of set.triangles){const v=t.map(i=>points[i]),u=v[1].map((x,i)=>x-v[0][i]),q=v[2].map((x,i)=>x-v[0][i]),n=[u[1]*q[2]-u[2]*q[1],u[2]*q[0]-u[0]*q[2],u[0]*q[1]-u[1]*q[0]],length=Math.hypot(...n);if(n[2]<=0)continue;faces.push({v,z:v.reduce((s,p)=>s+p[2],0)/3,shade:.65+.35*Math.max(0,(.25*n[0]+.4*n[1]+n[2])/(length*1.105)),color:set.id.startsWith('text/')&&result.design.treatment.startsWith('two-color')?result.design.textColor:result.design.plateColor});}}
 // Compare depth per pixel: large plate triangles must not paint over nearer letters.
 const image=ctx.createImageData(canvas.width,canvas.height),depth=new Float64Array(canvas.width*canvas.height);depth.fill(-Infinity);
 for(const f of faces){
  const p=f.v.map(v=>[(b.width/2+v[0]*scale)*dpi,(b.height/2-v[1]*scale)*dpi,v[2]]),[a,c,d]=p;
  const denominator=(c[1]-d[1])*(a[0]-d[0])+(d[0]-c[0])*(a[1]-d[1]);if(Math.abs(denominator)<1e-10)continue;
  const rgb=f.color.match(/\w\w/g).map(x=>Math.round(parseInt(x,16)*f.shade));
  const minX=Math.max(0,Math.floor(Math.min(...p.map(v=>v[0])))),maxX=Math.min(canvas.width-1,Math.ceil(Math.max(...p.map(v=>v[0]))));
  const minY=Math.max(0,Math.floor(Math.min(...p.map(v=>v[1])))),maxY=Math.min(canvas.height-1,Math.ceil(Math.max(...p.map(v=>v[1]))));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   const u=((c[1]-d[1])*(x+.5-d[0])+(d[0]-c[0])*(y+.5-d[1]))/denominator;
   const v=((d[1]-a[1])*(x+.5-d[0])+(a[0]-d[0])*(y+.5-d[1]))/denominator,t=1-u-v;
   if(u<0||v<0||t<0)continue;const z=u*a[2]+v*c[2]+t*d[2],i=y*canvas.width+x;
   if(z<depth[i]-1e-7)continue;depth[i]=z;image.data.set([...rgb,255],i*4);
  }
 }
 ctx.putImageData(image,0,0);
}
let drag=null;canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(!drag)return;angleY+=(e.clientX-drag[0])*.01;angleX+=(e.clientY-drag[1])*.01;drag=[e.clientX,e.clientY];draw();};canvas.onpointerup=()=>drag=null;canvas.onpointercancel=()=>drag=null;canvas.onwheel=e=>{e.preventDefault();zoom=Math.max(.5,Math.min(2.5,zoom*Math.exp(-e.deltaY*.001)));draw();};
$('front').onclick=()=>{angleX=0;angleY=0;draw();};$('orbit').onclick=()=>{angleX=.45;angleY=-.4;draw();};$('back').onclick=()=>{angleX=Math.PI;angleY=0;draw();};new ResizeObserver(draw).observe(canvas);
sync();if(design.familyId==='na-wallplate')await build();else referencePreview();
