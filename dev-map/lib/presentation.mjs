// One information level for the human drawing and default agent read. Detailed
// call-boundary tracing stays in the stored packet, available through --details.
import {structuralOverview} from './overview.mjs';
import {invocationInstances} from './instances.mjs';
const referenceFlags = ['unknown', 'positionUnknown', 'executionUnknown', 'possibleTarget', 'usesUnknown',
  'optional', 'omitted', 'defaulted', 'spread', 'rest'];
function callerReferences(references) {
  return references.map(ref=>{
    const location=ref.index!==undefined&&ref.index!==null&&ref.index!==''?{index:ref.index}:Object.fromEntries(
      ['path','file','line','endLine','column','endColumn'].filter(key=>ref[key]!==undefined).map(key=>[key,ref[key]]));
    const flags=Object.fromEntries(Object.entries(ref).filter(([key,value])=>
      (referenceFlags.includes(key)||key.endsWith('Unknown')||key==='external')&&typeof value==='boolean'));
    return {...location,...flags,...Object.fromEntries(['sites','flagCounts'].filter(key=>ref[key]!==undefined).map(key=>[key,ref[key]]))};
  });
}
const callerFields=value=>({...value,
  ...(value.callerReferences?{callerReferences:callerReferences(value.callerReferences)}:{}),
  ...(value.calledFrom?{calledFrom:callerReferences(value.calledFrom)}:{})});
