// Explicitly assigned sacrificial material. No overhang/angle area discovery.
import {fullFillResult,layerHeights} from '../../full-fill/scripts/fill.mjs';
import {createSectionQuery} from '../../../core/geom/query.mjs';
import {offsetRegion} from '../../../core/region/offset.mjs';
import {union,intersect,difference} from '../../../core/region/intersection.mjs';
import {regionArea} from '../../../core/region/region2d.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {lineSpacing} from '../../../core/path/spacing.mjs';

export const SUPPORT_DEFAULTS={enabled:false,spacingFactor:1,assignments:[],density:0.15,interfaceDensity:0.8,
  interfaceLayers:2,topGapMm:0.2,xyGapMm:0.3,perimeters:1,fillAnglesDeg:[0,90],treeChordMm:0.02};

const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===fields.split(',').sort().join();
const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
export function validateSupports(settings,process) {
  requireThat(typeof settings.enabled==='boolean'&&Array.isArray(settings.assignments),'Invalid support selection.');
  requireThat(finite(settings.density,0.01,1)&&finite(settings.interfaceDensity,0.01,1),'Support density must be 0.01–1.');
  requireThat(Number.isInteger(settings.interfaceLayers)&&settings.interfaceLayers>=0&&settings.interfaceLayers<=20,'Support interfaceLayers must be 0–20.');
  requireThat(finite(settings.topGapMm,0,10)&&finite(settings.xyGapMm,0,10),'Support gaps must be 0–10 mm.');
  requireThat(Number.isInteger(settings.perimeters)&&settings.perimeters>=0,'Support perimeters must be a whole number, zero or more.');
  requireThat(finite(settings.treeChordMm,0.001,0.2),'Support treeChordMm must be 0.001–0.2 mm.');
  requireThat(Array.isArray(settings.fillAnglesDeg)&&settings.fillAnglesDeg.length&&settings.fillAnglesDeg.every(v=>finite(v,-180,180)),'Invalid support fill angles.');
  const ids=new Set();
  for(const a of settings.assignments){
    requireThat(exact(a,'id,style,reason,contactZMm,footprint,treeNodes'),'Support assignments need id, style, reason, contactZMm, footprint and treeNodes.');
    requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id)&&!ids.has(a.id),'Invalid or duplicate support assignment ID.');ids.add(a.id);
    requireThat(['standard','tree'].includes(a.style),'Support style must be standard or tree; use a rimming skill for edge supports.');
    requireThat(typeof a.reason==='string'&&a.reason.trim().length>0,'Describe why this support area was assigned.');
    requireThat(finite(a.contactZMm,process.firstLayerMm+settings.topGapMm,1000),'Support contact height must leave room for a first layer and top gap.');
    requireThat(Array.isArray(a.footprint)&&Array.isArray(a.treeNodes),'Invalid support footprint or tree nodes.');
    if(a.style==='standard'){
      requireThat(a.treeNodes.length===0&&a.footprint.length>0&&a.footprint.every(loop=>Array.isArray(loop)&&loop.length>=3&&loop.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))),'Standard supports need closed footprint loops and no tree nodes.');
      requireThat(regionArea(union(a.footprint,[]))>0,'Support footprint has no material.');
    }else{
      requireThat(a.footprint.length===0&&a.treeNodes.length>=2,'Tree supports need nodes and an empty footprint.');
      const nodes=new Map();
      for(const n of a.treeNodes){
        requireThat(exact(n,'id,parent,point,radiusMm')&&typeof n.id==='string'&&n.id.length>0&&!nodes.has(n.id),'Invalid or duplicate tree node.');
        requireThat(Array.isArray(n.point)&&n.point.length===3&&n.point.every(Number.isFinite)&&n.point[2]>=0&&n.point[2]<=a.contactZMm-settings.topGapMm+1e-8,'Tree node lies outside the support height interval.');
        requireThat(finite(n.radiusMm,process.lineWidthMm,100),'Tree radius must be at least one line width and at most 100 mm.');
        nodes.set(n.id,n);
      }
      for(const n of nodes.values()){
        if(n.parent===null)requireThat(n.point[2]===0,'Tree roots must start on the bed.');
        else {const parent=nodes.get(n.parent);requireThat(parent&&parent.point[2]<n.point[2],'Each tree parent must exist below its child.');}
        if(!a.treeNodes.some(child=>child.parent===n.id))requireThat(Math.abs(n.point[2]-(a.contactZMm-settings.topGapMm))<1e-8,'Tree tips must end at contactZMm minus topGapMm.');
      }
    }
  }
  requireThat(!settings.enabled||settings.assignments.length>0,'Enabled supports need explicitly assigned areas; none are inferred.');
}

function circle(x,y,r,chord){
  const count=Math.max(12,Math.ceil(Math.PI/Math.acos(1-Math.min(chord/r,1))));
  return Array.from({length:count},(_,i)=>[x+r*Math.cos(2*Math.PI*i/count),y+r*Math.sin(2*Math.PI*i/count)]);
}

export function assignedSupportSection(a,z,settings,placement={xMm:0,yMm:0}) {
  if(z>a.contactZMm-settings.topGapMm+1e-8)return [];
  return supportSectionQuery(a,settings,placement)(z);
}

