import {addSupportBrim} from './brim.mjs';
const check=(condition,message)=>{if(!condition)throw Error(message);};
const positive=(value,name)=>{check(Number.isFinite(value)&&value>0,name+' must be positive.');return value;};
const shift=(curve,delta)=>curve.points?{...curve,points:curve.points.map(point=>point.map((v,k)=>v+delta[k]))}:
  {...curve,nurbs:{...curve.nurbs,controlPoints:curve.nurbs.controlPoints.map(point=>point.map((v,k)=>v+delta[k]))}};
const dot=(a,b)=>a.reduce((sum,v,k)=>sum+v*b[k],0);
const overlaps=([a,b],[c,d])=>Math.max(a,c)<Math.min(b,d)||(a===b?a>=c&&a<=d:c===d&&c>=a&&c<=b);

// Each local column advances independently. Whole sloping-course prerequisites
// would make its low end wait for unrelated work at its high end.
function pieces(contacts,tolerance){
  const cuts=[];
  for(const t of [0,1,...contacts.flatMap(contact=>contact.ranges.flat())].sort((a,b)=>a-b))if(!cuts.length||t-cuts.at(-1)>tolerance)cuts.push(t);
  cuts[cuts.length-1]=1;
  return cuts.slice(1).map((end,i)=>[cuts[i],end]).filter(([a,b])=>b>a);
}

export async function buildBridgeSupport(spec,process,Geometry,{normal,outwardSide=1,landingContacts=[],baseContacts=[],material=null}={}){
  const width=positive(spec.beadWidthMm??process.lineWidthMm,'beadWidthMm'),speed=positive(spec.speedMmS??process.planarSpeedMmS,'speedMmS');
  const height=positive(spec.layerHeightMm??process.layerMm,'layerHeightMm'),sampleStepMm=positive(spec.sampleStepMm??width/2,'sampleStepMm');
  const pair=Geometry.curvePairSurface(spec.base,spec.landing,{normal,correspondence:spec.correspondence});
  const position=p=>p.slice(0,3).map(value=>value/p[3]);
  const upper=pair.matched.landingControls.reduce((high,p)=>Math.max(high,dot(position(p),normal)),-Infinity);
  const lower=pair.matched.baseControls.reduce((low,p)=>Math.min(low,dot(position(p),normal)),Infinity),bound=upper-lower;
  const divisions=Math.max(1,Math.ceil(positive(bound,'Curve separation')/height));
  check(Number.isSafeInteger(divisions),'Curve divisions exceed integer representation.');
  const samples=Geometry.sampleSpatialCurve(pair.curveAt(1),{sampleStepMm,toleranceMm:Geometry.resolutionMm/4}).samples;
  const curves=[],landingBindings=[],baseBindings=[];
  let previous;
  for(let row=0;row<=divisions;row++){
    const first=pair.curveAt(row/divisions),second=await Geometry.ribbon({curve:first,vertical:normal,depthMm:outwardSide*width});
    check(second.curves.length===1,'The adjacent support path splits at an offset fold; select retained edge portions.');
    if(material)for(const curve of [first,second.curves[0]]){
      const samples=Geometry.sampleSpatialCurve(curve,{sampleStepMm,toleranceMm:Geometry.resolutionMm/4}).samples;
      check(!samples.some(sample=>Geometry.containsPoint(material,sample.point)),'Support centreline crosses part material: '+spec.id+'. Choose a printed base or a clear footprint.');
    }
    const reference=Geometry.curvePairSurface(first,second.curves[0],{normal}).surface;
    const current=Geometry.referenceSurface(reference);
    const below=previous??Geometry.referenceSurface(Geometry.curvePairSurface(shift(first,normal.map(v=>-v*(spec.firstHeightMm??height))),shift(second.curves[0],normal.map(v=>-v*(spec.firstHeightMm??height))),{normal}).surface);
    const contacts=row===divisions?landingContacts:row===0?baseContacts:[],ranges=pieces([...landingContacts,...baseContacts],Geometry.dimensions.ROUNDING_RELATIVE);
    for(const [index,range] of ranges.entries())for(const side of [0,1]){
      const [a,b]=range,id='row-'+row+'-path-'+side+'-piece-'+index;
      const parameters=[a,...samples.map(sample=>sample.t).filter(t=>t>a&&t<b),b];
      const profile=parameters.map(t=>{
        const frame=Geometry.evaluateSurface(current,[t,side]),prior=Geometry.evaluateSurface(below,[t,side]);
        const gap=dot(frame.point.map((v,k)=>v-prior.point[k]),prior.normal)/dot(prior.normal,frame.normal);
        return [(t-a)/(b-a),positive(gap,'Local normal layer height')];
      });
      const local=Geometry.curvePairSurface(Geometry.trimSpatialCurve(first,range),Geometry.trimSpatialCurve(second.curves[0],range),{normal}).surface;
      curves.push({id,closed:false,uv:{reference:{kind:'surface',surface:local},points:[[0,side],[1,side]]},
        role:'breakaway-support',directionRequired:false,seamRequired:false,beadWidthMm:width,
        heightMm:height,vary:{heightMm:profile},speedMmS:speed,sampleStepMm,repetitions:[0],
        ...(row?{after:['row-'+(row-1)+'-path-'+side+'-piece-'+index]}:{})});
      for(const contact of contacts)if(contact.ranges.some(interval=>overlaps(interval,range)))(row===0?baseBindings:landingBindings).push({target:contact.target,curve:id,row});
    }
    previous=current;
  }
  const assignment={id:spec.id,construction:'curves',part:spec.part??null,filament:null,process:null,after:[],curves,
    repeat:{count:1,translation:[0,0,0]},sequence:false,ordered:false,repetitionIds:['wall'],repetitionAfter:{},maxExcursionMm:null,toolPose:{alignToSliceNormal:true}};
  return {assignment,landingBindings,baseBindings,report:{id:spec.id,courses:divisions+1,edgePaths:2,requestedLayerHeightMm:height}};
}

