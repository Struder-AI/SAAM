// A deliberately bounded PacScript interpreter. Executes the delivered source,
// including helper calls and actual T/EX/TIME/IO fields. Annotations supply only
// process intent and labels, never playback coordinates or rotary motion.
import {requireThat,distance} from '../geom/tolerance.mjs';
import {validateDensoConfiguration} from '../machine/denso.mjs';
import {rotateZ,bedPoint,validatePose,interpolateDirections} from '../path/pose.mjs';
export const DENSO_LIMITATIONS=[
  'RC8 is confirmed; mounting, calibration and rotary installation are stated setup assumptions, not measured facts.',
  'Cartesian linear T poses, @0 endpoints, relative EX and TIME are interpreted. IK, reach, singularities, joint and motion limits and collisions are deferred to commissioning/controller behavior.',
  'Playback assumes synchronized linear progress of Cartesian and rotary commands at external speed 100%. Actual acceleration, external-axis interpolation, override, endpoint stops, IO latency and controller acceptance remain unverified.',
  'Relay volume is an estimate from requested duration and configured rate, not measured or metered extrusion. Continuous path geometry does not establish smooth deposition with @0 endpoint commands.',
  'External positioning at the declared start, calibrated tool/work definitions, rotary zero and external heating are prerequisites. No heating, homing or startup positioning is inserted.',
  'Delivery is a source ZIP for a WINCAPS III project. RC8 compilation/import and physical execution have not been validated.'
];
export const toWork=(point,c)=>rotateZ(point,c.workYawDeg).map((v,i)=>v+c.workOffsetMm[i]);
export const fromWork=(point,c)=>rotateZ(point.map((v,i)=>v-c.workOffsetMm[i]),-c.workYawDeg);
export function interpretDensoFiles(files,plan,machine,{moves=[]}={}){
  requireThat(machine.id==='denso-vp6242-rc8'&&plan.output==='denso-pacscript','Incompatible DENSO output.');
  validateDensoConfiguration(plan,{required:true});const c=plan.setup.denso;
  requireThat(files['main.pcs']&&Object.values(files).every(x=>typeof x==='string'),'Missing PacScript entry.');
  const functions=new Map(),visited=new Set();
  // The only effects a reader can observe are emitted moves and process events.
  // A delivered program is straight-line, so between two of them it cannot run
  // more statements than the package contains; a source that keeps calling
  // without emitting anything is what this counts, not program size.
  let statements=0;
  function load(file){
    requireThat(/^[a-z0-9_]+\.pcs$/.test(file)&&files[file],'Missing/invalid PacScript helper '+file);
    requireThat(!visited.has(file),'Duplicate or cyclic PacScript include.');visited.add(file);
    let body=null;
    for(const [index,line] of files[file].split(/\r?\n/).entries()){
      const text=line.split("'")[0].trim();if(!text)continue;
      const site={file,line:index+1,text,annotation:line.includes("' SAAM ")?line.slice(line.indexOf("' SAAM ")+7):null};
      let m;
      if((m=/^#include "([a-z0-9_]+\.pcs)"$/i.exec(text))){requireThat(!body,'Include inside Sub.');load(m[1]);}
      else if((m=/^Sub ([A-Za-z][A-Za-z0-9_]*)$/i.exec(text))){requireThat(!body&&!functions.has(m[1].toLowerCase()),'Duplicate/nested Sub.');body=[];functions.set(m[1].toLowerCase(),body);}
      else if(/^End Sub$/i.test(text)){requireThat(body,'Unexpected End Sub.');body=null;}
      else{requireThat(body,'Statement outside Sub at '+file+':'+site.line);body.push(site);statements++;}
    }
    requireThat(!body,'Unclosed Sub in '+file);
  }
  load('main.pcs');requireThat(visited.size===Object.keys(files).length,'Unreferenced source in PacScript package.');
  let rotary=c.initialPose.rotaryDeg,room=bedPoint(c.initialPositionMm,rotary,c.rotaryCenterMm),
    orientation={toolAxis:rotateZ(c.initialPose.toolAxis,rotary),toolUp:rotateZ(c.initialPose.toolUp,rotary)},
    seconds=0,relay=null,taken=false,tool=null,work=null,volume=0,estimate=0,steps=0;
  const events=[],active=new Set(),numberPattern='[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
  const movePattern=new RegExp('^Move L,\\s*@0 T\\(([^)]+)\\) EX\\(\\((\\d+),\\s*('+numberPattern+')\\)\\),\\s*Time\\s*=\\s*('+numberPattern+')$','i');
  function execute(name){
    const body=functions.get(name);requireThat(body&&!active.has(name),'Unknown/recursive PacScript call '+name);active.add(name);
    for(const site of body){
      const need=(ok,msg)=>requireThat(ok,`${site.file}:${site.line}: ${msg}`),text=site.text;
      need(++steps<=statements,'PacScript runs on without emitting motion or a process event; no straight-line program of this size can execute this long.');let m;
      if((m=/^Call ([A-Za-z][A-Za-z0-9_]*)$/i.exec(text)))execute(m[1].toLowerCase());
      else if((m=/^TakeArm (\d+) Keep\s*=\s*0$/i.exec(text))){need(!taken&&Number(m[1])===c.armGroup,'Unexpected arm group.');taken=true;}
      else if((m=/^ChangeTool (\d+)$/i.exec(text))){need(taken&&Number(m[1])===c.toolFrame,'Unexpected tool frame.');tool=Number(m[1]);}
      else if((m=/^ChangeWork (\d+)$/i.exec(text))){need(taken&&Number(m[1])===c.workFrame,'Unexpected work frame.');work=Number(m[1]);}
      else if((m=/^(Set|Reset) IO\[(\d+)\]$/i.exec(text))){need(Number(m[2])===c.extrusionOutput,'Unexpected relay output.');relay=m[1].toLowerCase()==='set';events.push({kind:relay?'extrusion-on':'extrusion-off',startSeconds:seconds,file:site.file,line:site.line});steps=0;}
      else if((m=new RegExp('^Delay ('+numberPattern+')$','i').exec(text))){need(relay===false&&Number(m[1])>=0,'Dwell needs relay off and nonnegative milliseconds.');const duration=Number(m[1])/1000;events.push({kind:'dwell',startSeconds:seconds,seconds:duration,file:site.file,line:site.line});seconds+=duration;steps=0;}
      else if((m=movePattern.exec(text))){
        need(taken&&tool!==null&&work!==null&&relay!==null,'Motion needs explicit arm, frames and relay state.');
        const raw=m[1].split(',').map(x=>x.trim());need(raw.length===10&&raw.every(x=>new RegExp('^'+numberPattern+'$').test(x)),'T requires ten numeric components.');
        const v=raw.map(Number);need(v.every(Number.isFinite)&&v[9]===c.figure&&Number(m[2])===c.rotaryAxis,'Unexpected figure/external axis.');
        const duration=Number(m[4])/1000,nextRotary=rotary+Number(m[3])/c.rotarySign;
        need(Number.isFinite(duration)&&duration>0&&Number.isFinite(nextRotary),'Invalid requested motion time/angle.');
        const nextRoom=fromWork(v.slice(0,3),c),nextOrientation={toolUp:rotateZ(v.slice(3,6),-c.workYawDeg),toolAxis:rotateZ(v.slice(6,9),-c.workYawDeg)};
        validatePose({...nextOrientation,rotaryDeg:nextRotary});
        need(site.annotation,'Missing process-intent annotation.');const label=JSON.parse(site.annotation);
        need(typeof label.phase==='string'&&Number.isFinite(label.layer)&&Number.isFinite(label.volumeMm3)&&label.volumeMm3>=0&&relay===(label.volumeMm3>0),'Relay differs from deposition intent.');
        // Subdivision follows the interpreted room trajectory and the moving
        // bed. A stationary room TCP still traces a curve on the part. The
        // commanded sweep and travel bound it; only a count the arrays cannot
        // index is refused.
        const n=Math.max(1,Math.ceil(Math.abs(nextRotary-rotary)),Math.ceil(distance(room,nextRoom)/2));
        need(Number.isSafeInteger(n),'Requested rotary sweep or travel is too large to subdivide.');
        let from=bedPoint(room,rotary,c.rotaryCenterMm,true),oldAngle=rotary,oldAxis=rotateZ(orientation.toolAxis,-rotary),oldUp=rotateZ(orientation.toolUp,-rotary);
        for(let i=1;i<=n;i++){
          const t=i/n,a=rotary+(nextRotary-rotary)*t,world=room.map((x,k)=>x+(nextRoom[k]-x)*t),dirs=interpolateDirections(orientation,nextOrientation,t),
            to=bedPoint(world,a,c.rotaryCenterMm,true),axis=rotateZ(dirs.toolAxis,-a),up=rotateZ(dirs.toolUp,-a),intent=label.volumeMm3/n,estimated=relay?c.extrusionRateMm3S*duration/n:0;
          moves.push({line:site.line,file:site.file,from,to,extruding:relay,volumeMm3:intent,commandedVolumeMm3:intent,estimatedRelayVolumeMm3:estimated,
            phase:label.phase,layer:label.layer,operation:label.operation??null,fan:0,speedMmS:distance(from,to)/(duration/n),startSeconds:seconds+(i-1)*duration/n,durationSeconds:duration/n,
            rotaryFromDeg:oldAngle,rotaryToDeg:a,toolAxisFrom:oldAxis,toolAxisTo:axis,toolUpFrom:oldUp,toolUpTo:up,rotaryCenterMm:c.rotaryCenterMm,interpolation:'nominal-cartesian-rotary'});
          from=to;oldAngle=a;oldAxis=axis;oldUp=up;estimate+=estimated;
        }
        volume+=label.volumeMm3;seconds+=duration;room=nextRoom;orientation=nextOrientation;rotary=nextRotary;steps=0;
      }else need(false,'Unsupported PacScript statement: '+text);
    }
    active.delete(name);
  }
  execute('main');requireThat(relay===false&&moves.some(m=>m.extruding),'Program must deposit and finish with relay off.');
  const summary={moves:moves.length,extrusionMoves:moves.filter(m=>m.extruding).length,volumeMm3:volume,commandedVolumeMm3:volume,estimatedRelayVolumeMm3:estimate,relayEstimateDifferenceMm3:estimate-volume,
    materialModel:'relay-estimate',filamentMm:null,motionSeconds:seconds,timing:'Requested TIME at 100% external speed; nominal synchronized progress only.',coordinateFrame:'part-relative deposition; rotating bed in fixed-room view'};
  return {moves,events,seconds,volumeMm3:volume,summary,language:'denso-pacscript',sources:files,finalPosition:bedPoint(room,rotary,c.rotaryCenterMm,true),
    checks:['strict-pacscript-subset','tool-work-frame-identity','relative-rotary-commands','requested-time','relay-state','commanded-volume-intent'],limitations:DENSO_LIMITATIONS,
    notice:'Experimental RC8 command preview. Nominal timing/rotary interpolation; reach, joint limits, collisions and physical deposition unchecked.'};
}
