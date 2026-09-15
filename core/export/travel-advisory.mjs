// Advisory only: inspect the same interpreted XYZ motions that Studio displays.
// A travel is a maximal run without deposition; lifts/detours and robot samples
// belong to that run, not separate reports. Process-only events do not split it.
export function shortTravelAdvisory(moves) {
  const thresholdMm=2,samples=[],operations=new Map();
  let first,last,previous,next,count=0,travelCount=0,minimumDistanceMm=null;
  const context=move=>move?{file:move.file??'program',line:move.line??null,
    operation:move.operation||null,phase:move.phase??null,layer:move.layer??null}:null;
  function finish() {
    if(!first)return;
    travelCount++;
    const distanceMm=Math.hypot(...last.to.map((v,i)=>v-first.from[i]));
    if(distanceMm<=thresholdMm){
      count++;minimumDistanceMm=Math.min(minimumDistanceMm??Infinity,distanceMm);
      for(const operation of new Set([previous?.operation,first.operation,last.operation,next?.operation].filter(Boolean)))
        operations.set(operation,(operations.get(operation)??0)+1);
      if(samples.length<20)samples.push({distanceMm,from:[...first.from],to:[...last.to],
        start:context(first),end:context(last),before:context(previous),after:context(next)});
    }
    first=last=null;
  }
  for(const move of moves){
    if(move.extruding){next=move;finish();previous=move;}
    else {first??=move;last=move;}
  }
  next=null;finish();
  return {code:'short-travel',severity:'advisory',thresholdMm,travelCount,count,minimumDistanceMm,
    operations:[...operations].map(([operation,count])=>({operation,count})),samples,
    omittedSamples:count-samples.length,
    message:count?'Bad path: travel endpoints are within 2 mm. Retain this evidence for later improvement of the generating skills/functions. This advisory does not block review or delivery and does not request automatic repair.':null};
}

export function withTravelAdvisory(program){
  program.summary={...program.summary,shortTravel:shortTravelAdvisory(program.moves)};
  return program;
}
