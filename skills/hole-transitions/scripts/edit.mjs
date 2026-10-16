const check=(condition,message)=>{if(!condition)throw Error(message);};
const positive=(value,name)=>{check(Number.isFinite(value)&&value>0,`${name} must be positive and finite.`);return value;};
const dot=(a,b)=>a.reduce((sum,v,k)=>sum+v*b[k],0);
const subtract=(a,b)=>a.map((v,k)=>v-b[k]);
const vector=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const loops=region=>Array.isArray(region)&&region.length&&region.every(loop=>Array.isArray(loop)&&loop.length>=3&&loop.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)));

// Convex apertures and their guides are ordinary mesh inputs. The plane frame
// keeps this construction independent of world Z and the source's travel direction.
function prism(outline,frame,from,to){
  const at=([x,y],z)=>frame.origin.map((v,k)=>v+x*frame.xAxis[k]+y*frame.yAxis[k]+z*frame.normal[k]);
  const n=outline.length,vertices=[...outline.map(p=>at(p,from)),...outline.map(p=>at(p,to))],triangles=[];
  for(let i=1;i<n-1;i++)triangles.push([0,i+1,i],[n,n+i,n+i+1]);
  for(let i=0;i<n;i++){const j=(i+1)%n;triangles.push([i,j,n+j],[i,n+j,n+i]);}
  return {shape:'mesh',vertices,triangles,source:null};
}
function circle(radius,toleranceMm){
  const count=Math.max(8,Math.ceil(Math.PI/Math.acos(Math.max(-1,1-Math.min(toleranceMm,radius)/radius))));
  return Array.from({length:count},(_,i)=>[radius*Math.cos(i*2*Math.PI/count),radius*Math.sin(i*2*Math.PI/count)]);
}
function selectedPart(plan,part){
  const solid=plan.geometry?.shape==='spatial'?plan.geometry.solid:plan.geometry;
  if(solid?.shape==='assembly'){
    const component=solid.parts.find(p=>p.id===part);check(component,'Choose the assembly part containing this hole.');return component;
  }
  check(part===null&&solid,'Hole support needs a solid and a matching source part.');
  return {geometry:solid,setGeometry(geometry){if(plan.geometry.shape==='spatial')plan.geometry.solid=geometry;else plan.geometry=geometry;}};
}
function wallSettings(parent,index){
  const settings={...parent,...parent.sliceOverrides?.[index]},loops=Array.isArray(settings.loops)?settings.loops[index%settings.loops.length]:settings.loops;
  check(loops>0,'Automatic hole attachment needs source wall loops at its supporting rim and continuing bore.');
  return {...settings,loops};
}
function wallOperation(parent,index){
  wallSettings(parent,index);
  return `${parent.part===null||parent.part===undefined?'':parent.part+':'}${parent.id}:${index}:walls`;
}
function continueWalls(parent,index,after){
  wallOperation(parent,index);
  const overrides=parent.sliceOverrides??[];
  parent.sliceOverrides=Array.from({length:Math.max(overrides.length,index+1)},(_,i)=>({...overrides[i]}));
  const selected=parent.sliceOverrides[index],groups={...parent.operationAfter,...selected.operationAfter};
  selected.operationAfter={...groups,walls:[...new Set([...(parent.operationAfter?.walls??[]),...(groups.walls??[]),after])]};
}