function boundaryReferences(references) {
  const callers = new Map();
  for (const ref of references) {
    const field = ['index', 'path', 'file'].find(key => ref[key]);
    // Without an identity there is no evidence that two rows share a caller.
    const key = field ? JSON.stringify([field, ref[field]]) : Symbol();
    const group = callers.get(key) ?? [];
    group.push(ref); callers.set(key, group);
  }
  return [...callers.values()].map(group => {
    const first = group[0];
    const location = first.index ? {index: first.index} : Object.fromEntries(
      ['path', 'file'].filter(key => first[key] !== undefined).map(key => [key, first[key]]));
    const sites = group.reduce((count, ref) => count + (ref.sites ?? 1), 0);
    const flagCounts = Object.fromEntries(referenceFlags.map(flag => [flag,
      group.reduce((count, ref) => count + (ref.flagCounts?.[flag] ?? (ref[flag] === true ? ref.sites ?? 1 : 0)), 0)
    ]).filter(([, count]) => count));
    if (sites > 1) return {...location, sites, ...(Object.keys(flagCounts).length ? {flagCounts} : {})};
    return {...location, ...Object.fromEntries(['line', 'column'].filter(key => first[key] !== undefined).map(key => [key, first[key]])),
      ...Object.fromEntries(Object.keys(flagCounts).map(flag => [flag, true]))};
  });
}
export function presentationPage(page) {
  page = invocationInstances(structuralOverview(page));
  // Class pages show relationships between members/groups, not execution instances.
  // Multiple underlying member pairs can become the same visible relationship.
  if(page.kind==='class'&&!page.relationshipSummary) {
    const grouped=new Map();
    for(const w of page.wires??[]) {
      const {edgeId,count,...wire}=w;
      const key=JSON.stringify(wire),held=grouped.get(key);
      if(held)held.count+=count??1;
      else grouped.set(key,{...wire,count:count??1});
    }
    const wires=[...grouped.values()].map(w=>({...w,...(w.kind==='call'&&w.count>1?{label:`call ×${w.count}`}:{})}));
    page={...page,wires,relationshipSummary:{sites:(page.wires??[]).reduce((sum,w)=>sum+(w.count??1),0),connections:wires.length,details:page.index}};
  }
  // Module call-site evidence is available in --details; unresolved rows and
  // the external count already summarize it at the same level as declarations.
  const {moduleCallSites,...visible} = page;
  // Assertion invocations carry their condition wires on the graph. Predicate
  // text and error prose remain in the rich packet and matching source.
  if (page.requires) visible.requires = page.requires.filter(requirement =>
    !page.components?.some(c => c.shape === 'assertion' && c.index === requirement.index));
  page = callerFields(visible);
  const component = c => {
    c = callerFields(c);
    if (c.captures) c = {...c, captures: c.captures.map(({name,access,reference,valueUnknown,lifetimeUnknown,mutationUnknown}) =>
      ({name,access,...(reference?{reference:true}:{}),...(valueUnknown?{valueUnknown:true}:{}),...(lifetimeUnknown?{lifetimeUnknown:true}:{}),
        ...(mutationUnknown?{mutationUnknown:true}:{})}))};
    if (c.reference === 'callable' || c.kind === 'group') return c;
    const calls = (page.callBindings ?? []).filter(call => c.id
      ? call.instance === c.id : call.callee === (c.path ?? `${c.file}::${c.label}`));
    return {...c, ...Object.fromEntries(['possibleTarget', 'executionUnknown']
      .filter(key => calls.some(call => call[key])).map(key => [key, true]))};
  };
  const boundary = (port, output = false) => {
    const {position, pattern, default: fallback, rest, producers, ...shown} = port;
    const directReturn = output && page.callBindings?.some(call => call.result?.kind === 'return' &&
      call.resultUses?.some(use => use.kind === 'return' && use.port === port.port));
    const returnedCall = directReturn && /^(?:await\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(/.exec(port.name ?? '');
    if (returnedCall) shown.name = `${returnedCall[1]} result`;
    if (output && port.fields) shown.name = `{${[...port.fields, ...(port.spread || port.computedKeys ? ['…'] : [])].join(', ')}}`;
    if (output && (port.kind === 'throw' || port.role === 'throw')) {
      const errorCall = /^(?:new\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(/.exec(port.name ?? '');
      if (errorCall) shown.name = errorCall[1];
      else if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(port.name ?? '')) shown.name = 'error';
    }
    if (port.references) shown.references = boundaryReferences(port.references);
    return shown;
  };
  const operator = op => {
    // Boxes identify an operation and its source. Its implementation belongs
    // under that source click, not repeated as a second body on the drawing.
    const fields = ['id', 'kind', 'file', 'line', 'endLine', 'column',
      'binding', 'collection', 'operation', 'callee', 'gate', 'optional', 'scope', 'targets', 'possibleTarget', 'callKind',
      'receiver', 'member', 'optionalReceiver', 'optionalCall'];
    return {...Object.fromEntries(fields.filter(key => op[key] !== undefined).map(key => [key, op[key]])),
      ...Object.fromEntries(Object.entries(op).filter(([key, value]) => key.endsWith('Unknown') && value === true)),
      ...(op.arguments?.some(arg => arg.unknown || arg.fields?.some(field => field.unknown)) ? {argumentUnknown: true} : {})};
  };
  const gate = (g,i) => {
    if(!('text' in g))return g;
    const terms=g.terms??[g],sources=terms.flatMap(t=>t.source?[t.source]:[]);
    const names=[...new Set(terms.map(t=>t.name).filter(Boolean))];
    const name=names.length?names.join(', '):`condition ${i+1}`;
    const source=sources.length?{file:sources[0].file,line:Math.min(...sources.map(s=>s.line)),endLine:Math.max(...sources.map(s=>s.endLine??s.line))}
      :page.file?{file:page.file,line:page.line,endLine:page.endLine}:{};
    return {name,kind:g.kind,branch:terms.at(-1)?.kind??g.kind,...source,
      ...(g.terms?{terms:terms.map((term,j)=>({name:term.name??`condition ${i+1}.${j+1}`,branch:term.kind,
        ...(term.source?{file:term.source.file,line:term.source.line,endLine:term.source.endLine??term.source.line,column:term.source.column}:{})}))}:{})};
  };
  return {...page,
    ...(page.components ? {components: page.components.map(component)} : {}),
    ...(page.children ? {children: page.children.map(callerFields)} : {}),
    ...(page.regions ? {regions: page.regions.map(callerFields)} : {}),
    ...(page.inputs ? {inputs: page.inputs.map(port => boundary(port))} : {}),
    ...(page.outputs ? {outputs: page.outputs.map(port => boundary(port, true))} : {}),
    ...(page.operators ? {operators: page.operators.map(operator)} : {}),
    ...(page.wires ? {wires: page.wires.map(({expression,...wire})=>
      wire.kind === 'gate' && wire.label && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(wire.label)
        ? {...wire,label:'condition'} : wire)} : {}),
    ...(page.gates ? {gates: page.gates.map(gate)} : {})};
}
