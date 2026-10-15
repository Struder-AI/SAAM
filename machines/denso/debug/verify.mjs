// A deliberately bounded PacScript interpreter. Executes the delivered source,
// including helper calls and actual T/EX/TIME/IO fields. Annotations supply only
// process intent and labels, never playback coordinates or rotary motion.

import {requireThat,distance,validateDensoConfiguration} from '../denso.mjs';
import {heldTableDeg} from '../kinematics.mjs';
import {createHash} from 'node:crypto';
// Debug-only machine verification (machine-verify): executes the written
// PacScript subset. Generation, reopen, Studio and delivery never load it;
// scripts/machine-verify.mjs runs it. Delete it after a physical trial.
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function verify(bytes,plan,machine,Export){
  const entries=Export.unpackZip(bytes);requireThat(entries.has('manifest.json'),'Missing DENSO manifest.');
  const m=JSON.parse(entries.get('manifest.json').toString('utf8'));
  requireThat(m.schema==='saam-denso-program/1'&&m.entry==='main.pcs'&&m.machineHash===digest(machine)&&m.setupHash===digest(plan.setup),'DENSO setup/machine identity differs.');
  requireThat(Array.isArray(m.sourceFiles)&&[...entries.keys()].filter(k=>k!=='manifest.json').sort().join()===m.sourceFiles.slice().sort().join(),'DENSO source inventory differs.');
  return {...interpretDensoFiles(Object.fromEntries(m.sourceFiles.map(n=>[n,entries.get(n).toString('utf8')])),plan,machine,Export.frame),limitations:m.limitations??[]};
}
function interpretDensoFiles(files,plan,machine,frame,moves=[]){
  const {rotateZ,rotatePointZ:bedPoint,interpolateDirectionPair,validateDirectionPair}=frame;
  const fromWork=(point,c)=>rotateZ(point.map((v,i)=>v-c.workOffsetMm[i]),-c.workYawDeg);
  requireThat(machine.id==='denso-vs068a4-rc8a'&&plan.output==='denso-pacscript','Incompatible DENSO output.');
  validateDensoConfiguration(plan,{required:true},validateDirectionPair);const c=plan.setup.denso;
  requireThat(files['main.pcs']&&Object.values(files).every(x=>typeof x==='string'),'Missing PacScript entry.');
  const functions=new Map(),visited=new Set();
  // Finite straight-line bodies and the active-call set establish termination.
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
      else{requireThat(body,'Statement outside Sub at '+file+':'+site.line);body.push(site);}
    }
    requireThat(!body,'Unclosed Sub in '+file);
  }
  load('main.pcs');requireThat(visited.size===Object.keys(files).length,'Unreferenced source in PacScript package.');
  let rotary=heldTableDeg(c),room=bedPoint(c.initialPositionMm,rotary,c.rotaryCenterMm),
    orientation={toolAxis:rotateZ(c.initialPose.toolAxis,rotary),toolUp:rotateZ(c.initialPose.toolUp,rotary)},
    seconds=0,relay=null,taken=false,tool=null,work=null,volume=0,estimate=0,untimedRelay=0;
  const events=[],active=new Set(),estimated=Number.isFinite(c.extrusionRateMm3S)&&c.extrusionRateMm3S>0,numberPattern='[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
  const movePattern=new RegExp('^Move L,\\s*@0 T\\(([^)]+)\\) EX\\(\\((\\d+),\\s*('+numberPattern+')\\)\\)(?:,\\s*Time\\s*=\\s*('+numberPattern+'))?$','i');
  function execute(name){
    const body=functions.get(name);requireThat(body&&!active.has(name),'Unknown/recursive PacScript call '+name);active.add(name);
    for(const site of body){
      const need=(ok,msg)=>requireThat(ok,`${site.file}:${site.line}: ${msg}`),text=site.text;
      let m;
      if((m=/^Call ([A-Za-z][A-Za-z0-9_]*)$/i.exec(text)))execute(m[1].toLowerCase());
      else if((m=/^TakeArm (\d+) Keep\s*=\s*0$/i.exec(text))){need(!taken&&Number(m[1])===c.armGroup,'Unexpected arm group.');taken=true;}
      else if((m=/^ChangeTool (\d+)$/i.exec(text))){need(taken&&Number(m[1])===c.toolFrame,'Unexpected tool frame.');tool=Number(m[1]);}
      else if((m=/^ChangeWork (\d+)$/i.exec(text))){need(taken&&Number(m[1])===c.workFrame,'Unexpected work frame.');work=Number(m[1]);}
      else if((m=/^(Set|Reset) IO\[(\d+)\]$/i.exec(text))){need(Number(m[2])===c.extrusionOutput,'Unexpected relay output.');relay=m[1].toLowerCase()==='set';events.push({kind:relay?'extrusion-on':'extrusion-off',startSeconds:seconds,file:site.file,line:site.line});}
      else if((m=new RegExp('^Delay ('+numberPattern+')$','i').exec(text))){need(relay===false&&Number(m[1])>=0,'Dwell needs relay off and nonnegative milliseconds.');const duration=Number(m[1])/1000;events.push({kind:'dwell',startSeconds:seconds,seconds:duration,file:site.file,line:site.line});seconds+=duration;}
      else if((m=movePattern.exec(text))){
        need(taken&&tool!==null&&work!==null&&relay!==null,'Motion needs explicit arm, frames and relay state.');
        const raw=m[1].split(',').map(x=>x.trim());need(raw.length===10&&raw.every(x=>new RegExp('^'+numberPattern+'$').test(x)),'T requires ten numeric components.');
        const v=raw.map(Number);need(v.every(Number.isFinite)&&v[9]===c.figure&&Number(m[2])===c.rotaryAxis,'Unexpected figure/external axis.');
        // No Time: the controller's own speed, as for a reorientation in place.
        const duration=m[4]===undefined?0:Number(m[4])/1000,nextRotary=rotary+Number(m[3])/c.rotarySign;
        if(m[4]===undefined&&relay)untimedRelay++;
        need(Number.isFinite(duration)&&(duration>0||m[4]===undefined)&&Number.isFinite(nextRotary),'Invalid requested motion time/angle.');
        const nextRoom=fromWork(v.slice(0,3),c),nextOrientation={toolUp:rotateZ(v.slice(3,6),-c.workYawDeg),toolAxis:rotateZ(v.slice(6,9),-c.workYawDeg)};
        validateDirectionPair(nextOrientation.toolAxis,nextOrientation.toolUp);
        need(site.annotation,'Missing process-intent annotation.');const label=JSON.parse(site.annotation);
        need(typeof label.phase==='string'&&Number.isFinite(label.layer)&&Number.isFinite(label.volumeMm3)&&label.volumeMm3>=0,'Invalid process-intent annotation.');
        // Subdivision follows the interpreted room trajectory and the moving
        // bed. A stationary room TCP still traces a curve on the part. The
        // commanded sweep and travel bound it; only a count the arrays cannot
        // index is refused.
        const n=Math.max(1,Math.ceil(Math.abs(nextRotary-rotary)),Math.ceil(distance(room,nextRoom)/2));
        need(Number.isSafeInteger(n),'Requested rotary sweep or travel is too large to subdivide.');
        let from=bedPoint(room,rotary,c.rotaryCenterMm,true),oldAxis=rotateZ(orientation.toolAxis,-rotary),oldUp=rotateZ(orientation.toolUp,-rotary);
        for(let i=1;i<=n;i++){
          const t=i/n,a=rotary+(nextRotary-rotary)*t,world=room.map((x,k)=>x+(nextRoom[k]-x)*t),[axisRoom,upRoom]=interpolateDirectionPair([orientation.toolAxis,orientation.toolUp],[nextOrientation.toolAxis,nextOrientation.toolUp],t),
            to=bedPoint(world,a,c.rotaryCenterMm,true),axis=rotateZ(axisRoom,-a),up=rotateZ(upRoom,-a),intent=label.volumeMm3/n,estimatePart=estimated&&m[4]!==undefined?(relay?c.extrusionRateMm3S*duration/n:0):null;
          moves.push({line:site.line,file:site.file,from,to,extruding:relay,volumeMm3:intent,commandedVolumeMm3:intent,estimatedRelayVolumeMm3:estimatePart,
            phase:label.phase,layer:label.layer,operation:label.operation??null,fan:0,speedMmS:duration>0?distance(from,to)/(duration/n):0,startSeconds:seconds+(i-1)*duration/n,durationSeconds:duration/n,
            toolAxisFrom:oldAxis,toolAxisTo:axis,toolUpFrom:oldUp,toolUpTo:up,interpolation:'nominal-cartesian-rotary'});
          from=to;oldAxis=axis;oldUp=up;if(estimatePart!==null)estimate+=estimatePart;
        }
        volume+=label.volumeMm3;seconds+=duration;room=nextRoom;orientation=nextOrientation;rotary=nextRotary;
      }else need(false,'Unsupported PacScript statement: '+text);
    }
    active.delete(name);
  }
  execute('main');
  const available=estimated&&!untimedRelay;
  const summary={moves:moves.length,extrusionMoves:moves.filter(m=>m.extruding).length,volumeMm3:volume,commandedVolumeMm3:volume,estimatedRelayVolumeMm3:available?estimate:null,relayEstimateDifferenceMm3:available?estimate-volume:null,
    materialModel:available?'relay-estimate':'relay-estimate-unavailable',filamentMm:null,motionSeconds:seconds,timing:'Written TIME at 100% external speed; controller-selected untimed duration excluded.',coordinateFrame:'part-relative deposition; rotating bed in fixed-room view'};
  return {moves,events,seconds,volumeMm3:volume,summary,language:'denso-pacscript',sources:files,finalPosition:bedPoint(room,rotary,c.rotaryCenterMm,true),
    checks:['strict-pacscript-subset','tool-work-frame-identity','relative-rotary-commands','requested-time','relay-state','commanded-volume-intent'],
    notice:'Experimental RC8A command preview. Nominal timing/rotary interpolation; reach, joint limits, collisions and physical deposition unchecked.'};
}
