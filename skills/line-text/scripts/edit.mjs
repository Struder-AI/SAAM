import {loadFont} from './catalog.mjs';
import {lineText} from './compile.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

// Replace one identified text assignment while preserving independent work.
// The returned assignment contains ordinary Trace centerlines and remains
// printable and viewable without loading this extension later.
export async function editLineText(source,request,{Geometry,Toolpath,part=null}={}){
  requireThat(request&&typeof request==='object'&&!Array.isArray(request),'Line text needs a request.');
  requireThat(Object.keys(request).every(key=>['id','fontId','text','heightMm','weight','stemRatio','beadRangeMm',
    'origin','layers','layerMm','letterSpacingMm','align','chain','onInfeasible','reference','substrate','remove'].includes(key)),
    'Unknown line-text request field.');
  const id=request.id;
  requireThat(typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id),'Line text needs a stable assignment id.');
  const assignments=structuredClone(source.slices?.assignments??[]),at=assignments.findIndex(a=>a.id===id);
  if(request.remove){
    requireThat(at>=0,`Line text assignment ${id} is absent.`);
    assignments.splice(at,1);
    return {assignments,report:{id,removed:true}};
  }
  requireThat(at<0||assignments[at].curves?.every(c=>c.role==='line-text'),
    `Assignment ${id} belongs to another construction.`);
  const origin=request.origin;
  requireThat(Array.isArray(origin)&&origin.length===3&&origin.every(Number.isFinite),'Line text origin must be finite XYZ.');
  requireThat(request.layerMm===undefined||Number.isFinite(request.layerMm)&&request.layerMm>0,'Line text layerMm must be positive.');
  requireThat(request.letterSpacingMm===undefined||Number.isFinite(request.letterSpacingMm),'Line text letterSpacingMm must be finite.');
  requireThat(request.align===undefined||['left','center','right'].includes(request.align),'Unknown text alignment.');
  requireThat(request.chain===undefined||typeof request.chain==='boolean','Line text chain must be boolean.');
  requireThat(request.onInfeasible===undefined||['reduce','error'].includes(request.onInfeasible),'Text infeasibility mode must be reduce or error.');
  const font=loadFont(request.fontId);
  const compiled=lineText({...request,font,firstLayerMm:origin[2],strokeTopology:Geometry?.strokeTopology});
  const reference=request.reference;
  if(reference?.kind==='slice'){
    requireThat(typeof reference.assignment==='string'&&Number.isSafeInteger(reference.index)&&reference.index>=0&&
      Object.keys(reference).every(key=>['kind','assignment','index'].includes(key)),'Manufactured lettering surface needs an assignment and native slice index.');
  }else if(reference){
    requireThat(['part','spline','plane','plate'].includes(reference.kind),'Line text reference must be a manufactured slice, part patch, build plate, independent plane or spline.');
    const shell=reference.kind==='part'?(await Geometry.resolveGeometrySelections(source.geometry,[{selection:part}]))[0]:null;
    const surface=Geometry.referenceSurface(reference,shell);
    for(const curve of compiled.assignment.curves)for(const [x,y] of curve.points)Geometry.evaluateSurface(surface,[x+origin[0],y+origin[1]]);
  }
  const substrate=Object.hasOwn(request,'substrate')?request.substrate:reference?.kind==='slice'?{assignment:reference.assignment,index:reference.index}:null;
  const curveReference=reference?.kind==='slice'?reference:{kind:'surface',surface:reference,part};
  const layers=request.layers??2,layerMm=request.layerMm??.2;
  const curves=Array.from({length:layers},(_,layer)=>compiled.assignment.curves.map(({points,...curve},stroke)=>({...curve,
    id:`stroke-${stroke}-layer-${layer}`,heightMm:layerMm,repetitions:[layer],
    ...(reference?{uv:{reference:curveReference,points:points.map(([x,y])=>[x+origin[0],y+origin[1]]),normalMm:origin[2]+layer*layerMm}}:
      {points:points.map(([x,y,z])=>[x+origin[0],y+origin[1],z+layer*layerMm])})}))).flat();
  const edgeAfter=curves.filter(curve=>curve.repetitions[0]>0).map(curve=>{
    const layer=curve.repetitions[0],stroke=Number(curve.id.split('-')[1]);
    return {target:{assignment:id,part,repetition:layer,edge:{curve:curve.id}},
      after:[{assignment:id,part,repetition:layer-1,edge:{curve:`stroke-${stroke}-layer-${layer-1}`}}]};
  });
  const assignment=Toolpath.curveAssignment({...compiled.assignment,part,curves,substrate:null,edgeAfter,
    ...(substrate?{operationAfter:{0:[substrate]}}:{}),
    repeat:{count:layers,translation:[0,0,0]},sequence:false,...(reference?{toolPose:{alignToSliceNormal:true}}:{})});
  if(at<0)assignments.push(assignment);else assignments[at]=assignment;
  return {assignments,report:{id,fontId:font.id,plan:compiled.plan,...compiled.report,
    ...(reference?{reference,layers,notes:[...(compiled.report.notes??[]),'Surface layout maps sizeMm to UV bounds; it does not preserve physical lettering dimensions on a distorted chart.']}: {})}};
}
