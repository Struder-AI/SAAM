const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
// Tree supports: explicitly placed branches ending at assigned contacts. No
// overhang/angle area discovery. A standard support under a footprint is a
// slice assignment with the support preset (core/print/slices.mjs); trees are
// sliced by the same preset, their branch sections as the layer regions.
const SUPPORT_GAPS={topGapMm:0.2,xyGapMm:0.3};

export const SUPPORT_DEFAULTS={enabled:false,assignments:[],...SUPPORT_GAPS,treeChordMm:0.02};

const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===fields.split(',').sort().join();
const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
export function validateSupports(settings,process) {
  requireThat(exact(settings,Object.keys(SUPPORT_DEFAULTS).join()),`Support settings are ${Object.keys(SUPPORT_DEFAULTS).join(', ')}; a standard support is a slice assignment with the support preset.`);
  requireThat(typeof settings.enabled==='boolean'&&Array.isArray(settings.assignments),'Invalid support selection.');
  requireThat(finite(settings.topGapMm,0,Infinity)&&finite(settings.xyGapMm,0,Infinity),'Support gaps must be nonnegative.');
  requireThat(finite(settings.treeChordMm,Number.MIN_VALUE,Infinity),'Support treeChordMm must be positive.');
  const ids=new Set();
  for(const a of settings.assignments){
    requireThat(exact(a,'id,reason,contactZMm,treeNodes'),'Tree support assignments need id, reason, contactZMm and treeNodes.');
    requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id)&&!ids.has(a.id),'Invalid or duplicate support assignment ID.');ids.add(a.id);
    requireThat(typeof a.reason==='string'&&a.reason.trim().length>0,'Describe why this support area was assigned.');
    requireThat(finite(a.contactZMm,process.firstLayerMm+settings.topGapMm,Infinity),'Support contact height must leave room for a first layer and top gap.');
    requireThat(Array.isArray(a.treeNodes)&&a.treeNodes.length>=2,'Tree supports need nodes.');
    const nodes=new Map();
    for(const n of a.treeNodes){
      requireThat(exact(n,'id,parent,point,radiusMm')&&typeof n.id==='string'&&n.id.length>0&&!nodes.has(n.id),'Invalid or duplicate tree node.');
      requireThat(Array.isArray(n.point)&&n.point.length===3&&n.point.every(Number.isFinite)&&n.point[2]>=0&&n.point[2]<=a.contactZMm-settings.topGapMm+1e-8,'Tree node lies outside the support height interval.');
      requireThat(finite(n.radiusMm,Number.MIN_VALUE,Infinity),'Tree radius must be positive.');
      nodes.set(n.id,n);
    }
    for(const n of nodes.values()){
      if(n.parent===null)requireThat(n.point[2]===0,'Tree roots must start on the bed.');
      else {const parent=nodes.get(n.parent);requireThat(parent&&parent.point[2]<n.point[2],'Each tree parent must exist below its child.');}
      if(!a.treeNodes.some(child=>child.parent===n.id))requireThat(Math.abs(n.point[2]-(a.contactZMm-settings.topGapMm))<1e-8,'Tree tips must end at contactZMm minus topGapMm.');
    }
  }
  requireThat(!settings.enabled||settings.assignments.length>0,'Enabled tree supports need explicitly assigned branches; none are inferred.');
}

function circle(x,y,r,chord){
  const count=Math.max(12,Math.ceil(Math.PI/Math.acos(1-Math.min(chord/r,1))));
  return Array.from({length:count},(_,i)=>[x+r*Math.cos(2*Math.PI*i/count),y+r*Math.sin(2*Math.PI*i/count)]);
}

// A tree's horizontal section at z: linearly interpolated circles between
// each node and its parent, merged.
export function treeSection(a,z,settings,placement={xMm:0,yMm:0}) {
  if(z>a.contactZMm-settings.topGapMm+1e-8)return [];
  const nodes=new Map(a.treeNodes.map(n=>[n.id,n]));
  const regions=[];
  for(const n of a.treeNodes){
    const p=nodes.get(n.parent);
    if(!p||z<p.point[2]-1e-8||z>n.point[2]+1e-8)continue;
    const t=(z-p.point[2])/(n.point[2]-p.point[2]);
    const x=p.point[0]+t*(n.point[0]-p.point[0]),y=p.point[1]+t*(n.point[1]-p.point[1]),r=p.radiusMm+t*(n.radiusMm-p.radiusMm);
    regions.push([circle(x+placement.xMm,y+placement.yMm,r,settings.treeChordMm)]);
  }
  return regions;
}

// Tree supports as one support-preset slice result: interface layers are the
// preset's solid top of the merged branch sections.
export function prepareSupportContexts({plan,processForAssignment,shells},{Geometry,Toolpath}) {
  const settings=plan.skills?.supports;
  if(!settings?.enabled)return [];
  const process=processForAssignment({id:'supports'});
  const top=Math.max(...settings.assignments.map(a=>a.contactZMm-settings.topGapMm));
  // Only authored branches are sectioned; Geometry checks the explicit
  // clearance at these levels without discovering or rerouting supports.
  const family=Geometry.planarRegionLayers({topZ:top,process,shells,clearanceMm:settings.xyGapMm,
    regionsAt:z=>settings.assignments.flatMap(a=>treeSection(a,z,settings,plan.placement))});
  const lastLayer=a=>Math.floor((a.contactZMm-settings.topGapMm-process.firstLayerMm+1e-8)/process.layerMm);
  return [Toolpath.prepareSliceRegionContext({plan,id:'supports',preset:'support',processForAssignment,family,endMm:top,
    validateResult:result=>requireThat(result.operations.length>0,'Assigned tree support produced no strokes; enlarge its branches.'),
    report:{assignments:settings.assignments.map(a=>({id:a.id,reason:a.reason,
      contactZMm:a.contactZMm,actualTopGapMm:a.contactZMm-(process.firstLayerMm+lastLayer(a)*process.layerMm)})),
    limitations:'Bed-rooted branches, explicit skeletons, planar contact heights; slice-plane clearance checks only. No automatic branch routing; physical performance unvalidated.'}})];
}

// Support layers print before every part operation reaching above them, even
// when the composer batches layers. For continuous and nonplanar operations
// the highest deposition point counts, not the scheduling rank.
export function supportDependencies(supports,modelResults) {
  const byRank=new Map();
  for(const op of supports.flatMap(r=>r.operations)){if(!byRank.has(op.rank))byRank.set(op.rank,[]);byRank.get(op.rank).push(op.id);}
  const ranks=[...byRank.keys()].sort((a,b)=>a-b),dependencyChanges=[];
  if(!ranks.length)return dependencyChanges;
  for(const result of modelResults)for(const op of result.operations){
    const high=op.strokes.reduce((z,s)=>s.points.reduce((v,p)=>Math.max(v,p[2]),z),-Infinity);
    let low=0,end=ranks.length;
    while(low<end){const mid=(low+end)>>>1;if(ranks[mid]<=high+1e-8)low=mid+1;else end=mid;}
    if(low)dependencyChanges.push({operationId:op.id,after:[...byRank.get(ranks[low-1])],mode:'append'});
  }
  return dependencyChanges;
}

export function supportRuntime(engines){return {validateSupports,prepareSupportContexts:input=>prepareSupportContexts(input,engines),supportDependencies};}
