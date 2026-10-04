// Geometry turns a normalized text feature into a mapped solid request. The
// extension owns feature defaults, ordering, Boolean composition and records.
import {requireThat,distance,cross,normalize} from './tolerance.mjs';
import {textOutlines} from './text-outline.mjs';
import {textLayout} from './text-layout.mjs';
import {referenceSurface} from './reference-surface.mjs';
import {union} from '../region/intersection.mjs';

// The layout's tangent frame at the anchor, applied rigidly to the whole group.
function anchoredLayout(layout,a,anchor,mirror){
  const h=0.0001,dx=layout(a[0]+h,a[1]).map((v,i)=>(v-anchor[i])/h),length=Math.hypot(...dx);
  const x=dx.map(v=>v/length),y=[-x[1],x[0]].map(v=>v*(mirror?-1:1));
  return (u,v)=>anchor.map((p,i)=>p+(u-a[0])*x[i]+(v-a[1])*y[i]);
}

function layoutGroup(group,feature,toleranceMm){
  const layout=textLayout(feature,toleranceMm);
  const anchor=group.anchor?layout(...group.anchor):null;
  const map=group.anchor?anchoredLayout(layout,group.anchor,anchor,feature.mirror):layout;
  const refine=(a,b,pa,pb,out)=>{
    const m=a.map((v,i)=>(v+b[i])/2),pm=map(...m),chord=pa.map((v,i)=>(v+pb[i])/2);
    requireThat(pm.every(Number.isFinite),'Baseline layout produced a non-finite point.');
    if(distance(pm,chord)<=toleranceMm){out.push(pb);return;}
    requireThat(m.some((v,i)=>v!==a[i])&&m.some((v,i)=>v!==b[i]),'Baseline layout reached the smallest representable step without meeting its chord tolerance.');
    refine(a,m,pa,pm,out);refine(m,b,pm,pb,out);
  };
  const loops=group.loops.map(loop=>{const out=[];for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];refine(a,b,map(...a),map(...b),out);}return out;});
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

export function mappedTextMaterial(feature,target,{toleranceMm,maxEdgeMm}){
  const outline=textOutlines(feature,toleranceMm),reference=referenceSurface(feature.reference,target);
  const lower=feature.offsetMm+(feature.mode==='raised'?-feature.overlapMm:-feature.depthMm);
  const upper=feature.offsetMm+(feature.mode==='raised'?feature.depthMm:feature.overlapMm);
  const glyphs=(feature.bendGlyphs?[{loops:outline.loops}]:outline.glyphs).map(group=>{
    const placed=layoutGroup(group,feature,toleranceMm);
    return {operation:'mapped-extrusion',loops:placed.loops,map:mapper(reference,placed.anchor),lower,upper,maxEdgeMm,toleranceMm,normalSide:feature.reference.normalSide??1};
  });
  return glyphs.reduce((a,b)=>a?{operation:'union',operands:[a,b]}:b,null);
}
