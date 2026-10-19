// Homogeneous Bezier operations shared by rational coincidence, support bounds
// and surface intersections. Inputs remain owned by their callers.
export function splitBezierLine(line,t){
  const state={row:line},left=[],right=[];
  while(state.row.length){
    left.push(state.row[0]);right.unshift(state.row.at(-1));
    state.row=state.row.slice(1).map((point,i)=>point.map((value,k)=>state.row[i][k]+t*(value-state.row[i][k])));
  }
  return [left,right];
}
export function restrictBezierLine(line,[low,high]){
  const right=low>0?splitBezierLine(line,low)[1]:line;
  return high<1?splitBezierLine(right,(high-low)/(1-low))[0]:right;
}
export function restrictBezierNet(net,ranges){
  const columns=net[0].map((_,j)=>restrictBezierLine(net.map(row=>row[j]),ranges[0]));
  const rows=columns[0].map((_,i)=>columns.map(column=>column[i]));
  return rows.map(row=>restrictBezierLine(row,ranges[1]));
}
export function splitBezierNet(net,axis,t=.5){
  if(axis===1){
    const rows=net.map(row=>splitBezierLine(row,t));
    return [rows.map(pair=>pair[0]),rows.map(pair=>pair[1])];
  }
  const columns=net[0].map((_,j)=>splitBezierLine(net.map(row=>row[j]),t));
  return [0,1].map(side=>columns[0][side].map((_,i)=>columns.map(pair=>pair[side][i])));
}
export function evaluateBezierNet(net,[u,v]){
  const columns=net[0].map((_,j)=>splitBezierLine(net.map(row=>row[j]),u)[0].at(-1));
  return splitBezierLine(columns,v)[0].at(-1);
}

const products=new Map();
export function bernsteinProductWeights(p,q){
  const key=p+':'+q;if(products.has(key))return products.get(key);
  const logChoose=(n,k)=>{
    const sum={value:0};
    for(let i=1;i<=Math.min(k,n-k);i++)sum.value+=Math.log(n+1-i)-Math.log(i);
    return sum.value;
  };
  const result=Array.from({length:p+1},(_,i)=>Array.from({length:q+1},(_,j)=>Math.exp(logChoose(p,i)+logChoose(q,j)-logChoose(p+q,i+j))));
  products.set(key,result);return result;
}
