const check=(condition,message)=>{if(!condition)throw Error(message);};
const dot=(a,b)=>a.reduce((sum,v,k)=>sum+v*b[k],0);
const area=region=>Math.abs(region.reduce((sum,loop)=>sum+loop.reduce((a,p,i)=>{const q=loop[(i+1)%loop.length];return a+p[0]*q[1]-q[0]*p[1];},0)/2,0));
const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
function convexHull(points){
  const sorted=points.toSorted((a,b)=>a[0]-b[0]||a[1]-b[1]),half=points=>{
    const result=[];for(const point of points){while(result.length>1&&cross(result.at(-2),result.at(-1),point)<=0)result.pop();result.push(point);}return result.slice(0,-1);
  };
  return [...half(sorted),...half(sorted.toReversed())];
}
function stageAngle(index){
  if(!index)return 0;
  const level=Math.floor(Math.log2(index)),denominator=2**level;
  return (2*(index-denominator)+1)*90/denominator;
}

// Partial bridge stages are ordinary native slices with chart material masks.
// Each strip preserves the final aperture; its removed bands run between the
// previous aperture's supporting sides. No toolpath IDs or machine enter here.
async function stepped(request,{Geometry,Recipe}){
  check(Object.keys(request).every(key=>['strategy','id','base','target','angleDeg','sampleStepMm','toleranceMm'].includes(key)),
    'Stepped reduction selects a printed base and a final edge, with optional angle and geometric resolution.');
  const base=await Recipe.selectEdge(request.base),target=await Recipe.selectEdge(request.target);
  check(base.selection.slice?.index!==undefined&&base.closed&&target.closed,'Stepped reduction needs a closed native Slice base and closed target edge.');
  const part=base.selection.slice.part??null;
  check((target.selection.slice?.part??target.part??null)===part,'The transition edges must use the same part frame.');
  const parent=Recipe.assignment(base.selection.slice.assignment);
  check(parent&&!parent.construction&&!parent.join,'The base must belong to an ordinary Slice stack.');
  const stack=await Recipe.slices({assignment:parent.id,part}),width=stack.process.lineWidthMm;
  const sampleStepMm=request.sampleStepMm??width/2,toleranceMm=request.toleranceMm??Geometry.resolutionMm;
  check([sampleStepMm,toleranceMm].every(v=>Number.isFinite(v)&&v>0)&&Number.isFinite(request.angleDeg??0),'Resolution must be positive and angle finite.');
  const samples=edge=>Geometry.sampleSpatialCurve(edge.curve,{toleranceMm:toleranceMm/2,sampleStepMm}).samples.map(s=>s.point);
  const first=samples(base),last=samples(target);
  const projected=(layer,points)=>{
    const direction=layer.direction??Geometry.evaluateSurface(layer.slice,layer.region[0][0]).normal;
    const query=Geometry.prepareSurfaceRay(layer.slice,direction,{points:layer.region.flat(),sampleStepMm});
    return points.map(point=>{
      const hits=Geometry.surfaceRayIntersections(query,point).toSorted((a,b)=>Math.abs(a.distanceMm)-Math.abs(b.distanceMm));
      check(hits.length,'An edge leaves the selected native stack chart.');return hits[0];
    });
  };
  const terminal=target.selection.slice?.assignment===parent.id&&target.selection.slice.index!==undefined?
    stack.layers.find(layer=>layer.index===target.selection.slice.index):stack.layers.map(layer=>({layer,error:Math.max(...projected(layer,last).map(hit=>Math.abs(hit.distanceMm)))})).toSorted((a,b)=>a.error-b.error)[0]?.layer;
  check(terminal&&Math.max(...projected(terminal,last).map(hit=>Math.abs(hit.distanceMm)))<=toleranceMm,
    'The target edge must lie on a native slice of the base stack.');
  const layers=stack.layers.filter(layer=>layer.index>base.selection.slice.index&&layer.index<terminal.index);
  check(layers.length&&layers.length===terminal.index-base.selection.slice.index-1,'Keep native transition slices between the base and final edge.');
  const owner=structuredClone(parent),stages=[];
  const overrides=owner.sliceOverrides??[];
  owner.sliceOverrides=Array.from({length:Math.max(overrides.length,terminal.index)},(_,i)=>({...overrides[i]}));
  for(const [ordinal,layer] of layers.entries()){
    const boundary=(edge,points)=>{
      const loop=projected(layer,points).map(hit=>hit.chartPoint),region=Geometry.union([loop],[]);
      return region;
    };
    const opening=boundary(base,first),goal=boundary(target,last);
    check(opening.length===1&&goal.length===1&&area(Geometry.difference(goal,opening))<=toleranceMm**2,'The final aperture must fit inside the base aperture.');
    check(area(Geometry.difference([convexHull(goal[0])],goal))<=toleranceMm**2,
      'Stepped reduction needs a convex final aperture; use explicit bridge bands for a concave passage.');
    let aperture=opening;
    for(let stage=0;stage<=ordinal;stage++){
      const angle=((request.angleDeg??0)+stageAngle(stage))*Math.PI/180,x=[Math.cos(angle),Math.sin(angle)],y=[-x[1],x[0]];
      const along=opening.flat().map(p=>dot(p,x)),across=goal.flat().map(p=>dot(p,y));
      const lo=Math.min(...along)-width,hi=Math.max(...along)+width,bottom=Math.min(...across),top=Math.max(...across);
      const strip=[[lo,bottom],[hi,bottom],[hi,top],[lo,top]].map(([u,v])=>x.map((n,k)=>u*n+v*y[k]));
      aperture=Geometry.intersect(aperture,[strip]);
    }
    const angleDeg=(request.angleDeg??0)+stageAngle(ordinal),regionUv=Geometry.difference(layer.region,aperture);
    check(regionUv.length,'A partial bridge stage owns no material.');
    if(ordinal===layers.length-1){
      const supported=Geometry.offsetSliceRegion(layer.slice,goal,width/2,{sampleStepMm});
      check(area(Geometry.difference(aperture,supported))<=toleranceMm**2,
        'The final aperture still exceeds one bead of support. Select a later target slice to allow more reduction stages.');
    }
    owner.sliceOverrides[layer.index]={...owner.sliceOverrides[layer.index],regionUv,loops:0,fillDensity:1,solidTop:0,solidBottom:0,
      fillPattern:'rectilinear',fillAnglesDeg:[angleDeg],rotateFill:false,fillOrder:null,connectNearby:false};
    // fillOrder is an assignment setting; per-slice fill settings select these
    // ordinary straight rows without adding a second construction family.
    delete owner.sliceOverrides[layer.index].fillOrder;
    stages.push({index:layer.index,angleDeg,apertureAreaChart2:area(aperture)});
  }
  check(parent.fillOrder===null,'Stepped reduction uses ordinary row fill, not causal-front or cell fill.');
  return {change:[{id:parent.id,set:{sliceOverrides:owner.sliceOverrides}}],report:{strategy:'stepped-reduction',base:base.selection,target:target.selection,
    stages,prerequisites:'Native predecessor slices; the target is geometry, not printed readiness.',
    geometry:'Partial apertures are saved Slice material masks; the design solid is unchanged.',physicalQualification:'Unverified; review bridge span, cooling and removal.'}};
}

// Hole transitions see the request and SAAM's services: a membrane or wave adds its operation;
// a stepped reduction sets per-layer overrides on the one Slice owner its base names.
export async function holeTransitionOperations(request,{Geometry,Recipe}){
  check(request&&['stepped-reduction','membrane','wave'].includes(request.strategy),'Choose stepped-reduction, membrane or wave.');
  check(typeof request.id==='string'&&/^[a-z][a-z0-9-]*$/.test(request.id),'Choose a lowercase hyphenated id.');
  check(Recipe?.constructEdgePaths&&Recipe?.slices&&Recipe?.assignment,'Hole transitions need the common geometric-edge and native-slice interfaces.');
  if(request.strategy==='stepped-reduction')return stepped(request,{Geometry,Recipe});
  const {strategy,...settings}=request;
  const made=await Recipe.constructEdgePaths({...settings,mode:strategy==='membrane'?'span':'wave'});
  return {add:[made.assignment],report:{strategy,...made.report}};
}