async function planarHole(plan,request,parent,Geometry,boreLayers){
  check(vector(request.centerMm),'centerMm is the shoulder center in part-local XYZ.');
  check(['horizontal','plane'].includes(parent.surface?.kind)&&!parent.within?.length&&!parent.join&&!parent.preset,'This hole construction needs an unbounded ordinary planar Slice owner.');
  const process={...plan.process,...parent.process},part=parent.part??null,owner=selectedPart(plan,part);
  const shell=await Geometry.buildGeometry(owner.geometry),base=parent.surface.kind==='horizontal'?Geometry.horizontalSlice(shell.bounds.min[2]):Geometry.planeSlice(parent.surface);
  const stack=parent.stack??process,h=positive(stack.layerMm,'layerMm'),width=positive(process.lineWidthMm,'lineWidthMm');
  const toleranceMm=positive(request.toleranceMm??.01,'toleranceMm');
  const r=positive(request.boreRadiusMm,'boreRadiusMm'),R=positive(request.counterboreRadiusMm,'counterboreRadiusMm');
  check(R>r+width,'The counterbore must leave room for a bridging band.');
  const angle=request.angleDeg??0;check(Number.isFinite(angle),'angleDeg must be finite.');
  const speed=positive(request.speedMmS??process.planarSpeedMmS,'speedMmS');
  const reference=Geometry.sliceStack({base,direction:stack.direction,pitchMm:h,firstLayerMm:positive(stack.firstLayerMm,'firstLayerMm')},shell.bounds);
  const at=reference.layers.findIndex(layer=>Math.abs(dot(subtract(request.centerMm,layer.slice.origin),base.normal))<=toleranceMm);
  check(at>=0&&reference.layers.length>at+boreLayers,`Align the shoulder with the source layer grid and retain ${boreLayers} bore layers above it.`);
  const frame={...base,origin:request.centerMm};
  const match=(slice,radius,side)=>Geometry.section(shell,slice,{side}).loops.some(loop=>Geometry.loopArea(loop)<0&&loop.every(p=>{
    const point=Geometry.evaluateSurface(slice,p).point,delta=subtract(point,request.centerMm);
    return Math.abs(Math.hypot(dot(delta,frame.xAxis),dot(delta,frame.yAxis))-radius)<=2*toleranceMm;
  }));
  check(match(reference.layers[at].slice,R,'negative')&&reference.layers.slice(at+1,at+boreLayers+1).every(layer=>match(layer.slice,r,'negative')),'The selected layers must contain the stated concentric circular counterbore and continuing bore.');
  return {part,owner,h,width,toleranceMm,r,R,angle,speed,reference,at,frame};
}
async function stepped(plan,request,parent,Geometry){
  check(Object.keys(request).every(k=>['strategy','id','sourceAssignment','centerMm','boreRadiusMm','counterboreRadiusMm','angleDeg','speedMmS','after','toleranceMm'].includes(k)),'Unknown stepped-reduction setting.');
  const {part,owner,h,width,toleranceMm,r,R,angle,speed,reference,at,frame}=await planarHole(plan,request,parent,Geometry,4);
  const anchorOperation=wallOperation(parent,reference.layers[at].index);
  const anchor=wallSettings(parent,reference.layers[at].index),radius=R+(anchor.loopInsetMm??width/2)+(anchor.loops-1)*width*(anchor.spacingFactor??1)+width/2;
  const rotate=([x,y])=>{const a=angle*Math.PI/180;return [x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];};
  const square=[[-r,-r],[r,-r],[r,r],[-r,r]],q=r*(Math.SQRT2-1);
  const apertures=[{name:'slot',points:[[-R,-r],[R,-r],[R,r],[-R,r]]},
    {name:'square',points:square},{name:'octagon',points:[[-q,-r],[q,-r],[r,-q],[r,q],[q,r],[-q,r],[-r,q],[-r,-q]]}];
  const cutters=[],assignments=[],stages=[];
  for(const [index,aperture] of apertures.entries()){
    const from=index*h,to=(index+1)*h,id=`${request.id}-${aperture.name}`,layer=reference.layers[at+index+1];
    cutters.push({shape:'boolean',operation:'intersection',operands:[prism(aperture.points.map(rotate),frame,from,to),prism(circle(R,toleranceMm),frame,from,to)]});
    const after=index?[`${part===null?'':part+':'}${assignments.at(-1).id}:${reference.layers[at+index].index}:fill`]:[...new Set([anchorOperation,...(request.after??[])])];
    assignments.push({...structuredClone(parent),id,loops:0,fillDensity:1,fillPattern:'rectilinear',fillAnglesDeg:[angle+[0,90,45][index]],rotateFill:false,
      solidTop:0,solidBottom:0,spacingFactor:1,fillOrder:null,connectNearby:false,sliceOverrides:undefined,
      process:{...parent.process,planarSpeedMmS:speed,firstLayerSpeedMmS:speed},
      // A course mask selects one slicing plane; its bead still inherits the
      // full stack gap. Keep mask faces between planes, away from adjacent claims.
      within:[{kind:'geometry',geometry:prism(circle(radius,toleranceMm),frame,to-h/4,to+h/4)}],
      operationAfter:{},dependencies:{afterParts:[],beforeParts:[],after},description:`Experimental ${aperture.name} hole transition; bridge direction ${angle+[0,90,45][index]} degrees.`});
    // Omitted optional settings must stay absent in the saved ordinary record.
    delete assignments.at(-1).sliceOverrides;
    stages.push({id,aperture:aperture.name,layerIndex:layer.index,normalOffsetMm:to,angleDeg:angle+[0,90,45][index]});
  }
  const geometry={shape:'boolean',operation:'difference',operands:[owner.geometry,...cutters]};
  if(owner.setGeometry)owner.setGeometry(geometry);else owner.geometry=geometry;
  const terminal=`${part===null?'':part+':'}${assignments.at(-1).id}:${reference.layers[at+3].index}:fill`,boreIndex=reference.layers[at+4].index;
  continueWalls(parent,boreIndex,terminal);
  return {assignments,report:{strategy:'stepped-reduction',part,stages,dependencies:{anchor:anchorOperation,terminal,continuation:wallOperation(parent,boreIndex)},scope:'Planar references, including tilted planes and oblique translation directions; no curved slices.',notes:['Transition openings enlarge the original bore locally. Rebuild from a prior Bundle revision after layer, width or strategy changes.']}};
}

