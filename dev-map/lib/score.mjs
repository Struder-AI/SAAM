// The map scorer: how well each map reads, by the measures the owner reviews maps with. The maps
// are the top map and every cluster; a leaf opens as code and is no map. Each map gets a badness
// per measure and their sum, and the tree's energy is the sum over its maps, each weighted by the
// log of the leaves nested in it, per leaf mapped. The sum has a fixed denominator, so a new map
// lowers the energy only by lowering the badness of others. The annealer (solve.mjs) lowers it for
// the middle-out solver (dev-map/influence/solve-middle.mjs).
//
// A map's members are the boxes it draws: homes, repeats and its external boxes (tree.mjs). Each
// member stands for the leaves nested under it, and links between leaves (calls, data between
// calls, indirect links) are lifted onto the members holding their two ends. A map's edge is its
// external boxes and its boundary boxes, each standing for the box on the nearest shared map that
// holds a crossing link's other end. Every part is a weight times the square of an excess, with no
// cap, so one bad map outweighs many slightly imperfect ones:
//   size       1 per squared box, homes and repeats, short of 6, and 0.025 beyond 20; edge boxes
//              do not count
//   edge       0.01 per squared edge box, with no allowance: what a map needs drawn from elsewhere
//   hubs       0.1 per squared wire a box has beyond 3 more than the map's mean, over every box
//              drawn: 10 boxes of 2 wires routed through one box of 20 is a bottleneck
//   islands    0.2 per squared group of members, beyond the first, with no link between them
//   backflow   0.05 per squared member pair linked against the best left-to-right order; loops
//              make some unavoidable, so it is scored, never forbidden; influence maps leave it
//              out for now (INFLUENCE)
//   balance    2 × the square of the biggest home box's share of the nested leaves beyond an even
//              share: a map that is one box holding nearly everything is a bottleneck
// Crossing (the share of links touching the map's nested content that no box on it holds) is
// reported, not scored.
import {flowOrder} from './tree.mjs';

export const SIZE={min:6,max:20,under:1,over:0.025};
export const WEIGHT={edge:0.01,hub:0.1,hubFree:3,island:0.2,backward:0.05,balance:2};
// A map's weight in the energy grows with the log of the leaves nested in it, so a map passed
// through on the way to many leaves counts for more, but no map outweighs the rest.
export const weightOf=leaves=>1+Math.log2(Math.max(1,leaves));
export const UBIQUITOUS=20;

// How many call links reach each leaf.
export function callersOf(links) {
  const callers=new Map();
  for(const {to,kind} of links)if(kind==='call')callers.set(to,(callers.get(to)??0)+1);
  return callers;
}

// The influence maps' objective (plans/dev-maps.md#levels): the same parts and weights, over one
// arrow per related pair of boxes, without backflow. The middle-out solver
// (dev-map/influence/solve-middle.mjs) supplies the pairing.
export const INFLUENCE={backflow:false};

// One map's score from what it draws (tree.mjs drawMap). `pairsOf`, when given, joins what the map
// draws into one wire per related pair of boxes ([a, b] each, either way round), and boundary and
// external wires are then counted once per pair too; `backflow: false` leaves backflow out.
export function scoreDrawn(drawn,callers,{pairsOf=null,backflow=true}={}) {
  // Every wire drawn, boundary wires included, once each, and each box's wire count.
  const wires=new Map(),degree=new Map(),edges=[];
  const wire=(a,b)=>{
    if(pairsOf&&b<a)[a,b]=[b,a];
    let ends=wires.get(a);if(!ends)wires.set(a,ends=new Set());
    if(ends.has(b))return false;
    ends.add(b);degree.set(a,(degree.get(a)??0)+1);degree.set(b,(degree.get(b)??0)+1);return true;
  };
  if(pairsOf){for(const [a,b] of pairsOf(drawn))if(wire(a,b))edges.push([a,b]);}
  else for(const {from,to} of drawn.lifted)if(wire(from,to))edges.push([from,to]);
  const ubiquitous=drawn.crossing.filter(c=>(callers.get(c.outside)??0)>=UBIQUITOUS).length;
  const homes=drawn.homes.length,outside=drawn.outside.map((box,i)=>`external:${i}`);
  drawn.outside.forEach((box,i)=>{for(const m of box.into)if(wire(outside[i],m))edges.push([outside[i],m]);
    for(const m of box.from)if(wire(m,outside[i]))edges.push([m,outside[i]]);});
  const boundary=new Map();
  for(const {inside,out,boundary:box} of drawn.crossing){let b=boundary.get(box);if(!b)boundary.set(box,b=`boundary:${box}`);
    if(out||pairsOf)wire(inside,b);else wire(b,inside);}
  return rateMap([...drawn.members,...outside],edges,{inner:drawn.members.length,boundary:boundary.size,
    degrees:[...new Set([...drawn.members,...outside,...boundary.values()])].map(m=>degree.get(m)??0),crossing:drawn.crossing.length,
    crossingPlain:drawn.crossing.length-ubiquitous,touching:drawn.touching,touchingPlain:drawn.touching-ubiquitous,
    balance:homes>1&&drawn.nested.size?drawn.largest/drawn.nested.size-1/homes:0,backflow});
}

// A map's score from its members, the member pairs linked on it, its boundary boxes, every drawn
// box's wire count, its balance, and the links touching its content and leaving it.
export function rateMap(members,edges,{inner,boundary,degrees,crossing,crossingPlain,touching,touchingPlain,balance,backflow=true}) {
  // Islands: members joined by any link in either direction.
  const parent=new Map(members.map(m=>[m,m]));
  const find=m=>parent.get(m)===m?m:find(parent.get(m));
  for(const [a,b] of edges)parent.set(find(a),find(b));
  const islands=new Set(members.map(find)).size;
  let backward=0;
  if(backflow){const order=flowOrder(members,edges);backward=edges.filter(([a,b])=>order.get(a)>order.get(b)).length;}
  const square=x=>x*x,externals=members.length-inner,edge=externals+boundary;
  const mean=degrees.reduce((a,b)=>a+b,0)/Math.max(1,degrees.length),free=mean+WEIGHT.hubFree;
  const badness={
    size:SIZE.under*square(Math.max(0,SIZE.min-inner))+SIZE.over*square(Math.max(0,inner-SIZE.max)),
    edge:WEIGHT.edge*square(edge),
    hubs:WEIGHT.hub*degrees.reduce((sum,d)=>sum+square(Math.max(0,d-free)),0),
    islands:WEIGHT.island*square(Math.max(0,islands-1)),
    backflow:WEIGHT.backward*square(backward),
    balance:WEIGHT.balance*square(balance)
  };
  return {nodes:inner,externals,edge:{boundary,externals},hubs:{max:Math.max(0,...degrees),mean},balance,
    crossing:{links:crossing,of:touching,share:touching?crossing/touching:0,withoutUbiquitous:touchingPlain?crossingPlain/touchingPlain:0},
    islands,backflow:{links:backward,of:edges.length},badness,score:Object.values(badness).reduce((a,b)=>a+b,0)};
}
