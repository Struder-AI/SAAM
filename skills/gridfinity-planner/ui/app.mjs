// Gridfinity planner UI: size the frame, pick and colour bins, stage plates,
// print. The workspace host saves the design and builds the bundles.
const $=id=>document.getElementById(id);
const PITCH=42;
const STEPS=['Size the frame','Pick & colour bins','Stage plates','Print'];
const view={design:null,preview:null,resources:null,step:0,type:'bin-1x1',height:3,filament:0,selection:new Set(),tool:'paint',marquee:null,ghost:null,painting:false,menuBin:null,confirmClear:false,confirmTimer:null,job:null,saving:Promise.resolve(),message:null};
const el=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children.flat().filter(c=>c!=null&&c!==false));return node;};
const catalog=type=>view.resources.catalog.find(entry=>entry.type===type);
const colourOf=index=>view.design.filaments[index]?.colour??'#888888';

async function api(path,method='GET',body){
  const response=await fetch(path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok)throw Error(result.error??'Request failed.');return result;
}
const status=text=>{$('status').textContent=text;};

// Every edit saves the complete design; the host normalizes it. A rejected
// edit restores the saved design and shows the reason in the panel.
function commit(next){
  view.saving=view.saving.then(async()=>{
    status('Saving…');
    try{view.design=(await api('/api/design','POST',{design:next})).design;view.message=null;await refresh();status('Saved');}
    catch(error){view.design=(await api('/api/design')).design;view.message={error:true,text:error.message};status('Not saved');render();}
  });
  return view.saving;
}
async function refresh(){view.preview=(await api('/api/preview','POST',{design:view.design,interactive:false})).preview;render();}
const edit=change=>{const next=structuredClone(view.design);change(next);return commit(next);};

// Which steps are reachable from the current plan.
function reachable(step){
  const p=view.preview;
  if(step===0)return true;
  if(!p.grid)return false;
  if(step===1)return true;
  const somethingToPrint=view.design.bins.length>0||view.design.baseplate.include;
  if(step===2)return somethingToPrint;
  return somethingToPrint&&p.plates.length>0&&!p.error;
}

// ---------- shared panel parts
function field(label,input,tip){
  const head=el('span',{},el('span',{textContent:label}));
  if(tip)head.append(el('span',{className:'tip',tabIndex:0,textContent:'?','aria-label':tip},el('span',{className:'bubble',textContent:tip})));
  return el('label',{className:'field'},head,input);
}
function numberInput(value,onChange,{min=0,step='any',placeholder=''}={}){
  const input=el('input',{type:'number',value:value??'',min,step,placeholder});
  input.onchange=()=>onChange(input.value===''?null:Number(input.value));return input;
}
function seg(options,current,onPick){
  return el('div',{className:'seg'},options.map(([value,text])=>{const b=el('button',{type:'button',textContent:text,className:value===current?'active':''});b.onclick=()=>onPick(value);return b;}));
}
function check(label,value,onChange){const input=el('input',{type:'checkbox',checked:value});input.onchange=()=>onChange(input.checked);return el('label',{className:'check'},el('span',{textContent:label}),input);}
function facts(rows){return el('dl',{},rows.filter(Boolean).map(([k,v])=>el('div',{},el('dt',{textContent:k}),el('dd',{textContent:v}))));}
function message(){return view.message?el('p',{className:'message'+(view.message.error?' error':''),textContent:view.message.text}):null;}
function next(label,step,{disabled=false,onClick}={}){
  const go=el('button',{type:'button',className:'primary',textContent:label,disabled:disabled||!reachable(step)});
  go.onclick=onClick??(()=>{view.step=step;view.selection.clear();render();});
  const back=view.step>0?el('button',{type:'button',className:'back',textContent:'← Back'}):null;
  if(back)back.onclick=()=>{view.step--;view.selection.clear();render();};
  return el('div',{className:'next'},message(),go,back);
}
const mm=value=>`${value.toFixed(value<100?1:0)} mm`;

