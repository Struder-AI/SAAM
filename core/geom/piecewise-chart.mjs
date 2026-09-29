import {distance,dot,cross,normalize,requireThat} from './tolerance.mjs';

const sub=(a,b)=>a.map((x,k)=>x-b[k]);
const add=(a,b,s=1)=>a.map((x,k)=>x+s*b[k]);
const cross2=(a,b)=>a[0]*b[1]-a[1]*b[0];
const dot2=(a,b)=>a[0]*b[0]+a[1]*b[1];

// A local, indexed chart atlas for the two piecewise references SAAM authors:
// contour sleeves and a mesh roof's visible facets. It preserves seams, creases
// and missing facets; it does not recognize or parameterize arbitrary meshes.
export function piecewiseChart(surface,{toleranceMm=.01,normalMm=0}={}){
  const triangles=[];
  if(surface.kind==='sleeve-chart'){
    const rings=surface.layers.map(layer=>{
      requireThat(layer.curves.length===1&&layer.curves[0].closed,'Sleeve chart requires one closed boundary per layer.');
      const raw=layer.curves[0].points,points=distance(raw[0],raw.at(-1))<1e-10?raw.slice(0,-1):raw;
      const lengths=[0];for(let i=0;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i],points[(i+1)%points.length]));
      return {points,cuts:lengths.map(l=>l/lengths.at(-1))};
    });
    const ringAt=(ring,u)=>{let i=1;while(i<ring.cuts.length-1&&ring.cuts[i]<u)i++;const t=(u-ring.cuts[i-1])/(ring.cuts[i]-ring.cuts[i-1]);return add(ring.points[i-1],sub(ring.points[i%ring.points.length],ring.points[i-1]),t);};
    const cuts=[...new Set(rings.flatMap(r=>r.cuts))].sort((a,b)=>a-b),cells=[];
    for(let v=0;v<rings.length-1;v++){
      for(let i=1;i<cuts.length;i++){
        const u0=cuts[i-1],u1=cuts[i],corners=[ringAt(rings[v],u0),ringAt(rings[v],u1),ringAt(rings[v+1],u1),ringAt(rings[v+1],u0)];
        // Bilinear ruled cells retain exact authored edges. A uniform per-cell
        // subdivision bounds the mixed term's planar interpolation error.
        const twist=distance(add(corners[0],corners[2]),add(corners[1],corners[3]));
        cells.push({u0,u1,v,corners,twist});
      }
    }
    // Conforming subdivisions share every edge vertex, including across the
    // periodic seam; varying cell counts would introduce false chart holes.
    const count=cells.reduce((n,c)=>Math.max(n,Math.ceil(Math.sqrt(c.twist/(4*toleranceMm)))),1);
    for(const {u0,u1,v,corners} of cells){
        const vertex=(x,y)=>({uv:[u0+(u1-u0)*x,v+y],point:corners[0].map((_,k)=>(1-y)*((1-x)*corners[0][k]+x*corners[1][k])+y*((1-x)*corners[3][k]+x*corners[2][k]))});
        for(let x=0;x<count;x++)for(let y=0;y<count;y++){
          const q=[vertex(x/count,y/count),vertex((x+1)/count,y/count),vertex((x+1)/count,(y+1)/count),vertex(x/count,(y+1)/count)];
          triangles.push([q[0],q[1],q[2]],[q[0],q[2],q[3]]);
        }
    }
  }else{
    const slice=surface.slice,mesh=slice.reference.geometry;
    requireThat(mesh.kind==='triangle-mesh','Piecewise bands on a native-shell roof are unfinished: use the native patch or spline height-field reference; tessellated-shell bands have unresolved facet-assembly artifacts.');
    triangles.push(...roofChartTriangles(mesh,slice));
  }
  requireThat(triangles.length,'Piecewise chart has no nondegenerate surface facets.');
  const periodic=surface.kind==='sleeve-chart',base=chartFromTriangles(triangles,periodic);
  return normalMm?roundedChart(base,{normalMm,toleranceMm}):{...base,toleranceMm,method:periodic?'ruled-sleeve-facet-unfolding':'authored-roof-facet-unfolding'};
}

