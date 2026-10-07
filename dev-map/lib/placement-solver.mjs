// Placement solver: coordinates on one map, independent of the nesting solver's tree.
// Springs shorten connections, repulsion opens space, and rectangle separation protects
// box text. Topology refinement then releases those columns and row order where fewer
// crossings, fewer wires through boxes, shorter links and a balanced footprint justify it.
// No viewport bounds the solve; authored layouts bypass this operation.
const GAP=30, DAMPING=0.72, QUIET_STEPS=20, SCORE_TOLERANCE=0.02;

function placementForces(boxes,wires,centre) {
  for(const b of boxes){b.fx=(b.seedX-b.x)*0.09;b.fy=(centre-b.y)*0.002;}
  for(const [a,b] of wires) {
    const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy));
    const reach=(a.w+b.w)/2+80,force=(d-reach)*0.012;
    a.fx+=dx/d*force;a.fy+=dy/d*force;b.fx-=dx/d*force;b.fy-=dy/d*force;
  }
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++) {
    const a=boxes[i],b=boxes[j],dx=b.x-a.x,dy=b.y-a.y;
    const reach=Math.max(a.w,b.w,a.h,b.h)+GAP*4,d=Math.max(1,Math.hypot(dx,dy));
    if(d>reach*2)continue;
    const force=9000/(d*d+400),ux=dx/d,uy=dy/d;
    a.fx-=ux*force*0.25;a.fy-=uy*force;b.fx+=ux*force*0.25;b.fy+=uy*force;
  }
}

function separatePlacement(boxes,rows,clearance) {
  // Project an ordered sweep onto separated rectangle footprints. A whole chain is
  // resolved in one sweep, rather than endlessly nudging its neighbours back together.
  const centre=boxes.reduce((sum,b)=>sum+b.y,0)/Math.max(1,boxes.length);
  for(let i=0;i<rows.length;i++) {
    const b=rows[i];
    for(let j=0;j<i;j++) {
      const a=rows[j];
      const pair=i+','+j;
      if(Math.abs(b.x-a.x)<(a.w+b.w)/2+GAP)clearance.add(pair);
      if(!clearance.has(pair))continue;
      const floor=a.y+(a.h+b.h)/2+GAP;
      if(b.y<floor){b.y=floor;b.vy=0;}
    }
  }
  const shift=boxes.reduce((sum,b)=>sum+b.y,0)/Math.max(1,boxes.length)-centre;
  for(const b of boxes)b.y-=shift;
}

function placementOverlaps(boxes) {
  const overlaps=[];
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++) {
    const a=boxes[i],b=boxes[j];
    if(Math.abs(a.x-b.x)<(a.w+b.w)/2+GAP-0.1&&Math.abs(a.y-b.y)<(a.h+b.h)/2+GAP-0.1)
      overlaps.push([a.id,b.id]);
  }
  return overlaps;
}

function placementCrosses(a,b,c,d) {
  const abC=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const abD=(b.x-a.x)*(d.y-a.y)-(b.y-a.y)*(d.x-a.x);
  const cdA=(d.x-c.x)*(a.y-c.y)-(d.y-c.y)*(a.x-c.x);
  const cdB=(d.x-c.x)*(b.y-c.y)-(d.y-c.y)*(b.x-c.x);
  return abC*abD<0&&cdA*cdB<0;
}

function placementPoint(box,points) { return points.get(box)??box; }

function placementSegment(a,b) { return {a,b,lowX:Math.min(a.x,b.x),highX:Math.max(a.x,b.x),lowY:Math.min(a.y,b.y),highY:Math.max(a.y,b.y)}; }

function placementPierces(segment,box,point) {
  const left=point.x-box.w/2+1,right=point.x+box.w/2-1,top=point.y-box.h/2+1,bottom=point.y+box.h/2-1;
  if(segment.lowX>=right||segment.highX<=left||segment.lowY>=bottom||segment.highY<=top)return false;
  const dx=segment.b.x-segment.a.x,dy=segment.b.y-segment.a.y;
  const span={low:0,high:1};
  if(dx===0){if(segment.a.x<=left||segment.a.x>=right)return false;}
  else{const a=(left-segment.a.x)/dx,b=(right-segment.a.x)/dx;span.low=Math.max(span.low,Math.min(a,b));span.high=Math.min(span.high,Math.max(a,b));}
  if(dy===0){if(segment.a.y<=top||segment.a.y>=bottom)return false;}
  else{const a=(top-segment.a.y)/dy,b=(bottom-segment.a.y)/dy;span.low=Math.max(span.low,Math.min(a,b));span.high=Math.min(span.high,Math.max(a,b));}
  return span.low<span.high;
}

