// Computed property keys the analysis can name without solving. `o[i]` with `i` a number reads
// an element, never a named field; `o[key]` with `key` one of a literal list of strings reads
// those fields. Anything else reads (or writes) every field, which merges unrelated values, so
// naming keys is where the analysis gets much of its precision on numeric code
// (DEVLOG 2026-10-04, sound whole scope).
//
// keyInfo(ast) resolves every identifier of a module to its binding (lexical scopes of an ES
// module: function, block, for-head, catch, class and static-block scopes, `var` hoisting) and
// classifies each binding from all of its definitions:
// - numeric: a variable whose every initial value and every assignment is a number (literals,
//   arithmetic, `++`, Math.*, Number(), parseInt, other numeric variables), never destructured
//   into or looped over;
// - strings: a const string, or a loop variable over a literal list of strings, never assigned;
// - a plain parameter (and a variable computed from one) is numeric only if every
//   invocation of its function passes a number there (an array method's index): the engine
//   decides that while solving (constraints.mjs paramKey), and widens the key when it does not.
// A name that resolves to no binding is a global and is never trusted.
const NUMERIC_BINARY=new Set(['-','*','/','%','**','<<','>>','>>>','&','|','^']);
const NUMERIC_CALLS=new Set(['Number','parseInt','parseFloat']);
export const ELEMENT='[]';
// Every number names the element field: o[i] and o[-1], o[0.5] or o[NaN] alike, and so does a
// string that is a number's canonical form ('1', '-1', 'NaN'), which is the same property.
export const literalKey=v=>typeof v==='number'||typeof v==='bigint'||String(Number(v))===String(v)?ELEMENT:String(v);

class Scope {
  constructor(parent,fnScope){this.parent=parent;this.names=new Map();this.fnScope=fnScope??this;}
  declare(name,rec){let r=this.names.get(name);if(!r){r=rec;this.names.set(name,r);}return r;}
  lookup(name){for(let s=this;s;s=s.parent){const r=s.names.get(name);if(r)return r;}return null;}
}
const patternIds=(p,out=[])=>{
  if(!p)return out;
  switch(p.type){
    case 'Identifier':out.push(p);break;
    case 'ObjectPattern':for(const q of p.properties)patternIds(q.type==='RestElement'?q.argument:q.value,out);break;
    case 'ArrayPattern':for(const q of p.elements)patternIds(q,out);break;
    case 'RestElement':patternIds(p.argument,out);break;
    case 'AssignmentPattern':patternIds(p.left,out);break;
  }
  return out;
};
const isFunction=n=>n.type==='FunctionDeclaration'||n.type==='FunctionExpression'||n.type==='ArrowFunctionExpression';
const children=n=>{const out=[];for(const k in n){if(k==='loc')continue;const v=n[k];if(Array.isArray(v)){for(const x of v)if(x&&typeof x.type==='string')out.push(x);}else if(v&&typeof v.type==='string')out.push(v);}return out;};

