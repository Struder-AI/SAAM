import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
// A travel shorter than this many line widths (process scale) between strokes
// is a bad path: producers connect nearby strokes by deposition.
const SHORT_TRAVEL_LINE_WIDTHS=5;

// Advisory only, over the prepared path Studio draws (the exact motion sent to
// the program writer). Moves are {from,to,extruding,operation,phase,layer,action}.
// A travel is a maximal run without deposition; lifts/detours and robot samples
// belong to that run, not separate reports. Process-only events do not split it.
// Required transitions are counted as travels but never flagged: the approach
// before the first deposition, the departure after the last, and a change of
// labelled deposition layer, where a nearby start is the intended path.
// A segment within print resolution inside a stroke is not a travel and is not
// counted as one.
export function shortTravelAdvisory(moves,lineWidthMm) {
  const thresholdMm=SHORT_TRAVEL_LINE_WIDTHS*lineWidthMm,samples=[],operations=new Map();
  let first,last,previous,next,count=0,liftedCount=0,travelCount=0,minimumDistanceMm=null,peakZ=-Infinity,routeMm=0;
  const context=move=>move?{action:move.action??null,
    operation:move.operation||null,phase:move.phase??null,layer:move.layer??null}:null;
  const known=value=>value!==undefined&&value!==null;
  function finish() {
    if(!first)return;
    if(routeMm<=PRINT_RESOLUTION_MM&&previous&&next){first=last=null;return;}
    travelCount++;
    const distanceMm=Math.hypot(...last.to.map((v,i)=>v-first.from[i]));
    const required=!previous||!next||(known(previous.layer)&&known(next.layer)&&previous.layer!==next.layer);
    if(distanceMm<=thresholdMm&&!required){
      count++;minimumDistanceMm=Math.min(minimumDistanceMm??Infinity,distanceMm);
      // A lift above both endpoints means the producer found the direct line
      // blocked, such as a gap between neighboring islands.
      const lifted=peakZ>Math.max(first.from[2],last.to[2])+PRINT_RESOLUTION_MM;
      if(lifted)liftedCount++;
      for(const operation of new Set([previous?.operation,first.operation,last.operation,next?.operation].filter(Boolean)))
        operations.set(operation,(operations.get(operation)??0)+1);
      if(samples.length<20)samples.push({distanceMm,lifted,from:[...first.from],to:[...last.to],
        start:context(first),end:context(last),before:context(previous),after:context(next)});
    }
    first=last=null;
  }
  for(const move of moves){
    if(move.extruding){next=move;finish();previous=move;}
    else {if(!first){first=move;peakZ=move.from[2];routeMm=0;}last=move;peakZ=Math.max(peakZ,move.to[2]);routeMm+=Math.hypot(...move.to.map((v,i)=>v-move.from[i]));}
  }
  next=null;finish();
  return {code:'short-travel',severity:'advisory',thresholdMm,travelCount,count,liftedCount,minimumDistanceMm,
    operations:[...operations].map(([operation,count])=>({operation,count})),samples,
    omittedSamples:count-samples.length,
    message:count?`Bad path: ${count} of ${travelCount} travels start and end within ${thresholdMm} mm on one layer (${liftedCount} lifted over a blocked line, ${count-liftedCount} moved directly). Tell the person, naming the affected operations, and retain this evidence for improving the generating skills/functions. This advisory does not block review or delivery and does not request automatic repair.`:null};
}

// The prepared path as moves; a stationary extrusion is a stroke of zero length.
export function preparedTravelAdvisory(prepared,plan){
  const moves=[];let from=prepared.initialPosition;
  for(const [action,a] of prepared.actions.entries()){
    if(a.kind!=='move'&&a.kind!=='extrude')continue;
    const to=a.kind==='move'?a.to:from;
    moves.push({from,to,extruding:a.volumeMm3>0,operation:a.operation,phase:a.phase,layer:a.layer,action});from=to;
  }
  return shortTravelAdvisory(moves,plan.process.lineWidthMm);
}
