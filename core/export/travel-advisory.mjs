// Advisory only: inspect the same interpreted XYZ motions that Studio displays.
// A travel is a maximal run without deposition; lifts/detours and robot samples
// belong to that run, not separate reports. Process-only events do not split it.
// Required transitions are counted as travels but never flagged: the approach
// before the first deposition, the departure after the last, and a change of
// labelled deposition layer, where a nearby start is the intended path.
// A sub-micron segment inside a stroke whose filament amount rounds to nothing
// in the written program is not a travel and is not counted as one.
export function shortTravelAdvisory(moves) {
  const thresholdMm=2,samples=[],operations=new Map();
  let first,last,previous,next,count=0,liftedCount=0,travelCount=0,minimumDistanceMm=null,peakZ=-Infinity,routeMm=0;
  const context=move=>move?{file:move.file??'program',line:move.line??null,
    operation:move.operation||null,phase:move.phase??null,layer:move.layer??null}:null;
  const known=value=>value!==undefined&&value!==null;
  function finish() {
    if(!first)return;
    if(routeMm<=0.001&&previous&&next){first=last=null;return;}
    travelCount++;
    const distanceMm=Math.hypot(...last.to.map((v,i)=>v-first.from[i]));
    const required=!previous||!next||(known(previous.layer)&&known(next.layer)&&previous.layer!==next.layer);
    if(distanceMm<=thresholdMm&&!required){
      count++;minimumDistanceMm=Math.min(minimumDistanceMm??Infinity,distanceMm);
      // A lift above both endpoints means the producer found the direct line
      // blocked, such as a gap between neighboring islands.
      const lifted=peakZ>Math.max(first.from[2],last.to[2])+1e-6;
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

export function withTravelAdvisory(program){
  program.summary={...program.summary,shortTravel:shortTravelAdvisory(program.moves)};
  return program;
}
