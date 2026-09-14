// A display budget, never a modification of the interpreted or exported path.
export const VIEWER_POINT_CAP=40_000;
export const VIEWER_TOLERANCE_MM=0.02;
export const CURRENT_LAYER_GAP_MM=0.04;
export const LAYER_FADE_MS=2000;
// User-verified visible palette; additional colors may be used when needed.
// Sky blue includes the user's requested slight darkening from #62a9df.
export const TOOLPATH_COLORS={skyBlue:'#5b9fd3',orange:'#c65b19',teal:'#53b8af',lavender:'#a799dc'};
export const layerKey=move=>move?`${move.phase}\0${move.layer}`:null;
// Keep the normal two-second fade unless the next layer arrives sooner.
export function createLayerFade() {
  let previous=null;
  const outgoing=new Map();
  return {
    reset(){previous=null;outgoing.clear();},
    frame(current,now,remainingMs=Infinity){
      const key=layerKey(current),weights=new Map();
      if(key!==previous){
        outgoing.clear();
        if(previous!==null)outgoing.set(previous,{start:now,progress:0});
        outgoing.delete(key);previous=key;
      }
      for(const [id,transition] of outgoing){
        const elapsed=Math.max(0,now-transition.start);
        const duration=Math.min(LAYER_FADE_MS,elapsed+Math.max(0,remainingMs));
        // Changing speed or pausing must not bring a faded layer back.
        const t=transition.progress=Math.max(transition.progress,Math.min(1,duration>0?elapsed/duration:1));
        if(t===1)outgoing.delete(id);
        else weights.set(id,1-t*t*(3-2*t));
      }
      if(key!==null)weights.set(key,1);
      return {weights,fading:outgoing.size>0};
    }
  };
}
function mixColor(from,to,t){
  return '#'+[1,3,5].map(i=>Math.round(parseInt(from.slice(i,i+2),16)*(1-t)+parseInt(to.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
}
export function toolpathStyle(move,current,skinPhase='draped-skin',emphasis,{lineWidthMm=0.4,pixelsPerMm=1}={}) {
  const active=!!current&&move.layer===current.layer&&move.phase===current.phase;
  const skin=move.phase===skinPhase||move.phase==='vase-wall'||move.phase==='cladding-hoop';
  const strength=active?1:emphasis??0;
  const axial=move.phase==='cladding-axial';
  const foreground=move.extruding?(axial?TOOLPATH_COLORS.teal:skin?TOOLPATH_COLORS.orange:move.phase==='prime'?'#5b92a3':TOOLPATH_COLORS.skyBlue):'#657fa3';
  const pale=move.extruding?(axial?mixColor(foreground,'#f3f1eb',.55):skin?'#d6a17c':move.phase==='prime'?'#5b92a3':'#b9d6ed'):'#aeb8c5';
  // Inset only the current layer's display strokes to reveal adjacent tracks.
  // This is a model-space gap, not a fixed-pixel minimum or a print change.
  const widthMm=active?Math.max(lineWidthMm-CURRENT_LAYER_GAP_MM,lineWidthMm/2):lineWidthMm;
  return {active,color:mixColor(foreground,pale,(1-strength)/3),opacity:0.5+0.5*strength,
    width:move.extruding?widthMm*pixelsPerMm:0.85};
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
  const value=(i,key)=>moves.value?moves.value(i,key):moves[i][key];
  for(let i=0;i<moves.length;){
    const first=i,layer=value(i,'layer'),phase=value(i,'phase');
    while(i+1<moves.length&&value(i+1,'layer')===layer&&value(i+1,'phase')===phase)i++;
    groups.push({first,last:i,raw:null,reduced:null});i++;
  }
  return {moves,groups};
}
export function remainingLayerMs(view,moveIndex,seconds,speed){
  if(!(speed>0))return Infinity;
  let low=0,high=view.groups.length;
  while(low<high){const mid=(low+high)>>1;if(view.groups[mid].last<moveIndex)low=mid+1;else high=mid;}
  const next=view.groups[low+1];
  return next?Math.max(0,(view.moves[next.first].startSeconds-seconds)/speed*1000):Infinity;
}
// A "layer" for inspection is one group: a run of same-phase, same-layer
// moves, the same unit the axial-color inspect buttons jump between.
export function layerIndexAt(view,seconds){
  if(!view.groups.length)return 0;
  const startOf=index=>view.moves[view.groups[index].first].startSeconds;
  let low=0,high=view.groups.length;
  while(low<high){const mid=(low+high)>>1;if(startOf(mid)<=seconds)low=mid+1;else high=mid;}
  return Math.max(0,Math.min(low-1,view.groups.length-1));
}
// The layer buttons show what the selected layer looks like FINISHED, not its
// start: a viewer stepping through layers wants to see what printed on each
// one, which needs every one of its moves drawn. Land just short of the next
// layer's first move so that move (already at the boundary) never appears
// started, even when it follows with no gap.
export function layerEndSeconds(view,index){
  if(!view.groups.length)return 0;
  const clamped=Math.max(0,Math.min(index,view.groups.length-1));
  const group=view.groups[clamped],move=view.moves[group.last],end=move.startSeconds+move.durationSeconds;
  const next=view.groups[clamped+1];
  return next?Math.min(end,view.moves[next.first].startSeconds-1e-6):end;
}
export function stepLayerIndex(view,seconds,direction){
  return Math.max(0,Math.min(layerIndexAt(view,seconds)+direction,view.groups.length-1));
}
function entries(view,group,reduced) {
  if(!reduced)return group.raw??=Array.from({length:group.last-group.first+1},(_,j)=>{
    const i=group.first+j,m=view.moves[i];return {first:i,last:i,from:m.from,to:m.to,move:m};
  });
  if(group.reduced)return group.reduced;
  const out=[],moves=view.moves.range?view.moves.range(group.first,group.last+1):view.moves;
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
  // Avoid materializing an object for every original move in a dense job.
  // Exact entries are useful only when the visible range fits the draw budget.
  if(count<=budget){
    const rows=groups.map(g=>visible(view,g,count,travel,false));
    return {segments:rows.flat(),reduced:false,overview:false};
  }
  let rows=groups.map(g=>visible(view,g,count,travel,true));
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
