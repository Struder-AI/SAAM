import {add,subtract,scale,dot,length,normalize} from '../core/geom/tolerance.mjs';
import {materialProjection} from './material-view.mjs';

// Display creases, not tessellation. Weld coincident proxy vertices for edge
// adjacency without changing the source mesh or the geometry used for slicing.
export function buildMeshView({vertices,faces},creaseDeg=3) {
  const ids=new Map(),weld=vertices.map(p=>{
    const key=p.map(v=>Math.round(v*1e7)).join(',');
    if(!ids.has(key))ids.set(key,ids.size);
    return ids.get(key);
  });
  const edges=new Map(),normals=faces.map(face=>{
    const n=[0,0,0];
    for(let i=0;i<face.length;i++) {
      const a=vertices[face[i]],b=vertices[face[(i+1)%face.length]];
      n[0]+=(a[1]-b[1])*(a[2]+b[2]);n[1]+=(a[2]-b[2])*(a[0]+b[0]);n[2]+=(a[0]-b[0])*(a[1]+b[1]);
    }
    const length=Math.hypot(...n);return length?n.map(v=>v/length):null;
  });
  const masks=faces.map(f=>f.map(()=>true));
  faces.forEach((face,f)=>face.forEach((v,i)=>{
    const a=weld[v],b=weld[face[(i+1)%face.length]],key=a<b?a+':'+b:b+':'+a;
    const entries=edges.get(key)??[];entries.push({f,i});edges.set(key,entries);
  }));
  const cosine=Math.cos(creaseDeg*Math.PI/180);
  for(const entries of edges.values()) {
    if(entries.length!==2)continue; // preserve boundaries/nonmanifold proxy edges
    const [a,b]=entries,na=normals[a.f],nb=normals[b.f];
    // Patch proxies can have opposite winding: compare their geometric planes.
    if(na&&nb&&Math.abs(na.reduce((s,v,i)=>s+v*nb[i],0))>cosine+1e-12)
      masks[a.f][a.i]=masks[b.f][b.i]=false;
  }
  return {edgeMasks:masks,normals,weld,edges};
}

