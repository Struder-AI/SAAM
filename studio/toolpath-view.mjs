import {TOLERANCE,ROUNDING_MM,CHORD_TOLERANCE_MM} from '../core/dimensions.mjs';
import {DEFAULT_PHASE_COLOURS,phaseColour} from '../core/print/phase-colours.mjs';
// A display budget, never a modification of the interpreted or exported path.
export const VIEWER_POINT_CAP=40_000;
// Cache limits only; larger groups are regenerated as a stream.
export const TOOLPATH_MEMO_SEGMENTS=16_384;
export const TOOLPATH_MEMO_GROUP_SEGMENTS=TOOLPATH_MEMO_SEGMENTS;
export const VIEWER_TOLERANCE_MM=CHORD_TOLERANCE_MM;
export const CURRENT_LAYER_GAP_MM=0.04;
export const LAYER_FADE_MS=2000;
// Inspection owns repetition identity; motion retains its geometric layer
// reference. Older paths use chronological display runs, never parsed names.
export const layerKey=move=>move?(move.sliceStack?`stack\0${move.sliceStack}\0${move.sliceIndex}`:move.layerId?`layer\0${move.layerId}\0${move.layer}`:move.legacyRun!==undefined?`run\0${move.legacyRun}`:`operation\0${move.operation??''}\0${move.phase}\0${move.layer}`):null;
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
// Multi-material moves show their filament colour; others their phase colour.
export function toolpathStyle(move,current,palette=DEFAULT_PHASE_COLOURS,emphasis,{lineWidthMm=0.4,pixelsPerMm=1,previousLayerOpacity=0.5}={}) {
  lineWidthMm=move.lineWidthMm??lineWidthMm;
  const active=!!current&&layerKey(move)===layerKey(current);
  const baseline=Math.max(0.5,Math.min(1,previousLayerOpacity));
  const opacity=active?1:baseline+(1-baseline)*(emphasis??0);
  const strength=(opacity-0.5)*2;
  const foreground=move.extruding&&move.filamentColor||phaseColour(palette,move);
  const pale=mixColor(foreground,'#f3f1eb',.55);
  // Inset only the current layer's display strokes to reveal adjacent tracks.
  // This is a model-space gap, not a fixed-pixel minimum or a print change.
  const widthMm=active?Math.max(lineWidthMm-CURRENT_LAYER_GAP_MM,lineWidthMm/2):lineWidthMm;
  return {active,color:mixColor(foreground,pale,(1-strength)/3),opacity,
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
function* simplify(moves,first,last) {
  const point=i=>i===first?moves.at(first).from:moves.at(i-1).to;
  const stack=[[first,last+1]];
  while(stack.length){
    // Half the display allowance leaves room for the partial chord ending at
    // the original playback position rather than at this stroke's endpoint.
    const [a,b]=stack.pop();let furthest=-1,error=(VIEWER_TOLERANCE_MM/2)**2;
    const from=point(a),to=point(b);
    for(let i=a+1;i<b;i++){const d=distance2(point(i),from,to);if(d>error){error=d;furthest=i;}}
    // Visit the left interval first so edges can be emitted in source order
    // without retaining every selected endpoint and sorting a complete run.
    if(furthest!==-1)stack.push([furthest,b],[a,furthest]);
    else yield {first:a,last:b-1,from:point(a),to:point(b),move:moves.at(a)};
  }
}
export function buildToolpathView(moves) {
  const groups=[];
  const read=moves.reader?.(['sliceStack','sliceIndex','layerId','legacyRun','phase','operation','layer'])??(i=>moves.at(i));
  const keyAt=i=>layerKey(read(i));
  for(let i=0;i<moves.length;){
    const first=i,key=keyAt(i);
    while(i+1<moves.length&&keyAt(i+1)===key)i++;
    groups.push({first,last:i});i++;
  }
  return {moves,groups,memo:createToolpathMemo()};
}
// Keep derived groups within the resident segment budget and one finite frame.
// A larger group streams rather than becoming an oversized cache entry.
export function createToolpathMemo(){
  const perGroup=new Map();
  let lastFrameKey=null,lastFrame=null,segments=0;
  return {
    *entries(group,reduced,make){
      const key=group.first+':'+reduced,found=perGroup.get(key);
      if(found){perGroup.delete(key);perGroup.set(key,found);yield* found;return;}
      let retained=[];
      for(const edge of make()){
        if(retained){if(retained.length<TOOLPATH_MEMO_GROUP_SEGMENTS)retained.push(edge);else retained=null;}
        yield edge;
      }
      if(!retained)return;
      while(segments+retained.length>TOOLPATH_MEMO_SEGMENTS||perGroup.size>=TOOLPATH_MEMO_SEGMENTS){
        const oldest=perGroup.keys().next().value;segments-=perGroup.get(oldest).length;perGroup.delete(oldest);
      }
      perGroup.set(key,retained);segments+=retained.length;
    },
    frame(key,select){
      if(lastFrameKey===key)return lastFrame;
      const result=select();lastFrameKey=key;lastFrame=result;return result;
    },
    stats(){return {groups:perGroup.size,segments,segmentBudget:TOOLPATH_MEMO_SEGMENTS,groupSegmentBudget:TOOLPATH_MEMO_GROUP_SEGMENTS};}
  };
}
export function remainingLayerMs(view,moveIndex,seconds,speed){
  if(!(speed>0))return Infinity;
  let low=0,high=view.groups.length;
  while(low<high){const mid=(low+high)>>1;if(view.groups[mid].last<moveIndex)low=mid+1;else high=mid;}
  const next=view.groups[low+1];
  return next?Math.max(0,(view.moves.at(next.first).startSeconds-seconds)/speed*1000):Infinity;
}
// A "layer" for inspection is one group: a run of same-phase, same-layer
// moves, the same unit the axial-color inspect buttons jump between.
export function layerIndexAt(view,seconds){
  if(!view.groups.length)return 0;
  const startOf=index=>view.moves.at(view.groups[index].first).startSeconds;
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
  const group=view.groups[clamped],move=view.moves.at(group.last),end=move.startSeconds+move.durationSeconds;
  const next=view.groups[clamped+1];
  // Display only: a microsecond before the next group starts.
  return next?Math.min(end,view.moves.at(next.first).startSeconds-TOLERANCE.domainFraction):end;
}
export function stepLayerIndex(view,seconds,direction){
  return Math.max(0,Math.min(layerIndexAt(view,seconds)+direction,view.groups.length-1));
}
// Choose a deposited layer with visible contour structure for a first look at
// an already generated path. Sharp turns in perimeter moves reveal authored
// details without guessing from the source mesh or altering playback/export.
export function representativeLayer(view,{feature='contour'}={}){
  const groups=view.groups.filter(group=>{
    for(let i=group.first;i<=group.last;i++)if(view.moves.at(i).extruding)return true;
    return false;
  });
  if(!groups.length)return null;
  if(feature==='infill'){
    const candidates=[];
    for(const group of groups){
      const index=view.groups.indexOf(group),progress=index/Math.max(1,view.groups.length-1);
      if(progress<.15||progress>.7)continue;
      let first=null,length=0;
      for(let i=group.first;i<=group.last;i++){
        const move=view.moves.at(i);if(!move.extruding||!/infill/.test(move.operation??'')||/solid/.test(move.operation))continue;
        first??=move;length+=Math.hypot(...move.to.map((v,k)=>v-move.from[k]));
      }
      if(first)candidates.push({move:first,length,index});
    }
    const peak=candidates.reduce((max,candidate)=>Math.max(max,candidate.length),0);
    const chosen=candidates.filter(candidate=>candidate.length>=peak*.9).at(-1);
    if(chosen)return {seconds:chosen.move.startSeconds,layer:chosen.move.layer,index:chosen.index,groups:view.groups.length,feature};
  }
  let best=null;const candidates=[];
  for(const [index,group] of groups.entries()){
    if(index===0||index===groups.length-1)continue;
    const progress=index/(groups.length-1);
    if(progress<.15||progress>.85)continue;
    let corners=0,walls=0,previous=null,first=null;
    for(let i=group.first;i<=group.last;i++){
      const move=view.moves.at(i);
      if(!move.extruding||!/walls|perimeter/.test(move.operation??move.role??'')){previous=null;continue;}
      first??=move;walls++;
      // Display only: consecutive wall moves that share an end are drawn as one.
      if(previous&&previous.operation===move.operation&&previous.to.every((v,k)=>Math.abs(v-move.from[k])<ROUNDING_MM)){
        const a=previous.to.map((v,k)=>v-previous.from[k]),b=move.to.map((v,k)=>v-move.from[k]);
        const lengths=Math.hypot(...a)*Math.hypot(...b);
        if(lengths&&a.reduce((sum,v,k)=>sum+v*b[k],0)/lengths<0.94)corners++;
      }
      previous=move;
    }
    if(!first)continue;
    const score=corners+Math.log1p(walls)+1-Math.abs(progress-.6);
    const candidate={score,move:first,index:view.groups.indexOf(group)};
    candidates.push(candidate);
    if(!best||score>best.score)best=candidate;
  }
  const fallback=groups[Math.min(groups.length-1,Math.max(0,Math.round((groups.length-1)*.55)))];
  const chosen=best?.score>=20?candidates.filter(candidate=>candidate.score>=best.score*.65).at(-1):null;
  let move=chosen?.move;
  if(!move)for(let i=fallback.first;i<=fallback.last;i++){const candidate=view.moves.at(i);if(candidate.extruding){move=candidate;break;}}
  return move?{seconds:move.startSeconds,layer:move.layer,index:chosen?.index??view.groups.indexOf(fallback),groups:view.groups.length,feature:'contour'}:null;
}
function entries(view,group,reduced) {
  return view.memo.entries(group,reduced,function*(){
    if(!reduced){
      for(let i=group.first;i<=group.last;i++){const move=view.moves.at(i);yield {first:i,last:i,from:move.from,to:move.to,move};}
      return;
    }
    const moves=view.moves;
    for(let first=group.first;first<=group.last;){
      let last=first;const start=moves.at(first);
      while(last<group.last){
        const previous=moves.at(last),next=moves.at(last+1);
        if(next.extruding!==start.extruding||next.operation!==start.operation||next.tool!==start.tool||next.filament!==start.filament||!same(previous.to,next.from))break;
        last++;
      }
      yield* simplify(moves,first,last);first=last+1;
    }
  });
}
function* visible(view,group,count,travel,reduced){
  for(const edge of entries(view,group,reduced)){
    if(edge.last>=count)break;
    if(travel||edge.move.extruding)yield edge;
  }
}
// Uniform selection includes both ends. Omitting an edge never connects its
// neighbours: an omitted travel cannot become a fictitious extrusion.
function localDetail(read,length,n){
  if(n<=0)return [];
  if(length<=n)return [...read()];
  // A single very dense layer can itself exceed the cap. Keep a detailed
  // window ending at playback, then favour walls and non-planar strokes over
  // older interior fill. Remaining samples cover the rest of the layer.
  const recent=Math.ceil(n/4),chosen=new Map();let index=0,importantCount=0;
  const important=e=>/walls|perimeter|skin|vase/.test(e.move.operation??e.move.phase)||e.from[2]!==e.to[2];
  for(const edge of read()){if(index++>=length-recent)chosen.set(edge.first,edge);else if(important(edge))importantCount++;}
  function select(length,count,accept){
    if(count<=0)return;
    let index=0,selected=0;
    const at=i=>count>=length?i:count===1?length-1:Math.round(i*(length-1)/(count-1));
    for(const edge of read())if(accept(edge)){
      if(index++===at(selected)){chosen.set(edge.first,edge);if(++selected===Math.min(count,length))break;}
    }
  }
  select(importantCount,Math.floor((n-chosen.size)/2),e=>!chosen.has(e.first)&&important(e));
  select(length-chosen.size,n-chosen.size,e=>!chosen.has(e.first));
  return [...chosen.values()].sort((a,b)=>a.first-b.first);
}
export function toolpathFrame(view,count,travel,{pointCap=VIEWER_POINT_CAP}={}) {
  const key=count+':'+travel+':'+pointCap;
  return view.memo.frame(key,()=>selectFrame(view,count,travel,pointCap));
}
export function toolpathPresentation(moves,at,detail) {
  const displayed=detail.partial?[...detail.segments,{...detail.partial,to:moves.at(at.completed).from}]:detail.segments;
  const current=at.active<0?undefined:moves.at(at.active);
  const currentLayer=current?.phase==='finish'?moves.findLast(move=>move.extruding):current;
  return {displayed,current,currentLayer};
}
function selectFrame(view,count,travel,pointCap) {
  // Reserve endpoints for the partial simplified edge and exact active move.
  const budget=Math.max(0,Math.floor(pointCap/2)-2);
  let groupCount=0;while(groupCount<view.groups.length&&view.groups[groupCount].first<count)groupCount++;
  // Avoid materializing an object for every original move in a dense job.
  // Exact entries are useful only when the visible range fits the draw budget.
  if(count<=budget){
    const segments=[];
    for(let i=0;i<groupCount;i++)for(const edge of visible(view,view.groups[i],count,travel,false))segments.push(edge);
    return {segments,reduced:false,overview:false};
  }
  const activeGroup=view.groups[groupCount-1];let active;
  if(activeGroup)for(const edge of entries(view,activeGroup,true))if(edge.first<count&&edge.last>=count&&(travel||edge.move.extruding)){active=edge;break;}
  const size=group=>{let length=0;for(const edge of visible(view,group,count,travel,true))length++;return length;};
  let total=0,latestLength=0;
  for(let i=0;i<groupCount;i++){const length=size(view.groups[i]);total+=length;if(i===groupCount-1)latestLength=length;}
  if(total<=budget){
    const segments=[];for(let i=0;i<groupCount;i++)for(const edge of visible(view,view.groups[i],count,travel,true))segments.push(edge);
    return {segments,partial:active,reduced:true,overview:false};
  }
  // Prefer complete representative layers, keeping the most recent layer in
  // detail. Base and upper layers stay represented; intermediate layers are
  // thinned evenly rather than removing corners from every layer.
  const recentBudget=Math.min(latestLength,Math.max(Math.floor(budget/2),budget-(total-latestLength)));
  const recent=localDetail(()=>visible(view,activeGroup,count,travel,true),latestLength,recentBudget),remaining=budget-recent.length;
  // Apply the same repeated uniform group selection without keeping arrays of
  // every group's edges. Only the short chain of selection lengths is needed.
  const levels=[groupCount-1];let olderLength=total-latestLength;
  const groupAt=index=>{
    for(let level=levels.length-1;level>0;level--){const length=levels[level];index=length===1?levels[level-1]-1:Math.round(index*(levels[level-1]-1)/(length-1));}
    return view.groups[index];
  };
  while(olderLength>remaining&&levels.at(-1)>1){
    levels.push(Math.ceil(levels.at(-1)/2));olderLength=0;
    for(let i=0;i<levels.at(-1);i++)olderLength+=size(groupAt(i));
  }
  const readOlder=function*(){for(let i=0;i<levels.at(-1);i++)yield* visible(view,groupAt(i),count,travel,true);};
  const older=localDetail(readOlder,olderLength,remaining);
  return {segments:[...older,...recent],partial:active,reduced:true,overview:true};
}
