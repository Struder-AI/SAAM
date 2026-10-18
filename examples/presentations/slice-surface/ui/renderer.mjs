import {createProjection,DEFAULT_CAMERA} from './camera.mjs';
const studio={image:null,layout:null};
export async function loadStudioWindow(){
  const image=new Image();image.src=new URL('./studio-window.png',import.meta.url).href;
  const response=await fetch(new URL('./studio-window.json',import.meta.url));
  if(!response.ok)throw Error('The Studio window capture is missing.');
  const layout=await response.json();await image.decode();studio.image=image;studio.layout=layout;
}
export function drawFrame(canvas,frame,{context=true,wash=true}={}){
  if(!studio.image)throw Error('Load the Studio window before drawing frames.');
  const ctx=canvas.getContext('2d'),s=canvas.width/studio.layout.width;
  ctx.setTransform(s,0,0,s,0,0);ctx.globalAlpha=1;ctx.drawImage(studio.image,0,0);
  const {x,y,width,height}=studio.layout.viewport;
  ctx.save();ctx.beginPath();ctx.rect(x,y,width,height);ctx.clip();ctx.translate(x,y);
  // The viewport uses Studio's own background, projection, grid and phase color.
  ctx.save();ctx.translate(width/2,height/2);ctx.scale(width/Math.SQRT2,height/Math.SQRT2);
  const background=ctx.createRadialGradient(0,0,0,0,0,1);background.addColorStop(0,'#f8faf1');background.addColorStop(1,'#eaf0e0');ctx.fillStyle=background;ctx.fillRect(-1,-1,2,2);ctx.restore();
  const size=frame.sizeMm,bounds={min:[0,0,0],max:[size,size,size]};
  const project=createProjection(bounds,width,height,DEFAULT_CAMERA.yaw,DEFAULT_CAMERA.tilt,1.15);
  function path(points,{closed=false,color='#5b9fd3',lineWidth=1.8,alpha=1}={}){
    if(points.length<2)return;ctx.beginPath();
    points.forEach((p,i)=>{const [px,py]=project(p);if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);});
    if(closed)ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.globalAlpha=alpha;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();ctx.globalAlpha=1;
  }
  for(let coordinate=-10;coordinate<=size+10;coordinate+=5){
    path([[coordinate,-10,0],[coordinate,size+10,0]],{color:'#dbe1d4',lineWidth:.6});
    path([[-10,coordinate,0],[size+10,coordinate,0]],{color:'#dbe1d4',lineWidth:.6});
  }
  function box(min,max,alpha=1){
    if(alpha<=0)return;
    if(context)for(let i=1;i<24;i++){
      const z=min[2]+(max[2]-min[2])*i/24;path([[min[0],min[1],z],[max[0],min[1],z],[max[0],max[1],z],[min[0],max[1],z]],{closed:true,color:'#7b9390',lineWidth:.75,alpha:.18*alpha});
    }
    const vertices=Array.from({length:8},(_,i)=>[i&1?max[0]:min[0],i&2?max[1]:min[1],i&4?max[2]:min[2]]);
    for(let i=0;i<8;i++)for(const bit of [1,2,4])if((i&bit)===0)path([vertices[i],vertices[i|bit]],{color:'#718b82',lineWidth:1,alpha:.42*alpha});
  }
  const a=frame.animation??{cubeContext:1,bridgeContext:0};
  box([0,0,0],[size,size,size],a.cubeContext);
  if(a.bridgeContext>0){box([0,0,0],[size/6,size,size/2],a.bridgeContext);box([size*5/6,0,0],[size,size,size/2],a.bridgeContext);}
  if(context)for(const curve of frame.contextGeometry??[])path(curve.points,{color:'#718b82',lineWidth:.85,alpha:curve.alpha});
  if(context)for(const curve of frame.previousPaths??[])path(curve.points,{closed:curve.closed,lineWidth:1.4,alpha:frame.animation.previousAlpha,color:'#5b9fd3'});
  if(wash){
    ctx.globalAlpha=.055;ctx.fillStyle='#5b9fd3';
    for(const boundary of frame.boundary){ctx.beginPath();boundary.forEach((p,i)=>{const [px,py]=project(p);if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);});ctx.closePath();ctx.fill();}
    ctx.globalAlpha=1;
  }
  for(const curve of frame.paths)path(curve.points,{closed:curve.closed,lineWidth:curve.role==='perimeter'?2.8:1.9,alpha:curve.role==='perimeter'?1:.94});
  ctx.font='10px Segoe UI';
  for(const [point,name,color] of [[[5,0,0],'X','#b26751'],[[0,5,0],'Y','#659a7a'],[[0,0,5],'Z','#638599']]){
    path([[0,0,0],point],{color,lineWidth:1.5});const p=project(point);ctx.fillStyle=color;ctx.fillText(name,p[0]+4,p[1]-4);
  }
  ctx.fillStyle='#71836b';ctx.fillText('5 mm grid',18,height-18);
  ctx.restore();ctx.setTransform(1,0,0,1,0,0);
}