// ---------- 3D thumbnails: flat-shaded painter's algorithm on a 2D canvas.
function drawThumbnail(canvas,mesh,colour){
  const ratio=devicePixelRatio||1,w=canvas.clientWidth||80,h=canvas.clientHeight||54;canvas.width=w*ratio;canvas.height=h*ratio;
  const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,w,h);
  const yaw=-0.75,tilt=0.62,cy=Math.cos(yaw),sy=Math.sin(yaw),ct=Math.cos(tilt),st=Math.sin(tilt);
  const project=([x,y,z])=>{const rx=x*cy-y*sy,ry=x*sy+y*cy;return [rx,-(ry*st)-z*ct,ry*ct-z*st];};
  const points=mesh.vertices.map(project),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),scale=Math.min((w-6)/(maxX-minX),(h-6)/(maxY-minY));
  const ox=(w-(maxX-minX)*scale)/2,oy=(h-(maxY-minY)*scale)/2;
  const raw=colour.match(/\w\w/g).map(v=>parseInt(v,16)),luminance=(.2126*raw[0]+.7152*raw[1]+.0722*raw[2])/255;
  // Very dark filaments are lifted toward grey so the shape stays readable.
  const rgb=luminance<.3?raw.map(c=>c+(150-c)*.6):raw;
  const faces=mesh.triangles.map(t=>{const [a,b,c]=t.map(i=>mesh.vertices[i]);const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n)||1;
    return {t,depth:t.reduce((s,i)=>s+points[i][2],0),light:.6+.4*Math.abs((n[0]*.35-n[1]*.45+n[2]*.82)/len)};});
  faces.sort((a,b)=>b.depth-a.depth);
  for(const face of faces){
    ctx.beginPath();face.t.forEach((i,k)=>{const p=points[i],x=ox+(p[0]-minX)*scale,y=oy+(p[1]-minY)*scale;k?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();
    const fill=`rgb(${rgb.map(c=>Math.round(Math.min(255,c*face.light))).join(',')})`;ctx.fillStyle=fill;ctx.strokeStyle=fill;ctx.lineWidth=.6;ctx.fill();ctx.stroke();
  }
}

// ---------- the frame drawing, shared by steps 1 and 2
function frameLayout(maxWidth,maxHeight){
  const g=view.preview.grid,p=g.padding,d=g.drawerMm;
  const gap=d?[(d[0]-g.plateMm[0])/2,(d[1]-g.plateMm[1])/2]:[0,0];
  const totalW=(d?d[0]:g.plateMm[0]),totalH=(d?d[1]:g.plateMm[1]);
  const scale=Math.min(maxWidth/totalW,maxHeight/totalH,64/PITCH);
  return {g,scale,size:PITCH*scale,width:totalW*scale,height:totalH*scale,
    plateLeft:gap[0]*scale,plateTop:gap[1]*scale,gridLeft:(gap[0]+p.left)*scale,gridTop:(gap[1]+p.back)*scale};
}
function drawFrame(stage,{bins}){
  const box=stage.getBoundingClientRect(),L=frameLayout(Math.max(200,box.width-120),Math.max(200,box.height-110));
  const {g,size}=L,frame=el('div',{className:'frame'+(bins?' painting':''),style:`width:${L.width}px;height:${L.height}px;margin:24px 0 30px`});
  if(g.drawerMm)frame.append(el('div',{className:'drawer',style:`left:-6px;top:-6px;width:${L.width+12}px;height:${L.height+12}px`}));
  if(view.design.baseplate.include)frame.append(el('div',{className:'pad',style:`left:${L.plateLeft}px;top:${L.plateTop}px;width:${g.plateMm[0]*L.scale}px;height:${g.plateMm[1]*L.scale}px`}));
  const px=x=>L.gridLeft+x*size,py=(y,h=1)=>L.gridTop+(g.yUnits-y-h)*size;
  for(let x=0;x<g.xUnits;x++)for(let y=0;y<g.yUnits;y++){
    const cell=el('div',{className:'cell',style:`left:${px(x)+1.5}px;top:${py(y)+1.5}px;width:${size-3}px;height:${size-3}px`});
    if(bins)cell.onpointerdown=event=>{
      if(event.button!==0)return;
      if(view.tool==='select'||event.shiftKey)return; // the frame starts a window
      view.selection.clear();view.painting=true;paint(x,y);
    };
    frame.append(cell);
  }
  if(bins){
    for(const bin of view.design.bins){
      const t=catalog(bin.type);
      const node=el('div',{className:'bin'+(view.selection.has(bin.id)?' selected':''),title:`${t.name} · ${bin.heightUnits} units${bin.label?' · '+bin.label:''} · right-click to delete`,
        style:`left:${px(bin.x)+2}px;top:${py(bin.y,t.yUnits)+2}px;width:${t.xUnits*size-4}px;height:${t.yUnits*size-4}px;background:${colourOf(bin.filament)}`},
        el('span',{className:'code',textContent:`${t.code} · ${bin.heightUnits}u`}),bin.label&&size*t.yUnits>44?el('span',{className:'label',textContent:bin.label}):null);
      node.dataset.id=bin.id;
      node.onpointerdown=event=>{
        event.stopPropagation();if(event.button!==0)return;$('menu').hidden=true;
        if(view.tool==='select'||event.shiftKey){startMarquee(event,frame,bin.id);return;}
        view.selection=new Set([bin.id]);render();
      };
      node.oncontextmenu=event=>{event.preventDefault();openMenu(bin.id,event.clientX,event.clientY);};
      frame.append(node);
    }
    // A window can start anywhere in the drawer, including its borders.
    frame.onpointerdown=event=>{if(event.button===0&&(view.tool==='select'||event.shiftKey))startMarquee(event,frame);};
    // Track the pointer over the whole frame: the cells are rebuilt while painting.
    frame.onpointermove=event=>{
      if(view.marquee){moveMarquee(event);return;}
      const r=frame.getBoundingClientRect(),x=Math.floor((event.clientX-r.left-L.gridLeft)/size),y=g.yUnits-1-Math.floor((event.clientY-r.top-L.gridTop)/size);
      if(x<0||y<0||x>=g.xUnits||y>=g.yUnits)return;
      if(view.ghost&&view.ghost[0]===x&&view.ghost[1]===y)return;
      view.ghost=[x,y];if(view.painting)paint(x,y);else drawGhost(frame,L);
    };
    frame.onpointerleave=()=>{view.ghost=null;drawGhost(frame,L);};
  }else{
    const dims=g.drawerMm??g.plateMm;
    frame.append(el('div',{className:'dim',textContent:mm(dims[0]),style:`left:0;right:0;top:-24px;text-align:center`}),
      el('div',{className:'dim',textContent:mm(dims[1]),style:`top:${L.height/2-6}px;left:${L.width+14}px`}));
  }
  frame.append(el('div',{className:'front-mark',textContent:'FRONT',style:`top:${L.height+12}px`}));
  stage.replaceChildren(frame);
  view.frame={frame,L};
  if(bins)drawGhost(frame,L);
}
function binAt(x,y){return view.design.bins.find(b=>{const t=catalog(b.type);return x>=b.x&&x<b.x+t.xUnits&&y>=b.y&&y<b.y+t.yUnits;});}
function fits(type,x,y){const g=view.preview.grid,t=catalog(type);if(x+t.xUnits>g.xUnits||y+t.yUnits>g.yUnits)return false;for(let i=x;i<x+t.xUnits;i++)for(let j=y;j<y+t.yUnits;j++)if(binAt(i,j))return false;return true;}
function drawGhost(frame,L){
  frame.querySelector('.ghost-bin')?.remove();
  if(!view.ghost||view.painting||view.tool==='select')return;
  const [x,y]=view.ghost,t=catalog(view.type);if(binAt(x,y))return;
  frame.append(el('div',{className:'ghost-bin'+(fits(view.type,x,y)?'':' bad'),style:`left:${L.gridLeft+x*L.size}px;top:${L.gridTop+(L.g.yUnits-y-t.yUnits)*L.size}px;width:${t.xUnits*L.size}px;height:${t.yUnits*L.size}px`}));
}
function nextId(){let n=1;const ids=new Set(view.design.bins.map(b=>b.id));while(ids.has(`bin-${n}`))n++;return `bin-${n}`;}
function paint(x,y){
  if(!fits(view.type,x,y))return;
  const t=catalog(view.type),height=Math.min(view.height,view.preview.maxHeightUnits);
  view.design.bins.push({id:nextId(),type:view.type,x,y,heightUnits:t.kind==='blank'?Math.max(1,height):Math.max(2,height),filament:view.filament,label:''});
  drawFrame($('stage'),{bins:true});
}
// Window selection: drag a rectangle; every bin it touches is selected. Shift
// adds to the selection. A click without dragging selects (or toggles) one bin.
function startMarquee(event,frame,binId=null){
  const r=frame.getBoundingClientRect(),start=[event.clientX-r.left,event.clientY-r.top];
  const box=el('div',{className:'marquee'});frame.append(box);
  view.marquee={frame,box,start,end:start,binId,additive:event.shiftKey,base:new Set(view.selection)};
  moveMarquee(event);
}
function moveMarquee(event){
  const m=view.marquee,r=m.frame.getBoundingClientRect();m.end=[event.clientX-r.left,event.clientY-r.top];
  const [x0,x1]=[m.start[0],m.end[0]].sort((a,b)=>a-b),[y0,y1]=[m.start[1],m.end[1]].sort((a,b)=>a-b);
  Object.assign(m.box.style,{left:x0+'px',top:y0+'px',width:x1-x0+'px',height:y1-y0+'px'});
  const hit=new Set();
  for(const node of m.frame.querySelectorAll('.bin')){
    const b=node.getBoundingClientRect(),[bl,bt]=[b.left-r.left,b.top-r.top];
    if(bl<x1&&bl+b.width>x0&&bt<y1&&bt+b.height>y0)hit.add(node.dataset.id);
  }
  m.hit=hit;
  for(const node of m.frame.querySelectorAll('.bin'))node.classList.toggle('selected',hit.has(node.dataset.id)||m.additive&&m.base.has(node.dataset.id));
}
function endMarquee(event){
  moveMarquee(event);
  const m=view.marquee;view.marquee=null;m.box.remove();
  const dragged=Math.hypot(m.end[0]-m.start[0],m.end[1]-m.start[1])>4;
  if(!dragged&&m.binId){
    if(m.additive){m.base.has(m.binId)?m.base.delete(m.binId):m.base.add(m.binId);view.selection=m.base;}
    else view.selection=new Set([m.binId]);
  }else view.selection=new Set([...(m.additive?m.base:[]),...(dragged?m.hit:[])]);
  render();
}
window.addEventListener('pointermove',event=>{if(view.marquee&&!view.marquee.frame.contains(event.target))moveMarquee(event);});
window.addEventListener('pointerup',event=>{
  if(view.marquee)endMarquee(event);
  if(view.painting){view.painting=false;commit(view.design);}
});
function openMenu(id,x,y){view.menuBin=id;const n=menuTargets().size;$('menu-delete').textContent=n>1?`Delete ${n} bins`:'Delete';$('menu-edit').textContent=n>1?`Edit ${n} bins`:'Edit';const menu=$('menu');menu.hidden=false;menu.style.left=x+'px';menu.style.top=y+'px';$('menu-delete').focus();}
document.addEventListener('pointerdown',event=>{if(!$('menu').contains(event.target))$('menu').hidden=true;});
const deleteBins=ids=>{for(const id of ids)view.selection.delete(id);return edit(d=>{d.bins=d.bins.filter(b=>!ids.has(b.id));});};
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){$('menu').hidden=true;if(view.selection.size){view.selection.clear();render();}}
  const typing=['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName);
  if(view.step===1&&!typing&&view.selection.size&&['Delete','Backspace'].includes(event.key)){event.preventDefault();deleteBins(new Set(view.selection));}
});
// Right-click acts on the whole selection when the bin is part of it.
const menuTargets=()=>view.selection.has(view.menuBin)?new Set(view.selection):new Set([view.menuBin]);
$('menu-delete').onclick=()=>{$('menu').hidden=true;deleteBins(menuTargets());};
$('menu-edit').onclick=()=>{$('menu').hidden=true;view.selection=menuTargets();render();};