export function keyInfo(ast) {
  const scopeOf=new Map(),recordOf=new Map(),records=[];
  const rec=(kind,extra={})=>{const r={kind,inits:[],writes:[],...extra};records.push(r);return r;};
  // `var` declarations of a function body (not inside nested functions).
  const hoistVars=(body,scope)=>{
    const visit=n=>{
      if(!n||typeof n.type!=='string'||isFunction(n))return;
      if(n.type==='VariableDeclaration'&&n.kind==='var')for(const d of n.declarations)for(const id of patternIds(d.id))scope.declare(id.name,rec('var'));
      if(n.type==='StaticBlock')return;
      for(const c of children(n))visit(c);
    };
    for(const s of body)visit(s);
  };
  const declareLexical=(statements,scope)=>{
    for(const s0 of statements) {
      const s=s0.type==='ExportNamedDeclaration'||s0.type==='ExportDefaultDeclaration'?s0.declaration:s0;
      if(!s)continue;
      if(s.type==='VariableDeclaration'&&s.kind!=='var')for(const d of s.declarations)for(const id of patternIds(d.id))scope.declare(id.name,rec(s.kind));
      if(s.type==='FunctionDeclaration'&&s.id)scope.declare(s.id.name,rec('function'));
      if(s.type==='ClassDeclaration'&&s.id)scope.declare(s.id.name,rec('class'));
      if(s.type==='ImportDeclaration')for(const sp of s.specifiers)scope.declare(sp.local.name,rec('import'));
    }
  };
  // Pass A: scopes and declarations.
  const build=(n,scope)=>{
    if(!n||typeof n.type!=='string')return;
    if(isFunction(n)) {
      const outer=n.type==='FunctionExpression'&&n.id?new Scope(scope,scope.fnScope):scope;
      if(outer!==scope)outer.declare(n.id.name,rec('function'));
      const fs=new Scope(outer);fs.fnScope=fs;scopeOf.set(n,fs);
      n.params.forEach((p,index)=>{
        if(p.type==='Identifier')fs.declare(p.name,rec('param',{fn:n,index}));
        else for(const id of patternIds(p))fs.declare(id.name,rec('pattern-param'));
      });
      if(n.type!=='ArrowFunctionExpression')fs.declare('arguments',rec('arguments'));
      if(n.body.type==='BlockStatement'){hoistVars(n.body.body,fs);declareLexical(n.body.body,fs);scopeOf.set(n.body,fs);for(const s of n.body.body)build(s,fs);}
      else build(n.body,fs);
      for(const p of n.params)build(p,fs);
      return;
    }
    switch(n.type) {
      case 'Program':{const s=new Scope(null);scopeOf.set(n,s);hoistVars(n.body,s);declareLexical(n.body,s);for(const c of n.body)build(c,s);return;}
      case 'BlockStatement':{const s=new Scope(scope,scope.fnScope);scopeOf.set(n,s);declareLexical(n.body,s);for(const c of n.body)build(c,s);return;}
      case 'StaticBlock':{const s=new Scope(scope);s.fnScope=s;scopeOf.set(n,s);hoistVars(n.body,s);declareLexical(n.body,s);for(const c of n.body)build(c,s);return;}
      case 'SwitchStatement':{build(n.discriminant,scope);const s=new Scope(scope,scope.fnScope);scopeOf.set(n,s);
        declareLexical(n.cases.flatMap(c=>c.consequent),s);for(const c of n.cases){build(c.test,s);for(const x of c.consequent)build(x,s);}return;}
      case 'ForStatement':case 'ForInStatement':case 'ForOfStatement':{
        const s=new Scope(scope,scope.fnScope);scopeOf.set(n,s);
        const head=n.type==='ForStatement'?n.init:n.left;
        if(head?.type==='VariableDeclaration'&&head.kind!=='var')for(const d of head.declarations)for(const id of patternIds(d.id))s.declare(id.name,rec(head.kind));
        for(const c of children(n))build(c,s);return;}
      case 'CatchClause':{const s=new Scope(scope,scope.fnScope);scopeOf.set(n,s);for(const id of patternIds(n.param))s.declare(id.name,rec('catch'));
        build(n.param,s);build(n.body,s);return;}
      case 'ClassExpression':case 'ClassDeclaration':{
        let s=scope;if(n.type==='ClassExpression'&&n.id){s=new Scope(scope,scope.fnScope);s.declare(n.id.name,rec('class'));}
        scopeOf.set(n,s);for(const c of children(n))build(c,s);return;}
    }
    for(const c of children(n))build(c,scope);
  };
  build(ast,null);

  // Pass B: resolve identifiers; record initial values and writes.
  const resolve=(id,scope)=>{const r=scope.lookup(id.name);if(r)recordOf.set(id,r);return r;};
  const writeOther=(p,scope)=>{for(const id of patternIds(p)){const r=resolve(id,scope);if(r)r.writes.push({other:true});}};
  const walk=(n,scope,parent,key)=>{
    if(!n||typeof n.type!=='string')return;
    const s=scopeOf.get(n)??scope;
    switch(n.type) {
      case 'Identifier':
        if(parent&&(parent.type==='MemberExpression'&&key==='property'&&!parent.computed
          ||(parent.type==='Property'||parent.type==='MethodDefinition'||parent.type==='PropertyDefinition')&&key==='key'&&!parent.computed
          ||(parent.type==='LabeledStatement'||parent.type==='BreakStatement'||parent.type==='ContinueStatement')&&key==='label'
          ||parent.type==='ImportSpecifier'&&key==='imported'||parent.type==='ExportSpecifier'&&key==='exported'
          ||parent.type==='MetaProperty'))return;
        resolve(n,s);return;
      case 'VariableDeclarator':{
        const ids=patternIds(n.id);
        for(const id of ids)resolve(id,s);
        if(n.id.type==='Identifier') {
          const r=recordOf.get(n.id);
          if(r){
            if(parent?.loop) {
              r.loop=parent.loop;
              if(parent.loop==='of'&&parent.right.type==='ArrayExpression'&&parent.right.elements.every(x=>x?.type==='Literal'&&typeof x.value==='string'))r.loopStrings=parent.right.elements.map(x=>literalKey(x.value));
            } else if(n.init)r.inits.push(n.init);
            else r.uninitialised=true;
          }
        } else for(const id of ids){const r=recordOf.get(id);if(r)r.writes.push({other:true});}
        walk(n.init,s,n,'init');
        for(const c of children(n.id))walk(c,s,n.id,'pattern');
        return;
      }
      case 'AssignmentExpression':
        if(n.left.type==='Identifier'){const r=resolve(n.left,s);if(r)r.writes.push({op:n.operator,value:n.right});}
        else if(n.left.type==='MemberExpression')walk(n.left,s,n,'left');
        else{writeOther(n.left,s);walkPatternDefaults(n.left,s);}
        walk(n.right,s,n,'right');return;
      case 'UpdateExpression':
        if(n.argument.type==='Identifier'){const r=resolve(n.argument,s);if(r)r.writes.push({op:'++'});}
        else walk(n.argument,s,n,'argument');
        return;
      case 'ForInStatement':case 'ForOfStatement':{
        if(n.left.type==='VariableDeclaration') {
          for(const d of n.left.declarations)walk(d,s,{loop:n.type==='ForOfStatement'?'of':'in',right:n.right},'declarations');
        } else if(n.left.type==='MemberExpression')walk(n.left,s,n,'left');
        else{writeOther(n.left,s);walkPatternDefaults(n.left,s);}
        walk(n.right,s,n,'right');walk(n.body,s,n,'body');return;
      }
    }
    for(const k in n) {
      if(k==='loc')continue;const v=n[k];
      if(Array.isArray(v)){for(const x of v)walk(x,s,n,k);}else if(v&&typeof v.type==='string')walk(v,s,n,k);
    }
  };
  // Default values and computed keys inside an assignment pattern are ordinary expressions.
  const walkPatternDefaults=(p,s)=>{
    if(!p)return;
    switch(p.type){
      case 'ObjectPattern':for(const q of p.properties){if(q.type==='RestElement')walkPatternDefaults(q.argument,s);else{if(q.computed)walk(q.key,s,q,'key');walkPatternDefaults(q.value,s);}}break;
      case 'ArrayPattern':for(const q of p.elements)walkPatternDefaults(q,s);break;
      case 'RestElement':walkPatternDefaults(p.argument,s);break;
      case 'AssignmentPattern':walkPatternDefaults(p.left,s);walk(p.right,s,p,'right');break;
      case 'MemberExpression':walk(p,s,null,null);break;
    }
  };
  walk(ast,null,null,null);

  // Classification. A value is numeric on a set of parameters (empty: always) or not numeric
  // (null). Variables start numeric with no parameters; each pass recomputes them from their
  // definitions, sets only grow and numeric only turns off, so it settles.
  const candidate=r=>(r.kind==='var'||r.kind==='let'||r.kind==='const'||r.kind==='param')&&!r.loop;
  const NONE=new Set();
  for(const r of records)r.deps=candidate(r)?(r.kind==='param'?new Set([r]):NONE):null;
  const join=(a,b)=>a===null||b===null?null:!a.size?b:!b.size?a:new Set([...a,...b]);
  function deps(e) {
    switch(e?.type) {
      case 'Literal':return typeof e.value==='number'||typeof e.value==='bigint'?NONE:null;
      case 'UnaryExpression':return e.operator==='-'||e.operator==='+'||e.operator==='~'?NONE:null;
      case 'UpdateExpression':return NONE;
      case 'BinaryExpression':return NUMERIC_BINARY.has(e.operator)?NONE:e.operator==='+'?join(deps(e.left),deps(e.right)):null;
      case 'AssignmentExpression':
        if(e.operator==='='||e.operator==='??='||e.operator==='||='||e.operator==='&&=')return deps(e.right);
        return e.operator==='+='?join(deps(e.left),deps(e.right)):NONE;
      case 'ConditionalExpression':return join(deps(e.consequent),deps(e.alternate));
      case 'LogicalExpression':return join(deps(e.left),deps(e.right));
      case 'SequenceExpression':return deps(e.expressions.at(-1));
      case 'ParenthesizedExpression':return deps(e.expression);
      case 'Identifier':return recordOf.get(e)?.deps??null;
      case 'CallExpression':{
        const c=e.callee;
        if(c.type==='Identifier')return NUMERIC_CALLS.has(c.name)&&!recordOf.get(c)?NONE:null;
        if(c.type==='MemberExpression'&&!c.computed&&c.object.type==='Identifier'&&!recordOf.get(c.object)
          &&(c.object.name==='Math'||c.object.name==='Number'&&(c.property.name==='parseInt'||c.property.name==='parseFloat')))return NONE;
        return null;
      }
      default:return null;
    }
  }
  const writeDeps=w=>w.other?null:w.op==='++'?NONE:(w.op==='='||w.op==='+='||w.op==='??='||w.op==='||='||w.op==='&&=')?deps(w.value):NONE;
  for(let changed=true;changed;) {
    changed=false;
    for(const r of records) {
      if(r.deps===null)continue;
      let d=r.kind==='param'?new Set([r]):NONE;
      for(const e of r.inits){d=join(d,deps(e));if(d===null)break;}
      if(d!==null)for(const w of r.writes){d=join(d,writeDeps(w));if(d===null)break;}
      if(d===null){r.deps=null;changed=true;}
      else if(d.size>r.deps.size){r.deps=d;changed=true;}
    }
  }
  for(const r of records) {
    if(r.writes.length)continue;
    if(r.loopStrings)r.strings=r.loopStrings;
    else if(r.kind==='const'&&r.inits.length===1) {
      const e=r.inits[0];
      if(e.type==='Literal'&&typeof e.value==='string')r.strings=[literalKey(e.value)];
      else if(e.type==='TemplateLiteral'&&!e.expressions.length)r.strings=[literalKey(e.quasis[0].value.cooked)];
    }
  }

  // The key a computed member expression or property names: a name, ELEMENT, a list of names,
  // {params: [record...]} (an element while every invocation of each function passes a number
  // at that parameter), or undefined (any field).
  function keyOf(k) {
    switch(k.type) {
      case 'Literal':return literalKey(k.value);
      case 'TemplateLiteral':return k.expressions.length?undefined:literalKey(k.quasis[0].value.cooked);
      case 'Identifier':{const r=recordOf.get(k);if(r?.strings)return r.strings;break;}
      case 'ConditionalExpression':{const a=keyOf(k.consequent),b=keyOf(k.alternate);
        const named=x=>typeof x==='string'||Array.isArray(x);
        if(named(a)&&named(b))return [...new Set([a,b].flat())];
        break;}
    }
    const d=deps(k);
    if(d===null)return undefined;
    return d.size?{params:[...d]}:ELEMENT;
  }
  return {keyOf};
}
