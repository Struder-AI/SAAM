// Public planar polygon query. Horizontal chords use a half-open vertex rule.
export function polygonChords(points,y){
  const crossings=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y))crossings.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
  }
  crossings.sort((a,b)=>a-b);
  return Array.from({length:crossings.length/2},(_,i)=>[crossings[i*2],crossings[i*2+1]]);
}
