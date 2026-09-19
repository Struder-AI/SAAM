import {requireThat,distance,cross,normalize} from '../../../core/geom/tolerance.mjs';
import {solidKernel,solidFromMesh,meshFromSolid,combineSolids,discardSolidKernel,KERNEL_TRIANGLE_CAPACITY} from '../../../core/geom/solid.mjs';
import {textOutlines} from '../../../core/geom/text-outline.mjs';
import {textLayout} from '../../../core/geom/text-layout.mjs';
import {referenceSurface} from '../../../core/geom/reference-surface.mjs';
import {tessellateShell} from '../../../core/geom/tessellate.mjs';
import {textTemplate,textDigest} from '../../../core/geom/text-record.mjs';
import {union} from '../../../core/region/intersection.mjs';

export const TEXT_DEFAULTS={id:'text',text:'',mode:'raised',sizeMm:6,lineHeightMm:8,letterSpacingMm:0,outlineOffsetMm:0,align:'left',
  direction:null,script:null,language:null,features:[],variation:{},positionMm:[0,0],rotationDeg:0,mirror:false,
  depthMm:0.6,offsetMm:0,overlapMm:0.1,bendGlyphs:true,baseline:null,reference:null,font:null};

export function textFeature(spec){
  requireThat(spec&&Object.keys(spec).every(k=>Object.hasOwn(TEXT_DEFAULTS,k)),'Unknown text feature setting.');
  const f={...structuredClone(TEXT_DEFAULTS),...structuredClone(spec)};
  requireThat(typeof f.id==='string'&&/^[\w-]{1,64}$/.test(f.id)&&typeof f.text==='string'&&f.text.length>0&&f.text.length<=2000,'Text needs a feature id and 1–2000 characters.');
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

function mappedSolid(kernel,loops,map,lower,upper,{maxEdgeMm,toleranceMm,normalSide=1}){
  let solid=kernel.Manifold.extrude(loops,upper-lower);
  try{
    const shifted=solid.translate([0,0,lower]);solid.delete();solid=shifted;
    // maxEdgeMm and toleranceMm decide the triangle count. Only a mesh the
    // 32-bit kernel cannot address at all is refused in advance; an actual
    // kernel failure discards the aborted instance and names its cause.
    const input=solid.getMesh();let estimated=0;
    const point=id=>Array.from(input.vertProperties.slice(id*input.numProp,id*input.numProp+3));
    for(let i=0;i<input.triVerts.length;i+=3){
      const p=Array.from(input.triVerts.slice(i,i+3),point),n=Math.ceil(Math.max(...p.map((v,j)=>distance(v,p[(j+1)%3])))/maxEdgeMm);
      estimated+=n*n;
    }
    requireThat(estimated<=KERNEL_TRIANGLE_CAPACITY,`Text subdivision at ${maxEdgeMm} mm needs about ${estimated} triangles, beyond the ${KERNEL_TRIANGLE_CAPACITY} the solid kernel can address; increase maxEdgeMm or shorten the text.`);
    const grow=(step,what)=>{
      try{const next=step();solid.delete();return next;}
      catch(error){discardSolidKernel();throw new Error(`The solid kernel failed while ${what}: ${error.message}. Increase maxEdgeMm or toleranceMm, or shorten the text.`);}
    };
    solid=grow(()=>solid.refineToLength(maxEdgeMm),`refining text to ${maxEdgeMm} mm edges`);
    // Each pass quarters the sampled deviation of a smooth reference, so a pass
    // that fails to reduce it is reported as a reference that cannot be
    // resolved rather than counted against a fixed number of passes.
    for(let previousError=Infinity;;){
      const mesh=solid.getMesh();
      let error=0;
      const at=id=>Array.from(mesh.vertProperties.slice(id*mesh.numProp,id*mesh.numProp+3));
      for(let i=0;i<mesh.triVerts.length;i+=3){
        const p=Array.from(mesh.triVerts.slice(i,i+3),at),q=p.map(map);
        for(const w of [[0.5,0.5,0],[0,0.5,0.5],[0.5,0,0.5],[1/3,1/3,1/3]]){
          const mid=p[0].map((_,k)=>p.reduce((sum,v,n)=>sum+v[k]*w[n],0));
          const chord=q[0].map((_,k)=>q.reduce((sum,v,n)=>sum+v[k]*w[n],0));
          error=Math.max(error,distance(map(mid),chord));
        }
      }
      if(error<=toleranceMm){
        // Reversing the reference normal reverses the map's handedness.
        // Manifold's mirror updates winding before the orientation-preserving warp.
        const source=normalSide===-1?solid.mirror([0,0,1]):solid;
        let warped;
        try{warped=source.warp(p=>{const q=map([p[0],p[1],p[2]*normalSide]);p[0]=q[0];p[1]=q[1];p[2]=q[2];});}
        finally{if(source!==solid)source.delete();}
        try{meshFromSolid(warped);return warped;}catch(error){warped.delete();throw error;}
      }
      requireThat(error<previousError*0.9,`Curved text tessellation stopped converging at ${error.toFixed(6)} mm against a ${toleranceMm} mm tolerance; revise the reference or toleranceMm.`);
      previousError=error;
      solid=grow(()=>solid.refine(2),'refining curved text against its reference');
    }
    // A discarded kernel cannot free its own solids; releasing this one must not
    // replace the failure that discarded it.
  }finally{try{solid.delete();}catch{}}
}

export async function compileText(base,features,{buildGeometry,toleranceMm=0.02,maxEdgeMm=1,standalone=false}={}){
  requireThat(typeof buildGeometry==='function'&&Array.isArray(features)&&features.length>0&&features.length<=40,'Text needs a geometry builder and 1–40 features.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0&&Number.isFinite(maxEdgeMm)&&maxEdgeMm>0,'Text toleranceMm and maxEdgeMm must be positive.');
  const normalized=features.map(textFeature);
  requireThat(new Set(normalized.map(f=>f.id)).size===normalized.length,'Text feature ids must be unique.');
  const kernel=await solidKernel(),target=base?buildGeometry(base):null;
  let result=target&&!standalone?solidFromMesh(kernel,tessellateShell(target,{toleranceMm})):null;
  const materials=new Map();let baseUncut=Boolean(result);
  if(result)materials.set('base',result.translate([0,0,0]));
  try{
    for(const f of normalized){
      requireThat(result||f.mode==='raised','Standalone text must begin with a raised feature.');
      const outline=textOutlines(f,toleranceMm),reference=referenceSurface(f.reference,target);
      const lower=f.offsetMm+(f.mode==='raised'?-f.overlapMm:-f.depthMm),upper=f.offsetMm+(f.mode==='raised'?f.depthMm:f.overlapMm);
      let textSolid=null;
      try{
        for(const group of f.bendGlyphs?[{loops:outline.loops}]:outline.glyphs){
          const placed=layoutGroup(group,f,toleranceMm);
          const next=mappedSolid(kernel,placed.loops,mapper(reference,placed.anchor),lower,upper,{maxEdgeMm,toleranceMm,normalSide:f.reference.normalSide??1});
          if(textSolid){const joined=combineSolids(textSolid,next,'add');textSolid.delete();next.delete();textSolid=joined;}else textSolid=next;
        }
        if(f.mode==='raised'){
          // Earlier material owns overlaps. Store only this feature's added
          // volume, so selecting adjacent/overlapping labels cannot print twice.
          materials.set('text/'+f.id,result?textSolid.subtract(result):textSolid.translate([0,0,0]));
        }else{
          baseUncut=false;
          for(const [id,material] of materials){const cut=material.subtract(textSolid);material.delete();materials.set(id,cut);}
        }
        if(result){const next=combineSolids(result,textSolid,f.mode==='raised'?'add':'subtract');result.delete();result=next;}
        else {result=textSolid;textSolid=null;}
      }finally{textSolid?.delete();}
    }
    const mesh=meshFromSolid(result),record={...textTemplate(),base:structuredClone(base),features:normalized,toleranceMm,maxEdgeMm,vertices:mesh.vertices,triangles:mesh.triangles};
    record.materialParts=[];
    for(const [id,solid] of materials)if(!solid.isEmpty()){
      if(id==='base'&&baseUncut)record.materialParts.push({id,geometry:null});
      else{const mesh=meshFromSolid(solid);record.materialParts.push({id,geometry:{shape:'mesh',source:null,vertices:mesh.vertices,triangles:mesh.triangles}});}
    }
    if(standalone)record.standalone=true;
    record.compiledHash=textDigest(record);
    return record;
  }finally{result?.delete();for(const material of materials.values())material.delete();}
}