// ---------- Step 1: size the frame
function sizeStep(){
  const s=view.design.sizing,g=view.preview.grid;
  const panel=[el('h2',{textContent:'Size the frame'}),el('p',{textContent:'Measure the inside of your drawer, or choose a grid. SAAM fits whole 42 mm cells and a baseplate that sits snugly.'}),
    seg([['drawer','Fit a drawer'],['grid','Choose a grid']],s.mode,mode=>edit(d=>{d.sizing.mode=mode;}))];
  if(s.mode==='drawer'){
    const unit=el('select',{},['in','cm','mm'].map(u=>el('option',{value:u,textContent:{in:'inches',cm:'centimetres',mm:'millimetres'}[u],selected:u===s.unit})));unit.onchange=()=>edit(d=>{d.sizing.unit=unit.value;});
    panel.push(field('Units',unit),
      el('div',{className:'row'},field('Inside width',numberInput(s.drawer.width,v=>edit(d=>{d.sizing.drawer.width=v;}),{placeholder:'width'})),field('Inside depth',numberInput(s.drawer.depth,v=>edit(d=>{d.sizing.drawer.depth=v;}),{placeholder:'depth'}))),
      field('Inside height',numberInput(s.drawer.height,v=>edit(d=>{d.sizing.drawer.height=v;}),{placeholder:'optional'}),'Limits how tall bins can be so the drawer still closes. Leave empty for no limit.'),
      field('Grid gap (mm)',numberInput(s.gridGapMm,v=>edit(d=>{d.sizing.gridGapMm=v??0;}),{step:.5}),
        'How much smaller the baseplate is than the drawer, in total across each direction. A smaller gap fits more snugly; a larger gap drops in more easily and allows for drawers that are not quite square. The default 4 mm leaves about 2 mm on each side.'));
  }else{
    const inches=value=>Math.max(1,Math.round(value*25.4/PITCH));
    panel.push(el('div',{className:'row'},field('Cells across',numberInput(s.grid.xUnits,v=>edit(d=>{d.sizing.grid.xUnits=v&&Math.max(1,Math.round(v));}),{min:1,step:1,placeholder:'cells'})),field('Cells deep',numberInput(s.grid.yUnits,v=>edit(d=>{d.sizing.grid.yUnits=v&&Math.max(1,Math.round(v));}),{min:1,step:1,placeholder:'cells'}))),
      el('div',{className:'row'},field('or width (in)',numberInput(null,v=>v&&edit(d=>{d.sizing.grid.xUnits=inches(v);}),{placeholder:'rough inches'})),field('or depth (in)',numberInput(null,v=>v&&edit(d=>{d.sizing.grid.yUnits=inches(v);}),{placeholder:'rough inches'}))));
  }
  panel.push(check('Print a baseplate',view.design.baseplate.include,value=>edit(d=>{d.baseplate.include=value;})));
  if(g)panel.push(facts([['Grid',`${g.xUnits} × ${g.yUnits} cells`],['Baseplate',`${mm(g.plateMm[0])} × ${mm(g.plateMm[1])}`],
    g.drawerMm&&['Side borders',`${mm(g.padding.left)} each`],g.drawerMm&&['Back border',mm(g.padding.back)],
    ['Tallest bin',view.preview.maxHeightUnits<20?`${view.preview.maxHeightUnits} units · ${view.preview.maxHeightUnits*7} mm`:'no limit']]));
  panel.push(next('Continue to bins',1));
  return {eyebrow:'Step 1 · frame',title:g?`${g.xUnits} × ${g.yUnits} grid`:'Your drawer',panel,
    draw:stage=>g?drawFrame(stage,{bins:false}):stage.replaceChildren(el('div',{className:'empty'},el('h1',{textContent:'Start with your drawer'}),el('p',{textContent:'Enter its inside width and depth, or choose a grid, and the frame appears here.'}))),
    foot:[g?'Bins sit centred side to side and at the front of the drawer.':'',g&&view.design.baseplate.include?'Hatched border: solid baseplate edge':'']};
}