// A roof is the upper envelope, not the set of facets whose centroids happen
// to be visible. Clip each planar facet against every higher overlapping
// facet's half planes; convex remainders retain exact crossing boundaries.
function roofChartTriangles(mesh,slice){
  const facets=mesh.triangles.map(indices=>{
    const points=indices.map(i=>mesh.vertices[i]),raw=cross(sub(points[1],points[0]),sub(points[2],points[0]));
    if(raw[2]<=1e-12)return null;
    const normal=normalize(raw),polygon=points.map(p=>p.slice(0,2)),origin=points[0];
    return {normal,polygon,min:[0,1].map(k=>Math.min(...polygon.map(p=>p[k]))),max:[0,1].map(k=>Math.max(...polygon.map(p=>p[k]))),height:p=>origin[2]-(normal[0]*(p[0]-origin[0])+normal[1]*(p[1]-origin[1]))/normal[2]};
  }).filter(Boolean);
  const split=(polygon,field)=>{
    const inside=[],outside=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],fa=field(a),fb=field(b);
      if(fa>=0)inside.push(a);if(fa<=0)outside.push(a);
      if(fa>0&&fb<0||fa<0&&fb>0){const point=add(a,sub(b,a),fa/(fa-fb));inside.push(point);outside.push(point);}
    }
    return {inside,outside};
  };
  const regions=[];
  for(const [index,facet] of facets.entries()){
    let pieces=[facet.polygon];
    for(const [otherIndex,other] of facets.entries()){
      if(otherIndex===index||[0,1].some(k=>other.max[k]<=facet.min[k]||other.min[k]>=facet.max[k]))continue;
      const differences=facet.polygon.map(p=>other.height(p)-facet.height(p));
      if(Math.max(...differences)<-1e-9||differences.every(d=>Math.abs(d)<1e-9))continue;
      const fields=other.polygon.map((a,i)=>{const edge=sub(other.polygon[(i+1)%3],a);return p=>cross2(edge,sub(p,a));});
      fields.push(p=>other.height(p)-facet.height(p)+(otherIndex<index?1e-12:-1e-12));
      const retained=[];
      for(const piece of pieces){let remainder=piece;for(const field of fields){if(remainder.length<3)break;const {inside,outside}=split(remainder,field);if(outside.length>=3)retained.push(outside);remainder=inside;}}
      pieces=retained;if(!pieces.length)break;
    }
    for(const polygon of pieces)regions.push({facet,polygon});
  }
  const vertices=regions.flatMap(r=>r.polygon),triangles=[];
  for(const {facet,polygon} of regions){
    const boundary=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],edge=sub(b,a),length2=dot2(edge,edge);if(length2<1e-20)continue;
      const cuts=[{t:0,point:a}];
      for(const p of vertices){const v=sub(p,a),t=dot2(v,edge)/length2;if(t>1e-9&&t<1-1e-9&&Math.abs(cross2(edge,v))<=1e-9*Math.sqrt(length2))cuts.push({t,point:p});}
      for(const {point} of cuts.sort((a,b)=>a.t-b.t))if(!boundary.length||distance(point,boundary.at(-1))>1e-9)boundary.push(point);
    }
    if(boundary.length<3)continue;
    const center=boundary.reduce((s,p)=>add(s,p,1/boundary.length),[0,0]);
    const vertex=uv=>({uv,point:[...uv,facet.height(uv)+slice.offsetMm-(slice.normalDepthMm??0)/facet.normal[2]]});
    for(let i=0;i<boundary.length;i++)if(Math.abs(cross2(sub(boundary[i],center),sub(boundary[(i+1)%boundary.length],center)))>1e-15)triangles.push([vertex(center),vertex(boundary[i]),vertex(boundary[(i+1)%boundary.length])]);
  }
  return triangles;
}

function chartFromTriangles(triangles,periodic){
  const faces=triangles.map(vertices=>{
    const [a,b,c]=vertices.map(v=>v.uv),[p,q,r]=vertices.map(v=>v.point),x=sub(b,a),y=sub(c,a),det=cross2(x,y);
    const du=sub(q,p).map((v,k)=>(v*y[1]-(r[k]-p[k])*x[1])/det),dv=sub(q,p).map((v,k)=>((r[k]-p[k])*x[0]-v*y[0])/det),normal=normalize(cross(du,dv));
    const E=dot(du,du),F=dot(du,dv),G=dot(dv,dv),D=E*G-F*F;
    return {vertices,du,dv,normal,neighbors:[null,null,null],uvOf(vector){const a=dot(du,vector),b=dot(dv,vector);return [(G*a-F*b)/D,(E*b-F*a)/D];}};
  });
  const edges=new Map();
  const key=uv=>uv.map((v,k)=>Math.round((periodic&&k===0?v-Math.floor(v):v)*1e10)).join(',');
  for(const [index,face] of faces.entries())for(let edge=0;edge<3;edge++){
    const a=face.vertices[edge].uv,b=face.vertices[(edge+1)%3].uv,k=[key(a),key(b)].sort().join('|');
    if(edges.has(k)){const previous=edges.get(k);face.neighbors[edge]=previous;faces[previous.face].neighbors[previous.edge]={face:index,edge};}
    else edges.set(k,{face:index,edge});
  }
  return {faces,periodic};
}

