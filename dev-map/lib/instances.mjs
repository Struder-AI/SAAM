// A declaration is reusable source; a stage is one invocation of that source.
// The scanner records exact producer/consumer sites before any graph contraction.
export function invocationInstances(page) {
  if(!page.invocationSites||page.structural||page.components?.some(c=>c.id))return page;
  const byPath=new Map();
  for(const call of page.callBindings??[]) {
    const list=byPath.get(call.callee)??[];list.push(call);byPath.set(call.callee,list);
  }
  const instances=new Map(),lookup=new Map(),components=[];
  for(const component of page.components??[]) {
    const path=component.path??`${component.file}::${component.label}`,calls=byPath.get(path)??[];
    const closureReference=component.closure&&(page.wires??[]).some(w=>w.from===component.index&&w.fromPort==='callable'||w.to===component.index&&w.kind==='capture');
    if(!calls.length||calls.length<2&&!closureReference){components.push(component);continue;}
    const copies=calls.map((call,i)=>{
      const id=`${component.index}@${i+1}`;
      const binding=call.result?.kind==='binding'&&/^[A-Za-z_$][\w$]*$/.test(call.result.expression)?call.result.expression:null;
      const {calls:count,gate:combined,captures,closure,...base}=component;
      const copy={...base,id,invocation:{file:call.file,line:call.line,column:call.column},
        ...(call.assertion?{assertion:call.assertion}:{}),
        ...(binding?{binding}:{}),...(call.gate!==undefined?{gate:call.gate}:{}),
        ...(call.executionUnknown?{executionUnknown:true}:{}),...(call.possibleTarget?{possibleTarget:true}:{})};
      lookup.set(`${component.index}:${call.file}:${call.start}:${call.end}`,id);
      return copy;
    });
    instances.set(component.index,copies);components.push(...copies);
  }
  if(!instances.size)return page;
  const missing=[],references=new Set(),endpoint=(at,site,direction,port)=>{
    if(!instances.has(at))return at;
    if(direction==='from'&&port==='callable'&&!site||direction==='to'&&port?.startsWith('capture:')) {
      if(!references.has(at)) {
        const {calls,gate,...source}=(page.components??[]).find(c=>c.index===at);
        components.push({...source,reference:'callable',calls:0});references.add(at);
      }
      return at;
    }
    const found=site&&lookup.get(`${at}:${site.file}:${site.start}:${site.end}`);
    if(found)return found;
    // Compact flow packets omit occurrence spans when a declaration has only one
    // invocation. If that closure also needs a canonical callable reference, the
    // invocation is still unambiguous: ordinary data belongs to its sole copy.
    // Callable-value and capture edges returned above remain on the declaration.
    const copies=instances.get(at);
    if(!site&&copies.length===1)return copies[0].id;
    const id=`untraced:${direction}:${at}`;
    if(!missing.some(p=>p.port===id)) {
      const producer=direction==='from',component=(page.components??[]).find(c=>c.index===at);
      missing.push({port:id,name:`unknown invocation ${producer?'producer':'consumer'} · ${component?.label??at}`,
        index:at,unknown:true,role:`unknown-invocation-${producer?'producer':'consumer'}`,side:producer?'input':'output'});
    }
    return id;
  };
  const wires=(page.wires??[]).map(({sourceSite,targetSite,...wire})=>({...wire,
    from:endpoint(wire.from,sourceSite,'from',wire.fromPort),to:endpoint(wire.to,targetSite,'to',wire.toPort)}));
  // Caller overlays describe declaration dependencies, not invocation dataflow.
  // Keep the canonical addresses when no unique invocation can be established.
  const callerWires=[],declarationReferences=[];
  for(const wire of page.callerWires??[]) {
    if(instances.has(wire.from)||instances.has(wire.to))declarationReferences.push(wire);
    else callerWires.push(wire);
  }
  const calls=(page.callBindings??[]).map(call=>{
    const component=(page.components??[]).find(c=>(c.path??`${c.file}::${c.label}`)===call.callee);
    const id=component&&lookup.get(`${component.index}:${call.file}:${call.start}:${call.end}`);
    return {...call,...(id?{instance:id}:{})};
  });
  return {...page,components,wires,callerWires,callBindings:calls,
    ...(declarationReferences.length?{declarationReferences}:{}),
    inputs:[...(page.inputs??[]),...missing.filter(p=>p.side==='input')],
    outputs:[...(page.outputs??[]),...missing.filter(p=>p.side==='output')],
    ...(missing.length?{uncertainty:[...(page.uncertainty??[]),...missing.map(p=>({kind:'invocation-origin',index:p.index,port:p.port}))]}:{})};
}
