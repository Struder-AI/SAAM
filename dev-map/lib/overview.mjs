import {outsideRootOf,isMapped} from './scope.mjs';

const order=(a,b)=>a<b?-1:a>b?1:0;

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
      if(target)return describe(target);
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
  // One relationship between two boxes is one wire. A containment map says that this flow reaches
  // that one and how often; the mechanism and what each site names are counted inside that single
  // wire, not spread over a row each, which only made the reader count arrows. What still splits
  // a wire is what the reader would act on differently: an operator port at either end, a gate,
  // and the leaf a contracted chain runs `via`.
  for(const wire of page.wires??[]) {
    const from=endpoints.get(wire.from)??wire.from,to=endpoints.get(wire.to)??wire.to;
    const key=JSON.stringify([from,to,wire.gate,wire.fromPort,wire.toPort,wire.via]);
    const held=groups.get(key)??groups.set(key,{from,to,kinds:{},names:new Set(),count:0,
      ...(wire.gate!==undefined?{gate:wire.gate}:{}),
      ...(wire.fromPort!==undefined?{fromPort:wire.fromPort}:{}),
      ...(wire.toPort!==undefined?{toPort:wire.toPort}:{}),
      ...(wire.via!==undefined?{via:wire.via}:{})}).get(key);
    for(const kind of wire.kinds?Object.keys(wire.kinds):[wire.kind])
      held.kinds[kind]=(held.kinds[kind]??0)+(wire.kinds?.[kind]??1);
    held.count+=wire.count??1;
    // A call site's label is the argument list, which belongs to the call, not to this map. What
    // a coupling names — a route, a message, a file — is the relationship itself, so it is kept.
    if(wire.label&&!['call','construct'].includes(wire.kind))held.names.add(wire.label);
  }
  // The label says the mechanisms and their counts, and the names when a drawing can still read
  // them. Past that the names stay whole in `names`, so nothing a site said is lost.
  const wires=[...groups.values()].map(({kinds,names,...wire})=>{
    const counted=Object.entries(kinds).sort(([a],[b])=>order(a,b));
    const mechanisms=counted.map(([kind,n])=>n>1?`${kind} ×${n}`:kind).join(', ');
    const named=[...names].sort(order),short=named.length&&named.length<=3;
    return {...wire,...(counted.length===1?{kind:counted[0][0]}:{kinds:Object.fromEntries(counted)}),
      count:wire.count,label:short?`${mechanisms}: ${named.join(', ')}`:mechanisms,
      ...(named.length&&!short?{names:named}:{})};
  });
  // These callers already have a generated boundary wire in this structural view.
  // Repeating each call site as an off-page arrow would undo the overview.
  const components=(page.components??[]).map(({callerReferences,...component})=>component);
  const {boundary,...rest}=page;
  return {...rest,components,inputs,outputs,wires,
    relationshipSummary:{sites:(page.wires??[]).length,connections:wires.length,details:page.index}};
}