async function membrane(plan,request,parent,Geometry){
  check(Object.keys(request).every(k=>['strategy','id','sourceAssignment','centerMm','boreRadiusMm','counterboreRadiusMm','angleDeg','speedMmS','after','toleranceMm'].includes(k)),'Unknown membrane setting.');
  const {part,owner,h,width,toleranceMm,R,angle,speed,reference,at,frame}=await planarHole(plan,request,parent,Geometry,1);
  check(at>0,'A membrane needs a preceding rim layer on the selected source stack.');
  const anchorIndex=reference.layers[at-1].index,settings=wallSettings(parent,anchorIndex),anchor=wallOperation(parent,anchorIndex),layer=reference.layers[at];
  const radius=R+(settings.loopInsetMm??width/2)+(settings.loops-1)*width*(settings.spacingFactor??1)+width/2;
  const geometry={shape:'boolean',operation:'union',operands:[owner.geometry,prism(circle(radius,toleranceMm),frame,-h,0)]};
  if(owner.setGeometry)owner.setGeometry(geometry);else owner.geometry=geometry;
  const assignment={...structuredClone(parent),id:request.id,loops:0,fillDensity:1,fillPattern:'rectilinear',fillAnglesDeg:[angle],rotateFill:false,
    solidTop:0,solidBottom:0,spacingFactor:1,fillOrder:null,connectNearby:false,
    process:{...parent.process,planarSpeedMmS:speed,firstLayerSpeedMmS:speed},
    within:[{kind:'geometry',geometry:prism(circle(radius,toleranceMm),frame,-h/4,h/4)}],operationAfter:{},
    dependencies:{afterParts:[],beforeParts:[],after:[...new Set([anchor,...(request.after??[])])]},
    description:'Experimental drill-through hole membrane; straight strands bridge from the printed rim.'};
  delete assignment.sliceOverrides;
  const terminal=`${part===null?'':part+':'}${request.id}:${layer.index}:fill`,boreIndex=reference.layers[at+1].index;
  continueWalls(parent,boreIndex,terminal);
  return {assignments:[assignment],report:{strategy:'membrane',part,layerIndex:layer.index,radiusMm:radius,
    dependencies:{anchor,terminal,continuation:wallOperation(parent,boreIndex)},
    scope:'Planar references, including tilted planes and oblique stack translations; no curved membranes.',
    notes:['The membrane closes the bore for piercing or drilling after printing. Rebuild from a prior Bundle revision after process or strategy changes.']}};
}

