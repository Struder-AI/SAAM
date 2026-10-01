import {requireThat,distance,cross,normalize} from '../../../core/private/extensions/numeric.mjs';

import {constructSolids} from '../../../core/geom/solid-operations.mjs';
import {textOutlines} from '../../../core/geom/text-outline.mjs';
import {textLayout} from '../../../core/geom/text-layout.mjs';
import {referenceSurface} from '../../../core/geom/reference-surface.mjs';
import {textTemplate,textDigest} from './record.mjs';
import {union} from '../../../core/region/intersection.mjs';

export const TEXT_DEFAULTS={id:'text',text:'',mode:'raised',sizeMm:6,lineHeightMm:8,letterSpacingMm:0,outlineOffsetMm:0,align:'left',
  direction:null,script:null,language:null,features:[],variation:{},positionMm:[0,0],rotationDeg:0,mirror:false,
  depthMm:0.6,offsetMm:0,overlapMm:0.1,bendGlyphs:true,baseline:null,reference:null,font:null};

export function textFeature(spec){
  requireThat(spec&&Object.keys(spec).every(k=>Object.hasOwn(TEXT_DEFAULTS,k)),'Unknown text feature setting.');
  const f={...structuredClone(TEXT_DEFAULTS),...structuredClone(spec)};
  requireThat(typeof f.id==='string'&&/^[\w-]+$/.test(f.id)&&typeof f.text==='string'&&f.text.length>0,'Text needs a feature id and nonempty text.');
  requireThat(['raised','recessed'].includes(f.mode)&&['left','center','right'].includes(f.align),'Invalid text mode or alignment.');
  for(const k of ['sizeMm','lineHeightMm','depthMm'])requireThat(Number.isFinite(f[k])&&f[k]>0,'Text '+k+' must be positive.');
  for(const k of ['letterSpacingMm','outlineOffsetMm','offsetMm','rotationDeg'])requireThat(Number.isFinite(f[k]),'Text '+k+' must be finite.');
  requireThat(Number.isFinite(f.overlapMm)&&f.overlapMm>=0,'Text overlapMm must be nonnegative.');
  requireThat(Array.isArray(f.positionMm)&&f.positionMm.length===2&&f.positionMm.every(Number.isFinite)&&typeof f.mirror==='boolean'&&typeof f.bendGlyphs==='boolean','Invalid text placement.');
  requireThat([null,'ltr','rtl'].includes(f.direction)&&[f.script,f.language].every(v=>v===null||typeof v==='string')&&Array.isArray(f.features)&&f.features.every(v=>typeof v==='string')&&f.variation&&typeof f.variation==='object'&&!Array.isArray(f.variation),'Invalid font shaping settings.');
  requireThat(f.font&&typeof f.font.data==='string'&&typeof f.font.sha256==='string','Text requires a saved font. Use fontPath through the text tool.');
  return f;
}