function supportSectionQuery(a,settings,placement) {
  const move=loops=>loops.map(loop=>loop.map(p=>[p[0]+placement.xMm,p[1]+placement.yMm]));
  const top=a.contactZMm-settings.topGapMm+1e-8;
  if(a.style==='standard'){
    const region=move(union(a.footprint,[]));
    return z=>z>top?[]:region;
  }
  const nodes=new Map(a.treeNodes.map(n=>[n.id,n]));
  return z=>{
  if(z>top)return [];
  let region=[];
  for(const n of a.treeNodes){
    const p=nodes.get(n.parent);
    if(!p||z<p.point[2]-1e-8||z>n.point[2]+1e-8)continue;
    const t=(z-p.point[2])/(n.point[2]-p.point[2]);
    const x=p.point[0]+t*(n.point[0]-p.point[0]),y=p.point[1]+t*(n.point[1]-p.point[1]),r=p.radiusMm+t*(n.radiusMm-p.radiusMm);
    region=union(region,[circle(x,y,r,settings.treeChordMm)]);
  }
  return move(region);
  };
}

export function supportResults({plan,machine,shells,modelResults}) {
  const settings=plan.skills.supports,process=plan.process;
  if(!settings?.enabled)return [];
  // The shared plan boundary already ran validateSupports. This producer owns
  // checks on newly derived support/part sections, not another settings pass.
  const top=Math.max(...settings.assignments.map(a=>a.contactZMm-settings.topGapMm));
  const heights=layerHeights(process,0,top),cache=new Map();
  const lastLayer=a=>Math.floor((a.contactZMm-settings.topGapMm-process.firstLayerMm+1e-8)/process.layerMm);
  const assigned=settings.assignments.map(a=>({sectionAt:supportSectionQuery(a,settings,plan.placement),lastLayer:lastLayer(a)}));
  const obstacles=shells.map(shell=>({shell,sectionAt:createSectionQuery(shell,{minFeatureMm:0.4})}));
  for(let index=0;index<heights.length;index++){
    const z=heights[index];let region=[],interfaceRegion=[];
    for(const a of assigned){
      const area=a.sectionAt(z);
      region=union(region,area);
      if(index>a.lastLayer-settings.interfaceLayers)interfaceRegion=union(interfaceRegion,area);
    }
    // This checks only assigned material at slicing planes. It does not scan
    // normals or create support areas, silently trim branches, or reroute them.
    for(const {shell,sectionAt} of obstacles){
      if(z<shell.bounds.min[2]-1e-8||z>shell.bounds.max[2]+1e-8)continue;
      const obstacle=offsetRegion(sectionAt(z).loops,settings.xyGapMm);
      requireThat(regionArea(intersect(region,obstacle))<1e-8,`Assigned support intersects part clearance at Z ${z.toFixed(3)} mm; revise its footprint or branches.`);
    }
    cache.set(index,{region,interfaceRegion});
  }
  const shell={bounds:{min:[0,0,0],max:[0,0,top]}};
  const indexAt=z=>Math.round((z-process.firstLayerMm)/process.layerMm);
  const shared={shell,plan,machine,sectionAt:z=>({loops:cache.get(indexAt(z)).region}),settings:{...settings,spacingFactor:settings.spacingFactor??1,minFeatureMm:0.4,fillOverlap:0.15}};
  const interiors=new Map();
  const body=fullFillResult({...shared,id:'supports',spacingMm:lineSpacing(process.lineWidthMm,settings)/settings.density,
    interiorRegion:(region,i)=>{interiors.set(i,region);return difference(region,cache.get(i).interfaceRegion);}});
  const surface=fullFillResult({...shared,id:'supports:interface',settings:{...shared.settings,perimeters:0},spacingMm:lineSpacing(process.lineWidthMm,settings)/settings.interfaceDensity,
    fillRegionAt:(_region,i)=>cache.get(i).interfaceRegion.length?intersect(interiors.get(i),cache.get(i).interfaceRegion):[]});
  const all=[...body.operations,...surface.operations];
  const byLayer=new Map(),wallsByLayer=new Map(),byRank=new Map();
  for(const op of all){
    if(!byLayer.has(op.layer))byLayer.set(op.layer,[]);byLayer.get(op.layer).push(op);
    if(!byRank.has(op.rank))byRank.set(op.rank,[]);byRank.get(op.rank).push(op.id);
    if(op.id.endsWith(':walls'))wallsByLayer.set(op.layer,op);
  }
  for(const op of all){
    op.phase='supports';
    for(const stroke of op.strokes)stroke.role=op.id.startsWith('supports:interface')?'support-interface':stroke.role==='fill'?'support':'support-wall';
    const walls=wallsByLayer.get(op.layer);
    if(walls&&walls!==op&&!op.after.includes(walls.id))op.after.push(walls.id);
    const lower=byLayer.get(op.layer-1)??[];
    for(const p of lower)if(!op.after.includes(p.id))op.after.push(p.id);
  }
  // Preserve support-before-part even when the locked composer batches layers.
  // For continuous/nonplanar operations use their highest deposition point,
  // rather than treating scheduling rank as physical height.
  const ranks=[...byRank.keys()].sort((a,b)=>a-b);
  for(const result of modelResults)for(const op of result.operations){
    const high=op.strokes.reduce((z,s)=>s.points.reduce((v,p)=>Math.max(v,p[2]),z),-Infinity);
    let low=0,end=ranks.length;
    while(low<end){const mid=(low+end)>>>1;if(ranks[mid]<=high+1e-8)low=mid+1;else end=mid;}
    if(low)op.after.push(...byRank.get(ranks[low-1]));
  }
  body.report.assignments=settings.assignments.map(a=>({id:a.id,style:a.style,reason:a.reason,
    contactZMm:a.contactZMm,actualTopGapMm:a.contactZMm-(process.firstLayerMm+lastLayer(a)*process.layerMm)}));
  body.report.limitations='Bed-rooted supports, explicit branch skeletons, planar contact heights; slice-plane clearance checks only. No automatic support selection or branch routing; physical performance unvalidated.';
  requireThat(all.length>0,'Assigned support produced no strokes; enlarge its footprint or branches.');
  return [body,surface];
}
