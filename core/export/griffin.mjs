import {distance,requireThat} from '../private/export/numeric.mjs';
import {checkedMachinePath} from './prepare-path.mjs';

import {plannedNozzleTemperatures} from '../path/process-controls.mjs';
// One G4 carries at most this many milliseconds; it is what the firmware reads
// from a single command, not a limit on how long a path may pause.
import {DWELL_COMMAND_MS} from './griffin-player.mjs';
export {interpretGriffin,interpretMotion,interpretMotionChunk} from './griffin-player.mjs';

const fmt=(n,d=5)=>Number(n.toFixed(d)).toString();
export function exportGriffin(path,plan,machine,{generatorVersion,buildDate}) {
  path=checkedMachinePath(path,plan,machine);
  const motionLines=exportMotion(path,plan);
  requireThat(machine.outputs.some(o=>o.id===plan.output && o.flavor==='Griffin'),'Machine does not declare Griffin export.');
  const s=plan.setup, area=Math.PI*(s.filamentMm/2)**2, tool=s.tool;
  const startupZ=machine.startup.zAfterStartupMm;
  requireThat(Number.isFinite(startupZ), 'Machine startup Z is required.');
  const points=[path.initialPosition,...path.actions.filter(a=>a.kind==='move').map(a=>a.to)];
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
  const volume=path.actions.reduce((v,a)=>v+(a.volumeMm3??0),0);
  let time=0,pos=path.initialPosition;
  for(const a of path.actions) {
    if(a.kind==='move'){time+=distance(pos,a.to)/a.speedMmS;pos=a.to;}
    if(a.kind==='dwell')time+=a.seconds;
    if(a.kind==='extrude')time+=a.volumeMm3/a.flowMm3S;
    if(a.filamentMm)time+=a.filamentMm/a.speedMmS;
  }
  const envelope=machine.outputs.find(o=>o.id===plan.output).program;
  requireThat(envelope, 'Machine snapshot has no program templates; recreate this print from the current machine profile.');
  const values={...s,tool,generatorVersion,buildDate,volume:Math.ceil(volume),seconds:Math.ceil(time),startupZ:fmt(startupZ)};
  for(const [bound,points] of [['min',min],['max',max]]) for(const [i,axis] of ['X','Y','Z'].entries()) values[bound+axis]=fmt(points[i]);
  const render=lines=>{
    requireThat(Array.isArray(lines)&&lines.every(line=>typeof line==='string'&&!/[\r\n]/.test(line)), 'Invalid machine program template.');
    return lines.map(line=>line.replace(/\{([A-Za-z]+)\}/g,(_match,key)=>{
      requireThat(Object.hasOwn(values,key)&&values[key]!==undefined&&values[key]!==null&&!/[\r\n]/.test(String(values[key])), 'Unknown or invalid template value: '+key);
      return String(values[key]);
    }));
  };
  const lines=[...render(envelope.header),...render(envelope.start)];
  // Large paths exceed the engine's argument limit when spread into push().
  for(const line of motionLines)lines.push(line);
  for(const line of render(envelope.end))lines.push(line);
  return lines.join('\n')+'\n';
}

