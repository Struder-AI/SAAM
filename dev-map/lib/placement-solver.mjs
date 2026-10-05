// Placement solver: coordinates on one map, independent of the nesting solver's tree.
// Springs shorten connections, repulsion opens space, and rectangle separation protects
// box text. Horizontal guides retain the seed's flow columns; no viewport bounds the solve.
const GAP=30, DAMPING=0.72, QUIET_STEPS=20;

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
  return {positions:Object.fromEntries(own.map(b=>[b.id,{x:b.x-b.w/2,y:b.y-b.h/2}])),
    settled:state.quiet>=QUIET_STEPS,steps:state.steps,motion:state.motion,overlaps:placementOverlaps(own)};
}