function layoutGroup(group,feature,toleranceMm){
  let map=textLayout(feature,toleranceMm);
  const anchor=group.anchor?map(...group.anchor):null;
  if(group.anchor){
    const h=0.0001,a=group.anchor,dx=map(a[0]+h,a[1]).map((v,i)=>(v-anchor[i])/h),length=Math.hypot(...dx);
    const x=dx.map(v=>v/length),y=[-x[1],x[0]].map(v=>v*(feature.mirror?-1:1));
    map=(u,v)=>anchor.map((p,i)=>p+(u-a[0])*x[i]+(v-a[1])*y[i]);
  }
  // The chord tolerance decides the subdivision; it ends when a midpoint is no
  // longer distinct from its ends, which is reported instead of a depth budget.
  const refine=(a,b,pa,pb,out)=>{
    const m=a.map((v,i)=>(v+b[i])/2),pm=map(...m),chord=pa.map((v,i)=>(v+pb[i])/2);
    requireThat(pm.every(Number.isFinite),'Baseline layout produced a non-finite point.');
    if(distance(pm,chord)<=toleranceMm){out.push(pb);return;}
    requireThat(m.some((v,i)=>v!==a[i])&&m.some((v,i)=>v!==b[i]),'Baseline layout reached the smallest representable step without meeting its chord tolerance.');
    refine(a,m,pa,pm,out);refine(m,b,pm,pb,out);
  };
  const loops=group.loops.map(loop=>{const out=[];for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];refine(a,b,map(...a),map(...b),out);}return out;});
  // Curve-following layout is still planar: normalize and triangulate after
  // this deformation so cap diagonals cannot cross the newly curved outlines.
  return {loops:union(loops,[]),anchor};
}
function mapper(reference,anchor){
  if(anchor){
    const e=reference(...anchor),h=0.0001;
    const right=reference(anchor[0]+h,anchor[1]),up=reference(anchor[0],anchor[1]+h);
    const x=normalize(right.point.map((v,i)=>v-e.point[i])),n=e.normal;
    let y=normalize(cross(n,x));if(y.reduce((sum,v,i)=>sum+v*(up.point[i]-e.point[i]),0)<0)y=y.map(v=>-v);
    return ([a,b,z])=>e.point.map((v,i)=>v+(a-anchor[0])*x[i]+(b-anchor[1])*y[i]+z*n[i]);
  }
  return ([x,y,z])=>{const e=reference(x,y);return e.point.map((v,i)=>v+z*e.normal[i]);};
}

export async function compileText(base,features,{buildGeometry,toleranceMm=0.02,maxEdgeMm=1,standalone=false}={}){
  requireThat(typeof buildGeometry==='function'&&Array.isArray(features)&&features.length>0,'Text needs a geometry builder and at least one feature.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0&&Number.isFinite(maxEdgeMm)&&maxEdgeMm>0,'Text toleranceMm and maxEdgeMm must be positive.');
  const normalized=features.map(textFeature);
  requireThat(new Set(normalized.map(f=>f.id)).size===normalized.length,'Text feature ids must be unique.');
  const target=base?buildGeometry(base):null;
  let result=target&&!standalone?target:null;
  const materials=new Map();let baseUncut=Boolean(result);
  if(result)materials.set('base',result);
  const difference=(a,b)=>({operation:'difference',operands:[a,b]});
  for(const f of normalized){
    requireThat(result||f.mode==='raised','Standalone text must begin with a raised feature.');
    const outline=textOutlines(f,toleranceMm),reference=referenceSurface(f.reference,target);
    const lower=f.offsetMm+(f.mode==='raised'?-f.overlapMm:-f.depthMm),upper=f.offsetMm+(f.mode==='raised'?f.depthMm:f.overlapMm);
    const glyphs=(f.bendGlyphs?[{loops:outline.loops}]:outline.glyphs).map(group=>{
      const placed=layoutGroup(group,f,toleranceMm);
      return {operation:'mapped-extrusion',loops:placed.loops,map:mapper(reference,placed.anchor),lower,upper,maxEdgeMm,toleranceMm,normalSide:f.reference.normalSide??1};
    });
    // Preserve the existing ordered union of glyphs and material precedence.
    const textSolid=glyphs.reduce((a,b)=>a?{operation:'union',operands:[a,b]}:b,null);
    if(f.mode==='raised')materials.set('text/'+f.id,result?difference(textSolid,result):textSolid);
    else {baseUncut=false;for(const [id,material] of materials)materials.set(id,difference(material,textSolid));}
    result=result?{operation:f.mode==='raised'?'union':'difference',operands:[result,textSolid]}:textSolid;
  }
  const [mesh,...parts]=await constructSolids([result,...materials.values()],{toleranceMm});
  requireThat(mesh,'Text operation produced an empty solid.');
  const record={...textTemplate(),base:structuredClone(base),features:normalized,toleranceMm,maxEdgeMm,vertices:mesh.vertices,triangles:mesh.triangles};
  record.materialParts=[...materials.keys()].flatMap((id,i)=>!parts[i]?[]:[{id,geometry:id==='base'&&baseUncut?null:{shape:'mesh',source:null,vertices:parts[i].vertices,triangles:parts[i].triangles}}]);
  if(standalone)record.standalone=true;
  record.compiledHash=textDigest(record);return record;
}
