export function containment(graph,report) {
  const groups=new Map(graph.files.filter(f=>/^(core|studio)\//.test(f.file)).map(f=>[f.file,{file:f.file,sha256:f.sha256,
    counts:{direct:0,enclosed:0,unrepresented:0},callables:{direct:0,enclosed:0,unrepresented:0},declarations:[]} ]));
  for(const d of report.inventory) {
    const group=groups.get(d.file);
    group.counts[d.status]++;if(d.callable)group.callables[d.status]++;
    group.declarations.push({anchor:d.anchor,name:d.anchor?.split('::').slice(1).join('::')??d.name,
      kind:d.kind,callable:!!d.callable,line:d.line,endLine:d.endLine,status:d.status,uses:d.occurrences,
      enclosing:d.enclosing[0]?.occurrences??[]});
  }
  return [...groups.values()];
}