export async function editBridgeSupports(source,request,Geometry){
  check(request&&Object.keys(request).join()==='supports'&&Array.isArray(request.supports)&&request.supports.length,'Supply a nonempty supports array.');
  const Recipe=Geometry.Recipe,prior=source.slices?.assignments??[],ids=new Set(prior.map(assignment=>assignment.id)),made=[],stacks=new Map();
  async function contacts(input,targets,part,width,direction,seam){
    const curve=Geometry.curvePairSurface(input,input,{correspondence:{baseDirection:direction,baseSeam:seam,landingDirection:direction,landingSeam:seam}}).curveAt(0);
    const records=[];
    for(const assignment of new Set(targets.map(target=>target.assignment))){
      const key=JSON.stringify([assignment,part]);if(!stacks.has(key))stacks.set(key,await Recipe.slices({assignment,part}));
      for(const contact of Geometry.curveSliceContacts(curve,stacks.get(key).layers,{sampleStepMm:width/2,includeRanges:true})){
        const target=targets.find(target=>target.assignment===assignment&&target.index===contact.index);
        if(target)records.push({...contact,target});
      }
    }
    check(targets.every(target=>records.some(contact=>contact.target===target)),'An attachment target has no source-curve interval.');return records;
  }
  for(const spec of request.supports){
    check(Object.keys(spec).every(key=>['id','base','landing','correspondence','layerHeightMm','beadWidthMm','sampleStepMm','speedMmS'].includes(key)),'Select base/landing edges; their adjacent material determines the offset side.');
    check(typeof spec.id==='string'&&/^[a-z][a-z0-9-]*$/.test(spec.id)&&!ids.has(spec.id),'Choose an unused lowercase support id.');ids.add(spec.id);
    const landing=await Recipe.selectEdge(spec.landing),targets=landing.targets??(landing.readiness?[landing.readiness]:[]);
    check(targets.length&&targets.every(target=>target&&typeof target==='object'&&Number.isSafeInteger(target.index)),'Select a landing edge with owning native Slice targets.');
    const baseOnBed=spec.base?.kind==='plate';
    check(!baseOnBed||Object.keys(spec.base).every(key=>['kind','curve'].includes(key)),'A plate base supplies kind and an optional curve.');
    const base=baseOnBed?{curve:spec.base.curve}:await Recipe.selectEdge(spec.base),baseTargets=base.targets??(base.readiness?[base.readiness]:[]);
    check(baseOnBed||baseTargets.length,'A printed base needs manufacturing readiness.');
    check(baseOnBed||(base.part??null)===(landing.part??null),'Support base and landing use the same part frame.');
    const normal=landing.materialNormal;check(normal?.length===3,'The landing needs its slice advance direction.');
    const process={...source.process,...landing.process},width=positive(spec.beadWidthMm??process.lineWidthMm,'beadWidthMm');
    const root=source.geometry?.shape==='spatial'?source.geometry.solid:source.geometry;
    const component=root?.shape==='assembly'?root.parts.find(part=>part.id===landing.part):null,material=component?.geometry??root;
    const [preparedMaterial]=await Geometry.prepareGeometrySelections(material,[{}]);
    const outside=(curve,materialSide)=>Geometry.ribbon({geometry:material,curve,vertical:normal,depthMm:width/2,materialSide});
    const offset=await outside(landing.curve,1);check(offset.curves.length,'Select an exposed edge portion.');
    const firstHeight=process.firstLayerMm??process.layerMm;
    const project=point=>{check(Math.abs(normal[2])>Geometry.dimensions.ROUNDING_RELATIVE,'A bed base needs an advance direction crossing the plate.');return point.map((v,k)=>v-normal[k]*(point[2]+(component?.zMm??0)-firstHeight)/normal[2]);};
    for(const [pieceIndex,upper] of offset.curves.entries()){
      const piece=offset.report.pieces[pieceIndex],range=landing.selection.range??[0,1];
      const selected=piece.sourceRange[0]===0&&piece.sourceRange[1]===1?landing:await Recipe.selectEdge({...landing.selection,range:piece.sourceRange.map(value=>range[0]+value*(range[1]-range[0]))});
      const selectedTargets=selected.targets??[selected.readiness],id=offset.curves.length===1?spec.id:spec.id+'-piece-'+pieceIndex;
      if(id!==spec.id){check(!ids.has(id),'Support piece id exists: '+id);ids.add(id);}
      let lower,baseSource,localBaseTargets=baseTargets;
      if(baseOnBed){
        if(base.curve){
          const samples=Geometry.sampleSpatialCurve(base.curve,{sampleStepMm:width/2,toleranceMm:Geometry.resolutionMm}).samples;
          check(samples.every(sample=>Math.abs(sample.point[2]+(component?.zMm??0))<=Geometry.resolutionMm),'An explicit plate base must lie on the canonical build plate.');
          lower=shift(Geometry.trimSpatialCurve(base.curve,piece.sourceRange),normal.map(v=>v*firstHeight));
        }else lower={...upper,nurbs:{...upper.nurbs,controlPoints:upper.nurbs.controlPoints.map(project)}};
      }else{
        const range=base.selection.range??[0,1];
        const selectedBase=piece.sourceRange[0]===0&&piece.sourceRange[1]===1?base:await Recipe.selectEdge({...base.selection,range:piece.sourceRange.map(value=>range[0]+value*(range[1]-range[0]))});
        localBaseTargets=selectedBase.targets??[selectedBase.readiness];
        const band=await outside(selectedBase.curve,-1);
        check(band.curves.length===1,'Select a printed base with one exterior ribbon.');baseSource=band.sourceCurves[0];
        lower=shift(band.curves[0],normal.map(v=>v*(spec.layerHeightMm??process.layerMm)));
      }
      const landingContacts=await contacts(offset.sourceCurves[pieceIndex],selectedTargets,landing.part??null,width,spec.correspondence?.landingDirection,spec.correspondence?.landingSeam);
      const baseContacts=baseOnBed?[]:await contacts(baseSource,localBaseTargets,landing.part??null,width,spec.correspondence?.baseDirection,spec.correspondence?.baseSeam);
      const built=await buildBridgeSupport({...spec,id,part:landing.part??null,base:lower,landing:upper,firstHeightMm:baseOnBed?firstHeight:spec.layerHeightMm??process.layerMm},process,Geometry,{normal,outwardSide:piece.side,landingContacts,baseContacts,material:preparedMaterial});
      made.push({...built,baseOnBed,component,report:{...built.report,targetEdge:selected.selection,targets:selectedTargets,outwardSide:piece.side,base:baseOnBed?{kind:'plate'}:localBaseTargets}});
    }
  }
  for(const entry of made){
    const first=entry.assignment.curves.filter(curve=>curve.id.startsWith('row-0-'));
    const {curves,report}=await addSupportBrim({...entry.assignment,curves:first},source,Geometry,{baseOnBed:entry.baseOnBed,component:entry.component,otherAssignments:[...prior,...made.map(item=>item.assignment)]});
    const brim=curves.map((curve,index)=>({...curve,id:'bed-brim-'+index}));
    entry.assignment.curves.unshift(...brim);
    for(const curve of first)if(brim.length)curve.after=brim.map(curve=>curve.id);
    entry.report.brim=report;
  }
  let assignments=[...prior,...made.map(entry=>entry.assignment)];
  for(const entry of made){
    const bindings=[];
    for(const binding of entry.landingBindings){
      const after={assignment:entry.assignment.id,repetition:'wall',part:entry.assignment.part,edge:{curve:binding.curve}};
      assignments=Recipe.withOperationAfter(assignments,binding.target,[after]);bindings.push({target:binding.target,after});
    }
    for(const binding of entry.baseBindings){
      const target={assignment:entry.assignment.id,repetition:'wall',part:entry.assignment.part,edge:{curve:binding.curve}};
      assignments=Recipe.withOperationAfter(assignments,target,[binding.target]);bindings.push({target,after:binding.target});
    }
    entry.report.bindings=bindings;
  }
  return {assignmentRequests:assignments,report:{supports:made.map(entry=>entry.report)}};
}
