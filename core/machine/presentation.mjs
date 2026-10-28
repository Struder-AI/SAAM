import {rigid,mv,mm,axisFrame,rodFrame,rotation,point,invert,compose,validateRigid,scale} from '../geom/frame.mjs';
import {frameAtTime} from './path-time.mjs';
import {constrainedJog,MARGIN_ROUNDING} from './jog.mjs';
import {BUILD_SCALE_MM,PRINT_RESOLUTION_MM} from '../dimensions.mjs';

// Gantry machines are drawn from profile data alone. Any other machine is drawn
// by its extension's kinematics plug: the machine pose is inverse kinematics
// from the toolhead's position and orientation in the part frame.
const isGantry=machine=>machine.kinematics==='cartesian-fixed-vertical-nozzle';
const durationOf=p=>p.seconds??p.summary?.motionSeconds??0;
function buildMachineMechanism({machine,setup,config,kinematics}){
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
    return {components,frameIds:[...frames],limits,machineBoundsWorldMm:{min:[-15,-15,0],max:[w+15,d+15,headZ+25]},coordinateBounds:defaultCoordinateBounds,angularLever:toolLength,manualEnabled:true,angleAxes:[],solve:solveGantryPose,sourcePose:gantrySourcePose,probeMargins:undefined,extraStatic:{}};
  }
  // Room/part alignment is established by source playback. Arm installation is
  // separate; never infer a robot base from a print's bounding box.
  if(config.worldFromBase)validateRigid(config.worldFromBase);
  const {limitations,partFrame,arm}=kinematics.view({machine,setup,config});
  limits.push(...limitations);
  const sourcePose=at=>{
    const part=partFrame(at);
    return {part,tcp:compose(part,rigid(at.point,axisFrame(scale(at.toolAxis??[0,0,-1],-1),at.toolUp??[0,1,0])))};
  };
  if(!arm){
    const solveUnavailableArmPose=at=>({worldFromFrame:sourcePose(at),diagnostics:[{code:'arm-unavailable',severity:'info',message:limits.at(-1)}]});
    return {components,frameIds:[...frames],limits,machineBoundsWorldMm:null,coordinateBounds:defaultCoordinateBounds,angularLever:toolLength,manualEnabled:false,angleAxes:[],solve:solveUnavailableArmPose,sourcePose,probeMargins:undefined,extraStatic:{}};
  }
  const local=at=>compose(invert(arm.worldFromBase),sourcePose(at).tcp);
  arm.linkLengthsMm.forEach((length,i)=>{link('arm-'+i,length);joint('pivot-'+i);});
  box('base','structure',arm.baseSizeMm);
  // No guessed reach cube: explicit fit uses the currently resolved assembly.
  // A calibrated installation can add a real framing envelope when needed.
  const solveArmPose=at=>{
    const pose=sourcePose(at),result=arm.inverse(compose(invert(arm.worldFromBase),pose.tcp));
    if(!result.valid)return {worldFromFrame:pose,margins:result.margins,diagnostics:result.errors.map(message=>({code:'arm-solve',severity:'warning',message}))};
    result.points.slice(1).forEach((p,i)=>{const a=point(arm.worldFromBase,result.points[i]),b=point(arm.worldFromBase,p);pose['arm-'+i]=rodFrame(a,b);pose['pivot-'+i]=rigid(b);});
    return {worldFromFrame:pose,margins:result.margins};
  };
  return {components,frameIds:[...frames],limits,machineBoundsWorldMm:null,coordinateBounds:arm.coordinateBounds,angularLever:arm.angularLeverMm,manualEnabled:true,angleAxes:arm.rotationControls,
    solve:solveArmPose,sourcePose,probeMargins:arm.reachMargins?at=>arm.reachMargins(local(at)):undefined,extraStatic:{base:arm.worldFromBase}};
}

function machineControlLayout({manualEnabled,coordinateBounds,angleAxes}){
  const controls=manualEnabled?[...['X','Y','Z'].map((label,i)=>({label,unit:'mm',min:Math.floor(coordinateBounds.min[i]*10)/10,max:Math.ceil(coordinateBounds.max[i]*10)/10,step:.1})),
    ...angleAxes.map(i=>({label:['Rotate X','Rotate Y','Rotate Z'][i],unit:'°',min:-180,max:180,step:.1}))]:[];
  return {controls,angleAxes};
}

