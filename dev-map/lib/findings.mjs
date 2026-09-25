// Which findings a map shows. A map draws leaves and the links between them, so a finding belongs
// on it when it may hide something no leaf or link stands for: code outside every leaf, or a
// relationship between leaves that no link draws. A finding about a precise aspect of what a leaf
// or link already draws (a branch, a loop, an argument's producer, a callback's timing) stays with
// the leaf's code and its read.
//
// On a map: every unresolved call (its target is unknown); a callable whose origin is unknown, and
// the arguments of that call; contents that escape into a record, a collection or a closure; a
// write to an object the leaf does not own (a parameter, `this`, captured or module state); and a
// captured binding shared with a closure that is a leaf of its own.
const escapes=new Set(['callable-origin','collection-capture','collection-escape','record-escape']);
const effects=new Set(['member-mutation','nested-receiver-effect','nested-collection-effect']);

export function onMap(field,row,{leaf,leafOf,rows}) {
  if(field==='unresolved')return true;
  if(escapes.has(row.kind))return true;
  if(effects.has(row.kind))return row.ownership!=='local';
  if(row.kind==='closure-capture')return (leafOf.get(row.closure)??leaf)!==leaf;
  if(row.kind==='argument-origin')return rows.some(r=>r.kind==='callable-origin'&&r.line===row.line&&r.call===row.call);
  return false;
}

// A leaf's rows that its boxes carry on a map.
export function mapFindings(page,leafOf) {
  const rows=page.uncertainty??[];
  return {uncertainty:rows.filter(row=>onMap('uncertainty',row,{leaf:page.path,leafOf,rows})),
    unresolved:(page.unresolved??[]).filter(row=>onMap('unresolved',row,{leaf:page.path,leafOf,rows}))};
}
