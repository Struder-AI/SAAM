import {frameAtTime} from '../export/source-time.mjs';
import {rotateZ} from '../path/pose.mjs';
import {densoGeometry,densoInverse,densoWristFromPose} from './denso-kinematics.mjs';
import {dobotGeometry,dobotInverse} from './dobot-kinematics.mjs';
import {constrainedJog} from './jog.mjs';
import {rigid,add,sub,scale,norm,mv,mm,axisFrame,rodFrame,rotation,point,invert,compose,validateRigid} from './rigid.mjs';

// Gantry machines are drawn from profile data alone; each arm has its own trusted model.
const ARMS=new Set(['dobot-mg400','denso-vs068a4-rc8']);
const isGantry=machine=>machine.kinematics==='cartesian-fixed-vertical-nozzle';
const durationOf=p=>p.seconds??p.summary?.motionSeconds??0;
function buildMachineMechanism({program,machine,setup,config}){
  const components=[],frames=new Set(['world','part','tcp']);
  const component=(id,role,shape,frameId=id,local=rigid())=>{frames.add(frameId);components.push({id,label:id.replaceAll('-',' '),role,shape,frameId,local});};
  const line=(id,role,a,b,frameId='world')=>component(id,role,{kind:'line',fromMm:a,toMm:b},frameId);
  const link=(id,length)=>component(id,'link',{kind:'line',fromMm:[0,0,0],toMm:[0,0,length]});
  const box=(id,role,size,frameId=id)=>component(id,role,{kind:'box',sizeMm:size},frameId);
  const joint=id=>component(id,'joint',{kind:'sphere',radiusMm:3});
  const limits=['Nominal mechanism presentation; no collision, load, compliance or hardware validation.'];
  const bounds=machine.bounds??{min:[-100,-100,0],max:[100,100,200]},toolLength=config.toolLengthMm??70;
  const defaultCoordinateBounds=structuredClone(bounds);
  const bed=[ [bounds.min[0],bounds.min[1],0],[bounds.max[0],bounds.min[1],0],[bounds.max[0],bounds.max[1],0],[bounds.min[0],bounds.max[1],0] ];
  component('bed','bed',{kind:'polyline',pointsMm:bed,closed:true},'part');
  component('tool','tool',{kind:'cone',lengthMm:4,radiusStartMm:0,radiusEndMm:2},'tcp');
  if(!config.flangeFromTool)line('hotend-shaft','link',[0,0,4],[0,0,toolLength],'tcp');

  if(isGantry(machine)){
    const [w,d,h]=bounds.max,headZ=h+toolLength;
    const gantrySourcePose=at=>({part:rigid([0,0,headZ-toolLength-at.point[2]])});
    limits.push('Schematic travel centerlines from profile bounds; housings, belts and parked tools omitted.');
    for(const x of [0,w])line('y-rail-'+x,'rail',[x,0,headZ],[x,d,headZ]);
    for(const x of [0,w])line('z-rail-'+x,'rail',[x,d,0],[x,d,h]);
    line('x-rail','rail',[0,0,0],[w,0,0],'gantry');box('carriage','carriage',[24,20,14]);
    const solveGantryPose=at=>{const [x,y,z]=at.point,part=rigid([0,0,headZ-toolLength-z]);return {worldFromFrame:{part,tcp:rigid([x,y,headZ-toolLength]),gantry:rigid([0,y,headZ]),carriage:rigid([x,y,headZ])},margins:at.point.flatMap((v,i)=>[v-bounds.min[i],bounds.max[i]-v])};};
    return {components,frameIds:[...frames],limits,machineBoundsWorldMm:{min:[-15,-15,0],max:[w+15,d+15,headZ+25]},coordinateBounds:defaultCoordinateBounds,angularLever:toolLength,manualEnabled:true,solve:solveGantryPose,sourcePose:gantrySourcePose,probeMargins:undefined,extraStatic:{}};
  }else{
    // Room/part alignment is established by source playback. Arm installation is
    // separate; never infer a robot base from a print's bounding box.
    if(config.worldFromBase)validateRigid(config.worldFromBase);
    const dobot=machine.id==='dobot-mg400',model=dobot?dobotGeometry(config):densoGeometry(config);
    const scaledDobot=dobot&&program.language==='dobot-lua'&&(setup.dobot?.scaleX!==1||setup.dobot?.scaleY!==1);
    const aligned=config.worldFromBase&&(Number.isFinite(config.toolLengthMm)||(!dobot&&config.flangeFromTool))&&(dobot||Array.isArray(config.modelSeedDeg))&&!scaledDobot;
    limits.push(dobot?'Nominal MG400 linkage; calibrated user/tool orientation and coupled interference are unchecked.':'Nominal VS-068A4 drawing centerlines and seeded IK; model angles are not RC8 encoders or FIG.');
    const robotSourcePose=at=>{
      const center=setup.denso?.rotaryCenterMm??[0,0,0],a=at.rotaryDeg??0,R=rotation([0,0,1],a*Math.PI/180),part=rigid(sub(center,mv(R,center)),R);
      const tcp=point(part,at.point),axis=rotateZ(at.toolAxis??[0,0,-1],a),up=rotateZ(at.toolUp??[0,1,0],a);
      return {part,tcp:rigid(tcp,axisFrame(scale(axis,-1),up))};
    };
    if(aligned){
      function densoReachMargins(at){
        const local=compose(invert(config.worldFromBase),robotSourcePose(at).tcp),wrist=densoWristFromPose(model,{tcp:local.translationMm,rotation:local.rotation});
        const radial=Math.hypot(wrist[0],wrist[1]),height=wrist[2]-model.shoulderHeightMm,fore=Math.hypot(model.forearmMm,model.elbowOffsetMm);
        // The shoulder travels on a circle about J1; these are conservative
        // annulus margins across azimuths. Seeded IK resolves the actual pose.
        const nearest=Math.hypot(radial-model.shoulderOffsetMm,height),farthest=Math.hypot(radial+model.shoulderOffsetMm,height);
        return [model.upperMm+fore-nearest,farthest-Math.abs(model.upperMm-fore)];
      }
      const baseCenter=point(config.worldFromBase,dobot?model.baseOriginMm:[0,0,model.shoulderHeightMm]);
      const radius=dobot?norm(model.shoulderMm)+model.l1+model.l2+norm(model.wristMm)+model.toolLengthMm:model.shoulderOffsetMm+model.upperMm+Math.hypot(model.forearmMm,model.elbowOffsetMm)+model.flangeMm+model.toolReachMm;
      const center=setup.denso?.rotaryCenterMm??[0,0,0],radial=radius+Math.hypot(baseCenter[0]-center[0],baseCenter[1]-center[1]);
      const armCoordinateBounds={min:[center[0]-radial,center[1]-radial,baseCenter[2]-radius],max:[center[0]+radial,center[1]+radial,baseCenter[2]+radius]};
      const armAngularLever=dobot?model.toolLengthMm:model.flangeMm+model.toolReachMm;
      const lengths=dobot?[Math.abs(model.baseOriginMm[2]),norm(model.shoulderMm),norm(model.upperMm),norm(model.forearmMm),norm(model.wristMm),model.toolLengthMm]
        :[Math.hypot(model.shoulderOffsetMm,model.shoulderHeightMm),model.upperMm,Math.hypot(model.forearmMm,model.elbowOffsetMm),model.flangeMm,...model.toolVectors.map(norm)];
      lengths.forEach((length,i)=>{link('arm-'+i,length);joint('pivot-'+i);});
      box('base','structure',dobot?[100,100,20]:[160,160,20]);
      // No guessed reach cube: explicit fit uses the currently resolved assembly.
      // A calibrated installation can add a real framing envelope when needed.
      const solveAlignedArmPose=at=>{
        const pose=robotSourcePose(at),local=compose(invert(config.worldFromBase),pose.tcp),axis=mv(local.rotation,[0,0,-1]);
        const yaw=Math.atan2(local.rotation[1][0],local.rotation[0][0])*180/Math.PI;
        const result=dobot?dobotInverse(model,{tcp:local.translationMm,yawDeg:yaw,toolAxis:axis}):densoInverse(model,{tcp:local.translationMm,rotation:local.rotation},{seed:config.modelSeedDeg});
        const margins=dobot?result.margins:densoReachMargins(at);
        if(!result.valid)return {worldFromFrame:pose,margins,diagnostics:result.errors.map(message=>({code:'arm-solve',severity:'warning',message}))};
        result.points.slice(1).forEach((p,i)=>{const a=point(config.worldFromBase,result.points[i]),b=point(config.worldFromBase,p);pose['arm-'+i]=rodFrame(a,b);pose['pivot-'+i]=rigid(b);});return {worldFromFrame:pose,margins};
      };
      return {components,frameIds:[...frames],limits,machineBoundsWorldMm:null,coordinateBounds:armCoordinateBounds,angularLever:armAngularLever,manualEnabled:true,solve:solveAlignedArmPose,sourcePose:robotSourcePose,probeMargins:dobot?undefined:densoReachMargins,extraStatic:{base:config.worldFromBase}};
    }else{
      limits.push(scaledDobot?'Arm omitted: non-unit Dobot design calibration cannot be overlaid with rigid physical frames.':'Arm omitted: supply kinematicModel.worldFromBase and installed toolLengthMm (or DENSO flangeFromTool)'+(dobot?'':', plus modelSeedDeg')+'.');
      const solveUnavailableArmPose=at=>({worldFromFrame:robotSourcePose(at),diagnostics:[{code:'arm-unavailable',severity:'info',message:limits.at(-1)}]});
      return {components,frameIds:[...frames],limits,machineBoundsWorldMm:null,coordinateBounds:defaultCoordinateBounds,angularLever:toolLength,manualEnabled:false,solve:solveUnavailableArmPose,sourcePose:robotSourcePose,probeMargins:undefined,extraStatic:{}};
    }
  }
}

