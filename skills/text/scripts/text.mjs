import {textTemplate} from "./record.mjs";

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

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

export async function compileText(base,features,{buildGeometry,constructSolids,mappedTextMaterial,toleranceMm=0.02,maxEdgeMm=1,standalone=false}={}){
  requireThat(typeof buildGeometry==='function'&&typeof constructSolids==='function'&&typeof mappedTextMaterial==='function'&&Array.isArray(features)&&features.length>0,
    'Text needs Geometry buildGeometry, constructSolids and mappedTextMaterial operations and at least one feature.');
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
    const textSolid=mappedTextMaterial(f,target,{toleranceMm,maxEdgeMm});
    if(f.mode==='raised')materials.set('text/'+f.id,result?difference(textSolid,result):textSolid);
    else {baseUncut=false;for(const [id,material] of materials)materials.set(id,difference(material,textSolid));}
    result=result?{operation:f.mode==='raised'?'union':'difference',operands:[result,textSolid]}:textSolid;
  }
  const [mesh,...parts]=await constructSolids([result,...materials.values()],{toleranceMm});
  requireThat(mesh,'Text operation produced an empty solid.');
  const record={...textTemplate(),base:structuredClone(base),features:normalized,toleranceMm,maxEdgeMm,vertices:mesh.vertices,triangles:mesh.triangles};
  record.materialParts=[...materials.keys()].flatMap((id,i)=>!parts[i]?[]:[{id,geometry:id==='base'&&baseUncut?null:{shape:'mesh',source:null,vertices:parts[i].vertices,triangles:parts[i].triangles}}]);
  if(standalone)record.standalone=true;
  return record;
}
