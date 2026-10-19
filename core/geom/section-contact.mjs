// Numerical contact footprints in a moving rectangular section's local frame.
// No path identities, manufacturing assumptions or scheduling policy live here.
import {add,subtract,scale,dot,length} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

function box(body,paddingMm=0){
  const delta=subtract(body.b,body.a),size=length(delta);if(size<=ROUNDING_MM)return null;
  const axes=[scale(delta,1/size),body.side,body.normal],limits=[[0,size],[-body.radius,body.radius],[-body.depth-paddingMm,paddingMm]];
  const vertices=Array.from({length:8},(_,mask)=>axes.reduce((point,axis,k)=>add(point,scale(axis,limits[k][mask>>k&1])),body.a));
  const edges=vertices.flatMap((a,i)=>[0,1,2].filter(k=>!(i>>k&1)).map(k=>[a,vertices[i|1<<k]]));
  return {origin:body.a,axes,limits,edges};
}
function local(point,basis){const delta=subtract(point,basis.origin);return basis.axes.map(axis=>dot(delta,axis));}
function clippedEdge(a,b,basis){
  const from=local(a,basis),to=local(b,basis),span={from:0,to:1};
  for(let k=0;k<3;k++){
    const delta=to[k]-from[k],[lo,hi]=basis.limits[k];
    if(Math.abs(delta)<=ROUNDING_MM){if(from[k]<lo-ROUNDING_MM||from[k]>hi+ROUNDING_MM)return [];continue;}
    const x=(lo-from[k])/delta,y=(hi-from[k])/delta;
    span.from=Math.max(span.from,Math.min(x,y));span.to=Math.min(span.to,Math.max(x,y));
    if(span.from>span.to)return [];
  }
  return [span.from,span.to].map(t=>a.map((v,k)=>v+(b[k]-v)*t));
}
function hull(points){
  const sorted=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]),unique=sorted.filter((p,i)=>!i||p[0]!==sorted[i-1][0]||p[1]!==sorted[i-1][1]);
  if(unique.length<3)return null;
  const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const low=[],high=[];
  for(const p of unique){while(low.length>1&&turn(low.at(-2),low.at(-1),p)<=0)low.pop();low.push(p);}
  for(const p of unique.toReversed()){while(high.length>1&&turn(high.at(-2),high.at(-1),p)<=0)high.pop();high.push(p);}
  const polygon=[...low.slice(0,-1),...high.slice(0,-1)];
  const area=polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length];return sum+a[0]*b[1]-a[1]*b[0];},0);
  return Math.abs(area)>ROUNDING_MM**2?polygon:null;
}
// The intersection vertices of two boxes lie on an edge of at least one box.
// Projecting that intersection measures contact width while retaining BOTH
// sections' dimensions and orientation; no exposed-face classification is needed.
export function sectionContactPolygons(receiver,material,{toleranceMm=PRINT_RESOLUTION_MM*2}={}){
  const a=box(receiver,toleranceMm),b=box(material);if(!a||!b)return [];
  const points=[...a.edges.flatMap(([p,q])=>clippedEdge(p,q,b)),...b.edges.flatMap(([p,q])=>clippedEdge(p,q,a))];
  const polygon=hull(points.map(p=>local(p,a).slice(0,2)));return polygon?[polygon]:[];
}
export function planeContactPolygons(receiver,{normal=[0,0,1],offsetMm=0,toleranceMm=PRINT_RESOLUTION_MM*2}={}){
  const basis=box(receiver,toleranceMm);if(!basis)return [];
  const points=[];
  for(const [a,b] of basis.edges){
    const x=dot(a,normal)-offsetMm,y=dot(b,normal)-offsetMm;
    if(Math.abs(x)<=ROUNDING_MM)points.push(a);
    if(Math.abs(y)<=ROUNDING_MM)points.push(b);
    if((x<0)!==(y<0)){const t=x/(x-y);points.push(a.map((v,k)=>v+(b[k]-v)*t));}
  }
  const polygon=hull(points.map(p=>local(p,basis).slice(0,2)));return polygon?[polygon]:[];
}

function edgesOf(polygons){
  return polygons.flatMap(polygon=>polygon.flatMap((a,i)=>{
    const b=polygon[(i+1)%polygon.length];if(a[0]===b[0])return [];
    const slope=(b[1]-a[1])/(b[0]-a[0]);
    return [{from:Math.min(a[0],b[0]),to:Math.max(a[0],b[0]),slope,intercept:a[1]-slope*a[0]}];
  }));
}
function widthAt(polygons,x){
  const intervals=[];
  for(const polygon of polygons){
    const ys=[];
    for(const [i,a] of polygon.entries()){
      const b=polygon[(i+1)%polygon.length];if(x<Math.min(a[0],b[0])||x>Math.max(a[0],b[0]))continue;
      if(a[0]===b[0])ys.push(a[1],b[1]);else ys.push(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]));
    }
    if(ys.length)intervals.push([Math.min(...ys),Math.max(...ys)]);
  }
  intervals.sort((a,b)=>a[0]-b[0]);const state={end:-Infinity,width:0};
  for(const [a,b] of intervals){state.width+=Math.max(0,b-Math.max(a,state.end));state.end=Math.max(state.end,b);}
  return state.width;
}
// Union coverage is piecewise linear. Its only events are polygon vertices and
// crossing edges, so long straight contacts cost no sampling along their length.
export function contactWidthIntervals(polygons,minimumWidthMm){
  const cuts=new Set(polygons.flatMap(polygon=>polygon.map(p=>p[0]))),edges=edgesOf(polygons);
  for(const [i,a] of edges.entries())for(let j=i+1;j<edges.length;j++){
    const b=edges[j],slope=a.slope-b.slope;if(Math.abs(slope)<=ROUNDING_RELATIVE)continue;
    const x=(b.intercept-a.intercept)/slope;
    if(x>Math.max(a.from,b.from)&&x<Math.min(a.to,b.to))cuts.add(x);
  }
  const sorted=[...cuts].sort((a,b)=>a-b),result=[];
  for(let i=1;i<sorted.length;i++){
    const from=sorted[i-1],to=sorted[i];if(to-from<=ROUNDING_MM)continue;
    // Interior evaluations avoid a vertical edge's one-sided endpoint value.
    const x=from+(to-from)/3,y=to-(to-from)/3,a=widthAt(polygons,x)-minimumWidthMm,b=widthAt(polygons,y)-minimumWidthMm;
    const slope=(b-a)/(y-x),left=a+slope*(from-x),right=a+slope*(to-x);
    if(Math.max(left,right)<=ROUNDING_MM)continue;
    const root=slope?x-a/slope:from,lo=left>ROUNDING_MM?from:Math.max(from,root),hi=right>ROUNDING_MM?to:Math.min(to,root);
    if(hi-lo<=ROUNDING_MM)continue;
    const previous=result.at(-1);
    if(previous&&lo<=previous[1]+ROUNDING_MM)previous[1]=hi;else result.push([lo,hi]);
  }
  return result;
}
