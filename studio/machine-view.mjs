// Studio's primitive vocabulary. Model equations and joint policy stay with providers.
const roles=new Set(['structure','rail','link','carriage','joint','bed','tool']);
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const transform=(t,p)=>t.rotation.map((r,i)=>dot(r,p)+t.translationMm[i]);
export const untransform=(t,p)=>[0,1,2].map(i=>dot(t.rotation.map(r=>r[i]),sub(p,t.translationMm)));
export const bindingKey=b=>JSON.stringify([b?.printId,b?.revision,b?.exportHash,b?.modelKey]);
function require(value,message){if(!value)throw Error('Machine presentation: '+message);}
function rigid(t){
  require(t&&vector(t.translationMm)&&Array.isArray(t.rotation)&&t.rotation.length===3&&t.rotation.every(vector),'invalid rigid frame');
  const r=t.rotation;
  require(r.every((row,i)=>r.every((other,j)=>Math.abs(dot(row,other)-(i===j?1:0))<=1e-6))&&Math.abs(dot(r[0],cross(r[1],r[2]))-1)<=1e-6,'frame must be a right-handed rotation');
}
function binding(b){require(b&&['printId','revision','exportHash','modelKey'].every(k=>typeof b[k]==='string'),'missing model/source identity');}
export function validateDescriptor(d){
  require(d?.schema==='saam-machine-presentation/1','unsupported descriptor version');binding(d.binding);
  require(typeof d.label==='string'&&typeof d.basis==='string'&&Array.isArray(d.limitations)&&d.limitations.every(s=>typeof s==='string'),'invalid scope');
  require(Array.isArray(d.frameIds)&&d.frameIds.every(s=>typeof s==='string')&&new Set(d.frameIds).size===d.frameIds.length&&['world','part','tcp'].every(s=>d.frameIds.includes(s)),'invalid frame inventory');
  require(Array.isArray(d.components),'missing components');const ids=new Set();
  if(d.controls!==undefined)require(Array.isArray(d.controls)&&d.controls.every(c=>typeof c.label==='string'&&typeof c.unit==='string'&&[c.min,c.max,c.step].every(Number.isFinite)&&c.min<c.max&&c.step>0),'invalid manual controls');
  for(const c of d.components){
    require(typeof c.id==='string'&&!ids.has(c.id)&&typeof c.label==='string'&&roles.has(c.role)&&d.frameIds.includes(c.frameId),'invalid component');ids.add(c.id);rigid(c.local);
    const s=c.shape,positive=v=>Number.isFinite(v)&&v>0,nonnegative=v=>Number.isFinite(v)&&v>=0;
    require(s&&({line:()=>vector(s.fromMm)&&vector(s.toMm),polyline:()=>Array.isArray(s.pointsMm)&&s.pointsMm.length>=2&&s.pointsMm.every(vector)&&typeof s.closed==='boolean',sphere:()=>positive(s.radiusMm),box:()=>vector(s.sizeMm)&&s.sizeMm.every(positive),cone:()=>positive(s.lengthMm)&&nonnegative(s.radiusStartMm)&&nonnegative(s.radiusEndMm)&&s.radiusStartMm+s.radiusEndMm>0}[s.kind]?.()),'unsupported or invalid primitive');
  }
  if(d.machineBoundsWorldMm!==null){const b=d.machineBoundsWorldMm;require(b&&vector(b.min)&&vector(b.max)&&b.min.every((v,i)=>v<=b.max[i]),'invalid framing bounds');}
  return d;
}
export function validateSnapshot(s,d,request){
  require(s?.schema==='saam-machine-pose/1'&&bindingKey(s.binding)===bindingKey(d.binding),'stale or unsupported pose');
  require(s.requestId===request.requestId&&s.seconds===request.seconds,'pose time does not match source time');
  require(JSON.stringify(s.manual??null)===JSON.stringify(request.manual??null),'pose does not match manual request');
  require(JSON.stringify(s.jog??null)===JSON.stringify(request.jog??null),'pose does not match jog request');
  if(s.controlValues!==undefined)require(Array.isArray(s.controlValues)&&s.controlValues.every(Number.isFinite)&&(s.controlValues.length===0||s.controlValues.length===d.controls?.length),'invalid manual coordinates');
  require(['ready','partial','unavailable'].includes(s.status)&&s.worldFromFrame&&Array.isArray(s.diagnostics),'invalid pose status');
  for(const [id,t] of Object.entries(s.worldFromFrame)){require(d.frameIds.includes(id),'unknown frame');rigid(t);}
  require(s.diagnostics.every(x=>typeof x.code==='string'&&typeof x.message==='string'&&['info','warning','error'].includes(x.severity)&&(!x.componentIds||x.componentIds.every(id=>d.components.some(c=>c.id===id)))),'invalid diagnostics');
  if(s.status!=='unavailable'){
    require(s.worldFromFrame.part&&s.worldFromFrame.world,'missing source alignment');
    const w=s.worldFromFrame.world;require(w.translationMm.every(v=>Math.abs(v)<1e-6)&&w.rotation.every((row,i)=>row.every((v,j)=>Math.abs(v-(i===j?1:0))<1e-6)),'world is not identity');
  }
  if(s.status==='ready')require(d.components.every(c=>s.worldFromFrame[c.frameId]),'ready pose omits components');
  return s;
}