function wave(request,parent,process){
  check(Object.keys(request).every(k=>['strategy','id','sourceAssignment','surface','domainUv','seedUv','layers','layerHeightMm','direction','lineSpacingMm','propagationStepMm','toleranceMm','sampleStepMm','speedMmS','fanPercent','toolPose','after','seedFrom','boreTo'].includes(k)),'Unknown wave setting.');
  check(['spline','patch'].includes(request.surface?.kind),'Wave holes need an authored spline reference or named patch.');
  check(loops(request.domainUv)&&loops(request.seedUv),'Supply the shoulder domainUv and an already supported rim seedUv.');
  const signedArea=loop=>loop.reduce((sum,p,i)=>sum+p[0]*loop[(i+1)%loop.length][1]-p[1]*loop[(i+1)%loop.length][0],0)/2;
  check(request.domainUv.some(loop=>signedArea(loop)<0),'The wave domain must retain the bore as a clockwise hole.');
  const layers=request.layers??1;check(Number.isSafeInteger(layers)&&layers>0,'layers must be a positive integer.');
  const height=positive(request.layerHeightMm??parent.stack?.layerMm??parent.process?.layerMm??process.layerMm,'layerHeightMm');
  const assignment={id:request.id,part:parent.part??null,filament:parent.filament??null,
    process:{...parent.process,planarSpeedMmS:positive(request.speedMmS??5,'speedMmS'),firstLayerSpeedMmS:positive(request.speedMmS??5,'speedMmS'),fanPercent:request.fanPercent??100},
    loops:0,fillDensity:1,solidTop:0,solidBottom:0,sampleStepMm:positive(request.sampleStepMm??.5,'sampleStepMm'),
    surface:structuredClone({...request.surface,offsetMm:request.surface.offsetMm??0}),
    stack:{firstLayerMm:height,layerMm:height,...(request.direction?{direction:request.direction}:{})},
    within:[{kind:'surface-domain',loopsUv:request.domainUv,fromLayer:-layers,toLayer:0}],
    fillOrder:{kind:'fronts',seedUv:request.seedUv,lineSpacingMm:positive(request.lineSpacingMm??.3,'lineSpacingMm'),propagationStepMm:positive(request.propagationStepMm??.1,'propagationStepMm'),toleranceMm:positive(request.toleranceMm??.01,'toleranceMm')},
    toolPose:request.toolPose??parent.toolPose??null,dependencies:{afterParts:[],beforeParts:[],after:request.after??[]},
    description:'Experimental wave hole shoulder: grow from the supported outer rim toward the retained bore.'};
  return {assignments:[assignment],report:{strategy:'wave',scope:'Regular injective spline charts and translated stacks; planar or curved. No normal-offset stack, folded chart or multi-chart stitching.',notes:['Place the reference at the top of the last wave course. Domain depth is layers × layerHeightMm in the calibrated stack. The seed denotes existing material and is not extruded again; inspect residuals and contact before continuing the ordinary bore.']}};
}

export async function editHoleTransition(source,request,Geometry){
  check(request&&['stepped-reduction','membrane','wave'].includes(request.strategy),'Choose stepped-reduction, membrane or wave.');
  check(typeof request.id==='string'&&/^[a-z][a-z0-9-]*$/.test(request.id),'Choose a lowercase hyphenated id.');
  check(request.after===undefined||Array.isArray(request.after)&&request.after.every(id=>typeof id==='string'&&id.length),'after names exact supporting operation IDs.');
  const plan=structuredClone(source),prior=plan.slices?.assignments??[],parent=prior.find(a=>a.id===request.sourceAssignment);
  check(parent&&!parent.construction&&!parent.join,'sourceAssignment must name an ordinary Slice owner.');
  const made=request.strategy==='wave'?wave(request,parent,plan.process):await (request.strategy==='membrane'?membrane:stepped)(plan,request,parent,Geometry);
  check(made.assignments.every(a=>!prior.some(old=>old.id===a.id)),'Transition ids already exist; undo the prior application or choose a distinct hole id.');
  let assignments=[...prior,...made.assignments];
  if(request.strategy==='wave'){
    const Recipe=Geometry.Recipe;
    check(Recipe&&request.boreTo,'Wave holes need boreTo selecting continuing wall operations.');
    check(!Array.isArray(request.boreTo)||request.boreTo.length,'boreTo cannot be empty.');
    check(!Array.isArray(request.seedFrom)||request.seedFrom.length,'seedFrom cannot be empty.');
    check(request.seedFrom||request.after?.length,'Wave holes need seedFrom selecting printed seed material, or explicit after operation IDs.');
    const anchors=request.seedFrom?(Array.isArray(request.seedFrom)?request.seedFrom:[request.seedFrom]).map(target=>Recipe.operationId(assignments,target)):request.after;
    made.assignments[0].dependencies.after=[...new Set([...made.assignments[0].dependencies.after,...anchors])];
    const targets=Array.isArray(request.boreTo)?request.boreTo:[request.boreTo];
    for(const target of targets)assignments=Recipe.withOperationAfter(assignments,target,[{assignment:request.id}]);
    made.report.dependencies={anchor:[...made.assignments[0].dependencies.after],terminal:{assignment:request.id},continuation:targets.map(target=>Recipe.operationId(assignments,target))};
  }
  return {geometry:plan.geometry,assignmentRequests:assignments,report:{...made.report,physicalQualification:'Unverified; review cooling, span, attachment and finishing.'}};
}