// Internal chart coordinates reserve room for each rounded strip. They never
// replace authored coordinates: every vertex separately retains baseUv, and
// lowering maps face locations exactly, holding baseUv fixed across a join.
function roundedChart(base,{normalMm,toleranceMm}){
  const vertices=new Map(),groups=[],radius=Math.abs(normalMm);
  const canonical=uv=>[base.periodic?uv[0]-Math.floor(uv[0]):uv[0],uv[1]];
  const vertexKey=uv=>canonical(uv).map(v=>Math.round(v*1e10)).join(',');
  const faceGroups=base.faces.map(face=>{
    const center=face.vertices.reduce((s,v)=>add(s,v.uv,1/3),[0,0]);
    return face.vertices.map(vertex=>{
      const key=vertexKey(vertex.uv);if(!vertices.has(key))vertices.set(key,{uv:canonical(vertex.uv),point:vertex.point,groups:[]});
      const shared=vertices.get(key);let group=shared.groups.find(g=>distance(g.normal,face.normal)<1e-9);
      if(!group){group={vertex:shared,normal:face.normal,directions:[]};shared.groups.push(group);groups.push(group);}
      group.directions.push(sub(center,vertex.uv));return group;
    });
  });
  for(const vertex of vertices.values())for(const group of vertex.groups){
    const displacement=group.directions.reduce((s,d)=>add(s,d,1/group.directions.length),[0,0]);
    group.uv=vertex.groups.length===1?vertex.uv:add(vertex.uv,displacement,.05);
  }
  const placed=(group,original)=>{
    const shift=base.periodic?Math.round(original[0]-group.vertex.uv[0]):0;
    return {uv:add(group.uv,[shift,0]),baseUv:original,point:add(group.vertex.point,group.normal,normalMm)};
  };
  const faceVertices=base.faces.map((face,i)=>face.vertices.map((v,k)=>placed(faceGroups[i][k],v.uv))),triangles=[...faceVertices];
  const interpolate=(a,b,t)=>normalize(add(a,sub(b,a),t));
  const edges=[];
  for(const [i,face] of base.faces.entries())for(let edge=0;edge<3;edge++){
    const next=face.neighbors[edge];if(!next||next.face<=i)continue;
    const other=base.faces[next.face];if(distance(face.normal,other.normal)<1e-9)continue;
    requireThat(dot(face.normal,other.normal)>-1+1e-10,'Rounded offset has reversing incident faces at a crease.');
    edges.push({i,edge,next});
  }
  let count=1;
  const pairs=edges.map(({i,next})=>[base.faces[i].normal,base.faces[next.face].normal]);
  for(const vertex of vertices.values())if(vertex.groups.length>2){const center=normalize(vertex.groups.reduce((s,g)=>add(s,g.normal),[0,0,0]));for(const g of vertex.groups)pairs.push([center,g.normal]);}
  while(pairs.some(([a,b])=>Array.from({length:count},(_,i)=>{
    const p=interpolate(a,b,i/count),q=interpolate(a,b,(i+1)/count);
    return radius*(1-Math.sqrt(Math.max(0,(1+dot(p,q))/2)))>toleranceMm;
  }).some(Boolean)))count*=2;
  for(const {i,edge,next} of edges){
    const face=base.faces[i],other=base.faces[next.face],a=faceVertices[i][edge],b=faceVertices[i][(edge+1)%3],ra=faceVertices[next.face][(next.edge+1)%3],rb=faceVertices[next.face][next.edge];
    const shift=base.periodic?Math.round(a.baseUv[0]-ra.baseUv[0]):0,au=add(ra.uv,[shift,0]),bu=add(rb.uv,[shift,0]);
    const vertex=(which,t)=>{const source=which?a:b,target=which?au:bu,point=face.vertices[which?edge:(edge+1)%3].point;return {uv:add(source.uv,sub(target,source.uv),t),baseUv:source.baseUv,point:add(point,interpolate(face.normal,other.normal,t),normalMm)};};
    for(let j=0;j<count;j++){const a0=vertex(true,j/count),a1=vertex(true,(j+1)/count),b0=vertex(false,j/count),b1=vertex(false,(j+1)/count);triangles.push([a0,b0,b1],[a0,b1,a1]);}
  }
  for(const vertex of vertices.values())if(vertex.groups.length>2){
    const ordered=[...vertex.groups].sort((a,b)=>Math.atan2(a.uv[1]-vertex.uv[1],a.uv[0]-vertex.uv[0])-Math.atan2(b.uv[1]-vertex.uv[1],b.uv[0]-vertex.uv[0]));
    const center=normalize(ordered.reduce((s,g)=>add(s,g.normal),[0,0,0]));
    for(let i=0;i<ordered.length;i++){
      const a=ordered[i],b=ordered[(i+1)%ordered.length];
      const point=(x,y)=>{const normal=normalize(add(add(center,a.normal.map((n,k)=>n-center[k]),x),b.normal.map((n,k)=>n-center[k]),y));return {uv:add(add(vertex.uv,sub(a.uv,vertex.uv),x),sub(b.uv,vertex.uv),y),baseUv:vertex.uv,point:add(vertex.point,normal,normalMm)};};
      for(let x=0;x<count;x++)for(let y=0;y<count-x;y++){
        const p=point(x/count,y/count),q=point((x+1)/count,y/count),r=point(x/count,(y+1)/count);triangles.push([p,q,r]);
        if(x+y<count-1)triangles.push([q,point((x+1)/count,(y+1)/count),r]);
      }
    }
  }
  const oriented=triangles.map(t=>cross2(sub(t[1].uv,t[0].uv),sub(t[2].uv,t[0].uv))<0?[t[0],t[2],t[1]]:t);
  return {...chartFromTriangles(oriented,base.periodic),base,faceVertices,normalMm,toleranceMm,method:'rounded-offset-facet-unfolding',roundSegments:count};
}

