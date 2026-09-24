// The invocation edge. A call box stands for a call the function makes, so it is attached to
// the function that makes it: one `invocation` wire per box, in call order, carrying the
// condition the call site stands under and the argument slots no data wire reaches as stubs: a
// constant carries its value, a gap its reason.
// A data wire says a value moves from one port to another; an invocation wire says this
// function invokes this box as its Nth call, and carries no value the rule can count. It is
// derived from the call site, never authored, and it is no part of the map-or-code rule:
// `destination.mjs` decides on the stored page, which holds data wires only.
const IDENTIFIER=/^[A-Za-z_$][\w$]*$/;
const PROPERTY=/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
const SLOT=/^arg\d+$/;
const NODE_PAGE=['function','method','handler','class'];

// Bindings a finding of this page already names: a loop variable holds the value of the
// iteration this call runs in, which the tracer does not have, and a branch join holds one of
// several values the branches produced.
const namedBindings=(page,kinds,operators=[])=>new Set([
  ...(page.operators??[]).filter(op=>operators.includes(op.kind)).map(op=>op.binding),
  ...(page.uncertainty??[]).filter(row=>kinds.includes(row.kind)).map(row=>row.binding)
].filter(Boolean));

// Why a slot carries no wire, read off the call site's own expression and the findings this
// page already holds. The classification is cheap and says which gap it is; the expression
// itself stays in `--details`, and the row that records the gap (`argument-origin`) is
// untouched. A constant is the one slot that is not a tracing gap, and it carries its value
// instead of a reason; `literal` remains here only for a constant whose text was not recorded.
const stubReason=(argument,{loops,joins})=>{
  if(argument.spread)return 'spread';
  if(argument.positionUnknown)return 'position-unknown';
  if(argument.constant)return 'literal';
  const text=(argument.expression??'').trim();
  if(!text)return 'untraced';
  if(/^Promise\.(?:all|allSettled|race|any)\s*\(/.test(text))return 'promise-combinator';
  if(/^new\s/.test(text))return 'constructed-value';
  if(/^await\b/.test(text))return 'awaited-value';
  if(IDENTIFIER.test(text))return loops.has(text)?'loop-variable'
    :joins.has(text)?'branch-join':'untraced-binding';
  if(PROPERTY.test(text))return 'property-path';
  if(/[\w$)\]]\s*\(/.test(text))return 'nested-call';
  if(/^[[{]/.test(text))return 'composed-literal';
  return 'computed-expression';
};

// A constant slot is not a gap, so it carries the value rather than a word for it: the panel
// feeding the input, drawn on it. The rendering is the call site's own text on one line, cut
// past LITERAL_LIMIT characters with an ellipsis — a string keeps its quotes, an object, array
// or template its source. A number or boolean spelled the way JSON spells it is carried as
// itself, so a reader gets the value and not a quotation of it; `null` and `undefined` stay
// the words they are written as, which no reader can mistake for an absent slot.
const LITERAL_LIMIT=40;
const literalValue=argument=>{
  const text=(argument.expression??'').replace(/\s+/g,' ').trim();
  if(!text)return undefined;
  if(text==='true')return true;
  if(text==='false')return false;
  if(/^-?[\d.]/.test(text)&&String(Number(text))===text)return Number(text);
  return text.length>LITERAL_LIMIT?`${text.slice(0,LITERAL_LIMIT)}…`:text;
};
// What the slot says: its value when the call site wrote one on this slot, otherwise which gap
// it is. A constant spread over the arguments, or one whose position a spread hid, is still a
// gap: the value is known but the slot it lands on is not, so the reason stands.
const stubOf=(slot,argument,names)=>{
  const reason=stubReason(argument,names);
  const value=reason==='literal'?literalValue(argument):undefined;
  return value===undefined?{slot,reason}:{slot,literal:value};
};

const boxOf=component=>component.id??component.index;
const pathOf=component=>component.path??`${component.file}::${component.label}`;
const bySite=(a,b)=>a.file<b.file?-1:a.file>b.file?1:a.line-b.line||a.column-b.column;

// One wire per drawn box, in call order. A box with no call site of its own is a declaration
// the function holds — a nested helper it passes on, a class member — and says so instead of
// claiming a call.
export function invocationWires(page) {
  const components=page.components??[];
  // A containment map draws no call of its own — its wires are contracted relationships — but a
  // leaf it homes still brings the calls it makes, and those boxes hang off the leaf here too.
  const ownCalls=!page.structural&&NODE_PAGE.includes(page.kind);
  const names={loops:namedBindings(page,['loop-data-flow','iteration-source'],['iteration']),
    joins:namedBindings(page,['branch-data-join','member-mutation'])};
  // An operator the flow dropped and a finding row kept, that no value reaches and nothing
  // takes the result of, is attached to the function that performs it exactly as a call is: the
  // inputs it could not source are stubs on the wire, so the box says where the operation
  // happens and which input is missing, and no box on the page floats.
  const operations=!ownCalls?[]:(page.operators??[]).filter(op=>op.keptFor==='finding'
    &&!(page.wires??[]).some(w=>w.from===op.id||w.to===op.id))
    .map(op=>({kind:'invocation',from:'self',to:op.id,provenance:'operation',
      ...((op.unknownInputs??[]).length?{stubs:(op.unknownInputs??[]).map(port=>
        stubOf(port,(op.arguments??[]).find(a=>a.port===port)??{},names))}:{})}));
  if(!components.length)return operations;
  if(!ownCalls&&!components.some(c=>c.via!==undefined))return [];
  const wired=new Map();
  for(const wire of page.wires??[]) {
    if(!SLOT.test(wire.toPort??''))continue;
    (wired.get(wire.to)??wired.set(wire.to,new Set()).get(wire.to)).add(wire.toPort);
  }
  const order=new Map([...(page.callBindings??[])].sort(bySite).map((call,i)=>[call,i+1]));
  const sites=new Map();
  for(const call of page.callBindings??[]) {
    const box=call.instance??components.find(c=>!c.id&&c.reference!=='callable'&&pathOf(c)===call.callee)?.index;
    if(box===undefined)continue;
    (sites.get(box)??sites.set(box,[]).get(box)).push(call);
  }
  const called=[],held=[],chain=[];
  for(const component of components) {
    // An authored cluster is not a call box: it stands for declarations whose own calls are
    // contracted onto it, and the contracted wires already attach it.
    if(component.kind==='group')continue;
    // A box a leaf drew onto this map is wired from that leaf, with the order and stubs of the
    // invocation wire the leaf's own page draws. The call is the leaf's, not this page's.
    if(component.via!==undefined) {
      const source=components.find(c=>(c.id??c.index)===component.via)
        ??components.find(c=>typeof c.id==='string'&&c.id.startsWith(`${component.via}@`));
      chain.push({kind:'invocation',from:source?boxOf(source):'self',to:boxOf(component),
        provenance:component.viaProvenance??'call-site',order:component.viaOrder??0,
        ...(component.viaSites?{sites:component.viaSites}:{}),
        ...(component.viaStubs?{stubs:component.viaStubs}:{})});
      continue;
    }
    if(!ownCalls)continue;
    const box=boxOf(component),calls=sites.get(box);
    if(!calls) {
      held.push({kind:'invocation',from:'self',to:box,
        provenance:component.reference==='callable'?'reference':'declaration'});
      continue;
    }
    const slots=wired.get(box)??new Set(),stubs=new Map();
    for(const call of calls)for(const argument of call.arguments??[]) {
      const slot=`arg${argument.position}`;
      if(slots.has(slot)||stubs.has(slot))continue;
      stubs.set(slot,stubOf(slot,argument,names));
    }
    // Every enclosing condition of a call is part of the context the call site stands in, and a
    // condition that guards nothing but calls is written nowhere else on the page. The wire the
    // box collapses its sites into carries it: `gate` where every site stands under the same
    // one, `siteGates` — the call's own number and its gate — where they differ or only some of
    // the sites are guarded. Both are numbers into the page's own `gates`.
    const guards=calls.map(call=>({order:order.get(call),gate:call.gate}))
      .filter(site=>site.gate!==undefined&&site.gate!==null).sort((a,b)=>a.order-b.order);
    const same=guards.length===calls.length&&new Set(guards.map(site=>site.gate)).size===1;
    called.push({kind:'invocation',from:'self',to:box,provenance:'call-site',
      order:Math.min(...calls.map(call=>order.get(call))),
      ...(calls.length>1?{sites:calls.length}:{}),
      ...(guards.length?same?{gate:guards[0].gate}:{siteGates:guards}:{}),
      ...(stubs.size?{stubs:[...stubs.values()]}:{})});
  }
  // A chain wire reads after the call it hangs from, however deep the chain runs.
  const rank=new Map(called.map(w=>[w.to,[w.order]]));
  for(const w of chain)rank.set(w.to,null);
  const key=box=>{
    const held=rank.get(box);
    if(held)return held;
    const w=chain.find(x=>x.to===box);
    if(!w)return [Number.MAX_SAFE_INTEGER];
    rank.set(box,[Number.MAX_SAFE_INTEGER]); // a cycle stops here rather than recurring
    const value=[...key(w.from),w.order];
    rank.set(box,value);return value;
  };
  const byCall=(a,b)=>{const x=key(a.to),y=key(b.to);
    for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]??-1)!==(y[i]??-1))return (x[i]??-1)-(y[i]??-1);
    return 0;};
  return [...[...called,...chain].sort(byCall),...held,...operations];
}
