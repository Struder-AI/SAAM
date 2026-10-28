import {PROGRAM_DECIMALS,XYZ_PROGRAM_DECIMALS} from '../dimensions.mjs';
import {distance,requireThat} from '../private/export/numeric.mjs';
import {knownSeconds} from '../path/saampath.mjs';
import {POSE_RESOLUTION} from '../path/pose.mjs';

// One G4 carries at most this many milliseconds; it is what the firmware reads
// from a single command, not a limit on how long a path may pause.
const DWELL_COMMAND_MS=60000;
// Feed commands keep two fewer decimals than fine internal program quantities.
const FEED_DECIMALS=Math.max(0,PROGRAM_DECIMALS-2),FEED_SCALE=10**FEED_DECIMALS;
const fmt=n=>Number(n.toFixed(PROGRAM_DECIMALS)).toString();
const comment=text=>String(text).replace(/[\r\n]+/g,' ');

// The G-code motion writer most printers share: prepared SAAMpath actions to
// command lines, plus the totals of exactly what was written (written
// coordinates, amounts and feeds), so no adapter re-reads its own program.
// tally: seconds, volumeMm3, strokes ([from,to] of each deposition, written
// coordinates) and layers (deposited `phase:layer` keys in first-use order).
// A deposition or extrusion that collapses at program precision is not written;
// its material carries to the next written amount (absolute E by construction,
// relative E in its residual), so written position and totals stay exact.
export function gcodeStream(path,plan,{extrusionMode='absolute',travelCommand='G0',collectStrokes=false,onStroke}={}) {
  const area=Math.PI*(plan.setup.filamentMm/2)**2;
  const tally={seconds:0,untimedMoves:0,volumeMm3:0,collapsedDepositMoves:0,terminalUnwrittenVolumeMm3:0,filamentStepVolumeMm3:area*10**-PROGRAM_DECIMALS,strokes:[],layers:new Set()};
  function* generate(){
  requireThat(['absolute','relative'].includes(extrusionMode),'Unsupported extrusion mode.');
  requireThat(['G0','G1'].includes(travelCommand),'Unsupported travel command.');
  const relativeE=extrusionMode==='relative';
  let residualE=0;
  const lines=[];
  function* flush(){for(const line of lines)yield line;lines.length=0;}
  let tag='',operation='',writtenE=0,writtenPosition=path.initialPosition.map(value=>Number(value.toFixed(XYZ_PROGRAM_DECIMALS)));
  tally.boundsMm={min:[...writtenPosition],max:[...writtenPosition]};
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
  // Writes one G0/G1 and returns its written feed in mm/s; a feed that is not
  // positive leaves the move out of the time estimate.
  const motion=(command,target,extrusion,feed)=>{
    let line=command;
    if(target)for(let k=0;k<3;k++){tally.boundsMm.min[k]=Math.min(tally.boundsMm.min[k],target[k]);tally.boundsMm.max[k]=Math.max(tally.boundsMm.max[k],target[k]);}
    if(target)for(let i=0;i<3;i++)line+=field('XYZ'[i],target[i]);
    if(extrusion!==undefined)line+=` E${extrusion}`;
    const written=Number(feed.toFixed(FEED_DECIMALS));
    line+=field('F',written);
    lines.push(line);
    return written/60;
  };
  // Written feed in mm/min, rounded down; an authored speed passes through and a
  // positive one below that precision is the smallest positive feed.
  const feedOf=mmS=>{const steps=Math.floor(mmS*60*FEED_SCALE);return (mmS>0?Math.max(steps,1):steps)/FEED_SCALE;};
  const timed=(lengthMm,speedMmS)=>{if(!(speedMmS>0))tally.untimedMoves++;return knownSeconds(lengthMm,speedMmS);};
  const deposit=(a,from,to,amount,seconds)=>{
    tally.volumeMm3+=amount*area;tally.seconds+=seconds;
    tally.terminalUnwrittenVolumeMm3=Math.max(0,tally.terminalUnwrittenVolumeMm3-amount*area);
    if(collectStrokes)tally.strokes.push([from,to]);onStroke?.(from,to);tally.layers.add(`${a.phase}:${a.layer}`);
  };
  for(const a of path.actions) {
    yield* flush();
    requireThat(!a.stationaryRange||!a.pose||a.pose.toolAxis.every((value,i)=>Math.abs(value-[0,0,-1][i])<=POSE_RESOLUTION),
      'G-code output does not support stationary tool-axis orientation.');
    // Labels are comments: a line break in one is written as a space.
    if((a.operation??'')!==operation){operation=a.operation??'';lines.push(`;SAAM_OPERATION:${comment(operation)}`);}
    const nextTag=`${a.phase}:${a.layer}`;
    if(tag!==nextTag){lines.push(`;SAAM_PHASE:${comment(a.phase)}`,`;LAYER:${a.layer}`);tag=nextTag;}
    if(a.kind==='move') {
      // Quantize once: command text, flow calculation and following position
      // must all use these same written coordinates and extrusion value.
      const target=a.to.map(v=>Number(v.toFixed(XYZ_PROGRAM_DECIMALS)));
      if(a.volumeMm3>0){
        // Relative amounts carry their rounding remainder forward, as absolute
        // E does by construction, so many equal short segments keep their total.
        // A remainder never erases a segment that is writable on its own.
        const ownMm=a.volumeMm3/area,filamentMm=ownMm+residualE,length=distance(writtenPosition,target);
        if(!(length>0)){tally.collapsedDepositMoves++;tally.terminalUnwrittenVolumeMm3+=a.volumeMm3;residualE=filamentMm;continue;}
        let nextE=Number((relativeE?filamentMm:writtenE+filamentMm).toFixed(PROGRAM_DECIMALS));
        if(relativeE&&!(nextE>0))nextE=Number(ownMm.toFixed(PROGRAM_DECIMALS));
        const de=relativeE?nextE:nextE-writtenE;
        residualE=filamentMm-de;
        deposit(a,writtenPosition,target,de,timed(length,motion('G1',target,nextE,feedOf(a.speedMmS))));
        if(!relativeE)writtenE=nextE;
      }
      else {
        const length=distance(writtenPosition,target);
        if(!(length>0))continue;
        tally.seconds+=timed(length,motion(travelCommand,target,undefined,a.speedMmS*60));
      }
      writtenPosition=target;
    } else if(a.kind==='extrude') {
      requireThat(!a.poseFrom||!a.pose||a.pose.toolAxis.every((value,i)=>Math.abs(value-a.poseFrom.toolAxis[i])<=POSE_RESOLUTION),
        'G-code output does not support simultaneous stationary orientation and metered extrusion.');
      const filamentMm=a.volumeMm3/area+residualE;
      const nextE=Number((relativeE?filamentMm:writtenE+filamentMm).toFixed(PROGRAM_DECIMALS));
      const de=relativeE?nextE:nextE-writtenE;
      if(!(de>0)){residualE=filamentMm;continue;}
      residualE=filamentMm-de;
      deposit(a,writtenPosition,writtenPosition,de,de/motion('G1',null,nextE,feedOf(a.flowMm3S/area)));
      if(!relativeE)writtenE=nextE;
    } else if(a.kind==='temperature') {
      lines.push(`M400`,`M109 S${fmt(a.targetC)}`);
    } else if(a.kind==='retract'||a.kind==='recover') {
      const filamentMm=(a.kind==='retract'?-1:1)*a.filamentMm;
      const nextE=Number((relativeE?filamentMm:writtenE+filamentMm).toFixed(PROGRAM_DECIMALS));
      tally.seconds+=timed(Math.abs(relativeE?nextE:nextE-writtenE),motion('G1',null,nextE,a.speedMmS*60));
      if(!relativeE)writtenE=nextE;
    } else if(a.kind==='fan') lines.push(a.percent===0?'M107':`M106 S${Math.round(a.percent*255/100)}`);
    else if(a.kind==='dwell'){
      // A longer pause is the same pause in commands the firmware accepts; the
      // parts sum to the requested milliseconds, so the wait is not shortened.
      let remaining=Math.ceil(a.seconds*1000);
      do{const part=Math.min(remaining,DWELL_COMMAND_MS);lines.push(`G4 P${part}`);tally.seconds+=part/1000;remaining-=part;yield* flush();}while(remaining>0);
    }
    else throw new Error(`Unsupported SAAMpath action: ${a.kind}`);
  }
  yield* flush();
  }
  return {lines:generate(),tally};
}

// Materialization remains for existing source/extension callers. The machine
// artifact path consumes the same command producer directly.
export function gcodeMotion(path,plan,options={}){
  const written=gcodeStream(path,plan,{...options,collectStrokes:true});
  return {lines:[...written.lines],tally:written.tally};
}
