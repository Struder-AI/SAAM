// Compact encoding of the viewer's information level. --details is the same page with the
// stored evidence kept beside it; this module neither scans nor changes graph relationships.
import {presentationPage} from './presentation.mjs';

// What identifies the same thing in the stored packet and in the presented page. A presented
// component is one invocation of a stored box, so several presented items share one stored one.
const identityOf=item=>item&&typeof item==='object'&&!Array.isArray(item)
  ?['index','port'].map(key=>item[key]).find(value=>typeof value==='string'):undefined;
// Fields presentation drops entries from, or aggregates: the stored list is the longer one and
// it says everything the presented one says, so the reading keeps it.
const stored=new Set(['requires','references']);
// Finding rows are regrouped and relocated without losing a row, and they carry no identity of
// their own, so the presented rows are taken whole rather than paired off against the stored.
const presented=new Set(['uncertainty','unresolved','nodeFindings']);
function withEvidence(evidence,shown,again=false) {
  if(Array.isArray(shown)) {
    if(!Array.isArray(evidence))return shown;
    // The presented list is the stored one in place when it keeps every stored item. A shorter
    // one is a second drawing of the same graph — an overview page collapses its ports and
    // wires into relationships — and then both lists are kept, the drawing first.
    const aligned=shown.length>=evidence.length;
    const known=new Map(),used=new Set(),taken=new Set();
    evidence.forEach((item,i)=>{const id=identityOf(item);if(id!==undefined&&!known.has(id))known.set(id,i);});
    const paired=shown.map((item,i)=>{
      const id=identityOf(item);
      // Without an identity the two lists are the same list in the same order; with one that
      // the stored packet does not carry, the presented item stands alone.
      const at=id===undefined?(aligned?i:-1):known.get(id)??-1;
      const repeat=id!==undefined&&taken.has(id);
      if(id!==undefined)taken.add(id);
      if(at<0||at>=evidence.length)return item;
      used.add(at);
      return withEvidence(evidence[at],item,repeat);
    });
    // Nothing stored is dropped: what no presented item carried is kept behind the drawing.
    const kept=evidence.filter((item,i)=>!used.has(i));
    return kept.length?[...paired,...kept]:paired;
  }
  if(!shown||typeof shown!=='object'||!evidence||typeof evidence!=='object'||Array.isArray(evidence))return shown;
  const merged={...evidence};
  for(const [key,value] of Object.entries(shown))
    merged[key]=stored.has(key)&&key in evidence?evidence[key]
      :presented.has(key)?value:withEvidence(evidence[key],value);
  // A caller list belongs to the declaration, not to each invocation of it: it is carried once,
  // by the first box the declaration is drawn as, and every later instance of that box counts
  // its callers as the drawing does.
  if(again&&merged.callerSummary&&!shown.callerReferences)delete merged.callerReferences;
  return merged;
}

// The details read: the page as the map presents it — invocation wires, state nodes, parameter
// targets, finding rows and counts, the boxes a leaf drew here — over the stored packet it was
// made from, so the expressions, producer traces and byte offsets are still under it.
export function detailedPage(page) {
  return withEvidence(page,presentationPage(page));
}
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
    // declaration it holds or calls stays visible without a second read. Its data wires are the
    // drawing it does not get; its invocation wires say which call each box is and which
    // argument slots are stubs, which the source alone does not say.
    // The state it reads and writes is context the source does not name in one place either.
    packet.wires = (page.wires ?? []).filter(wire => wire.kind === 'invocation' || wire.kind === 'state');
    const keys = ['index', 'path', 'file', 'kind', 'line', 'endLine', 'destination',
      'code', 'source', 'sources', 'sourceKind', 'sourceSha256', 'sourceUnavailable', 'regenerate', 'stale',
      'components', 'state', 'wires', 'facts', 'callerReferences', 'callerWires', 'calledFrom', 'couplings', 'unresolved', 'uncertainty'];
    if (!code) keys.push('inputs', 'outputs');
    return clean(Object.fromEntries(keys.filter(key => key in packet).map(key => [key, packet[key]])), undefined, true);
  }

  delete packet.flow;
  delete packet.generated;
  // Per-call-site evidence — argument counts and flags, the callee's traceability, the site's
  // line — is what the drawing turns into one invocation wire per box, with stub or literal
  // slots. The wire is what a reader acts on; the sites behind it are --details.
  delete packet.callBindings;
  delete packet.invocationSites;
  // A group's boundary list is the bookkeeping that ties each generated port back to the wire it
  // was cut from on the parent page. The ports themselves are presented, each carrying its
  // `edgeId` and `parentEndpoint`, and this page is the other end, so the list adds nothing.
  delete packet.boundary;
  // File/root children repeat the component/region inventory. Region children
  // remain: they are the file route alongside authored conceptual groups.
  if (page.kind === 'file' || page.kind === 'root') {
    const inventory = page.kind === 'file' ? 'components' : 'regions';
    const children = new Map((page.children ?? []).map(child => [child.index, child]));
    packet[inventory] = (page[inventory] ?? []).map(item => ({...children.get(item.index), ...item}));
    packet.children = (page.children ?? []).filter(child => !packet[inventory].some(item => item.index === child.index));
  }
  // A gate is a lookup table: every other field points at one by number. Where the only items
  // that pointed at it were the call sites this read no longer carries, the entry is left
  // dangling, so a table nothing on the page indexes is dropped whole. Numbering is never
  // rewritten — a surviving reference means the whole table stays.
  if (packet.gates?.length && !['components', 'operators', 'wires', 'inputs', 'outputs', 'ports']
    .some(field => (packet[field] ?? []).some(item => item.gate !== undefined && item.gate !== null)))
    delete packet.gates;
  return clean(packet, undefined, true);
}