// ---------- Step 2: pick and colour bins
function filamentList(){
  const list=el('div',{className:'swatches'});
  view.design.filaments.forEach((f,i)=>{
    const colour=el('input',{type:'color',value:f.colour,title:'Filament colour'}),name=el('input',{type:'text',value:f.name,'aria-label':'Filament name'});
    colour.onchange=()=>edit(d=>{d.filaments[i].colour=colour.value;});name.onchange=()=>edit(d=>{d.filaments[i].name=name.value;});
    const row=el('div',{className:'swatch'+(i===view.filament?' active':''),title:'Paint with this filament'},colour,name);
    row.onclick=event=>{if(event.target.tagName!=='INPUT'&&event.target.tagName!=='BUTTON'){view.filament=i;render();}};
    if(view.design.filaments.length>1){const remove=el('button',{type:'button',textContent:'×',title:'Remove filament','aria-label':`Remove ${f.name}`});
      remove.onclick=()=>edit(d=>{const shift=v=>v===i?0:v>i?v-1:v;d.filaments.splice(i,1);for(const b of d.bins)b.filament=shift(b.filament);d.baseplate.filament=shift(d.baseplate.filament);view.filament=0;});row.append(remove);}
    list.append(row);
  });
  const add=el('button',{type:'button',className:'add',textContent:'+ Add a filament'});
  add.onclick=()=>edit(d=>{d.filaments.push({name:`Filament ${d.filaments.length+1}`,colour:'#3a7bd5'});});
  return [list,add];
}
// One filament for every selected bin: a pick-one list of colour swatches.
function filamentChoice(bins,onPick){
  const common=bins.every(b=>b.filament===bins[0].filament)?bins[0].filament:null,name=`filament-${bins.map(b=>b.id).join('-')}`;
  return el('div',{className:'choices',role:'radiogroup','aria-label':'Filament'},view.design.filaments.map((f,i)=>{
    const radio=el('input',{type:'radio',name,value:i,checked:i===common});radio.onchange=()=>onPick(i);
    return el('label',{className:'choice'+(i===common?' active':'')},radio,el('span',{className:'dot',style:`background:${f.colour}`}),el('span',{textContent:f.name}));
  }));
}
function binEditor(bins){
  const ids=new Set(bins.map(b=>b.id)),change=fn=>edit(d=>{for(const b of d.bins)if(ids.has(b.id))fn(b);});
  const single=bins.length===1?bins[0]:null,t=single?catalog(single.type):null,max=view.preview.maxHeightUnits;
  const low=bins.some(b=>b.kind==='bin'||catalog(b.type).kind==='bin')?2:1,same=key=>bins.every(b=>b[key]===bins[0][key]);
  const heights=el('select',{},same('heightUnits')?null:el('option',{value:'',textContent:'Mixed heights',selected:true,disabled:true}),
    Array.from({length:Math.max(0,max-low+1)},(_,i)=>i+low).map(h=>el('option',{value:h,textContent:`${h} units · ${h*7} mm`,selected:same('heightUnits')&&h===bins[0].heightUnits})));
  heights.onchange=()=>change(b=>{b.heightUnits=Number(heights.value);});
  const panel=single
    ?[el('p',{className:'eyebrow',textContent:`${t.code} · ${single.id}`}),el('h2',{textContent:t.name})]
    :[el('p',{className:'eyebrow',textContent:'Selection'}),el('h2',{textContent:`${bins.length} bins selected`}),el('p',{textContent:'Changes apply to every selected bin. Shift-click or Shift-drag to add or remove bins.'})];
  panel.push(field('Height',heights),el('h3',{textContent:'Filament'}),filamentChoice(bins,i=>change(b=>{b.filament=i;})));
  if(single){
    const label=el('input',{type:'text',value:single.label,maxLength:24,placeholder:'e.g. M3 SCREWS'});label.onchange=()=>change(b=>{b.label=label.value;});
    panel.push(el('div',{style:'height:14px'}),field('Label',label,'Raised lettering on the floor of the front-left cup, made by SAAM’s text tool. You can change it later in Studio.'));
    if(t.kind==='bin'){
      const count=key=>numberInput(single[key],v=>change(b=>{b[key]=Math.max(1,Math.round(v??1));}),{min:1,step:1});
      panel.push(el('div',{className:'row'},field('Cups across',count('compartmentsX')),field('Cups deep',count('compartmentsY'))));
    }
  }
  const binsWithLip=bins.filter(b=>catalog(b.type).kind==='bin');
  if(binsWithLip.length)panel.push(check('Stacking lip',binsWithLip.every(b=>b.stackingLip),v=>change(b=>{if(catalog(b.type).kind==='bin')b.stackingLip=v;})));
  panel.push(check('Magnet pockets (6 × 2 mm)',bins.every(b=>b.magnetHoles),v=>change(b=>{b.magnetHoles=v;})));
  const done=el('button',{type:'button',className:'primary',textContent:'Done'});done.onclick=()=>{view.selection.clear();render();};
  const remove=el('button',{type:'button',className:'back',textContent:single?'Delete this bin':`Delete ${bins.length} bins`,style:'color:var(--bad)'});remove.onclick=()=>deleteBins(ids);
  panel.push(el('div',{className:'next'},message(),done,remove));
  return panel;
}
function binsStep(){
  const max=view.preview.maxHeightUnits,selected=view.design.bins.filter(b=>view.selection.has(b.id));
  let panel;
  if(selected.length)panel=binEditor(selected);
  else{
    if(view.height>max)view.height=Math.max(2,max);
    const chips=el('div',{className:'chips'},[2,3,4,5,6,8,10,12,15,20].filter(h=>h<=max).map(h=>{const c=el('button',{type:'button',className:h===view.height?'active':'',textContent:`${h}u`,title:`${h*7} mm`});c.onclick=()=>{view.height=h;render();};return c;}));
    const palette=el('div',{className:'palette'});
    for(const entry of view.resources.catalog){
      const canvas=el('canvas'),card=el('button',{type:'button',className:'type'+(entry.type===view.type?' active':''),title:entry.name},canvas,el('b',{textContent:entry.code}),el('small',{textContent:entry.name.replace(/^Bin /,'')}));
      card.onclick=()=>{view.type=entry.type;render();};palette.append(card);
      requestAnimationFrame(()=>drawThumbnail(canvas,entry.mesh,colourOf(view.filament)));
    }
    panel=[el('h2',{textContent:'Pick & colour bins'}),el('p',{textContent:'Choose a bin, its height and a filament, then click or drag across empty cells. Each footprint is one bin to print. Switch to Select, or hold Shift, and drag a window to select several bins.'}),
      el('h3',{textContent:'Bin type'}),palette,el('h3',{textContent:'Height'}),chips,
      el('h3',{textContent:'Filament'}),el('p',{textContent:'The colours you plan to print with. They don’t need to be loaded now.',style:'margin-bottom:8px;font-size:12px'}),...filamentList(),
      facts([['Bins',String(view.design.bins.length)],['Cells filled',`${view.preview.usedCells} of ${view.preview.cells}`]]),
      next('Continue to staging',2)];
  }
  // Confirmed on the page: embedded browsers may suppress native dialogs.
  const count=view.design.bins.length,clear=el('button',{type:'button',className:view.confirmClear?'danger':'',
    textContent:view.confirmClear?`Clear ${count} bin${count===1?'':'s'}?`:'Clear bins',disabled:!count});
  clear.onclick=()=>{
    clearTimeout(view.confirmTimer);
    if(!view.confirmClear){view.confirmClear=true;view.confirmTimer=setTimeout(()=>{view.confirmClear=false;render();},4000);render();return;}
    view.confirmClear=false;view.selection.clear();edit(d=>{d.bins=[];});
  };
  const tools=el('div',{className:'tools',role:'group','aria-label':'Grid tool'},[['paint','Paint'],['select','Select']].map(([tool,text])=>{
    const b=el('button',{type:'button',textContent:text,className:view.tool===tool?'active':'','aria-pressed':String(view.tool===tool)});
    b.onclick=()=>{view.tool=tool;view.ghost=null;render();};return b;
  }));
  return {eyebrow:'Step 2 · bins',title:`${view.preview.grid.xUnits} × ${view.preview.grid.yUnits} grid`,panel,buttons:[tools,clear],
    draw:stage=>drawFrame(stage,{bins:true}),
    foot:[view.tool==='select'?'Drag a window to select · Shift adds · Delete removes':'Click or drag to paint · Shift-drag to select · right-click for options',max<20?`Tallest bin ${max} units`:'']};
}

