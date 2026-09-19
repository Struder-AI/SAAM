// One information level for the human drawing and default agent read. Detailed
// call-boundary tracing stays in the stored packet, available through --details.
import {structuralOverview} from './overview.mjs';
import {invocationInstances} from './instances.mjs';
export function presentationPage(page) {
  page = invocationInstances(structuralOverview(page));
  // Module call-site evidence is available in --details; unresolved rows and
  // the external count already summarize it at the same level as declarations.
  const {moduleCallSites,...visible} = page;
  // Assertion invocations carry their condition wires on the graph. Predicate
  // text and error prose remain in the rich packet and matching source.
  if (page.requires) visible.requires = page.requires.filter(requirement =>
    !page.components?.some(c => c.shape === 'assertion' && c.index === requirement.index));
  page = visible;
  const component = c => {
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
    if (port.references) shown.references = port.references.map(ref => {
      const {index, line, column} = ref;
      const location = index ? {index} : Object.fromEntries(['path', 'file'].filter(k => ref[k] !== undefined).map(k => [k, ref[k]]));
      return {...location, ...(line !== undefined ? {line} : {}), ...(column !== undefined ? {column} : {}),
        ...Object.fromEntries(Object.entries(ref).filter(([key, value]) => value === true &&
          ['unknown', 'positionUnknown', 'executionUnknown', 'possibleTarget', 'usesUnknown',
            'optional', 'omitted', 'defaulted', 'spread', 'rest'].includes(key)))};
    });
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
    ...(page.inputs ? {inputs: page.inputs.map(port => boundary(port))} : {}),
    ...(page.outputs ? {outputs: page.outputs.map(port => boundary(port, true))} : {}),
    ...(page.operators ? {operators: page.operators.map(operator)} : {}),
    ...(page.wires ? {wires: page.wires.map(({expression,...wire})=>wire)} : {}),
    ...(page.gates ? {gates: page.gates.map(gate)} : {})};
}