function machineControlLayout(machine,{manualEnabled,coordinateBounds}){
  const cartesian=isGantry(machine),dobot=machine.id==='dobot-mg400';
  const angleAxes=cartesian?[]:dobot?[2]:[0,1,2];
  const controls=manualEnabled?[...['X','Y','Z'].map((label,i)=>({label,unit:'mm',min:Math.floor(coordinateBounds.min[i]*10)/10,max:Math.ceil(coordinateBounds.max[i]*10)/10,step:.1})),
    ...angleAxes.map(i=>({label:['Rotate X','Rotate Y','Rotate Z'][i],unit:'°',min:-180,max:180,step:.1}))]:[];
  return {controls,angleAxes};
}

function controlPose({controls,angleAxes},at,manual){
  if(!controls.length)return {at,controlValues:[]};
  const R=at.rotation??axisFrame(scale(at.toolAxis??[0,0,-1],-1),at.toolUp??[0,1,0]);
  const b=Math.asin(Math.max(-1,Math.min(1,-R[2][0]))),singular=Math.abs(Math.cos(b))<1e-7;
  const a=[singular?0:Math.atan2(R[2][1],R[2][2]),b,singular?Math.atan2(-R[0][1],R[1][1]):Math.atan2(R[1][0],R[0][0])];
  if(!manual)return {at,controlValues:[...at.point,...angleAxes.map(i=>a[i]*180/Math.PI)]};
  angleAxes.forEach((axis,i)=>a[axis]=manual[i+3]*Math.PI/180);
  const r=mm(rotation([0,0,1],a[2]),mm(rotation([0,1,0],a[1]),rotation([1,0,0],a[0])));
  return {at:{...at,point:manual.slice(0,3),rotation:r,toolAxis:mv(r,[0,0,-1]),toolUp:mv(r,[0,1,0])},controlValues:[...manual]};
}