// Compile geometry once; only rigid placement changes with playback.
function primitive(s){
  const vertices=[],faces=[],edges=[];
  const point=p=>(vertices.push(p),vertices.length-1);
  const ring=(r,z,n=16)=>Array.from({length:n},(_,i)=>point([r*Math.cos(i*2*Math.PI/n),r*Math.sin(i*2*Math.PI/n),z]));
  const loop=ids=>ids.forEach((id,i)=>edges.push([id,ids[(i+1)%ids.length]]));
  if(s.kind==='line'){point(s.fromMm);point(s.toMm);edges.push([0,1]);}
  if(s.kind==='polyline'){s.pointsMm.forEach(point);for(let i=1;i<vertices.length;i++)edges.push([i-1,i]);if(s.closed)edges.push([vertices.length-1,0]);}
  if(s.kind==='box'){
    for(const z of [-1,1])for(const y of [-1,1])for(const x of [-1,1])point([x*s.sizeMm[0]/2,y*s.sizeMm[1]/2,z*s.sizeMm[2]/2]);
    faces.push([0,2,3,1],[4,5,7,6],[0,1,5,4],[2,6,7,3],[0,4,6,2],[1,3,7,5]);
    edges.push([0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]);
  }
  if(s.kind==='cone'){
    const a=ring(s.radiusStartMm,0),b=ring(s.radiusEndMm,s.lengthMm);loop(a);loop(b);
    faces.push([...a].reverse(),b);for(let i=0;i<a.length;i++){const j=(i+1)%a.length;faces.push([a[i],a[j],b[j],b[i]]);if(i%4===0)edges.push([a[i],b[i]]);}
  }
  if(s.kind==='sphere'){
    const rings=Array.from({length:7},(_,j)=>{const a=-Math.PI/2+j*Math.PI/6;return ring(s.radiusMm*Math.cos(a),s.radiusMm*Math.sin(a),12);});
    for(let j=1;j<rings.length;j++)for(let i=0;i<12;i++)faces.push([rings[j-1][i],rings[j-1][(i+1)%12],rings[j][(i+1)%12],rings[j][i]]);
    loop(rings[3]);for(const i of [0,3,6,9])for(let j=1;j<rings.length;j++)edges.push([rings[j-1][i],rings[j][i]]);
  }
  return {vertices,faces,edges};
}
export function compileMachine(d){validateDescriptor(d);return {descriptor:d,components:d.components.map(c=>({...c,...primitive(c.shape)}))};}
export function poseMachine(scene,snapshot){
  if(!scene||!snapshot||snapshot.status==='unavailable')return null;
  const part=snapshot.worldFromFrame.part;
  const components=scene.components.filter(c=>snapshot.worldFromFrame[c.frameId]).map(c=>({...c,
    vertices:c.vertices.map(p=>untransform(part,transform(snapshot.worldFromFrame[c.frameId],transform(c.local,p))))}));
  if(!components.length)return null;
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(const c of components)for(const p of c.vertices)p.forEach((v,i)=>{bounds.min[i]=Math.min(bounds.min[i],v);bounds.max[i]=Math.max(bounds.max[i],v);});
  return {components,bounds,part,hasTool:components.some(c=>c.role==='tool'),hasBed:components.some(c=>c.role==='bed')};
}
export const boundsCorners=b=>Array.from({length:8},(_,i)=>[0,1,2].map(k=>(i>>k)&1?b.max[k]:b.min[k]));
export function machineFitBounds(scene,pose,worldToDisplay){
  const b=scene.descriptor.machineBoundsWorldMm;
  const points=b?boundsCorners(b).map(worldToDisplay):pose?.components.flatMap(c=>c.vertices.map(p=>worldToDisplay(transform(pose.part,p))));
  if(!points?.length)return null;
  return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};
}
export const machinePalette={structure:'#7b8980',rail:'#6b8178',link:'#647b72',carriage:'#60796f',joint:'#718579',bed:'#7d9185',tool:'#3e594b'};
function marks(machine,project,mode,palette,filter){
  const out=[];
  for(const c of machine.components){
    if(filter&&!filter(c))continue;
    const points=c.vertices.map(project),color=palette[c.role]??palette.structure;
    const ghost=mode==='ghost'&&c.role!=='tool',opacity=ghost?(c.role==='structure'||c.role==='rail'?.18:.26):c.role==='tool'?.9:.8;
    for(const face of c.faces){const p=face.map(i=>points[i]);out.push({p,v:face.map(i=>c.vertices[i]),fill:true,color,opacity:opacity*(ghost?.26:.34),depth:p.reduce((s,v)=>s+v[2],0)/p.length});}
    for(const edge of c.edges){const p=edge.map(i=>points[i]);out.push({p,v:edge.map(i=>c.vertices[i]),fill:false,color,opacity,width:c.role==='link'?1.5:c.role==='tool'?1.25:1,depth:(p[0][2]+p[1][2])/2});}
  }
  return out.sort((a,b)=>a.depth-b.depth||Number(b.fill)-Number(a.fill));
}
// Canvas fallback uses the same primitives and camera, ordered by face/edge depth.
export function drawMachineCanvas(ctx,machine,{project,mode='ghost',palette=machinePalette,filter}={}){
  if(!machine)return;ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
  for(const m of marks(machine,project,mode,palette,filter)){ctx.beginPath();m.p.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.globalAlpha=m.opacity;
    if(m.fill){ctx.closePath();ctx.fillStyle=m.color;ctx.fill();}else{ctx.lineWidth=m.width;ctx.strokeStyle=m.color;ctx.stroke();}}
  ctx.restore();
}

