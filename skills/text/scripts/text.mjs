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

// -> {geometry, notes}: the construction's notes; no material is empty geometry with a note.
export async function compileText(base,features,{buildGeometry,constructGeometry,textOutlines,textLayout,mappedRegionMaterial,dimensions,toleranceMm=dimensions.CHORD_TOLERANCE_MM,maxEdgeMm=1,standalone=false}={}){
  requireThat(typeof buildGeometry==='function'&&typeof constructGeometry==='function'&&[textOutlines,textLayout,mappedRegionMaterial].every(operation=>typeof operation==='function')&&Array.isArray(features)&&features.length>0,
    'Text needs Geometry construction, font outlines, layout and mapped-region operations and at least one feature.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0&&Number.isFinite(maxEdgeMm)&&maxEdgeMm>0,'Text toleranceMm and maxEdgeMm must be positive.');
  const normalized=features.map(textFeature);
  requireThat(new Set(normalized.map(f=>f.id)).size===normalized.length,'Text feature ids must be unique.');
  const target=base?await buildGeometry(base):null;
  let result=base&&!standalone?base:null;
  const materials=new Map();let baseUncut=Boolean(result);
  if(result)materials.set('base',result);
  const difference=(a,b)=>({operation:'difference',operands:[a,b]});
  for(const f of normalized){
    requireThat(result||f.mode==='raised','Standalone text must begin with a raised feature.');
    const outline=textOutlines(f,toleranceMm);
    const textSolid=outline.loops.length?mappedRegionMaterial({
      groups:f.bendGlyphs?[{loops:outline.loops}]:outline.glyphs,
      layout:textLayout(f,toleranceMm),mirror:f.mirror,reference:f.reference,
      lower:f.offsetMm+(f.mode==='raised'?-f.overlapMm:-f.depthMm),
      upper:f.offsetMm+(f.mode==='raised'?f.depthMm:f.overlapMm),normalSide:f.reference.normalSide??1
    },target,{toleranceMm,maxEdgeMm}):null;
    if(!textSolid)continue;
    if(f.mode==='raised')materials.set('text/'+f.id,result?difference(textSolid,result):textSolid);
    else {baseUncut=false;for(const [id,material] of materials)materials.set(id,difference(material,textSolid));}
    result=result?{operation:f.mode==='raised'?'union':'difference',operands:[result,textSolid]}:textSolid;
  }
  const [built,...parts]=result?await constructGeometry([result,...materials.values()],{toleranceMm}):[null];
  const record={...textTemplate({solid:true}),base:structuredClone(base),features:normalized,toleranceMm,maxEdgeMm,solid:built?.geometry??{shape:'mesh',source:null,vertices:[],triangles:[]}};
  record.materialParts=[...materials.keys()].flatMap((id,i)=>parts[i].empty?[]:[{id,geometry:id==='base'&&baseUncut?null:parts[i].geometry}]);
  if(standalone)record.standalone=true;
  return {geometry:record,notes:[...built?.notes??[],...(!built||built.empty?['The text leaves no material.']:[])]};
}