function placementFootprint(boxes,points,scale) {
  const low={x:Infinity,y:Infinity},high={x:-Infinity,y:-Infinity};
  for(const b of boxes){const p=placementPoint(b,points);low.x=Math.min(low.x,p.x-b.w/2);low.y=Math.min(low.y,p.y-b.h/2);high.x=Math.max(high.x,p.x+b.w/2);high.y=Math.max(high.y,p.y+b.h/2);}
  const width=high.x-low.x,height=high.y-low.y;
  const skew=Math.log(Math.max(1,width)/Math.max(1,height)/1.6);
  return (width+height*1.6)/scale*0.1+skew*skew*boxes.length*0.8;
}

function placementLocalCost(boxes,links,eligible,current,affected,moving,points,scale,maxCross=Infinity) {
  // Center segments are a cheap routing proxy; the renderer still routes actual curves.
  // Only relationships affected by this move count, including other wires over a moved box.
  const state={cross:0,length:0,hits:0};
  const geometry=[...current];
  for(const i of affected){const [a,b]=links[i];geometry[i]=placementSegment(placementPoint(a,points),placementPoint(b,points));}
  for(const i of affected) {
    const segment=geometry[i],p=segment.a,q=segment.b;
    state.length+=Math.hypot(p.x-q.x,p.y-q.y)/scale;
    for(const j of eligible[i]) {
      if(affected.has(j)&&j<=i)continue;
      const other=geometry[j];
      if(segment.lowX>=other.highX||segment.highX<=other.lowX||segment.lowY>=other.highY||segment.highY<=other.lowY)continue;
      if(placementCrosses(p,q,other.a,other.b)){
        state.cross++;
        if(state.cross>maxCross)return {cross:state.cross,hits:Infinity,score:Infinity};
      }
    }
  }
  for(const i of affected)for(const b of boxes)if(!links[i].includes(b)&&placementPierces(geometry[i],b,placementPoint(b,points)))state.hits++;
  for(const b of moving)for(let i=0;i<links.length;i++)if(!affected.has(i)&&placementPierces(geometry[i],b,placementPoint(b,points)))state.hits++;
  return {cross:state.cross,hits:state.hits,score:state.cross*6+state.hits*8+state.length+placementFootprint(boxes,points,scale)};
}

function placementLegal(boxes,points) {
  for(const [a,p] of points)for(const b of boxes) {
    if(a===b)continue;
    const q=placementPoint(b,points);
    if(Math.abs(p.x-q.x)<(a.w+b.w)/2+GAP-0.01&&Math.abs(p.y-q.y)<(a.h+b.h)/2+GAP-0.01)return false;
  }
  return true;
}

function placementCandidates(boxes,box,neighbours) {
  const points=[];
  const mean={x:0,y:0};
  const attraction=neighbours.length?neighbours:boxes.filter(b=>b!==box);
  for(const n of attraction){mean.x+=n.x;mean.y+=n.y;const dx=(n.w+box.w)/2+GAP+0.1,dy=(n.h+box.h)/2+GAP+0.1;points.push(new Map([[box,{x:n.x-dx,y:n.y}]]),new Map([[box,{x:n.x+dx,y:n.y}]]),new Map([[box,{x:n.x,y:n.y-dy}]]),new Map([[box,{x:n.x,y:n.y+dy}]]));}
  if(attraction.length){mean.x/=attraction.length;mean.y/=attraction.length;points.push(new Map([[box,mean]]),new Map([[box,{x:box.x,y:mean.y}]]),new Map([[box,{x:mean.x,y:box.y}]]));}
  for(const n of boxes) {
    if(n===box)continue;
    if(Math.abs(n.x-box.x)>(n.w+box.w)/2+GAP&&!neighbours.includes(n))continue;
    points.push(new Map([[box,{x:n.x,y:n.y}],[n,{x:box.x,y:box.y}]]));
  }
  return points;
}

