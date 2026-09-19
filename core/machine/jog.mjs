// Local constrained jogging. All feasibility and boundary values belong to the
// model. Continue locally from the current feasible configuration.
export function constrainedJog({from,target,axis,scales,evaluate}){
  if(!Number.isInteger(axis)||axis<0||axis>=from.length||target.length!==from.length||!from.every(Number.isFinite)||!target.every(Number.isFinite))throw Error('Invalid jog request');
  const initial=evaluate(from);if(!initial.valid)throw Error('Jog must start from a reachable pose');
  let accepted=[...from],result=initial,limited=false;
  // Continuation steps stay within 8 weighted units of each other, so a longer
  // drag takes more of them rather than coarser ones.
  const remaining=target[axis]-from[axis],steps=Math.max(1,Math.ceil(Math.abs(remaining)*scales[axis]/8));
  const free=from.map((_,i)=>i).filter(i=>i!==axis);
  function project(start,value){
    let x=[...start];x[axis]=value;
    // Corrections continue while the worst boundary margin keeps improving; a
    // correction that no longer improves it has reached an infeasible pose.
    let best=-Infinity,stalls=0;
    for(;;){
      const s=evaluate(x);if(s.valid)return {values:x,result:s};
      const margins=s.margins;if(!margins?.length||!margins.every(Number.isFinite))return null;
      if(!margins.some(v=>v<1e-7))return null;
      const worst=Math.min(...margins);
      if(worst>best+Math.abs(best)*1e-9+1e-12){best=worst;stalls=0;}
      else if(++stalls>=8)return null;
      const boundaries=margins.map((v,i)=>({v,i}));
      const columns=free.map(j=>{const y=[...x],h=.001/scales[j];y[j]+=h;const m=evaluate(y,true).margins;return margins.map((v,i)=>((m?.[i]??v)-v)/.001);});
      const delta=free.map(()=>0);
      // Project a minimum-size correction onto the linearized active boundaries.
      for(let pass=0;pass<6;pass++)for(const c of boundaries){
        const g=columns.map(col=>col[c.i]),square=g.reduce((sum,v)=>sum+v*v,0),need=1e-6-c.v-g.reduce((sum,v,i)=>sum+v*delta[i],0);
        if(need>0&&square>1e-16)g.forEach((v,i)=>delta[i]+=v*need/square);
      }
      const distance=Math.hypot(...delta);if(distance<1e-9)return null;
      const factor=Math.min(1,8/distance);free.forEach((j,i)=>x[j]+=delta[i]*factor/scales[j]);
      if(!x.every(Number.isFinite))return null;
    }
  }
  for(let step=1;step<=steps;step++){
    const wanted=from[axis]+remaining*step/steps,solved=project(accepted,wanted);
    if(solved){accepted=solved.values;result=solved.result;continue;}
    // Locate the last reachable position along this local continuation.
    let lo=accepted[axis],hi=wanted;
    while(Math.abs(hi-lo)*scales[axis]>.001){
      const middle=(lo+hi)/2;if(middle===lo||middle===hi)break;
      const s=project(accepted,middle);
      if(s){lo=middle;accepted=s.values;result=s.result;}else hi=middle;
    }
    limited=true;break;
  }
  return {values:accepted,result,limited,adjusted:accepted.some((v,i)=>i!==axis&&Math.abs(v-from[i])*scales[i]>.001)};
}
