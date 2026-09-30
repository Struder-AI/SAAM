// Boundary provenance is generated from source-addressed call evidence. A caller is
// context for an argument/result, not a claim to be that value's ultimate origin.
export function attachPortReferences(packets,index) {
  const pathAt=new Map([...index].map(([path,at])=>[at,path]));
  const producer=(value,caller)=>{
    const at=index.get(value.endpoint),port=/^(in\d+|op\d+)$/.test(value.endpoint)?value.endpoint:null;
    return {...value,page:caller.index,...(at?{index:at,path:value.endpoint}:{}),
      ...(port?{port:value.port??port}:{} )};
  };
  const use=(value,caller)=>({...value,page:caller.index,
    ...(index.has(value.callee)?{index:index.get(value.callee),path:value.callee}:{} )});
  for(const page of packets.values()) {
    for(const [i,input] of (page.inputs??[]).entries()) {
      input.role='input';input.position??=i+1;input.references=[];
    }
    for(const output of page.outputs??[]) {
      output.role=output.kind==='throw'?'throw':'return';output.references=[];
      output.producers=(page.wires??[]).filter(w=>w.to===output.port&&w.kind!=='gate').map(w=>({
        page:page.index,endpoint:w.from,...(pathAt.has(w.from)?{index:w.from,path:pathAt.get(w.from)}:{port:w.from}),
        ...(w.label?{label:w.label}:{}),...(w.fromPort?{fromPort:w.fromPort}:{})
      }));
    }
  }
  for(const caller of packets.values())for(const call of caller.callBindings??[]) {
    const callee=packets.get(call.callee);if(!callee)continue;
    const context={index:caller.index,path:caller.path,file:call.file,line:call.line,
      column:call.column,start:call.start,end:call.end,
      ...(call.optional?{optional:true}:{}),...(call.executionUnknown?{executionUnknown:true}:{}),
      ...(call.possibleTarget?{possibleTarget:true}:{})};
    const spreadAt=call.arguments.find(a=>a.spread)?.position;
    for(const input of callee.inputs??[]) {
      const position=input.position,exact=call.arguments.find(a=>a.position===position);
      let value;
      if(spreadAt!==undefined&&spreadAt<=position) {
        value={expression:call.arguments.filter(a=>a.position>=spreadAt).map(a=>a.expression).join(', '),
          spread:true,positionUnknown:true,unknown:true,producers:[]};
      } else if(input.rest) {
        const rest=call.arguments.filter(a=>a.position>=position);
        value={expression:`[${rest.map(a=>a.expression).join(', ')}]`,rest:true,
          ...(rest.some(a=>a.unknown)?{unknown:true}:{}),
          producers:rest.flatMap(a=>a.producers.map(p=>producer(p,caller)))};
      } else if(exact) {
        const {position:ignored,...argument}=exact;
        value={...argument,producers:exact.producers.map(p=>producer(p,caller))};
      } else value={omitted:true,expression:input.default??'undefined',
        ...(input.default!==undefined?{defaulted:true}:{}),producers:[]};
      input.references.push({kind:'argument',...context,argument:position,...value});
    }
    for(const output of callee.outputs??[])if(output.role==='return') {
      const uses=(call.resultUses??[]).map(v=>use(v,caller));
      output.references.push({kind:'result',...context,binding:call.result,uses,
        ...(!uses.length&&['binding','expression'].includes(call.result.kind)?{usesUnknown:true}:{})});
    }
  }
}
