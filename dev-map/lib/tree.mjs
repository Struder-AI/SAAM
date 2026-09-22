// The published index is a place in the map tree: `0`, then its regions, then the Nth node
// whose home is that map, and so on down. Generation numbers declarations by source position
// (region.file.declaration); that address stays internal, for scoped reuse only.
//
// A page's home is the first map that shows it, walking every containment map (root, region,
// group, file) before any call-flow map. Authored grouping therefore places every declaration
// it claims, and a call-flow map homes only its own groups and what no containment map shows.
// Every other appearance is a repeat: it keeps the home index and names its home, and the home
// names each map that repeats it.
const containment=new Set(['root','region','group','file']);
const byIndex=(a,b)=>{
  const x=a.split('.').map(Number),y=b.split('.').map(Number);
  for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]??-1)!==(y[i]??-1))return (x[i]??-1)-(y[i]??-1);
  return 0;
};
export const shownOn=page=>page.kind==='root'?page.regions:page.components??[];
export const homeOf=at=>at.includes('.')?at.slice(0,at.lastIndexOf('.')):'0';

// `pages` maps each source address to its page. Returns source address → tree index for the
// pages the walk reaches; any other page belongs to no map.
export function treeNumbering(pages) {
  const tree=new Map([['0','0']]),maps=[['0','0']],flows=[];
  while(maps.length||flows.length) {
    const [at,placed]=(maps.length?maps:flows).shift();
    const children=[...new Set(shownOn(pages.get(at)).map(c=>c.index))]
      .filter(child=>pages.has(child)&&!tree.has(child)).sort(byIndex);
    for(const [i,child] of children.entries()) {
      const index=placed==='0'?String(i+1):`${placed}.${i+1}`;
      tree.set(child,index);
      (containment.has(pages.get(child).kind)?maps:flows).push([child,index]);
    }
  }
  return tree;
}

// Only address-bearing fields are rewritten; a numeric data label is not a map address. Source
// addresses and tree indexes share one number space, so an object held by several pages is
// rewritten once: `seen` spans the whole pass.
const addressKeys=new Set(['index','handle','from','to','region','parent','port','mechanism','outside',
  'parentEndpoint','parentFrom','parentTo','caller','callee','page','endpoint','id']);
const address=/^([a-z-]+:)?(\d+(?:\.\d+)*)(@\d+)?$/;
export function renumber(value,tree,seen=new WeakSet()) {
  if(!value||typeof value!=='object'||seen.has(value))return value;
  seen.add(value);
  if(Array.isArray(value)){value.forEach(item=>renumber(item,tree,seen));return value;}
  for(const [key,item] of Object.entries(value)) {
    const m=addressKeys.has(key)&&typeof item==='string'&&address.exec(item);
    if(m&&tree.has(m[2]))value[key]=(m[1]??'')+tree.get(m[2])+(m[3]??'');
    else renumber(item,tree,seen);
  }
  return value;
}

// Mark repeats on published pages (already renumbered): a repeat names its home map; a home
// node names every other map it appears on.
export function markRepeats(published) {
  const elsewhere=new Map();
  for(const page of published.values())for(const c of shownOn(page)) {
    if(!published.has(c.index)||homeOf(c.index)===page.index)continue;
    const list=elsewhere.get(c.index)??elsewhere.set(c.index,new Set()).get(c.index);
    list.add(page.index);
  }
  for(const page of published.values())for(const c of shownOn(page)) {
    delete c.home;delete c.alsoOn;
    if(!published.has(c.index))continue;
    if(homeOf(c.index)!==page.index)c.home=homeOf(c.index);
    else if(elsewhere.has(c.index))c.alsoOn=[...elsewhere.get(c.index)].sort(byIndex);
  }
}
