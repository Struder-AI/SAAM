import {frameAtTime} from '../export/source-time.mjs';
import {rotateZ} from '../path/pose.mjs';
import {geometry as splitGeometry,inverse as splitInverse} from './split-delta.mjs';
import {densoGeometry,densoInverse} from './denso-kinematics.mjs';
import {dobotGeometry,dobotInverse} from './dobot-kinematics.mjs';
import {tiltyGeometry,tiltyInverse,tiltyBounds} from './tilty.mjs';
import {constrainedJog} from './jog.mjs';
import {rigid,identity,add,sub,scale,norm,mv,mm,axisFrame,rodFrame,rotation,point,invert,compose,validateRigid} from './rigid.mjs';

const supported=new Set(['ultimaker-s5','bambu-h2d','dobot-mg400','denso-vp6242-rc8','split-delta','tilty']);
const durationOf=p=>p.seconds??p.summary?.motionSeconds??0;
// A closed registry of trusted models. Profiles contain data, never loaded code.
export async function createMachinePresentation({program,machine,setup={},sourceIdentity,signal}){
  signal?.throwIfAborted();if(!supported.has(machine.id))return null;
  const config={...machine.kinematicModel,...setup.kinematicModel},components=[],frames=new Set(['world','part','tcp']);
  const binding={...sourceIdentity,modelKey:JSON.stringify([1,machine.id,machine.revision,config,setup.tool])};
  const component=(id,role,shape,frameId=id,local=rigid())=>{frames.add(frameId);components.push({id,label:id.replaceAll('-',' '),role,shape,frameId,local});};
  const line=(id,role,a,b,frameId='world')=>component(id,role,{kind:'line',fromMm:a,toMm:b},frameId);
  const link=(id,length)=>component(id,'link',{kind:'line',fromMm:[0,0,0],toMm:[0,0,length]});
  const box=(id,role,size,frameId=id)=>component(id,role,{kind:'box',sizeMm:size},frameId);
  const joint=id=>component(id,'joint',{kind:'sphere',radiusMm:3});
  const limits=['Nominal mechanism presentation; no collision, load, compliance or hardware validation.'];
  let solve,probeMargins,extraStatic={},machineBoundsWorldMm=null,manualEnabled=true;
  const bounds=machine.bounds??{min:[-100,-100,0],max:[100,100,200]},toolLength=config.toolLengthMm??70;
  let coordinateBounds=structuredClone(bounds),angularLever=toolLength;
  const bed=[ [bounds.min[0],bounds.min[1],0],[bounds.max[0],bounds.min[1],0],[bounds.max[0],bounds.max[1],0],[bounds.min[0],bounds.max[1],0] ];
  component('bed','bed',{kind:'polyline',pointsMm:bed,closed:true},'part');
  component('tool','tool',{kind:'cone',lengthMm:4,radiusStartMm:0,radiusEndMm:2},'tcp');
  line('hotend-shaft','link',[0,0,4],[0,0,toolLength],'tcp');

  if(machine.id==='ultimaker-s5'||machine.id==='bambu-h2d'){
    const [w,d,h]=bounds.max,headZ=h+toolLength;
    limits.push('Schematic travel centerlines from profile bounds; housings, belts and parked tools omitted.');
    for(const x of [0,w])line('y-rail-'+x,'rail',[x,0,headZ],[x,d,headZ]);
    for(const x of [0,w])line('z-rail-'+x,'rail',[x,d,0],[x,d,h]);
    line('x-rail','rail',[0,0,0],[w,0,0],'gantry');box('carriage','carriage',[24,20,14]);
    machineBoundsWorldMm={min:[-15,-15,0],max:[w+15,d+15,headZ+25]};
    solve=at=>{const [x,y,z]=at.point,part=rigid([0,0,headZ-toolLength-z]);return {worldFromFrame:{part,tcp:rigid([x,y,headZ-toolLength]),gantry:rigid([0,y,headZ]),carriage:rigid([x,y,headZ])},margins:at.point.flatMap((v,i)=>[v-bounds.min[i],bounds.max[i]-v])};};
  }else if(machine.id==='split-delta'||machine.id==='tilty'){
    const tilty=machine.id==='tilty',g=tilty?tiltyGeometry(config):splitGeometry(config),count=tilty?9:6;
    angularLever=g.toolLengthMm+(g.rearLengthMm??0);
    limits.push(`Working carriage travel: ${g.railMinMm} to ${g.railMaxMm} mm${tilty?`; tilt rails start at ${g.tiltRailMinMm.join(', ')} mm`:''}. These fixed endpoints also define the displayed rails.`);
    if(tilty)limits.push(`Rod inversion reserve: ${g.marginDeg} degrees; minimum normalized constraint singular-value ratio: ${g.minSingularRatio}.`);
    const endpoints=tilty?g.towers.map(e=>[[e[0]*(g.towerRadiusMm-g.platformRadiusMm),e[1]*(g.towerRadiusMm-g.platformRadiusMm),g.railMinMm],[e[0]*(g.towerRadiusMm-g.platformRadiusMm),e[1]*(g.towerRadiusMm-g.platformRadiusMm),g.railMaxMm]])
      :g.rails.map((p,i)=>[add(p,scale(g.railDirections[i],g.railMinMm)),add(p,scale(g.railDirections[i],g.railMaxMm))]);
    const reach=g.rodLengthMm+g.toolLengthMm+(tilty?0:Math.max(...g.anchors.map(norm)));
    coordinateBounds={min:[0,1,2].map(i=>Math.max(...endpoints.map(pair=>Math.min(pair[0][i],pair[1][i])-reach))),max:[0,1,2].map(i=>Math.min(...endpoints.map(pair=>Math.max(pair[0][i],pair[1][i])+reach)))};
    coordinateBounds.min[2]=0; // Study bed plane; no nozzle below the bed.
    if(tilty)coordinateBounds=tiltyBounds(g);
    if(tilty){
      for(let i=0;i<3;i++){const e=g.towers[i],t=[-e[1],e[0],0],base=scale(e,g.towerRadiusMm);
        for(const side of [-1,0,1])line(`rail-${i}-${side}`,'rail',add(base,add(scale(t,side*g.pairSpacingMm/2),[0,0,side===0?g.tiltRailMinMm[i]:g.railMinMm])),add(base,add(scale(t,side*g.pairSpacingMm/2),[0,0,g.railMaxMm])));
        box('main-carriage-'+i,'carriage',[16,g.pairSpacingMm+12,12]);box('tilt-carriage-'+i,'carriage',[12,12,12]);
      }
      for(let i=0;i<count;i++)link('rod-'+i,i%3===2?g.tiltRodLengthMm:g.rodLengthMm);
      joint('gimbal');line('rear-hotend','link',[0,0,0],[0,0,g.rearLengthMm],'hotend');
      component('gimbal-outer','joint',{kind:'polyline',closed:true,pointsMm:Array.from({length:20},(_,i)=>[0,8*Math.cos(i*Math.PI/10),8*Math.sin(i*Math.PI/10)])},'gimbal');
      component('gimbal-inner','joint',{kind:'polyline',closed:true,pointsMm:Array.from({length:20},(_,i)=>[6*Math.cos(i*Math.PI/10),0,6*Math.sin(i*Math.PI/10)])});
      component('rear-anchor-ring','link',{kind:'polyline',closed:true,pointsMm:g.towers.map(e=>add(scale(e,g.rearRadiusMm),[0,0,g.rearLengthMm]))},'hotend');
    }else{
      for(let i=0;i<count;i++){
        line('rail-'+i,'rail',add(g.rails[i],scale(g.railDirections[i],g.railMinMm)),add(g.rails[i],scale(g.railDirections[i],g.railMaxMm)));
        link('rod-'+i,g.rodLengthMm);box('carriage-'+i,'carriage',[12,12,12]);
      }
    }
    const radius=tilty?g.platformRadiusMm:g.rotationScaleMm;
    component('platform','carriage',{kind:'polyline',closed:true,pointsMm:Array.from({length:24},(_,i)=>[radius*Math.cos(i*Math.PI/12),radius*Math.sin(i*Math.PI/12),0])});
    components.find(c=>c.id==='hotend-shaft').shape.toMm[2]=g.toolLengthMm;
    const r=g.towerRadiusMm+g.railMaxMm*Math.abs(Math.tan((g.railTiltDeg??0)*Math.PI/180))+40;
    machineBoundsWorldMm={min:[-r,-r,Math.min(0,g.railMinMm)],max:[r,r,g.railMaxMm+20]};
    solve=at=>{
      const R=at.rotation??axisFrame(scale(at.toolAxis??[0,0,-1],-1),at.toolUp??[0,1,0]);
      const s=tilty?tiltyInverse(g,{tcp:at.point,rotation:R}):splitInverse(g,{tcp:at.point,rotation:R});
      if(!s.valid)return {worldFromFrame:{part:rigid()},margins:s.margins,diagnostics:s.errors.map(message=>({code:'model-solve',severity:'warning',message}))};
      const pose={part:rigid(),tcp:rigid(at.point,R),platform:rigid(s.platform,tilty?identity():R)};
      if(tilty){pose.gimbal=rigid(s.platform);pose['gimbal-inner']=rigid(s.platform,rotation([1,0,0],s.gimbalRadians[0]));pose.hotend=rigid(s.platform,R);
        s.rods.forEach((rod,i)=>pose['rod-'+i]=rodFrame(rod.from,rod.to));
        g.towers.forEach((e,i)=>{pose['main-carriage-'+i]=rigid(add(scale(e,g.towerRadiusMm),[0,0,s.mainHeights[i]]),axisFrame([0,0,1],[-e[1],e[0],0]));pose['tilt-carriage-'+i]=rigid(add(scale(e,g.towerRadiusMm),[0,0,s.tiltHeights[i]]));});
      }else s.carriages.forEach((c,i)=>{pose['carriage-'+i]=rigid(c);pose['rod-'+i]=rodFrame(c,s.points[i]);});
      return {worldFromFrame:pose,margins:s.margins};
    };
  }else{
    // Room/part alignment is established by source playback. Arm installation is
    // separate; never infer a robot base from a print's bounding box.
    if(config.worldFromBase)validateRigid(config.worldFromBase);
    const dobot=machine.id==='dobot-mg400',model=dobot?dobotGeometry(config):densoGeometry(config);
    const scaledDobot=dobot&&program.language==='dobot-lua'&&(setup.dobot?.scaleX!==1||setup.dobot?.scaleY!==1);
    const aligned=config.worldFromBase&&Number.isFinite(config.toolLengthMm)&&(dobot||Array.isArray(config.modelSeedDeg))&&!scaledDobot;
    manualEnabled=!!aligned;
    limits.push(dobot?'Nominal MG400 linkage; calibrated user/tool orientation and coupled interference are unchecked.':'Nominal VP-6242 drawing centerlines and seeded IK; model angles are not RC8 encoders or FIG.');
    const sourceFrames=at=>{
      const center=setup.denso?.rotaryCenterMm??[0,0,0],a=at.rotaryDeg??0,R=rotation([0,0,1],a*Math.PI/180),part=rigid(sub(center,mv(R,center)),R);
      const tcp=point(part,at.point),axis=rotateZ(at.toolAxis??[0,0,-1],a),up=rotateZ(at.toolUp??[0,1,0],a);
      return {part,tcp:rigid(tcp,axisFrame(scale(axis,-1),up))};
    };
    if(aligned){
      if(!dobot)probeMargins=at=>{
        const local=compose(invert(config.worldFromBase),sourceFrames(at).tcp),wrist=add(local.translationMm,mv(local.rotation,[0,0,model.flangeMm+model.toolLengthMm]));
        const distance=norm(sub(wrist,[0,0,model.shoulderHeightMm])),fore=Math.hypot(model.forearmMm,model.elbowOffsetMm);
        return [model.upperMm+fore-distance,distance-Math.abs(model.upperMm-fore)];
      };
      const baseCenter=point(config.worldFromBase,dobot?model.baseOriginMm:[0,0,model.shoulderHeightMm]);
      const radius=dobot?norm(model.shoulderMm)+model.l1+model.l2+norm(model.wristMm)+model.toolLengthMm:model.upperMm+Math.hypot(model.forearmMm,model.elbowOffsetMm)+model.flangeMm+model.toolLengthMm;
      const center=setup.denso?.rotaryCenterMm??[0,0,0],radial=radius+Math.hypot(baseCenter[0]-center[0],baseCenter[1]-center[1]);
      coordinateBounds={min:[center[0]-radial,center[1]-radial,baseCenter[2]-radius],max:[center[0]+radial,center[1]+radial,baseCenter[2]+radius]};
      angularLever=dobot?model.toolLengthMm:model.flangeMm+model.toolLengthMm;
      const lengths=dobot?[Math.abs(model.baseOriginMm[2]),norm(model.shoulderMm),norm(model.upperMm),norm(model.forearmMm),norm(model.wristMm),model.toolLengthMm]
        :[model.shoulderHeightMm,model.upperMm,Math.hypot(model.forearmMm,model.elbowOffsetMm),model.flangeMm,model.toolLengthMm];
      lengths.forEach((length,i)=>{link('arm-'+i,length);joint('pivot-'+i);});
      box('base','structure',dobot?[100,100,20]:[160,160,20]);extraStatic.base=config.worldFromBase;
      // No guessed reach cube: explicit fit uses the currently resolved assembly.
      // A calibrated installation can add a real framing envelope when needed.
      solve=at=>{
        const pose=sourceFrames(at),local=compose(invert(config.worldFromBase),pose.tcp),axis=mv(local.rotation,[0,0,-1]);
        const yaw=Math.atan2(local.rotation[1][0],local.rotation[0][0])*180/Math.PI;
        const result=dobot?dobotInverse(model,{tcp:local.translationMm,yawDeg:yaw,toolAxis:axis}):densoInverse(model,{tcp:local.translationMm,rotation:local.rotation},{seed:config.modelSeedDeg});
        const margins=dobot?result.margins:probeMargins(at);
        if(!result.valid)return {worldFromFrame:pose,margins,diagnostics:result.errors.map(message=>({code:'arm-solve',severity:'warning',message}))};
        result.points.slice(1).forEach((p,i)=>{const a=point(config.worldFromBase,result.points[i]),b=point(config.worldFromBase,p);pose['arm-'+i]=rodFrame(a,b);pose['pivot-'+i]=rigid(b);});return {worldFromFrame:pose,margins};
      };
    }else{
      limits.push(scaledDobot?'Arm omitted: non-unit Dobot design calibration cannot be overlaid with rigid physical frames.':'Arm omitted: supply kinematicModel.worldFromBase and installed toolLengthMm'+(dobot?'':', plus modelSeedDeg')+'.');
      solve=at=>({worldFromFrame:sourceFrames(at),diagnostics:[{code:'arm-unavailable',severity:'info',message:limits.at(-1)}]});
    }
  }
  const tilty=machine.id==='tilty',cartesian=['ultimaker-s5','bambu-h2d'].includes(machine.id),dobot=machine.id==='dobot-mg400';
  const angleAxes=cartesian?[]:dobot?[2]:tilty?[0,1]:[0,1,2];
  const controls=manualEnabled?[...['X','Y','Z'].map((label,i)=>({label,unit:'mm',min:Math.floor(coordinateBounds.min[i]*10)/10,max:Math.ceil(coordinateBounds.max[i]*10)/10,step:.1})),
    ...angleAxes.map(i=>({label:tilty?['Gimbal X','Gimbal Y'][i]:['Rotate X','Rotate Y','Rotate Z'][i],unit:'°',min:tilty?-(config.maxTiltDeg??40):-180,max:tilty?(config.maxTiltDeg??40):180,step:.1}))]:[];
  function controlPose(at,manual){
    if(!controls.length)return {at,controlValues:[]};
    const R=at.rotation??axisFrame(scale(at.toolAxis??[0,0,-1],-1),at.toolUp??[0,1,0]);
    const b=Math.asin(Math.max(-1,Math.min(1,-R[2][0]))),singular=Math.abs(Math.cos(b))<1e-7;
    const a=tilty?[Math.atan2(-R[1][2],R[2][2]),Math.asin(Math.max(-1,Math.min(1,R[0][2]))),0]
      :[singular?0:Math.atan2(R[2][1],R[2][2]),b,singular?Math.atan2(-R[0][1],R[1][1]):Math.atan2(R[1][0],R[0][0])];
    if(!manual)return {at,controlValues:[...at.point,...angleAxes.map(i=>a[i]*180/Math.PI)]};
    angleAxes.forEach((axis,i)=>a[axis]=manual[i+3]*Math.PI/180);
    const r=tilty?mm(rotation([1,0,0],a[0]),rotation([0,1,0],a[1])):mm(rotation([0,0,1],a[2]),mm(rotation([0,1,0],a[1]),rotation([1,0,0],a[0])));
    return {at:{...at,point:manual.slice(0,3),rotation:r,toolAxis:mv(r,[0,0,-1]),toolUp:mv(r,[0,1,0])},controlValues:[...manual]};
  }
  const descriptor={schema:'saam-machine-presentation/1',binding,label:machine.name,basis:config.basis??'Nominal design geometry; source-command motion',frameIds:[...frames],components,machineBoundsWorldMm,limitations:limits,controls};
  let disposed=false;
  return {descriptor,async sample(request,{signal}={}){
    signal?.throwIfAborted();if(disposed)throw Error('Machine presentation disposed');
    if(!Number.isFinite(request.seconds)||request.seconds<0||request.seconds>durationOf(program))throw Error('Machine sample time outside source duration');
    if(request.manual!==undefined&&(!controls.length||!Array.isArray(request.manual)||request.manual.length!==controls.length||!request.manual.every(Number.isFinite)))throw Error('Invalid manual machine coordinates');
    const sourceAt=frameAtTime(program.moves,request.seconds);let {at,controlValues}=sourceAt.point?controlPose(sourceAt,request.manual):{at:sourceAt,controlValues:[]};
    let result={worldFromFrame:{},diagnostics:[]};
    try{if(at.point){
      if(request.jog){
        const evaluate=(values,probe=false)=>{const posed=controlPose(sourceAt,values),s=probe&&probeMargins?{margins:probeMargins(posed.at)}:solve(posed.at),f={world:rigid(),...extraStatic,...s.worldFromFrame};
          const margins=[...(s.margins??[]),...values.flatMap((v,i)=>[v-controls[i].min,controls[i].max-v])];
          return {...s,margins,valid:margins.every(v=>Number.isFinite(v)&&v>=-1e-7)&&components.every(c=>f[c.frameId])&&!s.diagnostics?.some(d=>d.severity==='warning'),controlValues:values};};
        const jog=constrainedJog({from:request.jog.from,target:request.manual,axis:request.jog.axis,scales:controls.map(c=>c.unit==='mm'?1:angularLever*Math.PI/180),evaluate});
        result=jog.result;controlValues=jog.values;
        if(jog.limited||jog.adjusted)result={...result,diagnostics:[{code:'jog-boundary',severity:'info',message:jog.limited?'Reached the modeled boundary; holding a reachable pose.':'Other coordinates adjusted to stay within the machine boundaries.'}]};
      }else result=solve(at);
    }else result.diagnostics=[{code:'no-motion',severity:'info',message:'No source pose available'}];}
    catch(error){result={worldFromFrame:{part:rigid()},diagnostics:[{code:'model-solve',severity:'warning',message:error.message}]};}
    const worldFromFrame={world:rigid(),...extraStatic,...result.worldFromFrame};
    const available=components.filter(c=>worldFromFrame[c.frameId]);
    const status=!worldFromFrame.part||!available.length?'unavailable':available.length===components.length?'ready':'partial';
    return {schema:'saam-machine-pose/1',binding,...request,status,worldFromFrame,controlValues,diagnostics:result.diagnostics??[]};
  },dispose(){disposed=true;}};
}
