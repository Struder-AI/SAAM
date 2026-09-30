// One information level for the human drawing and default agent read. Detailed
// call-boundary tracing stays in the stored packet, available through --details.
import {structuralOverview} from './overview.mjs';
import {invocationInstances} from './instances.mjs';
import {invocationWires} from './invocation.mjs';
const referenceFlags =['unknown', 'positionUnknown', 'executionUnknown', 'possibleTarget', 'usesUnknown',
  'optional', 'omitted', 'defaulted', 'spread', 'rest', 'unmapped'];
const dataPath=/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
function callerReferences(references) {
  return references.map(ref=>{
    const location=ref.index!==undefined&&ref.index!==null&&ref.index!==''?{index:ref.index}:Object.fromEntries(
      ['path','file','line','endLine','column','endColumn'].filter(key=>ref[key]!==undefined).map(key=>[key,ref[key]]));
    const flags=Object.fromEntries(Object.entries(ref).filter(([key,value])=>
      (referenceFlags.includes(key)||key.endsWith('Unknown')||key==='external')&&typeof value==='boolean'));
    return {...location,...flags,...Object.fromEntries(['sites','flagCounts'].filter(key=>ref[key]!==undefined).map(key=>[key,ref[key]]))};
  });
}
const callerFields=(value,summarize=false)=>{
  const {callerReferences:storedReferences,...base}=value;
  const references=storedReferences?callerReferences(storedReferences):null;
  return {...base,
    ...(references?(summarize&&references.length>5
      ? {callerSummary:{count:references.length,index:value.index}}
      : {callerReferences:references}):{}),
    ...(value.calledFrom?{calledFrom:callerReferences(value.calledFrom)}:{})};
};
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
function uncertaintyRows(rows) {
  const grouped=new Map();
  for(const row of rows) {
    if(row.kind!=='closure-capture'||!row.closure||!row.binding||!row.access||row.bindings) {
      grouped.set(Symbol(),[row]);continue;
    }
    const {binding,access,...shared}=row;
    const key=JSON.stringify(Object.fromEntries(Object.entries(shared).sort(([a],[b])=>a.localeCompare(b))));
    const held=grouped.get(key)??[];held.push(row);grouped.set(key,held);
  }
  return [...grouped.values()].map(group=>{
    if(group.length===1)return group[0];
    const {binding,access,...shared}=group[0],bindings={};
    for(const row of group)(bindings[row.access]??=[]).push(row.binding);
    return {...shared,count:group.length,bindings};
  });
}
// Every finding row says which file it is about. A row is read on its node's own page, on a box
// that draws that node, and in a node section of a page that is not the node's own, so the file
// is the node's and travels with the row. The compact read drops it again wherever it only
// repeats the file already in scope.
const located=(rows,file)=>!file||!rows?.length?rows:rows.map(row=>row.file===undefined?{file,...row}:row);
const fileOf=path=>path?.includes('::')?path.slice(0,path.indexOf('::')):undefined;
export function presentationPage(page) {
  page = invocationInstances(structuralOverview(page));
  // Class pages show relationships between members/groups, not execution instances.
  // Multiple underlying member pairs can become the same visible relationship.
  if((page.kind==='class'||page.stateful)&&!page.relationshipSummary) {
    const grouped=new Map();
    for(const w of page.wires??[]) {
      // Closure factories contain actual invocations as well as owned-state
      // relationships. Only the latter can collapse after authored grouping.
      if(page.kind!=='class'&&(!['state','capture'].includes(w.kind)||w.provenance==='state-thread')) {
        grouped.set(Symbol(),w);
        continue;
      }
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
  const {moduleCallSites,children,files,members,codeTargets,...visible} = page;
  if(Array.isArray(files))visible.fileCount=files.length;
  else if(files!==undefined)visible.files=files;
  // Keep the address of each visible box, without also emitting the inventory
  // of descendants hidden behind it. Source expansion uses the stored packet.
  const childByIndex=new Map((children??[]).map(child=>[child.index,child]));
  for(const field of ['components'])if(visible[field])visible[field]=visible[field].map(item=>{
    const child=childByIndex.get(item.index);
    const navigation=Object.fromEntries(['index','path','file','label','lines','nodes','destination']
      .filter(key=>child?.[key]!==undefined).map(key=>[key,child[key]]));
    return {...navigation,...item};
  });
  if(visible.composition){const {groups,...composition}=visible.composition;visible.composition=composition;}
  // Assertion invocations carry their condition wires on the graph. Predicate
  // text and error prose remain in the rich packet and matching source.
  if (page.requires) visible.requires = page.requires.filter(requirement =>
    !page.components?.some(c => c.shape === 'assertion' && c.index === requirement.index));
  page = callerFields(visible);
  const component = c => {
    // A box carries the finding rows of the node it draws, reduced exactly as that node's own
    // page reduces them, and located in the node's own file.
    const nodeFile = c.file ?? page.file;
    if (c.uncertainty) c = {...c, uncertainty: located(uncertaintyRows(c.uncertainty), nodeFile)};
    if (c.unresolved?.length) c = {...c, unresolved: located(c.unresolved, nodeFile)};
    c = callerFields(c,true);
    // The group's own page owns its membership. An enclosing page needs only
    // its address, label and count; raw membership remains in --details.
    if(c.kind==='group'){const {members,files,...group}=c;return group;}
    // What a closure captures is drawn: the holder's own bindings are state nodes wired to this
    // box, and the analysis limits on them are finding rows. The box says it is a function
    // value; it does not also recite the capture list as text.
    if (c.captures) {const {captures, ...box} = c; c = box;}
    if (c.reference === 'callable') return c;
    const calls = (page.callBindings ?? []).filter(call => c.id
      ? call.instance === c.id : call.callee === (c.path ?? `${c.file}::${c.label}`));
    return {...c, ...Object.fromEntries(['possibleTarget', 'executionUnknown']
      .filter(key => calls.some(call => call[key])).map(key => [key, true]))};
  };
  const boundary = (port, output = false) => {
    const {position, pattern, default: fallback, rest, producers, returnCall, ...shown} = port;
    const directReturn = output && page.callBindings?.some(call => call.result?.kind === 'return' &&
      call.resultUses?.some(use => use.kind === 'return' && use.port === port.port));
    const returnedCall=output&&(returnCall??(directReturn?/^(?:await\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(/.exec(port.name??'')?.[1]:null));
    if (returnedCall) shown.name = `${returnedCall} result`;
    else if(output&&port.name?.endsWith('…'))shown.name='return value';
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
      'binding', 'collection', 'operation', 'callee', 'gate', 'optional', 'scope', 'targets', 'possibleTarget', 'callKind', 'keptFor',
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
  // Every box a function page draws is attached to the function that draws it. These wires are
  // added last, so nothing above collapses or relabels them, and they carry no value.
  const invocations = invocationWires(page);
  return {...page,
    ...(page.uncertainty ? {uncertainty: located(uncertaintyRows(page.uncertainty), page.file)} : {}),
    ...(page.unresolved?.length ? {unresolved: located(page.unresolved, page.file)} : {}),
    // One section per node this page draws, reduced exactly as that node's own page reduces it
    // and located in that node's file, which is not always this page's.
    ...(page.nodeFindings ? {nodeFindings: page.nodeFindings.map(section => {
      const file = fileOf(section.path) ?? page.file;
      return {...section,
        ...(section.uncertainty ? {uncertainty: located(uncertaintyRows(section.uncertainty), file)} : {}),
        ...(section.unresolved?.length ? {unresolved: located(section.unresolved, file)} : {})};
    })} : {}),
    ...(page.components ? {components: page.components.map(component)} : {}),
    ...(page.inputs ? {inputs: page.inputs.map(port => boundary(port))} : {}),
    ...(page.outputs ? {outputs: page.outputs.map(port => boundary(port, true))} : {}),
    ...(page.operators ? {operators: page.operators.map(operator)} : {}),
      ...(page.wires||invocations.length ? {wires: [...(page.wires??[]).map(({expression,...wire})=>{
        const returned=wire.kind==='return'&&wire.fromPort==='result'
          ? page.outputs?.find(port=>port.port===wire.to):null;
        if(returned?.returnCall)return {...wire,label:`${returned.returnCall} result`};
        if(!wire.label||dataPath.test(wire.label))return wire;
      if(wire.kind==='gate'||wire.toPort==='control')return {...wire,label:'condition'};
      if(wire.fromPort==='selected')return {...wire,label:'selected result'};
      return wire;
    }),...invocations]} : {}),
    ...(page.gates ? {gates: page.gates.map(gate)} : {})};
}
