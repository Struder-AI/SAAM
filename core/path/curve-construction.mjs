import {distance,requireThat} from '../geom/tolerance.mjs';

// Explicit centerlines stay independent. Closure is materialized so callers
// can retain their supplied seam and direction through ordinary composition.
export function placeCenterlines(curves,{offset=[0,0,0],zMm=null,role='trace'}={}) {
  return curves.map(curve=>{
    const {points:sourcePoints,closed,courses,layers,...properties}=curve;
    const local=curve.closed?[...curve.points,curve.points[0]]:curve.points;
    const points=local.map(p=>[p[0]+offset[0],p[1]+offset[1],(zMm??p[2]??0)+offset[2]]);
    return {role,...properties,closed:false,points};
  });
}

export function curveLength(points) {
  return points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
}

export function railAnchors(rails,overlapsMm) {
  return rails.map((rail,side)=>rail.map((p,i)=>{
    const q=rails[1-side][i],d=Math.hypot(p[0]-q[0],p[1]-q[1]);
    requireThat(d>0,'Attachment rails need nonzero XY span length.');
    return [p[0]+(p[0]-q[0])*overlapsMm[side]/d,p[1]+(p[1]-q[1])*overlapsMm[side]/d,p[2]];
  }));
}

export function alongRail(rail,index,mm) {
  const a=rail[index],next=rail[index+1]??rail[index-1];
  const sign=index+1<rail.length?1:-1,d=distance(a,next);
  requireThat(d>0,'Consecutive attachment anchors must differ.');
  return a.map((v,k)=>v+sign*(next[k]-a[k])*mm/d);
}

// Construct process curves only: attachment and free-span roles, speeds and
// multipliers remain distinct until depositCurves computes their bead sections.
export function attachmentCurves({rails,mode,overlapMm,attachmentSpeedMmS,pressMm,jogMm,leadInMm,
  speedMmS,flowMultiplier,endAttachment,maxSegmentMm}) {
  const end=endAttachment??{overlapMm,pressMm,jogMm:0,speedMmS:attachmentSpeedMmS,flowMultiplier:1};
  const anchors=railAnchors(rails,[overlapMm,mode==='one-way'?end.overlapMm:overlapMm]),curves=[];
  function add(role,points,speed=attachmentSpeedMmS,flow=1,segmentMetadata=null) {
    if(points.every(p=>distance(p,points[0])<1e-9))return;
    curves.push({role,closed:false,points,speedMmS:speed,flowMultiplier:flow,...(segmentMetadata?{segmentMetadata}:{})});
  }
  function press(a,depth=pressMm,speed=attachmentSpeedMmS,flow=1) {
    if(depth)add('bridge-press',[a,[a[0],a[1],a[2]-depth],a],speed,flow);
  }
  for(let i=0;i<rails[0].length;i++){
    const side=mode==='alternating'?i%2:0,a=anchors[side][i],z=anchors[1-side][i];
    if(i&&mode==='alternating')add('bridge-turn',[anchors[side][i-1],a]);
    if(leadInMm){const start=alongRail(anchors[side],i,-leadInMm);if(i&&mode==='alternating')add('bridge-lead-position',[a,start]);add('bridge-lead',[start,a]);}
    if(jogMm)add('bridge-jog',[a,alongRail(anchors[side],i,-jogMm),a]);
    press(a);
    add('bridge-attach',[a,rails[side][i]]);
    const from=rails[side][i],to=rails[1-side][i],segments=maxSegmentMm?Math.ceil(distance(from,to)/maxSegmentMm):1;
    const metadata=maxSegmentMm?Array.from({length:segments},(_,j)=>({bridgeSpan:i,bridgeSegment:j})):null;
    add('bridge-span',Array.from({length:segments+1},(_,j)=>from.map((v,k)=>v+(to[k]-v)*j/segments)),speedMmS,flowMultiplier,metadata);
    add('bridge-attach',[rails[1-side][i],z],end.speedMmS,end.flowMultiplier);
    press(z,end.pressMm,end.speedMmS,end.flowMultiplier);
    if(end.jogMm)add('bridge-end-jog',[z,alongRail(anchors[1-side],i,-end.jogMm),z],end.speedMmS,end.flowMultiplier);
  }
  return {curves,end};
}