// Angle-weighted corner normals remove triangulation shading without rounding
// real corners or blending across separately named CAD/component features.
export function buildGeometryView(geometry,creaseDeg=35,gridFeatures=[]){
  const {vertices,faces,labels}=geometry,topology=buildMeshView(geometry,creaseDeg);
  const {normals,weld,edges}=topology,incident=new Map(),cosine=Math.cos(creaseDeg*Math.PI/180);
  const features=[...new Set(labels)],featureIds=new Map(features.map((id,i)=>[id,i]));
  faces.forEach((face,f)=>face.forEach((v,k)=>{
    const a=subtract(vertices[face[(k+face.length-1)%face.length]],vertices[v]),b=subtract(vertices[face[(k+1)%face.length]],vertices[v]);
    const weight=Math.acos(Math.max(-1,Math.min(1,dot(a,b)/Math.max(1e-20,length(a)*length(b)))));
    const list=incident.get(weld[v])??[];list.push({f,weight});incident.set(weld[v],list);
  }));
  const cornerNormals=faces.map((face,f)=>face.map(v=>{
    const n=normals[f]??[0,0,1];let sum=[0,0,0];
    for(const other of incident.get(weld[v])){
      const candidate=normals[other.f];if(!candidate||labels[other.f]!==labels[f])continue;
      const alignment=dot(n,candidate);
      if(Math.abs(alignment)>cosine)sum=add(sum,scale(candidate,other.weight*(alignment<0?-1:1)));
    }
    return length(sum)>1e-12?normalize(sum):n;
  }));
  const triangles=[],surface=[],outlines=[];
  faces.forEach((face,f)=>{
    for(let i=1;i<face.length-1;i++){
      const corners=[0,i,i+1];triangles.push({indices:corners.map(k=>face[k]),id:labels[f]});
      for(const k of corners)surface.push(...vertices[face[k]],...cornerNormals[f][k],featureIds.get(labels[f]));
    }
  });
  for(const entries of edges.values()){
    const a=entries[0],b=entries[1];
    if(entries.length===2&&labels[a.f]===labels[b.f]&&!gridFeatures.includes(labels[a.f])&&!topology.edgeMasks[a.f][a.i])continue;
    for(const entry of entries.filter((e,i)=>entries.findIndex(o=>labels[o.f]===labels[e.f])===i)){
      const face=faces[entry.f];
      for(const k of [entry.i,(entry.i+1)%face.length])outlines.push(...vertices[face[k]],0,0,1,featureIds.get(labels[entry.f]));
    }
  }
  const edgeFeatures=new Map(),edgeLines=[],groups=new Map();
  for(const entries of edges.values()){
    const a=entries[0],names=[...new Set(entries.map(e=>labels[e.f]))].sort();
    if(names.length===1&&entries.length===2&&!topology.edgeMasks[a.f][a.i])continue;
    const face=faces[a.f],indices=[face[a.i],face[(a.i+1)%face.length]],key=JSON.stringify(names);
    if(!groups.has(key))groups.set(key,{names,segments:[]});
    groups.get(key).segments.push({indices,ends:indices.map(i=>weld[i])});
  }
  // Join a curved rim, but split at junctions so a box's wireframe is twelve edges.
  for(const [key,{names,segments}]of groups){
    const at=new Map(),visited=new Set();let number=0;
    segments.forEach((s,i)=>s.ends.forEach(v=>{if(!at.has(v))at.set(v,[]);at.get(v).push(i);}));
    function chain(index,start){
      const collected=[];let vertex=start;
      while(!visited.has(index)){
        visited.add(index);const s=segments[index];collected.push(s.indices);vertex=s.ends[0]===vertex?s.ends[1]:s.ends[0];
        if(at.get(vertex).length!==2)break;
        const next=at.get(vertex).find(i=>!visited.has(i));if(next===undefined)break;index=next;
      }
      const id='edge:'+key+':'+(++number),feature=features.length,offset=edgeLines.length/7;features.push(id);
      for(const pair of collected)for(const i of pair)edgeLines.push(...vertices[i],0,0,1,feature);
      edgeFeatures.set(id,{id,names,number,segments:collected,offset,count:collected.length*2});
    }
    segments.forEach((s,i)=>{const start=s.ends.find(v=>at.get(v).length!==2);if(start!==undefined&&!visited.has(i))chain(i,start);});
    segments.forEach((s,i)=>{if(!visited.has(i))chain(i,s.ends[0]);});
  }
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(const p of vertices)p.forEach((v,k)=>{bounds.min[k]=Math.min(bounds.min[k],v);bounds.max[k]=Math.max(bounds.max[k],v);});
  bounds.min[2]=Math.min(0,bounds.min[2]);
  return {geometry,features,triangles,cornerNormals,bounds,topology,edgeFeatures,edgeLines:new Float32Array(edgeLines),surface:new Float32Array(surface),outlines:new Float32Array(outlines)};
}

// Interpolate depth at the click, rather than sorting by whole-face centers.
function faceAt(view,points,x,y){
  let closest=-Infinity,hit=null;
  for(const triangle of view.triangles){
    const [a,b,c]=triangle.indices.map(i=>points[i]);
    const d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(d)<1e-10)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d;
    const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d,w=1-u-v;
    if(Math.min(u,v,w)<-1e-8)continue;
    const depth=u*a[2]+v*b[2]+w*c[2];if(depth>closest){closest=depth;hit=triangle.id;}
  }
  return {id:hit,depth:closest};
}
export function pickGeometry(view,project,x,y,{edges=false,radius=6}={}){
  const points=view.geometry.vertices.map(project);
  if(edges){
    let nearest=radius*radius,hit=null,front=-Infinity;
    for(const edge of view.edgeFeatures.values())for(const pair of edge.segments){
      const [a,b]=pair.map(i=>points[i]),dx=b[0]-a[0],dy=b[1]-a[1],squared=dx*dx+dy*dy;
      if(squared<1e-10)continue;
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/squared)),px=a[0]+t*dx,py=a[1]+t*dy,distance=(px-x)**2+(py-y)**2,depth=a[2]+t*(b[2]-a[2]);
      if(distance>nearest+1e-8||distance>=nearest-1e-8&&depth<front)continue;
      if(depth+1e-7<faceAt(view,points,px,py).depth)continue;
      nearest=distance;front=depth;hit=edge.id;
    }
    if(hit)return hit;
  }
  return faceAt(view,points,x,y).id;
}
export function visibleGeometryEdgeSegments(view,project,id){
  const edge=view.edgeFeatures.get(id);if(!edge)return [];
  const points=view.geometry.vertices.map(project),visible=[];
  for(const pair of edge.segments){
    const [a,b]=pair.map(i=>points[i]),count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/6));
    const point=t=>a.map((v,k)=>v+t*(b[k]-v));
    for(let i=0;i<count;i++){const middle=point((i+.5)/count);if(middle[2]+1e-7>=faceAt(view,points,middle[0],middle[1]).depth)visible.push([point(i/count),point((i+1)/count)]);}
  }
  return visible;
}

