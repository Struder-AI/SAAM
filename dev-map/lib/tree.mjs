// The published index is a place in the map tree: `0`, then its regions, then the Nth node
// whose home is that map, and so on down. Generation numbers declarations by source position
// (region.file.declaration); that address stays internal, for scoped reuse only.
//
// The walk is one depth-first pass, and a page's home is the first map of its own region that
// reaches it: `0` lists the regions in index order; a region page lists its flow roots and the
// authored clusters of them, in index order; a group lists its members in index order; a flow
// page lists its components in call order. Each child is numbered where it is met and then
// expanded in full before its next sibling. A nested declaration is homed by the declaration
// that holds it, never beside it. Every other appearance is a repeat: it keeps the home index
// and names its home, and the home names each map that repeats it.
//
// One rule decides whether an address is a map at all: it is, when its drawing would show at
// least two called declarations with a wire on one of them; otherwise the address opens code
// (dev-map/lib/destination.mjs). A code address still numbers what it holds, so the walk
// continues through it.
const containment=new Set(['root','region','group']);
const byIndex=(a,b)=>{
  const x=a.split('.').map(Number),y=b.split('.').map(Number);
  for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]??-1)!==(y[i]??-1))return (x[i]??-1)-(y[i]??-1);
  return 0;
};
export const shownOn=page=>page.kind==='root'?page.regions:page.components??[];
export const homeOf=at=>at.includes('.')?at.slice(0,at.lastIndexOf('.')):'0';

// What a page belongs to: a nested declaration belongs to the declaration that holds it, and a
// group to the page it groups. Only that page may place it; everywhere else it is a repeat.
function holders(pages) {
  const byPath=new Map();
  for(const [at,page] of pages)if(page.path&&!byPath.has(page.path))byPath.set(page.path,at);
  const holder=new Map();
  for(const [at,page] of pages) {
    const cut=page.path?.lastIndexOf('::')??-1;
    if(cut<0)continue;
    const parent=byPath.get(page.path.slice(0,cut));
    if(parent!==undefined&&parent!==at)holder.set(at,parent);
  }
  // A group is part of the page it groups, so grouping a nested declaration on its holder's
  // page still places it there.
  const scopes=new Map();
  const scope=at=>{
    if(scopes.has(at))return scopes.get(at);
    let page=pages.get(at),found=at;
    while(page?.kind==='group'&&page.owner!==undefined) {
      const next=byPath.get(page.owner);
      if(next===undefined||next===found)break;
      found=next;page=pages.get(found);
    }
    scopes.set(at,found);return found;
  };
  return {holder,scope};
}

// `pages` maps each source address to its page. Returns source address → tree index for the
// pages the walk reaches; any other page belongs to no map.
export function treeNumbering(pages) {
  const {holder,scope}=holders(pages);
  const tree=new Map([['0','0']]),stack=[['0','0']];
  // A region holds its own code. A call that crosses a region draws the callee here and links
  // to its home; it does not move the callee into the caller's region.
  const regionOf=at=>at.split('.')[0];
  while(stack.length) {
    const [at,placed]=stack.pop();
    const page=pages.get(at),here=scope(at);
    let children=[...new Set(shownOn(page).map(c=>c.index))]
      .filter(child=>pages.has(child)&&!tree.has(child)&&
        (at==='0'||regionOf(child)===regionOf(at))&&
        [undefined,at,here].includes(holder.get(child)));
    // A containment map is an arrangement, so it reads in index order; a flow page is a
    // sequence, so it keeps the call order its components already carry.
    if(containment.has(page.kind))children=children.sort(byIndex);
    const placedChildren=children.map((child,i)=>{
      const index=placed==='0'?String(i+1):`${placed}.${i+1}`;
      tree.set(child,index);return [child,index];
    });
    for(const child of placedChildren.reverse())stack.push(child);
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
