import {frameAtTime,displayPoint} from './playback.mjs';
import {createProjection} from './camera.mjs';
import {buildToolpathView,toolpathFrame,toolpathPresentation,toolpathStyle,layerKey,remainingLayerMs,layerIndexAt,TOOLPATH_COLORS} from './toolpath-view.mjs';
import {buildGeometryView,createGeometryRenderer,pickGeometry,visibleGeometryEdgeSegments} from './mesh-view.mjs';
import {buildMaterialScene,createMaterialRenderer} from './material-view.mjs';
import {drawMachineCanvas} from './machine-view.mjs';
import {point} from '../core/machine/rigid.mjs';
import {createViewPerformance,createMotionQuality} from './view-performance.mjs';

const clock=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');

export function createViewerRenderer({canvas,reportPerformance=()=>{},
  requestFrame=globalThis.requestAnimationFrame,cancelFrame=globalThis.cancelAnimationFrame,now=()=>globalThis.performance.now(),
  setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout,pinnedQuality=null,
  buildGeometry=buildGeometryView,createGeometry=createGeometryRenderer,buildPathView=buildToolpathView,
  buildMaterialView=buildMaterialScene,createMaterial=createMaterialRenderer}={}) {
  let geometryScene=null,geometryRenderer=null,geometryProject=null,geometryError='';
  let pathView=null,materialScene=null,materialRenderer=null,materialError='',lastMaterialStats=null;
  let motionQuality=null,lastMotion=0,lastWheel=-Infinity,lastMovingFrame=0,redrawRequested=0,redrawFrame=0,settleTimer=0;
  let scheduleEpoch=0;
  let lastPerformanceContext={};
  let scheduledRead=null,scheduledApply=null,publication=0;
  const performanceView=createViewPerformance({report:reportPerformance,context:()=>({...lastPerformanceContext,renderer:materialRenderer?.renderer??null,
    material:lastPerformanceContext.tab==='toolpath'?lastMaterialStats:null})});
  const sceneState=()=>({pathView,pathMoves:pathView?.moves,materialMoves:materialScene?.moves,
    hasGeometry:Boolean(geometryScene),
    groups:pathView?.groups??[],moves:pathView?.moves??[],hasSelectedEdge:id=>geometryScene?.edgeFeatures.has(id)??false,
    edge:id=>geometryScene?.edgeFeatures.get(id),solid:Boolean(materialScene&&materialRenderer)});
  function publishGeometry({geometry,featureEdges=[]}) {
    geometryScene=buildGeometry(geometry,35,featureEdges);geometryProject=null;geometryError='';
    try{geometryRenderer??=createGeometry();if(!geometryRenderer)geometryError='Shading needs WebGL2; showing flat surfaces.';}
    catch(error){geometryError='Shading unavailable: '+error.message;}
    return sceneState();
  }
  async function publishProgram({moves,plan,geometry,previewMaterial,onProgress,buildPath=true,buildMaterial=true}) {
    const ticket=++publication;if(buildPath)pathView=buildPathView(moves);
    if(!buildMaterial)return {scene:sceneState(),previewMaterialConsumed:false};
    materialError='';
    let previewMaterialConsumed=false;
    try{
      materialRenderer??=createMaterial();
      const next=materialRenderer?(previewMaterial?{...previewMaterial,moves,plan,geometry}:await buildMaterialView(moves,plan,geometry,{onProgress})):null;
      if(ticket!==publication)return {scene:sceneState(),previewMaterialConsumed:false};
      materialScene=next;previewMaterialConsumed=Boolean(materialRenderer&&previewMaterial);
      if(!materialRenderer)materialError='3D material rendering needs WebGL2. Showing toolpath lines.';
    }catch(error){if(ticket===publication){materialScene=null;materialError='Material view unavailable: '+error.message+' Showing toolpath lines.';}}
    return {scene:sceneState(),previewMaterialConsumed};
  }
  function clearProgram(){publication++;pathView=null;materialScene=null;materialRenderer?.dispose();materialRenderer=null;materialError='';}
  function requestDraw(readSnapshot,applyAnnotations){scheduledRead=readSnapshot;scheduledApply=applyAnnotations;if(redrawFrame)return;
    const epoch=scheduleEpoch;let handle;redrawRequested=now();handle=requestFrame(()=>{if(redrawFrame===handle)redrawFrame=0;if(epoch!==scheduleEpoch)return;
      const annotations=draw(scheduledRead());scheduledApply?.(annotations);});redrawFrame=handle;
  }
  function noteMotion(kind='orbit'){lastMotion=now();if(kind==='zoom')lastWheel=lastMotion;}
  function draw(snapshot={}) {
    const {target=canvas,width=target.clientWidth,height=target.clientHeight,ratio=globalThis.devicePixelRatio||1,position=0,
      frameNow=now(),fadeState,updateUI=true,playbackSpeed=0,machineState=null,state,shown=state,tab='geometry',selected=null,
      camera,settings,bounds,skinPhase,machineColors,cameraMode='ghost',playing=false,manualPose=false,duration=0,selectionLabel=''}=snapshot;
    const annotations={selectionText:null,layerText:null,detailText:null,timeText:null,fadeContinuation:false};
    if(updateUI)lastPerformanceContext=snapshot.performanceContext??{};
    const ctx=target.getContext('2d'),drawStart=now(),moving=playing||drawStart-lastMotion<250;let materialMs=0,materialStats=null,quality=0;
    const segment=(a,b,color,width=1)=>{ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();};
    if(updateUI&&redrawFrame){cancelFrame(redrawFrame);redrawFrame=0;}if(!state)return annotations;
    if(target.width!==Math.round(width*ratio)||target.height!==Math.round(height*ratio)){target.width=Math.round(width*ratio);target.height=Math.round(height*ratio);}
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.globalAlpha=1;ctx.save();ctx.translate(width/2,height/2);ctx.scale(width/Math.SQRT2,height/Math.SQRT2);
    const background=ctx.createRadialGradient(0,0,0,0,0,1);background.addColorStop(0,'#f8faf1');background.addColorStop(1,'#eaf0e0');ctx.fillStyle=background;ctx.fillRect(-1,-1,2,2);ctx.restore();
    const project=createProjection(tab==='toolpath'&&camera.fitBounds?camera.fitBounds:bounds,width,height,camera.yaw,camera.tilt,camera.zoom,camera.pan,tab==='toolpath'&&cameraMode==='machine');
    const referenceProject=tab==='toolpath'&&machineState?.pose&&!settings.followPlate?p=>{const {xMm,yMm}=shown.plan.placement,q=point(machineState.pose.part,[p[0]+xMm,p[1]+yMm,p[2]]);return project([q[0]-xMm,q[1]-yMm,q[2]]);}:project;
    const strokeScale={lineWidthMm:shown.plan.process.lineWidthMm,pixelsPerMm:project.pixelsPerMm,previousLayerOpacity:settings.previousLayerOpacity};
    for(let x=bounds.min[0]-10;x<=bounds.max[0]+10;x+=5)segment(referenceProject([x,bounds.min[1]-10,0]),referenceProject([x,bounds.max[1]+10,0]),'#dbe1d4',.6);
    for(let y=bounds.min[1]-10;y<=bounds.max[1]+10;y+=5)segment(referenceProject([bounds.min[0]-10,y,0]),referenceProject([bounds.max[0]+10,y,0]),'#dbe1d4',.6);
    if(snapshot.showGeometry){geometryProject=project;
      if(geometryRenderer)try{const options={project,width,height,ratio,color:TOOLPATH_COLORS.skyBlue,selected};geometryRenderer.draw(geometryScene,{...options,shadow:true});ctx.save();ctx.globalAlpha=.16;ctx.filter='blur(6px)';ctx.drawImage(geometryRenderer.canvas,0,0,width,height);ctx.restore();geometryRenderer.draw(geometryScene,options);ctx.drawImage(geometryRenderer.canvas,0,0,width,height);}catch(error){geometryError=error.message;geometryRenderer.dispose();geometryRenderer=null;}
      if(!geometryRenderer){const pts=state.geometry.vertices.map(project),polygons=state.geometry.faces.map((face,i)=>({id:state.geometry.labels[i],edges:geometryScene.topology.edgeMasks[i],points:face.map(j=>pts[j]),depth:face.reduce((sum,j)=>sum+pts[j][2],0)/face.length})).sort((a,b)=>a.depth-b.depth);
        for(const polygon of polygons){ctx.beginPath();polygon.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=polygon.id===selected?'#83b5d6':TOOLPATH_COLORS.skyBlue;ctx.fill();for(let i=0;i<polygon.points.length;i++)if(polygon.edges[i])segment(polygon.points[i],polygon.points[(i+1)%polygon.points.length],'#5c879e',.6);}}
      if(!geometryRenderer&&geometryScene?.edgeFeatures.has(selected))for(const [a,b]of visibleGeometryEdgeSegments(geometryScene,project,selected))segment(a,b,'#eb591f',3);
      annotations.selectionText=selected?selectionLabel:geometryError||'Click a surface or edge to see its name';
    }
    if(tab==='toolpath'&&shown.program&&pathView){const moves=shown.program.moves,at=frameAtTime(moves,position),count=at.completed,placement=shown.plan.placement,showTravel=settings.showTravel;
      annotations.layerText='Layer '+(layerIndexAt(pathView,position)+1)+'/'+pathView.groups.length;
      if(Number.isInteger(at.tool))annotations.layerText+=' · '+(shown.machine.tools.find(t=>t.index===at.tool)?.label??`Tool ${at.tool}`)+' · '+at.nozzleMm+' mm';
      const center=shown.plan.setup.denso?.rotaryCenterMm??[0,0,0],angle=at.rotaryDeg??0,machine=machineState?.pose,follow=settings.followPlate;
      const local=p=>{const q=machine?(follow?p:point(machine.part,p)):displayPoint(p,angle,center,!shown.plan.setup.denso||follow);return [q[0]-placement.xMm,q[1]-placement.yMm,q[2]];};
      if(shown.plan.setup.denso&&!machine?.hasBed){const radius=Math.max(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1])*.65;let prior=null;
        for(let i=0;i<=80;i++){const a=i*Math.PI/40,q=project(local([center[0]+radius*Math.cos(a),center[1]+radius*Math.sin(a),center[2]]));if(prior)segment(prior,q,'#718d91',1);prior=q;}
        segment(project(local(center)),project(local([center[0]+radius,center[1],center[2]])),'#507b89',2);}
      const solid=!!materialScene&&!!materialRenderer;if(solid)motionQuality??=createMotionQuality();quality=updateUI&&solid?pinnedQuality??(moving?motionQuality.level:0):0;
      const materialProject=p=>project(local(p));materialProject.pixelsPerMm=project.pixelsPerMm;
      if(machine&&!solid)drawMachineCanvas(ctx,machine,{project:materialProject,mode:cameraMode,palette:machineColors,filter:c=>c.role!=='tool'});
      const detail=!solid||showTravel||materialScene.unsupported.length?toolpathFrame(pathView,count,showTravel):{segments:[]};
      annotations.detailText=solid?(materialScene.unsupported.length?'Line view for '+materialScene.unsupported.join(', ')+': surface frames unavailable.':''):materialError||(detail.overview?'Layer overview · detail follows playback. Export keeps every point.':detail.reduced?'Curves simplified for display (0.02 mm). Export keeps every point.':'');
      const {displayed,current,currentLayer}=toolpathPresentation(moves,at,detail),fade=fadeState.frame(currentLayer,frameNow,remainingLayerMs(pathView,at.active,position,playbackSpeed)),styles=new Map();
      if(solid)try{const start=now();materialStats=materialRenderer.draw(materialScene,{at,current:currentLayer,fade,project:materialProject,width,height,ratio,skinPhase,previousLayerOpacity:settings.previousLayerOpacity,machine,machineMode:cameraMode,machinePalette:machineColors,quality});ctx.drawImage(materialRenderer.canvas,0,0,width,height);materialMs=now()-start;}catch(error){materialError=error.message;materialRenderer.dispose();materialRenderer=null;materialScene=null;if(!updateUI)throw error;annotations.redraw=true;}
      for(const active of [false,true])for(const edge of displayed){if(solid&&edge.move.extruding&&materialScene?.supported[edge.first])continue;const key=layerKey(edge.move),styleKey=key+':'+!!edge.move.extruding+':'+(edge.move.filament??'')+':'+(edge.move.lineWidthMm??'');let style=styles.get(styleKey);if(!style){style=toolpathStyle(edge.move,currentLayer,skinPhase,fade.weights.get(key)??0,strokeScale);styles.set(styleKey,style);}if(style.active!==active)continue;ctx.globalAlpha=style.opacity;segment(project(local(edge.from)),project(local(edge.to)),style.color,style.width);}
      ctx.globalAlpha=1;for(const event of shown.program.events??[])if(event.kind==='injection'&&position>=event.startSeconds){const p=project(local(event.positionMm)),active=position<event.startSeconds+event.seconds;ctx.beginPath();ctx.arc(p[0],p[1],active?7:4,0,Math.PI*2);ctx.strokeStyle='#b85c28';ctx.lineWidth=2;ctx.stroke();if(active){ctx.fillStyle='#b85c28';ctx.font='12px Segoe UI';ctx.fillText(`Injecting ${event.volumeMm3.toFixed(2)} mm³ · ${event.nozzleC}°C`,p[0]+11,p[1]-8);}}
      annotations.fadeContinuation=fade.fading&&!playing;
      if(current&&at.fraction<1&&(current.extruding||showTravel)&&!(solid&&materialScene?.supported[at.active])){const style=toolpathStyle(current,current,skinPhase,undefined,strokeScale);segment(project(local(current.from)),project(local(at.point)),style.color,style.width);}
      if(machine&&!solid)drawMachineCanvas(ctx,machine,{project:materialProject,mode:cameraMode,palette:machineColors,filter:c=>c.role==='tool'});
      if(at.point&&!manualPose){const axis=at.toolAxis??[0,0,-1],p=project(local(at.point)),q=project(local(at.point.map((v,i)=>v-axis[i]*6)));if(!machine?.hasTool)segment(p,q,'#273e36',3);ctx.beginPath();ctx.arc(p[0],p[1],machine?.hasTool?2:3,0,Math.PI*2);ctx.fillStyle='#273e36';ctx.fill();annotations.timeText=clock(position)+' / '+clock(duration);}
    }
    const projectedOrigin=referenceProject([0,0,0]),origin=tab==='toolpath'?projectedOrigin:[width-48,height-42];ctx.globalAlpha=tab==='toolpath'?1:.65;ctx.font='10px Segoe UI';
    for(const [point,name,color] of [[[5,0,0],'X','#b26751'],[[0,5,0],'Y','#659a7a'],[[0,0,5],'Z','#638599']]){const p=referenceProject(point),end=tab==='toolpath'?p:[origin[0]+(p[0]-projectedOrigin[0])*5/project.pixelsPerMm,origin[1]+(p[1]-projectedOrigin[1])*5/project.pixelsPerMm];segment(origin,end,color,tab==='toolpath'?1.5:1);if(Math.hypot(end[0]-origin[0],end[1]-origin[1])>1){ctx.fillStyle=color;ctx.fillText(name,end[0]+4,end[1]-4);}}
    ctx.globalAlpha=1;ctx.font='10px Segoe UI';ctx.fillStyle='#71836b';ctx.fillText('5 mm grid',18,height-18);
    if(updateUI){const end=now();if(materialStats)lastMaterialStats=materialStats;performanceView.frame(snapshot.interaction??(playing?'playback':end-lastWheel<200?'zoom':null),{start:drawStart,drawMs:end-drawStart,materialMs,quality});if(moving&&motionQuality&&tab==='toolpath'){const cost=playing?(drawStart-lastMovingFrame<1000?drawStart-lastMovingFrame:end-drawStart):end-(redrawRequested||drawStart);motionQuality.sample(cost);lastMovingFrame=drawStart;if(quality>0&&pinnedQuality===null){clearTimer(settleTimer);settleTimer=setTimer(()=>requestDraw(scheduledRead,scheduledApply),260);}}redrawRequested=0;}
    return annotations;
  }
  function pick({x,y}){return geometryScene&&geometryProject?pickGeometry(geometryScene,geometryProject,x,y,{edges:true}):null;}
  function flushPerformance(){performanceView.flush();}
  function dispose(){publication++;scheduleEpoch++;if(redrawFrame)cancelFrame(redrawFrame);redrawFrame=0;clearTimer(settleTimer);settleTimer=0;scheduledRead=scheduledApply=null;
    performanceView.flush();geometryRenderer?.dispose();materialRenderer?.dispose();geometryRenderer=materialRenderer=null;geometryScene=geometryProject=pathView=materialScene=null;}
  return {publishGeometry,publishProgram,clearProgram,sceneState,requestDraw,draw,pick,noteMotion,flushPerformance,dispose};
}