export function createGeometryRenderer(documentApi=document){
  const canvas=documentApi.createElement('canvas'),gl=canvas.getContext('webgl2',{alpha:true,antialias:true,preserveDrawingBuffer:true});
  if(!gl)return null;
  let lost=false;canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;});
  const sources=[`#version 300 es
    precision highp float;layout(location=0) in vec3 position;layout(location=1) in vec3 normal;layout(location=2) in float feature;
    uniform mat4 projection;uniform bool shadow;out vec3 n;flat out float id;
    void main(){vec3 p=position;if(shadow)p=vec3(p.xy+vec2(.12,.08)*max(0.,p.z),0.);
      gl_Position=projection*vec4(p,1.);n=normal;id=feature;}`,
    `#version 300 es
    precision highp float;in vec3 n;flat in float id;uniform vec3 color,light,eye;uniform float selected;uniform bool shadow,edges;out vec4 result;
    void main(){if(shadow){result=vec4(.12,.18,.20,1.);return;}
      bool highlighted=selected>=0.&&abs(id-selected)<.1;
      if(edges){float a=highlighted?.95:.22;result=vec4((highlighted?vec3(.92,.35,.12):vec3(.15,.34,.46))*a,a);return;}
      vec3 normal=normalize(n);if(dot(normal,eye)<0.)normal=-normal;
      float diffuse=max(0.,dot(normal,light));float highlight=pow(max(0.,dot(normal,normalize(light+eye))),36.)*.12;
      vec3 base=highlighted?mix(color,vec3(.65,.83,.94),.22):color;
      result=vec4(base*(.48+.52*diffuse)+highlight,1.);}`];
  const shaders=sources.map((source,i)=>{const shader=gl.createShader(i?gl.FRAGMENT_SHADER:gl.VERTEX_SHADER);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;});
  const program=gl.createProgram();shaders.forEach(s=>gl.attachShader(program,s));gl.linkProgram(program);shaders.forEach(s=>gl.deleteShader(s));
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
  const uniforms=Object.fromEntries(['projection','shadow','color','light','eye','selected','edges'].map(name=>[name,gl.getUniformLocation(program,name)]));
  let scene=null,buffers=[];
  function reset(){for(const b of buffers){gl.deleteBuffer(b.buffer);gl.deleteVertexArray(b.vao);}buffers=[];}
  function upload(data){const buffer=gl.createBuffer(),vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    for(const [location,size,offset] of [[0,3,0],[1,3,12],[2,1,24]]){gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,28,offset);}return {buffer,vao,count:data.length/7};}
  return {canvas,draw(next,{project,width,height,ratio,color,selected=null,shadow=false}){
    if(lost)throw new Error('Geometry graphics context lost. Refresh Studio to restore shading.');
    if(scene!==next){reset();scene=next;buffers=[upload(scene.surface),upload(scene.outlines),upload(scene.edgeLines)];}
    const w=Math.round(width*ratio),h=Math.round(height*ratio);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const {matrix,light}=materialProjection(project,width,height,scene.bounds),o=project([0,0,0]);
    const eye=normalize([[1,0,0],[0,1,0],[0,0,1]].map(p=>project(p)[2]-o[2]));
    gl.useProgram(program);gl.uniformMatrix4fv(uniforms.projection,false,matrix);gl.uniform3fv(uniforms.light,light);gl.uniform3fv(uniforms.eye,eye);
    gl.uniform3fv(uniforms.color,[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255));gl.uniform1f(uniforms.selected,scene.features.indexOf(selected));
    gl.uniform1i(uniforms.shadow,shadow);gl.uniform1i(uniforms.edges,0);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);
    gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);gl.bindVertexArray(buffers[0].vao);gl.drawArrays(gl.TRIANGLES,0,buffers[0].count);gl.disable(gl.POLYGON_OFFSET_FILL);
    if(!shadow){gl.uniform1i(uniforms.edges,1);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);
      gl.bindVertexArray(buffers[1].vao);gl.drawArrays(gl.LINES,0,buffers[1].count);
      const edge=scene.edgeFeatures.get(selected);if(edge){gl.lineWidth(3);gl.bindVertexArray(buffers[2].vao);gl.drawArrays(gl.LINES,edge.offset,edge.count);gl.lineWidth(1);}}
    gl.bindVertexArray(null);
  },dispose(){reset();gl.deleteProgram(program);}};
}