function candidates(chart,uv){
  const shift=chart.periodic?Math.floor(uv[0]):0,found=[],shifts=chart.periodic?[shift,shift-1,shift+1]:[shift];
  for(const shift of shifts){const p=[uv[0]-shift,uv[1]];for(const [index,face] of chart.faces.entries()){
    const inside=face.vertices.every(({uv:a},i)=>cross2(sub(face.vertices[(i+1)%3].uv,a),sub(p,a))>=-1e-10);
    if(inside)found.push({face,index,p,shift});
  }}
  requireThat(found.length,`Piecewise chart has no surface at (${uv.join(', ')}).`);return found;
}

export function piecewiseChartFrame(chart,uv,hint=null){
  const found=candidates(chart,uv),selected=hint?found.find(({face,p,shift})=>{
    const d=[hint[0]-uv[0],hint[1]-uv[1]];
    return face.vertices.every(({uv:a},i)=>{const edge=sub(face.vertices[(i+1)%3].uv,a);return cross2(edge,sub(p,a))>1e-10||cross2(edge,d)>=-1e-12;});
  })??found[0]:found[0];
  const {face,p}=selected,a=face.vertices[0],point=add(add(a.point,face.du,p[0]-a.uv[0]),face.dv,p[1]-a.uv[1]);
  const [b,c]=face.vertices.slice(1),ab=sub(b.uv,a.uv),ac=sub(c.uv,a.uv),ap=sub(p,a.uv),det=cross2(ab,ac),x=cross2(ap,ac)/det,y=cross2(ab,ap)/det;
  const baseUv=a.baseUv?add(add(a.baseUv,sub(b.baseUv,a.baseUv),x),sub(c.baseUv,a.baseUv),y):p;
  return {...face,point,baseUv:[baseUv[0]+selected.shift,baseUv[1]],duu:[0,0,0],duv:[0,0,0],dvv:[0,0,0],index:selected.index,shift:selected.shift};
}

export function mapPiecewiseChartPath(chart,path){
  if(!chart.base)return path;
  const split=splitPiecewiseChartPath(chart.base,path),points=[],parameters=[];
  for(let i=1;i<split.points.length;i++){
    const a=split.points[i-1],b=split.points[i],frame=piecewiseChartFrame(chart.base,a,add(a,sub(b,a),.5));
    const original=chart.base.faces[frame.index].vertices,offset=chart.faceVertices[frame.index];
    for(const [p,t] of [[a,split.parameters[i-1]],[b,split.parameters[i]]]){
      const uv=[p[0]-frame.shift,p[1]],ab=sub(original[1].uv,original[0].uv),ac=sub(original[2].uv,original[0].uv),ap=sub(uv,original[0].uv),det=cross2(ab,ac),x=cross2(ap,ac)/det,y=cross2(ab,ap)/det;
      const mapped=add(add(offset[0].uv,sub(offset[1].uv,offset[0].uv),x),sub(offset[2].uv,offset[0].uv),y);mapped[0]+=frame.shift;
      if(!points.length||distance(mapped,points.at(-1))>1e-12){points.push(mapped);parameters.push(t);}
    }
  }
  return {points,parameters,closed:false};
}