function buildMachineDescriptor(machine,config,binding,{frameIds,components,machineBoundsWorldMm,limits},{controls}){
  return {schema:'saam-machine-presentation/1',binding,label:machine.name,basis:config.basis??'Nominal design geometry; source-command motion',frameIds,components,machineBoundsWorldMm,limitations:limits,controls};
}

function sampleMachinePresentation(program,descriptor,mechanism,layout,request){
  const {binding,components,controls}=descriptor;
  const {solve,sourcePose,probeMargins,extraStatic,angularLever}=mechanism;
  if(!Number.isFinite(request.seconds)||request.seconds<0||request.seconds>durationOf(program))throw Error('Machine sample time outside source duration');
  if(request.manual!==undefined&&(!controls.length||!Array.isArray(request.manual)||request.manual.length!==controls.length||!request.manual.every(Number.isFinite)))throw Error('Invalid manual machine coordinates');
  const sourceAt=frameAtTime(program.moves,request.seconds);let {at,controlValues}=sourceAt.point?controlPose(layout,sourceAt,request.manual):{at:sourceAt,controlValues:[]};
  let result={worldFromFrame:{},diagnostics:[]};
  try{if(at.point){
    if(request.jog){
      const evaluate=(values,probe=false)=>{const posed=controlPose(layout,sourceAt,values),s=probe&&probeMargins?{margins:probeMargins(posed.at)}:solve(posed.at),f={world:rigid(),...extraStatic,...s.worldFromFrame};
        const margins=[...(s.margins??[]),...values.flatMap((v,i)=>[v-controls[i].min,controls[i].max-v])];
        return {...s,margins,valid:margins.every(v=>Number.isFinite(v)&&v>=-1e-7)&&components.every(c=>f[c.frameId])&&!s.diagnostics?.some(d=>d.severity==='warning'),controlValues:values};};
      const jog=constrainedJog({from:request.jog.from,target:request.manual,axis:request.jog.axis,scales:controls.map(c=>c.unit==='mm'?1:angularLever*Math.PI/180),evaluate});
      result=jog.result;controlValues=jog.values;
      if(jog.limited||jog.adjusted)result={...result,diagnostics:[{code:'jog-boundary',severity:'info',message:jog.limited?'Reached the modeled boundary; holding a reachable pose.':'Other coordinates adjusted to stay within the machine boundaries.'}]};
    }else result=solve(at);
  }else result.diagnostics=[{code:'no-motion',severity:'info',message:'No source pose available'}];}
  catch(error){
    // A failed solve still knows where the source put the part. Missing frames
    // are omitted, never drawn at an identity stand-in.
    let known={};try{if(at.point)known=sourcePose(at);}catch{/* no source pose either: unavailable */}
    result={worldFromFrame:known,diagnostics:[{code:'model-solve',severity:'warning',message:error.message}]};
  }
  const worldFromFrame={world:rigid(),...extraStatic,...result.worldFromFrame};
  const available=components.filter(c=>worldFromFrame[c.frameId]);
  const status=!worldFromFrame.part||!available.length?'unavailable':available.length===components.length?'ready':'partial';
  return {schema:'saam-machine-pose/1',binding,...request,status,worldFromFrame,controlValues,diagnostics:result.diagnostics??[]};
}

// A closed registry of trusted models. Profiles contain data, never loaded code.
export async function createMachinePresentation({program,machine,setup={},sourceIdentity,signal}){
  signal?.throwIfAborted();if(!isGantry(machine)&&!ARMS.has(machine.id))return null;
  const config={...machine.kinematicModel,...setup.kinematicModel};
  const binding={...sourceIdentity,modelKey:JSON.stringify([1,machine.id,machine.revision,config,setup.tool])};
  const mechanism=buildMachineMechanism({program,machine,setup,config});
  const layout=machineControlLayout(machine,mechanism);
  const descriptor=buildMachineDescriptor(machine,config,binding,mechanism,layout);
  let disposed=false;
  return {descriptor,async sample(request,{signal}={}){
    signal?.throwIfAborted();if(disposed)throw Error('Machine presentation disposed');
    return sampleMachinePresentation(program,descriptor,mechanism,layout,request);
  },dispose(){disposed=true;}};
}