// ---------- Steps 3 and 4: plates
function plateCards(stage,{created}){
  const machine=view.resources.printers.find(m=>m.id===view.design.printer.machineId),bed=machine.printableMm,w=bed.max[0]-bed.min[0],h=bed.max[1]-bed.min[1];
  const done=new Set((view.job?.stage==='complete'?view.job.bundles??[]:[]).map(b=>b.id));
  stage.replaceChildren(el('div',{className:'plates'},view.preview.plates.map(plate=>{
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
    const add=(tag,attrs,text)=>{const node=document.createElementNS(svg.namespaceURI,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);if(text)node.textContent=text;svg.append(node);return node;};
    add('rect',{x:1,y:1,width:w-2,height:h-2,rx:6,fill:'none',stroke:'#a8b6a4','stroke-dasharray':'6 5'});
    for(const item of plate.items){
      const [fx,fy]=item.footprintMm,x=item.bedMm[0]-bed.min[0],y=h-(item.bedMm[1]-bed.min[1])-fy;
      add('rect',{x,y,width:fx,height:fy,rx:4,fill:colourOf(item.filament),'fill-opacity':item.kind==='baseplate'?.45:1,stroke:'#1b2929','stroke-opacity':.35});
      add('text',{x:x+fx/2,y:y+fy/2+5,'text-anchor':'middle','font-size':13,'font-weight':600,fill:'#1b2929',stroke:'#fafbf7','stroke-width':3,'paint-order':'stroke'},item.kind==='baseplate'?'baseplate':catalog(item.bin.type).code);
    }
    const state=created?el('span',{className:'state'+(done.has(plate.id)?' done':''),textContent:done.has(plate.id)?'Created':view.job&&!['complete','failed'].includes(view.job.stage)?'Waiting…':'Ready'}):el('span',{},plate.filaments.map(i=>el('span',{className:'dot',title:view.design.filaments[i].name,style:`background:${colourOf(i)};margin-left:4px`})));
    return el('div',{className:'plate'},el('div',{className:'plate-head'},el('span',{textContent:plate.id.replace('plate-','Plate ')}),state),svg,
      el('ul',{},plate.items.map(item=>el('li',{textContent:item.kind==='baseplate'?`Baseplate tile ${item.xUnits} × ${item.yUnits}`:`${catalog(item.bin.type).name} · ${item.bin.heightUnits}u${item.bin.label?' · “'+item.bin.label+'”':''}`}))));
  })));
}
function stageStep(){
  const p=view.design.printer,printers=view.resources.printers,machine=printers.find(m=>m.id===p.machineId),bed=machine.printableMm;
  const printer=el('select',{},printers.map(m=>el('option',{value:m.id,textContent:m.name,selected:m.id===p.machineId})));
  printer.onchange=()=>edit(d=>{d.printer.machineId=printer.value;if(!printers.find(m=>m.id===printer.value).filamentChanges)d.printer.packing='filament';});
  const bp=view.design.baseplate,bpFilament=el('select',{},view.design.filaments.map((f,i)=>el('option',{value:i,textContent:f.name,selected:i===bp.filament})));
  bpFilament.onchange=()=>edit(d=>{d.baseplate.filament=Number(bpFilament.value);});
  const tiles=view.preview.plates.flatMap(plate=>plate.items).filter(item=>item.kind==='baseplate').length;
  const panel=[el('h2',{textContent:'Stage plates'}),el('p',{textContent:'Choose the printer you plan to use. Its build plate sets how the bins and baseplate are laid out. You choose the printer, setup and filaments in Studio.'}),
    field('Printer',printer,'Used here only for plate size. Each plate opens in Studio without a printer; choose it there.'),
    machine.filamentChanges?seg([['filament','One filament per plate'],['mixed','Mix filaments']],p.packing,packing=>edit(d=>{d.printer.packing=packing;})):null,
    bp.include?field('Baseplate filament',bpFilament):null,
    facts([['Usable plate',`${(bed.max[0]-bed.min[0]).toFixed(0)} × ${(bed.max[1]-bed.min[1]).toFixed(0)} mm`],['Build plates',String(view.preview.plates.length)],
      bp.include&&['Baseplate tiles',String(tiles)],['Bins',String(view.design.bins.length)]]),
    view.preview.error?el('p',{className:'message error',textContent:view.preview.error}):null,
    next('Continue to print',3)];
  return {eyebrow:'Step 3 · staging',title:`${view.preview.plates.length} build plate${view.preview.plates.length===1?'':'s'} · ${machine.name}`,panel,
    draw:stage=>plateCards(stage,{created:false}),foot:['Front of each plate at the bottom','10 mm bed margin · 6 mm between parts']};
}
function printStep(){
  const plates=view.preview.plates,job=view.job,busy=job&&!['complete','failed'].includes(job.stage);
  const create=()=>api('/api/bundles','POST',{design:view.design}).then(started=>{view.job=started;view.message=null;render();}).catch(error=>{view.message={error:true,text:error.message};render();});
  const counts=view.preview.counts.map(c=>[`${c.code} · ${c.heightUnits}u · ${view.design.filaments[c.filament].name}`,`× ${c.count}`]);
  const progress=busy?[el('progress',{className:'progress',max:job.total||1,value:job.completed??0}),el('p',{className:'message',textContent:`Building ${job.piece??'plates'} (${job.completed??0} of ${job.total})…`})]:[];
  const outcome=job?.stage==='complete'?el('p',{className:'message',textContent:`Created ${job.bundles?.length??0} print bundles. SAAM opens each plate in Studio, where you choose the printer and filaments, slice, review and export. Your intended colours are listed with each plate.`})
    :job?.stage==='failed'?el('p',{className:'message error',textContent:'Creation failed: '+job.error}):null;
  const panel=[el('h2',{textContent:'Print'}),el('p',{textContent:'Each plate becomes its own SAAM print and opens in Studio, the standard printing workbench. Labels are made with SAAM’s text tool and stay editable there.'}),
    facts([['Build plates',String(plates.length)],...counts]),...progress,outcome,
    next(job?.stage==='complete'?'Create again':'Create print bundles',3,{disabled:busy,onClick:create}),
    el('p',{textContent:`Labels use the ${view.resources.labelFont.name} font (${view.resources.labelFont.license}).`,style:'font-size:10px;margin:12px 0 0'})];
  return {eyebrow:'Step 4 · print',title:'Send plates to Studio',panel,draw:stage=>plateCards(stage,{created:true}),
    foot:['Re-creating replaces the previous set; plates edited in Studio are kept','']};
}