// Unfold each adjacent facet about its shared edge. On planar facets this is
// exact to floating-point arithmetic; a ruled cell's approximation is bounded
// by the atlas tolerance, independently of the requested geodesic distance.
export function piecewiseChartRay(chart,uv,direction,lengthMm,hint=null){
  let frame=piecewiseChartFrame(chart,uv,hint),index=frame.index,shift=frame.shift,p=[uv[0]-shift,uv[1]];
  let velocity=normalize(sub(direction,frame.normal.map(n=>n*dot(direction,frame.normal)))),remaining=lengthMm;
  const ray=[[...uv]],visited=new Set();
  while(remaining>1e-12){
    const face=chart.faces[index],d=face.uvOf(velocity);let travel=remaining,edgeIndex=-1;
    for(let edge=0;edge<3;edge++){
      const a=face.vertices[edge].uv,b=face.vertices[(edge+1)%3].uv,e=sub(b,a),den=cross2(e,d);
      if(den>=-1e-12)continue;
      const t=-cross2(e,sub(p,a))/den;
      if(t>=-1e-9&&t<travel){travel=Math.max(0,t);edgeIndex=edge;}
    }
    p=add(p,d,travel);remaining-=travel;
    const next=[p[0]+shift,p[1]];if(distance(next,ray.at(-1))>1e-12)ray.push(next);
    if(edgeIndex<0||remaining<=1e-12)break;
    const adjacent=face.neighbors[edgeIndex];
    if(!adjacent)break; // True chart edge or hole, never a synthetic bridge.
    const other=chart.faces[adjacent.face],a=face.vertices[edgeIndex],b=face.vertices[(edgeIndex+1)%3],axis=normalize(sub(b.point,a.point));
    const parallel=dot(velocity,axis),across=Math.sqrt(Math.max(0,1-parallel*parallel));
    const oa=other.vertices[adjacent.edge],ob=other.vertices[(adjacent.edge+1)%3],interior=normalize(cross(other.normal,sub(ob.point,oa.point)));
    if(dot(face.normal,other.normal)<1-1e-12)velocity=add(axis.map(v=>v*parallel),interior,across);
    const delta=a.uv[0]-ob.uv[0];
    if(chart.periodic&&Math.abs(delta)>.5){p[0]-=delta;shift+=delta;}
    const key=`${index}:${edgeIndex}:${remaining}`;
    requireThat(!visited.has(key),'Piecewise chart ray cannot progress through a vertex.');visited.add(key);
    index=adjacent.face;
  }
  return ray;
}

export function splitPiecewiseChartPath(chart,path){
  const points=path.closed?[...path.points,path.points[0]]:path.points,result=[points[0]],parameters=[path.parameters?.[0]??0];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],d=sub(b,a),cuts=[1],low=chart.periodic?Math.floor(Math.min(a[0],b[0]))-1:0,high=chart.periodic?Math.floor(Math.max(a[0],b[0]))+1:0;
    for(let shift=low;shift<=high;shift++)for(const face of chart.faces)for(let edge=0;edge<3;edge++){
      const p=add(face.vertices[edge].uv,[shift,0]),q=add(face.vertices[(edge+1)%3].uv,[shift,0]),e=sub(q,p),den=cross2(d,e);
      if(Math.abs(den)<1e-14)continue;
      const t=cross2(sub(p,a),e)/den,s=cross2(sub(p,a),d)/den;
      if(t>1e-10&&t<1-1e-10&&s>=-1e-10&&s<=1+1e-10)cuts.push(t);
    }
    for(const t of [...new Set(cuts)].sort((a,b)=>a-b)){const p=add(a,d,t);if(distance(p,result.at(-1))>1e-10){result.push(p);const ta=path.parameters?.[i-1]??(i-1)/(points.length-1),tb=path.parameters?.[i]??i/(points.length-1);parameters.push(ta+(tb-ta)*t);}}
  }
  return {...path,closed:false,points:result,parameters};
}
