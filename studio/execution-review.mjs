// Canonical schedule indexes are monotone across display subdivisions. Search
// the existing compact rows; retain no second timeline or per-entity index table.
export function scheduledEntity(moves,index){
  if(!Number.isSafeInteger(index)||index<0||!moves?.length||!Number.isSafeInteger(moves.at(0).scheduleIndex))return null;
  const boundary=after=>{let lo=0,hi=moves.length;while(lo<hi){const mid=(lo+hi)>>1,value=moves.at(mid).scheduleIndex;if(value<index||after&&value===index)lo=mid+1;else hi=mid;}return lo;};
  const first=boundary(false),end=boundary(true);if(first===end)return null;
  const a=moves.at(first),b=moves.at(end-1);
  return {entityId:a.entityId,scheduleIndex:index,kind:a.executionKind,toolIndex:a.toolIndex,first,last:end-1,
    startSeconds:a.startSeconds,endSeconds:b.startSeconds+b.durationSeconds,
    ...(a.sourceCurveId?{curveId:a.sourceCurveId,from:Math.min(a.sourceFromU,b.sourceFromU),to:Math.max(a.sourceToU,b.sourceToU),reverse:a.sourceReverse}:{}),
    ...(a.executionKind==='stationary'?{fromU:a.stationaryFromU,toU:b.stationaryToU}:{} )};
}

export function createExecutionReview({parent,onSeek}){
  const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const panel=element('details'),input=element('input'),readout=element('p');panel.className='execution-review';panel.hidden=true;
  const label=element('label','Schedule index ');input.type='number';input.min=0;input.step=1;label.append(input);panel.append(element('summary','Scheduled entities'),label);parent.append(panel);
  let program=null;
  function select(seek){
    const row=scheduledEntity(program?.moves,Number(input.value));
    if(!row){readout.textContent='No rendered entity has this schedule index.';return;}
    const parts=[`Index ${row.scheduleIndex} · ${row.kind}`,`Entity ${row.entityId}`];
    if(Number.isSafeInteger(row.toolIndex))parts.push(`Logical tool ${row.toolIndex}`);
    if(row.curveId)parts.push(`Curve ${row.curveId} · u=${row.from}…${row.to}${row.reverse?' · reversed':''}`);
    if(row.kind==='stationary')parts.push(`Requested stationary timeline u=${row.fromU}…${row.toU}`);
    parts.push(`Requested playback ${row.startSeconds.toPrecision(6)}…${row.endSeconds.toPrecision(6)} s`);
    readout.textContent=parts.join('\n');if(seek)onSeek(row.startSeconds);
  }
  const button=(text,action)=>{const b=element('button',text);b.type='button';b.onclick=action;panel.append(b);return b;};
  button('Previous entity',()=>{input.value=Math.max(Number(input.min),Number(input.value)-1);select(true);});
  button('Show entity',()=>select(true));button('Next entity',()=>{input.value=Math.min(Number(input.max),Number(input.value)+1);select(true);});panel.append(readout);
  input.onchange=()=>select(false);
  return {bind(next,{visible=true}={}){
    const first=next?.moves?.at(0),last=next?.moves?.at(-1),available=Number.isSafeInteger(first?.scheduleIndex)&&Number.isSafeInteger(last?.scheduleIndex);
    if(!available){program=null;panel.hidden=true;readout.textContent='';return;}
    if(program!==next){program=next;input.min=first.scheduleIndex;input.max=last.scheduleIndex;input.value=first.scheduleIndex;select(false);}
    panel.hidden=!visible;
  },clear(){program=null;panel.hidden=true;readout.textContent='';},dispose(){program=null;panel.remove();}};
}
