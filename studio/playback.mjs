export function advancePlayback(seconds, elapsedMs, speed, duration) {
  return Math.min(duration, Math.max(0, seconds + Math.max(0, elapsedMs) / 1000 * speed));
}
export function frameAtTime(moves, seconds) {
  if(!moves.length)return {completed:0,active:-1,fraction:0,point:null};
  let low=0,high=moves.length;
  while(low<high){const mid=(low+high)>>1;if(moves[mid].startSeconds<=seconds)low=mid+1;else high=mid;}
  const index=low-1;
  if(index<0)return {completed:0,active:-1,fraction:0,point:moves[0].from};
  const move=moves[index],fraction=Math.max(0,Math.min(1,(seconds-move.startSeconds)/move.durationSeconds));
  return {completed:index+(fraction>=1?1:0),active:index,fraction,point:move.from.map((v,i)=>v+(move.to[i]-v)*fraction)};
}