function refinePlacement(boxes,links,progress) {
  // Each legal move strictly lowers the bounded score without adding a crossing or box hit.
  // Stop on measured improvement, rather than limiting passes or silently leaving overlaps.
  const touching=new Map(boxes.map(b=>[b,new Set()])),neighbours=new Map(boxes.map(b=>[b,[]]));
  for(let i=0;i<links.length;i++){const [a,b]=links[i];touching.get(a).add(i);touching.get(b).add(i);neighbours.get(a).push(b);neighbours.get(b).push(a);}
  const scale=boxes.reduce((sum,b)=>sum+b.w,0)/Math.max(1,boxes.length),empty=new Map();
  const eligible=links.map(([a,b],i)=>links.flatMap(([c,d],j)=>i!==j&&a!==c&&a!==d&&b!==c&&b!==d?[j]:[]));
  const state={changed:true};
  while(state.changed) {
    state.changed=false;
    progress.passes++;
    for(const box of boxes) {
      const best={points:empty,score:-SCORE_TOLERANCE};
      const baseline=new Map();
      const current=links.map(([a,b])=>placementSegment(a,b));
      for(const points of placementCandidates(boxes,box,neighbours.get(box))) {
        progress.candidates++;
        if(!placementLegal(boxes,points))continue;
        const moving=[...points.keys()],affected=new Set();for(const b of moving)for(const i of touching.get(b))affected.add(i);
        const key=[...points.keys()].map(b=>b.id).join(',');
        if(!baseline.has(key))baseline.set(key,placementLocalCost(boxes,links,eligible,current,affected,moving,empty,scale));
        const before=baseline.get(key),after=placementLocalCost(boxes,links,eligible,current,affected,moving,points,scale,before.cross);
        const cross=after.cross-before.cross,score=after.score-before.score;
        if(cross<=0&&after.hits<=before.hits&&score<best.score){best.points=points;best.score=score;}
      }
      if(best.points.size){for(const [b,p] of best.points){b.x=p.x;b.y=p.y;}state.changed=true;progress.moves++;}
    }
  }
}

export function solvePlacement({boxes,wires}) {
  const own=boxes.map(b=>({id:b.id,w:b.w,h:b.h,x:b.x+b.w/2,y:b.y+b.h/2,
    seedX:b.x+b.w/2,vx:0,vy:0,fx:0,fy:0}));
  for(const b of own)if(![b.x,b.y,b.w,b.h].every(Number.isFinite)||b.w<=0||b.h<=0)
    throw Error(`Invalid placement box ${b.id}`);
  const byId=new Map(own.map(b=>[b.id,b]));
  if(byId.size!==own.length)throw Error('Placement box identities must be unique');
  const rows=[...own].sort((a,b)=>a.y-b.y||a.id.localeCompare(b.id)),clearance=new Set();
  const links=wires.map(([a,b])=>[byId.get(a),byId.get(b)]).filter(([a,b])=>a&&b&&a!==b);
  const state={quiet:0,steps:0,motion:0,heat:1},centre=own.reduce((sum,b)=>sum+b.y,0)/Math.max(1,own.length);
  // Cooling damps the forces to rest; the solve ends on measured motion, not a tick cap.
  while(state.quiet<QUIET_STEPS) {
    const before=own.map(b=>[b.x,b.y]);
    placementForces(own,links,centre);
    for(const b of own) {
      b.vx=(b.vx+b.fx*state.heat)*DAMPING;b.vy=(b.vy+b.fy*state.heat)*DAMPING;
      const speed=Math.hypot(b.vx,b.vy),scale=Math.min(1,24/Math.max(speed,1));
      b.x+=b.vx*scale;b.y+=b.vy*scale;
    }
    separatePlacement(own,rows,clearance);
    const shift=own.reduce((max,b,i)=>Math.max(max,Math.hypot(b.x-before[i][0],b.y-before[i][1])),0);
    state.heat*=0.99;state.motion=shift;state.quiet=shift<0.04?state.quiet+1:0;state.steps++;
  }
  const refinement={passes:0,moves:0,candidates:0};
  refinePlacement(own,links,refinement);
  return {positions:Object.fromEntries(own.map(b=>[b.id,{x:b.x-b.w/2,y:b.y-b.h/2}])),
    settled:state.quiet>=QUIET_STEPS,steps:state.steps,motion:state.motion,overlaps:placementOverlaps(own),refinement};
}
