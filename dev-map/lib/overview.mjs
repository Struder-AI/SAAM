import {outsideRootOf,isMapped} from './scope.mjs';

// Generated overview anchors follow the enclosing graph's actual containment.
// Exact call sites remain on the stored wires; only inventory views summarize them.
export function attachOverviewAnchors(pages, index) {
  const describe=page=>({index:page.index,name:page.label??page.path??page.file});
  for(const page of pages.values()) {
    if(!page.structural)continue;
    const anchor=(port,owner=page,seen=new Set())=>{
      const key=`${owner.index}:${port.port}`;
      if(seen.has(key))return null;seen.add(key);
      const parent=pages.get(owner.parent);
      if(parent&&port.parentEndpoint) {
        const component=parent.components?.find(c=>c.index===port.parentEndpoint);
        if(component)return {index:component.index,name:component.label??component.path??component.file};
        const outer=[...(parent.inputs??[]),...(parent.outputs??[])].find(p=>p.port===port.parentEndpoint);
        if(outer)return anchor(outer,parent,seen);
      }
      const at=port.index??index.get(port.path),target=pages.get(at);
      if(target) {
        const region=pages.get(at.split('.')[0]);
        if(region&&region.index!==page.index.split('.')[0])return describe(region);
        const file=target.file&&pages.get(index.get(target.file));
        return describe(file??target);
      }
      // Source outside the mapped roots has no invented navigable address. `outside` separates
      // that from a mapped path this drawing simply has no box for: only the former is a scope
      // edge, and only the former is drawn as an arrow ending in a name.
      const path=port.path??port.name??port.outside;
      if(path)return {name:outsideRootOf(path),unmapped:true,...(isMapped(path)?{}:{outside:true})};
      return null;
    };
    for(const port of [...(page.inputs??[]),...(page.outputs??[])]) {
      const found=anchor(port);if(found)port.overviewAnchor=found;
    }
  }
}

export function structuralOverview(page) {
  if(!page.structural||page.relationshipSummary)return page;
  const endpoints=new Map(),ports=(values,direction)=>{
    const grouped=new Map();
    for(const port of values??[]) {
      const anchor=port.overviewAnchor;
      const key=anchor?`${direction}:${anchor.index??anchor.name}`:port.port;
      endpoints.set(port.port,key);
      if(!grouped.has(key))grouped.set(key,anchor?{port:key,...anchor,role:direction==='in'?'incoming-relation':'outgoing-relation'}:port);
    }
    return [...grouped.values()];
  };
  const inputs=ports(page.inputs,'in'),outputs=ports(page.outputs,'out'),groups=new Map();
  for(const wire of page.wires??[]) {
    const from=endpoints.get(wire.from)??wire.from,to=endpoints.get(wire.to)??wire.to;
    const label=['call','construct'].includes(wire.kind)?undefined:wire.label;
    const key=JSON.stringify([from,to,wire.kind,label,wire.gate,wire.fromPort,wire.toPort]);
    const held=groups.get(key);
    if(held)held.count++;
    else groups.set(key,{from,to,kind:wire.kind,count:1,
      ...(label?{label}:{}),
      ...(wire.gate!==undefined?{gate:wire.gate}:{}),
      ...(wire.fromPort!==undefined?{fromPort:wire.fromPort}:{}),
      ...(wire.toPort!==undefined?{toPort:wire.toPort}:{})});
  }
  const wires=[...groups.values()].map(w=>({...w,label:(w.label?`${w.kind}: ${w.label}`:w.kind)+(w.count>1?` ×${w.count}`:'')}));
  // These callers already have a generated boundary wire in this structural view.
  // Repeating each call site as an off-page arrow would undo the overview.
  const components=(page.components??[]).map(({callerReferences,...component})=>component);
  const {boundary,...rest}=page;
  return {...rest,components,inputs,outputs,wires,
    relationshipSummary:{sites:(page.wires??[]).length,connections:wires.length,details:page.index}};
}
