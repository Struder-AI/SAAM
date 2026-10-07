// Precision-critical callables (Li et al. 2018, Zipper): a callable through which values it
// receives may come back out, in its result (directly, wrapped in a literal it builds, or read
// from a received object) or into a field of another received value. A copy of such a callable
// shared by several callers merges what they pass, and hands every caller everything; a callable
// with no such flow returns only what it makes or reads elsewhere. This is a syntactic, per-callable
// over-approximation used only to choose where copies get more call-site context
// (constraints.mjs cloneFor); it never affects soundness, since every call is wired in every copy.
const FUNCTION=/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/;
const MUTATORS=new Set(['push','unshift','splice','set','add','fill','copyWithin']);
// Calls whose result is a primitive whatever they are handed: global functions and namespaces,
// and methods (on any receiver) that answer with a boolean, number or string.
const PRIMITIVE_GLOBALS=new Set(['Number','String','Boolean','parseFloat','parseInt','isFinite','isNaN','BigInt','Symbol','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI','escape']);
const PRIMITIVE_NAMESPACES=new Set(['Math']);
const PRIMITIVE_METHODS=new Set(['every','some','includes','indexOf','lastIndexOf','findIndex','findLastIndex','join','toFixed','toPrecision','toString','toLocaleString','has','startsWith','endsWith','test','localeCompare','charAt','charCodeAt','codePointAt','trim','trimStart','trimEnd','toLowerCase','toUpperCase','padStart','padEnd','repeat','isArray','isInteger','isFinite','isSafeInteger','isNaN','is','hasOwn','hasOwnProperty','stringify','getTime','valueOf','search','normalize']);
const primitiveCall=c=>c.type==='Identifier'?PRIMITIVE_GLOBALS.has(c.name)
  :c.type==='MemberExpression'&&!c.computed&&(PRIMITIVE_METHODS.has(c.property.name)||c.object.type==='Identifier'&&PRIMITIVE_NAMESPACES.has(c.object.name));

function patternNames(p,out=[]) {
  if(!p)return out;
  switch(p.type) {
    case 'Identifier':out.push(p.name);break;
    case 'AssignmentPattern':patternNames(p.left,out);break;
    case 'RestElement':patternNames(p.argument,out);break;
    case 'ArrayPattern':for(const e of p.elements)patternNames(e,out);break;
    case 'ObjectPattern':for(const q of p.properties)patternNames(q.type==='RestElement'?q.argument:q.value,out);break;
  }
  return out;
}
// Whether a node mentions any of the names (free uses inside nested functions included).
function mentions(n,names) {
  if(!n||typeof n.type!=='string')return false;
  if(n.type==='Identifier')return names.has(n.name);
  if(n.type==='ThisExpression')return names.has('this');
  for(const k in n) {
    if(k==='loc')continue;
    const v=n[k];
    if(Array.isArray(v)){for(const x of v)if(x&&typeof x.type==='string'&&mentions(x,names))return true;}
    else if(v&&typeof v.type==='string'&&(k!=='property'||n.computed)&&(k!=='key'||n.computed)&&mentions(v,names))return true;
  }
  return false;
}

export function precisionCritical(fn) {
  const seed=new Set(fn.params.flatMap(p=>patternNames(p)));
  if(fn.type!=='ArrowFunctionExpression')seed.add('this');
  if(!seed.size)return false;
  const {returns,stores}=flowsOut(fn,seed);
  return returns||stores;
}
// Array methods whose result holds what their callback returns (and, for reduce, the initial
// value), not the receiver's elements.
const CALLBACK_RESULT=new Set(['map','flatMap','reduce','reduceRight']);
// Whether values named in `seed` (and what is computed from them) may reach fn's result
// (returns) or a field of such a value (stores).
function flowsOut(fn,seed) {
  const derived=new Set(seed);
  // Whether an expression's value may hold a received value (primitive-valued forms do not).
  const value=e=>{
    if(!e)return false;
    switch(e.type) {
      case 'Identifier':return derived.has(e.name);
      case 'ThisExpression':return derived.has('this');
      case 'Literal':case 'TemplateLiteral':case 'BinaryExpression':case 'UnaryExpression':case 'UpdateExpression':
      case 'ClassExpression':case 'MetaProperty':case 'YieldExpression':return false;
      case 'MemberExpression':return value(e.object);
      case 'ChainExpression':case 'ParenthesizedExpression':return value(e.expression);
      case 'AwaitExpression':case 'SpreadElement':return value(e.argument);
      case 'ConditionalExpression':return value(e.consequent)||value(e.alternate);
      case 'LogicalExpression':return value(e.left)||value(e.right);
      case 'SequenceExpression':return value(e.expressions.at(-1));
      case 'AssignmentExpression':return value(e.right);
      case 'ArrayExpression':return e.elements.some(value);
      case 'ObjectExpression':return e.properties.some(p=>p.type==='SpreadElement'?value(p.argument):value(p.value));
      case 'FunctionExpression':case 'ArrowFunctionExpression':return mentions(e.body,derived);
      case 'CallExpression':case 'NewExpression':
        if(primitiveCall(e.callee))return false;
        if(e.callee.type==='MemberExpression'&&!e.callee.computed&&CALLBACK_RESULT.has(e.callee.property.name)&&FUNCTION.test(e.arguments[0]?.type)) {
          const cb=e.arguments[0],inner=new Set(derived);
          if(value(e.callee.object))for(const p of cb.params)for(const x of patternNames(p))inner.add(x);
          return flowsOut(cb,inner).returns||e.arguments.slice(1).some(value);
        }
        return (e.callee.type==='MemberExpression'?value(e.callee.object):mentions(e.callee,derived))||e.arguments.some(value);
      default:return mentions(e,derived);  // calls, new, tagged templates: anything they are handed
    }
  };
  // Bindings that may hold received values, to a fixed point over the callable's own body.
  const own=[];
  const collect=(n,top)=>{
    if(!n||typeof n.type!=='string')return;
    if(!top&&FUNCTION.test(n.type))return;
    own.push(n);
    for(const k in n){if(k==='loc')continue;const v=n[k];if(Array.isArray(v))for(const x of v)collect(x,false);else if(v&&typeof v.type==='string')collect(v,false);}
  };
  collect(fn.body,false);
  for(let changed=true;changed;) {
    changed=false;
    const mark=names=>{for(const x of names)if(!derived.has(x)){derived.add(x);changed=true;}};
    for(const n of own) {
      if(n.type==='VariableDeclarator'&&n.init&&value(n.init))mark(patternNames(n.id));
      else if(n.type==='AssignmentExpression'&&n.left.type!=='MemberExpression'&&value(n.right))mark(patternNames(n.left));
      else if((n.type==='ForOfStatement'||n.type==='ForInStatement')&&value(n.right))
        mark(n.left.type==='VariableDeclaration'?n.left.declarations.flatMap(d=>patternNames(d.id)):patternNames(n.left));
    }
  }
  let returns=!!(fn.expression&&value(fn.body)),stores=false;
  for(const n of own) {
    if(n.type==='ReturnStatement'&&value(n.argument))returns=true;
    // A received value stored into a received object, or added to one.
    else if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&value(n.left.object)&&value(n.right))stores=true;
    else if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&!n.callee.computed&&MUTATORS.has(n.callee.property.name)
      &&value(n.callee.object)&&n.arguments.some(value))stores=true;
  }
  return {returns,stores};
}