// The same volumetric SAAMpath actions and rounding rules feed every dialect.
export function exportMotion(path,plan,{extrusionMode='absolute',travelCommand='G0'}={}) {
  requireThat(['absolute','relative'].includes(extrusionMode),'Unsupported extrusion mode.');
  requireThat(['G0','G1'].includes(travelCommand),'Unsupported travel command.');
  const relativeE=extrusionMode==='relative';
  let residualE=0;
  const lines=[],area=Math.PI*(plan.setup.filamentMm/2)**2;
  let e=0,tag='',operation='',writtenE=0,writtenPosition=[...path.initialPosition];
  // This body is also embedded in machine templates. Establish XYZ and feed on
  // its first use, then rely only on modal state written by this exporter.
  const modal={};
  const field=(key,value)=>{
    // Preserve the old writer's treatment of non-decimal representations.
    // Supported machine coordinates/feed use ordinary decimal notation.
    if(!Number.isFinite(value)||Math.abs(value)>=1e21)return ` ${key}${value}`;
    if(modal[key]===value)return '';
    modal[key]=value;return ` ${key}${value}`;
  };
  const motion=(command,target,extrusion,feed)=>{
    let line=command;
    if(target)for(let i=0;i<3;i++)line+=field('XYZ'[i],target[i]);
    if(extrusion!==undefined)line+=` E${extrusion}`;
    line+=field('F',Number(feed.toFixed(3)));
    lines.push(line);
  };
  for(const a of path.actions) {
    if((a.operation??'')!==operation){operation=a.operation??'';requireThat(!/[\r\n]/.test(operation),'Invalid operation label.');lines.push(`;SAAM_OPERATION:${operation}`);}
    requireThat(!/[\r\n]/.test(a.phase),'Invalid phase label.');
    const nextTag=`${a.phase}:${a.layer}`;
    if(tag!==nextTag){lines.push(`;SAAM_PHASE:${a.phase}`,`;LAYER:${a.layer}`);tag=nextTag;}
    if(a.kind==='move') {
      // Quantize once: command text, flow calculation and following position
      // must all use these same written coordinates and extrusion value.
      const target=a.to.map(v=>Number(v.toFixed(5)));
      if(a.volumeMm3>0){
        // Relative amounts carry their rounding remainder forward, as absolute
        // E does by construction, so many equal short segments keep their total.
        // A remainder never erases a segment that is writable on its own.
        const ownMm=a.volumeMm3/area,filamentMm=ownMm+(relativeE?residualE:0);
        if(!relativeE)e+=filamentMm;
        let nextE=Number((relativeE?filamentMm:e).toFixed(5));
        if(relativeE){if(!(nextE>0))nextE=Number(ownMm.toFixed(5));residualE=filamentMm-nextE;}
        const length=distance(writtenPosition,target),de=relativeE?nextE:nextE-writtenE;
        requireThat(length>0, 'A deposition move collapsed at export precision.');
        const speed=a.speedMmS;
        const feed=Math.floor(speed*60*1000)/1000;
        requireThat(feed>0,'Deposition feed collapsed at export precision.');
        motion('G1',target,nextE,feed);
        if(!relativeE)writtenE=nextE;
      }
      else motion(travelCommand,target,undefined,a.speedMmS*60);
      writtenPosition=target;
    } else if(a.kind==='extrude') {
      const filamentMm=a.volumeMm3/area;
      if(!relativeE)e+=filamentMm;
      const nextE=Number((relativeE?filamentMm:e).toFixed(5));
      const de=relativeE?nextE:nextE-writtenE;
      requireThat(de>0,'Stationary extrusion collapsed at export precision.');
      const feed=Math.floor(a.flowMm3S/area*60*1000)/1000;
      requireThat(feed>0,'Stationary extrusion feed collapsed at export precision.');
      motion('G1',null,nextE,feed);
      if(!relativeE)writtenE=nextE;
    } else if(a.kind==='temperature') {
      requireThat(plannedNozzleTemperatures(plan).has(a.targetC),'Unplanned operation temperature.');
      lines.push(`M400`,`M109 S${fmt(a.targetC)}`);
    } else if(a.kind==='retract'||a.kind==='recover') {
      const filamentMm=(a.kind==='retract'?-1:1)*a.filamentMm;
      if(!relativeE)e+=filamentMm;
      const nextE=Number((relativeE?filamentMm:e).toFixed(5));
      motion('G1',null,nextE,a.speedMmS*60);
      if(!relativeE)writtenE=nextE;
    } else if(a.kind==='fan') lines.push(a.percent===0?'M107':`M106 S${Math.round(a.percent*255/100)}`);
    else if(a.kind==='dwell'){
      // A longer pause is the same pause in commands the firmware accepts; the
      // parts sum to the requested milliseconds, so the wait is not shortened.
      let remaining=Math.ceil(a.seconds*1000);
      do{const part=Math.min(remaining,DWELL_COMMAND_MS);lines.push(`G4 P${part}`);remaining-=part;}while(remaining>0);
    }
    else throw new Error(`Unsupported SAAMpath action: ${a.kind}`);
  }
  return lines;
}
