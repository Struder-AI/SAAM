import {loadFont} from './catalog.mjs';
import {lineText} from './compile.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

// Replace one identified text assignment while preserving independent work.
// The returned assignment contains ordinary Trace centerlines and remains
// printable and viewable without loading this extension later.
export function editLineText(source,request,{Geometry}={}){
  requireThat(request&&typeof request==='object'&&!Array.isArray(request),'Line text needs a request.');
  requireThat(Object.keys(request).every(key=>['id','fontId','text','heightMm','weight','stemRatio','beadRangeMm',
    'origin','layers','layerMm','letterSpacingMm','align','chain','onInfeasible','remove'].includes(key)),
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
  const assignment={...compiled.assignment,part:null,sequence:false,courseIds:null,maxExcursionMm:null,
    curves:compiled.assignment.curves.map(curve=>({...curve,
      points:curve.points.map(([x,y,z])=>[x+origin[0],y+origin[1],z])}))};
  if(at<0)assignments.push(assignment);else assignments[at]=assignment;
  return {assignments,report:{id,fontId:font.id,plan:compiled.plan,...compiled.report}};
}
