import {createStrokeFont} from './strokefont.mjs';
import {createFontCatalog} from './catalog.mjs';
import {createTextLayout} from './layout.mjs';
import {createTextMeasure} from './measure.mjs';
import {createTextPlan} from './plan.mjs';
import {createTextCompiler} from './compile.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

const operationsByGeometry=new WeakMap();
function textOperations(Geometry){
  if(operationsByGeometry.has(Geometry))return operationsByGeometry.get(Geometry);
  const strokeFont=createStrokeFont(Geometry),catalog=createFontCatalog(strokeFont),layout=createTextLayout(Geometry,strokeFont);
  const measure=createTextMeasure(Geometry,strokeFont,layout),plan=createTextPlan(Geometry,measure,catalog);
  const {loadFont}=catalog,{lineText}=createTextCompiler(Geometry,layout,measure,plan);
  const operations=Object.freeze({loadFont,lineText});operationsByGeometry.set(Geometry,operations);return operations;
}

// Add, replace or remove one identified text operation. Line text sees its request, its part and
// SAAM's services; the returned operation contains ordinary Trace centerlines and remains
// printable and viewable without loading this extension later.
export async function lineTextOperations(request,{Geometry,Toolpath,Recipe,part=null}={}){
  const {loadFont,lineText}=textOperations(Geometry);
  requireThat(request&&typeof request==='object'&&!Array.isArray(request),'Line text needs a request.');
  requireThat(Object.keys(request).every(key=>['id','fontId','text','heightMm','weight','stemRatio','beadRangeMm',
    'origin','layers','layerMm','letterSpacingMm','align','chain','onInfeasible','reference','substrate','remove'].includes(key)),
    'Unknown line-text request field.');
  const id=request.id;
  requireThat(typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id),'Line text needs a stable assignment id.');
  const existing=Recipe.assignment(id);
  if(request.remove){
    requireThat(existing,`Line text assignment ${id} is absent.`);
    return {remove:[id],report:{id,removed:true}};
  }
  requireThat(!existing||existing.curves?.every(c=>c.role==='line-text'),
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
    const shell=reference.kind==='part'?await Recipe.preparedPart(part):null;
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
  const {id:_id,...set}=assignment;
  return {...(existing?{change:[{id,set}]}:{add:[assignment]}),report:{id,fontId:font.id,plan:compiled.plan,...compiled.report,
    ...(reference?{reference,layers,notes:[...(compiled.report.notes??[]),'Surface layout maps sizeMm to UV bounds; it does not preserve physical lettering dimensions on a distorted chart.']}: {})}};
}
