import {PROGRAM_DECIMALS} from '../dimensions.mjs';
import {distance,requireThat} from '../private/export/numeric.mjs';
import {knownSeconds} from '../path/saampath.mjs';

// One G4 carries at most this many milliseconds; it is what the firmware reads
// from a single command, not a limit on how long a path may pause.
const DWELL_COMMAND_MS=60000;
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
export function gcodeMotion(path,plan,{extrusionMode='absolute',travelCommand='G0'}={}) {
  requireThat(['absolute','relative'].includes(extrusionMode),'Unsupported extrusion mode.');
  requireThat(['G0','G1'].includes(travelCommand),'Unsupported travel command.');
  const relativeE=extrusionMode==='relative';
  let residualE=0;
  const lines=[],area=Math.PI*(plan.setup.filamentMm/2)**2,tally={seconds:0,untimedMoves:0,volumeMm3:0,strokes:[],layers:new Set()};
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
  // Writes one G0/G1 and returns its written feed in mm/s; a feed that is not
  // positive leaves the move out of the time estimate.
  const motion=(command,target,extrusion,feed)=>{
    let line=command;
    if(target)for(let i=0;i<3;i++)line+=field('XYZ'[i],target[i]);
    if(extrusion!==undefined)line+=` E${extrusion}`;
    const written=Number(feed.toFixed(3));
    line+=field('F',written);
    lines.push(line);
    return written/60;
  };
  // Written feed in mm/min, rounded down; an authored speed passes through and a
  // positive one below that precision is the smallest positive feed.
  const feedOf=mmS=>{const steps=Math.floor(mmS*60*1000);return (mmS>0?Math.max(steps,1):steps)/1000;};
  const timed=(lengthMm,speedMmS)=>{if(!(speedMmS>0))tally.untimedMoves++;return knownSeconds(lengthMm,speedMmS);};
  const deposit=(a,from,to,amount,seconds)=>{
    tally.volumeMm3+=amount*area;tally.seconds+=seconds;
    tally.strokes.push([from,to]);tally.layers.add(`${a.phase}:${a.layer}`);
  };
  for(const a of path.actions) {
    // Labels are comments: a line break in one is written as a space.
    if((a.operation??'')!==operation){operation=a.operation??'';lines.push(`;SAAM_OPERATION:${comment(operation)}`);}
    const nextTag=`${a.phase}:${a.layer}`;
    if(tag!==nextTag){lines.push(`;SAAM_PHASE:${comment(a.phase)}`,`;LAYER:${a.layer}`);tag=nextTag;}
    if(a.kind==='move') {
      // Quantize once: command text, flow calculation and following position
      // must all use these same written coordinates and extrusion value.
      const target=a.to.map(v=>Number(v.toFixed(PROGRAM_DECIMALS)));
      if(a.volumeMm3>0){
        // Relative amounts carry their rounding remainder forward, as absolute
        // E does by construction, so many equal short segments keep their total.
        // A remainder never erases a segment that is writable on its own.
        const ownMm=a.volumeMm3/area,filamentMm=ownMm+(relativeE?residualE:0),length=distance(writtenPosition,target);
        if(!relativeE)e+=filamentMm;
        if(!(length>0)){if(relativeE)residualE=filamentMm;continue;}
        let nextE=Number((relativeE?filamentMm:e).toFixed(PROGRAM_DECIMALS));
        if(relativeE){if(!(nextE>0))nextE=Number(ownMm.toFixed(PROGRAM_DECIMALS));residualE=filamentMm-nextE;}
        const de=relativeE?nextE:nextE-writtenE;
        deposit(a,writtenPosition,target,de,timed(length,motion('G1',target,nextE,feedOf(a.speedMmS))));
        if(!relativeE)writtenE=nextE;
      }
      else tally.seconds+=timed(distance(writtenPosition,target),motion(travelCommand,target,undefined,a.speedMmS*60));
      writtenPosition=target;
    } else if(a.kind==='extrude') {
      const filamentMm=a.volumeMm3/area;
      if(!relativeE)e+=filamentMm;
      const nextE=Number((relativeE?filamentMm:e).toFixed(PROGRAM_DECIMALS));
      const de=relativeE?nextE:nextE-writtenE;
      if(!(de>0)){if(relativeE)residualE+=filamentMm;continue;}
      deposit(a,writtenPosition,writtenPosition,de,de/motion('G1',null,nextE,feedOf(a.flowMm3S/area)));
      if(!relativeE)writtenE=nextE;
    } else if(a.kind==='temperature') {
      lines.push(`M400`,`M109 S${fmt(a.targetC)}`);
    } else if(a.kind==='retract'||a.kind==='recover') {
      const filamentMm=(a.kind==='retract'?-1:1)*a.filamentMm;
      if(!relativeE)e+=filamentMm;
      const nextE=Number((relativeE?filamentMm:e).toFixed(PROGRAM_DECIMALS));
      tally.seconds+=timed(Math.abs(relativeE?nextE:nextE-writtenE),motion('G1',null,nextE,a.speedMmS*60));
      if(!relativeE)writtenE=nextE;
    } else if(a.kind==='fan') lines.push(a.percent===0?'M107':`M106 S${Math.round(a.percent*255/100)}`);
    else if(a.kind==='dwell'){
      // A longer pause is the same pause in commands the firmware accepts; the
      // parts sum to the requested milliseconds, so the wait is not shortened.
      let remaining=Math.ceil(a.seconds*1000);
      do{const part=Math.min(remaining,DWELL_COMMAND_MS);lines.push(`G4 P${part}`);tally.seconds+=part/1000;remaining-=part;}while(remaining>0);
    }
    else throw new Error(`Unsupported SAAMpath action: ${a.kind}`);
  }
  return {lines,tally};
}