// Gimbal lock, a shape judgement: within a turn that moves a point at build scale by
// less than print resolution (as core/path/pose.mjs), the outer angles merge.
const GIMBAL_LOCK=PRINT_RESOLUTION_MM/BUILD_SCALE_MM;
function controlPose({controls,angleAxes},at,manual){
  if(!controls.length)return {at,controlValues:[]};
  const R=at.rotation??axisFrame(scale(at.toolAxis??[0,0,-1],-1),at.toolUp??[0,1,0]);
  const b=Math.asin(Math.max(-1,Math.min(1,-R[2][0]))),singular=Math.abs(Math.cos(b))<GIMBAL_LOCK;
  const a=[singular?0:Math.atan2(R[2][1],R[2][2]),b,singular?Math.atan2(-R[0][1],R[1][1]):Math.atan2(R[1][0],R[0][0])];
  if(!manual)return {at,controlValues:[...at.point,...angleAxes.map(i=>a[i]*180/Math.PI)]};
  angleAxes.forEach((axis,i)=>a[axis]=manual[i+3]*Math.PI/180);
  const r=mm(rotation([0,0,1],a[2]),mm(rotation([0,1,0],a[1]),rotation([1,0,0],a[0])));
  return {at:{...at,point:manual.slice(0,3),rotation:r,toolAxis:mv(r,[0,0,-1]),toolUp:mv(r,[0,1,0])},controlValues:[...manual]};
}

function buildMachineDescriptor(machine,config,binding,{frameIds,components,machineBoundsWorldMm,limits},{controls}){
  return {schema:'saam-machine-presentation/1',binding,label:machine.name,basis:config.basis??'Nominal design geometry; source-command motion',frameIds,components,machineBoundsWorldMm,limitations:limits,controls};
}

function sampleMachinePresentation(program,descriptor,mechanism,layout,request,orientation){
  const {binding,components,controls}=descriptor;
  const {solve,sourcePose,probeMargins,extraStatic,angularLever}=mechanism;
  if(!Number.isFinite(request.seconds)||request.seconds<0||request.seconds>durationOf(program))throw Error('Machine sample time outside source duration');
  if(request.manual!==undefined&&(!controls.length||!Array.isArray(request.manual)||request.manual.length!==controls.length||!request.manual.every(Number.isFinite)))throw Error('Invalid manual machine coordinates');
  const sourceAt=frameAtTime(program.moves,request.seconds);
  if(orientation&&sourceAt.point)Object.assign(sourceAt,orientation.at(Math.max(0,sourceAt.active),sourceAt.fraction));
  let {at,controlValues}=sourceAt.point?controlPose(layout,sourceAt,request.manual):{at:sourceAt,controlValues:[]};
  let result={worldFromFrame:{},diagnostics:[]};
  try{if(at.point){
    if(request.jog){
      const evaluate=(values,probe=false)=>{const posed=controlPose(layout,sourceAt,values),s=probe&&probeMargins?{margins:probeMargins(posed.at)}:solve(posed.at),f={world:rigid(),...extraStatic,...s.worldFromFrame};
        const margins=[...(s.margins??[]),...values.flatMap((v,i)=>[v-controls[i].min,controls[i].max-v])];
        return {...s,margins,valid:margins.every(v=>Number.isFinite(v)&&v>=-MARGIN_ROUNDING)&&components.every(c=>f[c.frameId])&&!s.diagnostics?.some(d=>d.severity==='warning'),controlValues:values};};
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

// A gantry, or a machine whose extension supplies a kinematics plug
// (createKinematics(Kinematics) from its machine-kinematics entry).
export async function createMachinePresentation({program,machine,setup={},kinematics=null,sourceIdentity,signal}){
  signal?.throwIfAborted();if(!isGantry(machine)&&!kinematics)return null;
  const config={...machine.kinematicModel,...setup.kinematicModel};
  const binding={...sourceIdentity,modelKey:JSON.stringify([2,machine.id,machine.revision,config,setup])};
  const mechanism=buildMachineMechanism({machine,setup,config,kinematics});
  const layout=machineControlLayout(mechanism);
  const descriptor=buildMachineDescriptor(machine,config,binding,mechanism,layout);
  const orientation=kinematics?.programOrientation?.({program,setup});
  let disposed=false;
  return {descriptor,async sample(request,{signal}={}){
    signal?.throwIfAborted();if(disposed)throw Error('Machine presentation disposed');
    return sampleMachinePresentation(program,descriptor,mechanism,layout,request,orientation);
  },dispose(){disposed=true;}};
}
