// Compact encoding of the viewer's information level. --details retains the
// original packet; this module neither scans nor changes graph relationships.
import {presentationPage} from './presentation.mjs';
export function compactPage(page, {code = false} = {}) {
  page = presentationPage(page);
  const sourceOnly = code || page.destination === 'code';
  const clean = (value, inheritedFile, top = false) => {
    if (Array.isArray(value)) return value.map(item => clean(item, inheritedFile));
    if (!value || typeof value !== 'object') return value;
    const result = {}, file = value.file ?? inheritedFile;
    const hasRange = Number.isInteger(value.line) && Number.isInteger(value.endLine);
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined || Array.isArray(child) && !child.length) continue;
      if (['start', 'end'].includes(key)) continue;
      if (key === 'file' && !top && child === inheritedFile) continue;
      if (hasRange && ['line', 'endLine', 'lines'].includes(key)) {
        if (key === 'line') result.range = [value.line, value.endLine];
        continue;
      }
      if (key === 'sourceSpan' && child.file === file && child.line === value.line && child.endLine === value.endLine) continue;
      if (key === 'leaf' && value.destination) continue;
      if (key === 'pattern' && child === value.name) continue;
      if (key === 'endpoint' && child === value.index) continue;
      if (key === 'port' && child === value.endpoint) continue;
      if (key === 'callee' && child === value.path) continue;
      result[key] = clean(child, file);
    }
    return result;
  };

  const packet = {...page};
  // Both graph and code destinations carry each incoming caller only once.
  if (page.calledFrom) {
    const represented = new Set([
      ...(page.callerReferences ?? []).map(ref => ref.index),
      ...(page.callerWires ?? []).map(wire => wire.caller ?? wire.from)
    ].filter(Boolean));
    packet.calledFrom = page.calledFrom.filter(ref => !represented.has(ref.index));
  }
  if (sourceOnly) {
    // A page that opens as code still names the pages it would have drawn: the walk down to a
    // declaration it holds or calls stays visible without a second read.
    const keys = ['index', 'path', 'file', 'kind', 'line', 'endLine', 'destination',
      'code', 'source', 'sources', 'sourceKind', 'sourceSha256', 'sourceUnavailable', 'regenerate', 'stale',
      'components', 'facts', 'callerReferences', 'callerWires', 'calledFrom', 'couplings', 'unresolved', 'uncertainty'];
    if (!code) keys.push('inputs', 'outputs');
    return clean(Object.fromEntries(keys.filter(key => key in packet).map(key => [key, packet[key]])), undefined, true);
  }

  delete packet.flow;
  delete packet.generated;
  delete packet.callBindings;
  // File/root children repeat the component/region inventory. Region children
  // remain: they are the file route alongside authored conceptual groups.
  if (page.kind === 'file' || page.kind === 'root') {
    const inventory = page.kind === 'file' ? 'components' : 'regions';
    const children = new Map((page.children ?? []).map(child => [child.index, child]));
    packet[inventory] = (page[inventory] ?? []).map(item => ({...children.get(item.index), ...item}));
    packet.children = (page.children ?? []).filter(child => !packet[inventory].some(item => item.index === child.index));
  }
  // Wires carry producers/consumers and source argument slots. Occurrences keep
  // source identity and analysis limits; expressions and tracing are --details.
  const declarations = new Map((page.components ?? []).map(node => [node.path ?? `${node.file}::${node.label}`, node.index]));
  if (page.callBindings?.length) packet.calls = page.callBindings.map(call => {
    const {arguments: args = [], resultUses, result, callee, callable, ...occurrence} = call;
    const argumentFlags=args.map(arg=>Object.fromEntries(['position','unknown','spread','positionUnknown','constant']
      .filter(key=>arg[key]!==undefined).map(key=>[key,arg[key]])))
      .filter(arg=>Object.keys(arg).length>1);
    return {...occurrence, callee: declarations.get(callee) ?? callee,
      argumentCount:args.length,...(argumentFlags.length?{arguments:argumentFlags}:{}),
      ...(callable?.unknown?{callableUnknown:true}:{}),
      ...(result ? {result: {kind: result.kind,
        ...(result.kind==='binding'&&/^[A-Za-z_$][\w$]*$/.test(result.expression??'')?{binding:result.expression}:{})}} : {})};
  });
  return clean(packet, undefined, true);
}