// ---------- render
function render(){
  if(!view.design||!view.preview)return;
  if(!reachable(view.step))view.step=[3,2,1,0].find(reachable);
  $('steps').replaceChildren(...STEPS.map((name,i)=>{
    const b=el('button',{type:'button',className:i===view.step?'active':i<view.step?'done':'',disabled:!reachable(i)},el('span',{textContent:String(i+1)}),name);
    b.onclick=()=>{view.step=i;view.selection.clear();render();};return b;
  }));
  const step=[sizeStep,binsStep,stageStep,printStep][view.step]();
  $('view-eyebrow').textContent=step.eyebrow;$('view-title').textContent=step.title;
  $('view-buttons').replaceChildren(...(step.buttons??[]));
  $('panel').replaceChildren(...step.panel.filter(Boolean));
  $('view-foot-left').textContent=step.foot[0]??'';$('view-foot-right').textContent=step.foot[1]??'';
  step.draw($('stage'));
}
window.addEventListener('resize',()=>{if(view.preview)render();});
window.addEventListener('saam-workspace-event',async({detail})=>{
  if(detail.kind==='workspace-design-updated'&&detail.source==='agent'){view.design=(await api('/api/design')).design;await refresh();}
  if(detail.kind?.startsWith('workspace-bundles-')){view.job=await api('/api/job');if(view.step===3)render();}
});
try{
  const loaded=await api('/api/design');view.design=loaded.design;view.job=loaded.job;
  view.resources=await api('/api/resources');
  await refresh();
}catch(error){$('panel').replaceChildren(el('h2',{textContent:'The planner could not start'}),el('p',{className:'message error',textContent:error.message}));}
