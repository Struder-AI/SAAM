// Which findings a map shows, and in which of the two missing classes. A map draws leaves and the
// links between them, so a finding belongs on it when it may hide something no leaf or link stands
// for:
//
// - `code` (red): code outside every leaf, which no box draws. Module-level code that runs at load,
//   other than declarations and constant data, is the top map's (`module-code`).
// - `link` (orange): a relationship between leaves that no link draws. Every unresolved call (its
//   target is unknown); a callable whose origin is unknown, and the arguments of that call;
//   contents that escape into a record, a collection or a closure; a write to an object the leaf
//   does not own (a parameter, `this`, captured or module state); and a captured binding shared
//   with a closure that is a leaf of its own.
//
// A finding about a precise aspect of what a leaf or link already draws (a branch, a loop, an
// argument's producer, a callback's timing) is in neither class and stays with the leaf's code and
// its read.
//
// State an enclosing factory or class owns is drawn: each leaf using it has a state link to its
// owner (store.mjs). So a write, or a capture, whose binding is owned state the leaf's links
// already name is drawn, and is no missing finding.
const escapes=new Set(['callable-origin','collection-capture','collection-escape','record-escape']);
export const effects=new Set(['member-mutation','nested-receiver-effect','nested-collection-effect']);

// The binding a write reaches: `report` of `report.rows[i]`, `rows` of `this.rows.push`. None
// when the object is a call's result.
export function writtenBinding(row) {
  if(row.field)return row.field;
  const text=row.binding??row.receiver??'';
  const found=/^(?:this\.)?(#?[A-Za-z_$][\w$]*)(?![\w$]*\s*\()/.exec(text);
  return found?.[1]??null;
}

export function missingClass(field,row,{leaf,leafOf,rows,held=()=>new Set()}) {
  if(field==='unresolved')return 'link';
  if(row.kind==='module-code')return 'code';
  if(escapes.has(row.kind))return 'link';
  if(effects.has(row.kind)) {
    if(['local','global'].includes(row.ownership)||row.reads)return null;
    return held(row.declaration??leaf).has(writtenBinding(row))?null:'link';
  }
  if(row.kind==='closure-capture') {
    if((leafOf.get(row.closure)??leaf)===leaf)return null;
    const names=row.bindings?Object.values(row.bindings).flat():[row.binding];
    return names.every(name=>held(row.closure).has(name))?null:'link';
  }
  if(row.kind==='argument-origin')return rows.some(r=>r.kind==='callable-origin'&&r.line===row.line&&r.call===row.call)?'link':null;
  return null;
}

// Tags each row of a read with its missing class, so every view of the row (the leaf's read, the
// box that draws it, the viewer) colours it the same way without deciding again.
export function classifyFindings(page,leafOf,held) {
  const rows=page.uncertainty??[];
  for(const field of ['uncertainty','unresolved'])for(const row of page[field]??[]) {
    const found=missingClass(field,row,{leaf:page.path,leafOf,rows,held});
    if(found)row.missing=found;else delete row.missing;
  }
}

// A leaf's rows that its boxes carry on a map: the classified ones.
export function mapFindings(page) {
  return {uncertainty:(page.uncertainty??[]).filter(row=>row.missing),
    unresolved:(page.unresolved??[]).filter(row=>row.missing)};
}

// The count of each missing class among rows, the way a cluster box names what it nests.
export function missingCounts(rows) {
  const out={};
  for(const row of rows)if(row.missing)out[row.missing]=(out[row.missing]??0)+(row.count??1);
  return out;
}
