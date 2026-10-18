import {createViewerRenderer} from './native/studio/viewer-renderer.mjs';
import {createMaterialRenderer} from './native/studio/material-view.mjs';
import {createLayerFade} from './native/studio/toolpath-view.mjs';
const studio={};let current=null,published=null;
const viewport=document.createElement('canvas'),overlay=document.createElement('canvas');
function contextCurves(ctx,frame,project,width,height){
 function path(points,{closed=false,alpha=.32,lineWidth=.85}={}){if(points.length<2)return;ctx.beginPath();points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});if(closed)ctx.closePath();ctx.strokeStyle='#718b82';ctx.globalAlpha=alpha;ctx.lineWidth=lineWidth;ctx.stroke();ctx.globalAlpha=1;}
 function box(){const s=frame.sizeMm,vertices=Array.from({length:8},(_,i)=>[i&1?s:0,i&2?s:0,i&4?s:0]);for(let i=0;i<8;i++)for(const bit of [1,2,4])if(!(i&bit))path([vertices[i],vertices[i|bit]],{alpha:.42});if(current.context)for(let z=1;z<s;z++)path([[0,0,z],[s,0,z],[s,s,z],[0,s,z]],{closed:true,alpha:.15,lineWidth:.7});}
 if(frame.animation.context==='cube')box();
 if(frame.animation.context==='tube')for(const curve of frame.contextGeometry)if(current.context||curve.alpha>.4)path(curve.points,{alpha:curve.alpha});
 if(frame.animation.context==='bridge')for(const [i,rail] of frame.bridgeRails.entries()){
   const outer=rail.map(p=>[i?24:0,p[1],p[2]]),inner=rail.map(p=>[i?19:5,p[1],p[2]]),bottom=inner.map(p=>[p[0],p[1],0]);
   path(outer,{alpha:.42});path(inner,{alpha:.5});path(bottom,{alpha:.3});
   for(const j of [0,rail.length-1]){path([outer[j],inner[j],bottom[j],[outer[j][0],outer[j][1],0],outer[j]],{closed:true,alpha:.4});}
   if(current.context)for(let j=0;j<rail.length;j+=8)path([inner[j],bottom[j]],{alpha:.18});
 }
}
const renderer=createViewerRenderer({canvas:viewport,createMaterial:()=>{
 const native=createMaterialRenderer();if(!native)throw Error('Native SAAM shading requires WebGL2.');
 return {...native,canvas:overlay,draw(scene,options){
   const stats=native.draw(scene,options),{width,height}=options;overlay.width=width;overlay.height=height;const ctx=overlay.getContext('2d');
   contextCurves(ctx,current.frame,options.project,width,height);ctx.drawImage(native.canvas,0,0,width,height);return stats;
 }};
}});
export async function loadStudioWindow(){
 studio.image=new Image();studio.image.src=new URL('./studio-window.png',import.meta.url).href;
 studio.layout=await(await fetch(new URL('./studio-window.json',import.meta.url))).json();await studio.image.decode();
}
export async function drawFrame(canvas,frame,{context=true,previous=null}={}){
 if(!studio.image)throw Error('Studio capture is not loaded.');current={frame,context};
 let program=frame.program;
 if(previous){const before=previous.program.moves.map(move=>({...move,layerId:'previous-layer',sliceStack:'previous',sliceIndex:-1})),offset=previous.program.summary.motionSeconds;
   program={...program,moves:[...before,...program.moves.map(move=>({...move,startSeconds:move.startSeconds+offset}))],summary:{...program.summary,motionSeconds:offset+program.summary.motionSeconds}};
 }
 const identity=frame.frame+':'+(previous?.frame??'');
 if(published!==identity){await renderer.publishProgram({moves:program.moves,plan:frame.plan,geometry:{}});published=identity;}
 const {x,y,width,height}=studio.layout.viewport;viewport.width=width;viewport.height=height;
 const state={plan:frame.plan,geometry:{},program};
 const annotations=renderer.draw({target:viewport,width,height,ratio:1,position:program.summary.motionSeconds,frameNow:10000,fadeState:createLayerFade(),updateUI:false,state,tab:'toolpath',camera:{yaw:-.78,tilt:.62,zoom:1.15,pan:[0,0]},settings:{showTravel:false,previousLayerOpacity:.24,followPlate:true},bounds:{min:[0,0,0],max:[24,24,24]}});
 if(!renderer.sceneState().solid||annotations.detailText)throw Error(annotations.detailText||'Native material rendering unavailable.');
 const ctx=canvas.getContext('2d'),scale=canvas.width/studio.layout.width;ctx.setTransform(scale,0,0,scale,0,0);ctx.globalAlpha=1;ctx.drawImage(studio.image,0,0);ctx.drawImage(viewport,x,y,width,height);
 // The surrounding window is a real Studio capture; keep its changing readouts truthful.
 ctx.fillStyle='#f4f2ed';ctx.fillRect(1580,200,150,32);ctx.fillRect(1580,245,150,30);ctx.textAlign='right';ctx.fillStyle='#1b2929';ctx.font='12px "Segoe UI",Arial,sans-serif';ctx.fillText(String(program.moves.length),1726,219);ctx.fillText(frame.program.summary.volumeMm3.toFixed(2)+' mm³',1726,264);
 ctx.fillStyle='#fafbf6';ctx.fillRect(1050,802,315,30);ctx.fillRect(1280,860,85,24);ctx.fillStyle='#687675';ctx.font='10px "Segoe UI",Arial,sans-serif';ctx.fillText('slice '+(Math.max(0,frame.animation.layerIndex)+1)+' · step 1/1',1363,822);const duration=program.summary.motionSeconds,clock=n=>Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0');ctx.fillText(clock(duration)+' / '+clock(duration),1363,878);ctx.textAlign='left';
 ctx.setTransform(1,0,0,1,0,0);
 return {solid:true,moves:program.moves.length,connections:frame.connections};
}
