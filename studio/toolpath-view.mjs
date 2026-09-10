// A display budget, never a modification of the interpreted or exported path.
export const VIEWER_POINT_CAP=40_000;
export const VIEWER_TOLERANCE_MM=0.02;
export function toolpathStyle(move,current,skinPhase='draped-skin') {
  const active=!!current&&move.layer===current.layer&&move.phase===current.phase;
  const skin=move.phase===skinPhase||move.phase==='vase-wall';
  return {active,color:move.extruding?(skin?(active?'#c65b19':'#d6a17c'):
    move.phase==='prime'?'#5b92a3':active?'#24583e':'#91a68a'):(active?'#657fa3':'#aeb8c5'),
    opacity:active?1:0.2,width:active?(move.extruding?1.35:0.85):0.65};
}
const same=(a,b)=>a.every((v,i)=>v===b[i]);
const distance2=(p,a,b)=>{
  const v=b.map((x,i)=>x-a[i]),w=p.map((x,i)=>x-a[i]);
  const length=v.reduce((s,x)=>s+x*x,0),t=length?Math.max(0,Math.min(1,w.reduce((s,x,i)=>s+x*v[i],0)/length)):0;
  return w.reduce((s,x,i)=>s+(x-t*v[i])**2,0);
};
// Douglas–Peucker within one continuous operation/style. Travel, layer and
// extrusion transitions are never bridged. Every retained edge names its
// original move interval so scrubbing still follows the original timeline.
function simplify(moves,first,last) {
  const point=i=>i===first?moves[first].from:moves[i-1].to;
  const keep=new Set([first,last+1]),stack=[[first,last+1]];
  while(stack.length){
    // Half the display allowance leaves room for the partial chord ending at
    // the original playback position rather than at this stroke's endpoint.
    const [a,b]=stack.pop();let furthest=-1,error=(VIEWER_TOLERANCE_MM/2)**2;
    for(let i=a+1;i<b;i++){const d=distance2(point(i),point(a),point(b));if(d>error){error=d;furthest=i;}}
    if(furthest!==-1){keep.add(furthest);stack.push([a,furthest],[furthest,b]);}
  }
  const points=[...keep].sort((a,b)=>a-b);
  return points.slice(1).map((end,i)=>({first:points[i],last:end-1,from:point(points[i]),to:point(end),move:moves[points[i]]}));
}
export function buildToolpathView(moves) {
  const groups=[];
  for(let i=0;i<moves.length;){
    const first=i,m= moves[i];
    while(i+1<moves.length&&moves[i+1].layer===m.layer&&moves[i+1].phase===m.phase)i++;
    groups.push({first,last:i,raw:null,reduced:null});i++;
  }
  return {moves,groups};
}
function entries(view,group,reduced) {
  if(!reduced)return group.raw??=Array.from({length:group.last-group.first+1},(_,j)=>{
    const i=group.first+j,m=view.moves[i];return {first:i,last:i,from:m.from,to:m.to,move:m};
  });
  if(group.reduced)return group.reduced;
  const out=[],moves=view.moves;
  for(let first=group.first;first<=group.last;){
    let last=first;
    while(last<group.last&&moves[last+1].extruding===moves[first].extruding&&moves[last+1].operation===moves[first].operation
      &&same(moves[last].to,moves[last+1].from))last++;
    for(const edge of simplify(moves,first,last))out.push(edge);first=last+1;
  }
  return group.reduced=out;
}
function visible(view,group,count,travel,reduced){
  const key=(reduced?'simple':'exact')+(travel?'All':'Extrusion');
  const segments=group[key]??=entries(view,group,reduced).filter(s=>travel||s.move.extruding);
  if(count>group.last)return segments;
  let low=0,high=segments.length;
  while(low<high){const mid=(low+high)>>1;if(segments[mid].last<count)low=mid+1;else high=mid;}
  return segments.slice(0,low);
}
// Uniform selection includes both ends. Omitting an edge never connects its
// neighbours: an omitted travel cannot become a fictitious extrusion.
function spread(items,n){
  if(n>=items.length)return items;
  if(n<=0)return [];
  if(n===1)return [items.at(-1)];
  return Array.from({length:n},(_,i)=>items[Math.round(i*(items.length-1)/(n-1))]);
}
function localDetail(items,n){
  if(n<=0)return [];
  if(items.length<=n)return items;
  // A single very dense layer can itself exceed the cap. Keep a detailed
  // window ending at playback, then favour walls and non-planar strokes over
  // older interior fill. Remaining samples cover the rest of the layer.
  const recent=items.slice(-Math.ceil(n/4)),chosen=new Set(recent);
  const important=items.filter(e=>!chosen.has(e)&&(/walls|perimeter|skin|vase/.test(e.move.operation??e.move.phase)||e.from[2]!==e.to[2]));
  for(const e of spread(important,Math.floor((n-chosen.size)/2)))chosen.add(e);
  for(const e of spread(items.filter(e=>!chosen.has(e)),n-chosen.size))chosen.add(e);
  return [...chosen].sort((a,b)=>a.first-b.first);
}
export function toolpathFrame(view,count,travel,{pointCap=VIEWER_POINT_CAP}={}) {
  const key=count+':'+travel+':'+pointCap;
  if(view.frameKey===key)return view.frame;
  const result=selectFrame(view,count,travel,pointCap);
  view.frameKey=key;view.frame=result;return result;
}
function selectFrame(view,count,travel,pointCap) {
  // Reserve endpoints for the partial simplified edge and exact active move.
  const budget=Math.max(0,Math.floor(pointCap/2)-2);
  const groups=view.groups.filter(g=>g.first<count);
  let rows=groups.map(g=>visible(view,g,count,travel,false));
  if(rows.reduce((s,a)=>s+a.length,0)<=budget)return {segments:rows.flat(),reduced:false,overview:false};
  rows=groups.map(g=>visible(view,g,count,travel,true));
  const activeGroup=groups.at(-1),active=activeGroup&&entries(view,activeGroup,true).find(s=>s.first<count&&s.last>=count&&(travel||s.move.extruding));
  if(rows.reduce((s,a)=>s+a.length,0)<=budget)return {segments:rows.flat(),partial:active,reduced:true,overview:false};
  // Prefer complete representative layers, keeping the most recent layer in
  // detail. Base and upper layers stay represented; intermediate layers are
  // thinned evenly rather than removing corners from every layer.
  const latest=rows.pop()??[],recentBudget=Math.min(latest.length,Math.max(Math.floor(budget/2),budget-rows.reduce((s,a)=>s+a.length,0)));
  const recent=localDetail(latest,recentBudget),remaining=budget-recent.length;
  let selected=rows;
  while(selected.reduce((s,a)=>s+a.length,0)>remaining&&selected.length>1)selected=spread(selected,Math.ceil(selected.length/2));
  let older=selected.flat();
  if(older.length>remaining)older=localDetail(older,remaining);
  return {segments:[...older,...recent],partial:active,reduced:true,overview:true};
}
