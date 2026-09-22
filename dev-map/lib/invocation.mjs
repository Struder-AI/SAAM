// The invocation edge. A call box stands for a call the function makes, so it is attached to
// the function that makes it: one `invocation` wire per box, in call order, carrying the
// argument slots the tracer could not source as marked stubs. A data wire says a value moves
// from one port to another; an invocation wire says this function invokes this box as its Nth
// call, and nothing about a value. It is derived from the call site, never authored, and it is
// no part of the map-or-code rule: `destination.mjs` decides on the stored page, which holds
// data wires only.
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
// untouched. `literal` is the one reason that is not a tracing gap: the value is a constant
// written at the call site, so there is nothing to wire it to.
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

const boxOf=component=>component.id??component.index;
const pathOf=component=>component.path??`${component.file}::${component.label}`;
const bySite=(a,b)=>a.file<b.file?-1:a.file>b.file?1:a.line-b.line||a.column-b.column;

// One wire per drawn box, in call order. A box with no call site of its own is a declaration
// the function holds — a nested helper it passes on, a class member — and says so instead of
// claiming a call.
export function invocationWires(page) {
  if(page.structural||!NODE_PAGE.includes(page.kind))return [];
  const components=page.components??[];
  if(!components.length)return [];
  const names={loops:namedBindings(page,['loop-data-flow','iteration-source'],['iteration']),
    joins:namedBindings(page,['branch-data-join','member-mutation'])};
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
  const called=[],held=[];
  for(const component of components) {
    // An authored cluster is not a call box: it stands for declarations whose own calls are
    // contracted onto it, and the contracted wires already attach it.
    if(component.kind==='group')continue;
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
      stubs.set(slot,{slot,reason:stubReason(argument,names)});
    }
    called.push({kind:'invocation',from:'self',to:box,provenance:'call-site',
      order:Math.min(...calls.map(call=>order.get(call))),
      ...(calls.length>1?{sites:calls.length}:{}),
      ...(stubs.size?{stubs:[...stubs.values()]}:{})});
  }
  return [...called.sort((a,b)=>a.order-b.order),...held];
}