// Simple primitives share the material renderer's projection/depth attachment.
// Lines are screen-width quads so their legibility survives zoom and device DPI.
export function createMachineLayer(gl){
  const vertex=`#version 300 es
  precision highp float;layout(location=0) in vec3 position;layout(location=1) in vec3 other;
  layout(location=2) in float side;layout(location=3) in vec4 color;layout(location=4) in float stroke;
  uniform mat4 projection;uniform vec2 viewport;out vec4 tint;
  void main(){vec4 p=projection*vec4(position,1.);vec4 q=projection*vec4(other,1.);
    vec2 delta=(q.xy-p.xy)*viewport;float n=length(delta);if(n>0.)p.xy+=vec2(-delta.y,delta.x)/n*side*stroke/viewport;
    gl_Position=p;tint=color;}`;
  const fragment=`#version 300 es
  precision highp float;in vec4 tint;out vec4 result;void main(){result=vec4(tint.rgb*tint.a,tint.a);}`;
  const shaders=[vertex,fragment].map((source,i)=>{const s=gl.createShader(i?gl.FRAGMENT_SHADER:gl.VERTEX_SHADER);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;});
  const program=gl.createProgram();shaders.forEach(s=>gl.attachShader(program,s));gl.linkProgram(program);shaders.forEach(s=>gl.deleteShader(s));if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  const buffer=gl.createBuffer(),vao=gl.createVertexArray(),projection=gl.getUniformLocation(program,'projection'),viewport=gl.getUniformLocation(program,'viewport');
  gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);for(const [i,n,offset] of [[0,3,0],[1,3,12],[2,1,24],[3,4,28],[4,1,44]]){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,n,gl.FLOAT,false,48,offset);}
  // under composites behind pixels already drawn (premultiplied destination-over).
  return {draw(machine,{project,matrix,width,height,mode,palette=machinePalette,filter,depth=true,under=false}){
    const data=[];
    // Sort in camera depth, but keep source coordinates for the shared depth test.
    const emit=(p,q,side,m)=>{const rgb=[1,3,5].map(i=>parseInt(m.color.slice(i,i+2),16)/255);data.push(...p,...q,side,...rgb,m.opacity,m.width??0);};
    for(const m of marks(machine,project,mode,palette,filter)){
      if(m.fill){for(let i=1;i<m.v.length-1;i++)for(const p of [m.v[0],m.v[i],m.v[i+1]])emit(p,p,0,m);}
      else{const [p,q]=m.v;for(const [a,b,s] of [[p,q,-1],[p,q,1],[q,p,1],[q,p,1],[p,q,1],[q,p,-1]])emit(a,b,s,m);}
    }
    if(!data.length)return;
    gl.useProgram(program);gl.uniformMatrix4fv(projection,false,matrix);gl.uniform2f(viewport,width,height);gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);
    gl.colorMask(true,true,true,true);gl.depthMask(false);depth?gl.enable(gl.DEPTH_TEST):gl.disable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);under?gl.blendFunc(gl.ONE_MINUS_DST_ALPHA,gl.ONE):gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLES,0,data.length/12);gl.bindVertexArray(null);
  },dispose(){gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteProgram(program);}};
}
