// Display-only material geometry, derived from interpreted moves. No slicing,
// machine commands, approval data or reference part mesh is changed here.
import {add,subtract,scale,dot,cross,length,normalize} from '../core/geom/tolerance.mjs';
import {createMachineLayer} from './machine-view.mjs';
import {CURRENT_LAYER_GAP_MM,layerKey,toolpathStyle} from './toolpath-view.mjs';

export const materialKey=move=>layerKey(move)+'\0'+(move.operation??'');
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);

export function beadSection(move,plan,geometry,from=move.from,to=move.to,{gap=false}={}){
  if(!move.extruding||length(subtract(to,from))<1e-9)return null;
  const p=plan.process,tangent=normalize(subtract(to,from));
  const clad=['cladding-axial','cladding-hoop','cladding-helix-forward','cladding-helix-reverse'].includes(move.phase);
  let height=move.layer===0?p.firstLayerMm:p.layerMm,normal=()=>[0,0,1],centered=false;
  if(clad){
    const center=plan.setup.denso?.rotaryCenterMm??[plan.placement.xMm,plan.placement.yMm,0];
    height=plan.skills['pipe-cladding'].normalMm;centered=true;
    if(plan.skills['pipe-cladding'].surface){
      // Recover the commanded surface frame from interpreted tool orientation.
      // The cladding producer tilts toward -V and sets tool Y to V cross normal.
      if(!move.toolAxisTo||!move.toolUpTo)return null;
      const tilt=plan.skills['pipe-cladding'].tiltDeg*Math.PI/180;
      const frame=(axis,up)=>normalize(add(scale(axis,-Math.sin(tilt)),scale(cross(up,axis),-Math.cos(tilt))));
      const a=frame(move.toolAxisFrom,move.toolUpFrom),b=frame(move.toolAxisTo,move.toolUpTo);
      normal=point=>normalize(mix(a,b,Math.min(1,distanceAlong(point))));
      function distanceAlong(point){return length(subtract(point,move.from))/Math.max(1e-12,length(subtract(move.to,move.from)));}
    }else normal=point=>normalize([point[0]-center[0],point[1]-center[1],0]);
  }else if(move.phase==='inclined'&&geometry.roof){
    height=p.skinNormalMm;normal=()=>normalize([-geometry.roof.a,-geometry.roof.b,1]);
  }else if(move.phase==='draped-skin'||move.phase==='rimming-normal'||move.phase==='wave-overhangs'){
    // Source records do not yet retain these skills' local surface normals.
    // Keep an explicitly labelled line fallback rather than inventing a frame.
    return null;
  }
  if(!(height>0))return null;
  const originalLength=length(subtract(move.to,move.from));
  const area=originalLength>1e-9?(move.commandedVolumeMm3??move.volumeMm3)/originalLength:NaN;
  const width=Number.isFinite(area)&&area>0?area/height:p.lineWidthMm;
  const displayWidth=gap?Math.max(width-CURRENT_LAYER_GAP_MM,width*.5):width;
  function end(point){
    const n=normal(point),projected=subtract(n,scale(tangent,dot(n,tangent)));
    if(length(projected)<1e-8)return null;
    const short=normalize(projected),wide=normalize(cross(short,tangent));
    return {center:centered?point:subtract(point,scale(n,height/2)),
      wide:scale(wide,displayWidth/2),short:scale(short,height/2)};
  }
  const a=end(from),b=end(to);return a&&b?{a,b,width,height}:null;
}
export const beadInstance=section=>new Float32Array([...section.a.center,...section.b.center,...section.a.wide,...section.a.short,...section.b.wide,...section.b.short]);

// Completed material retains every source curve segment. Rectangular swept
// sections touch neighboring tracks to form a solid layer appearance. Shared
// templates and compact instance buffers replace per-bead tessellated meshes.
export async function buildMaterialScene(moves,plan,geometry,{onProgress=()=>{},yieldTask=()=>new Promise(r=>setTimeout(r,0))}={}){
  const groups=[],byKey=new Map(),unsupported=new Set(),supported=new Uint8Array(moves.length);
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  // Yield to input/painting by elapsed work, not once per operation. Thousands
  // of small operations otherwise pay thousands of browser timer delays; one
  // large operation must still yield while its beads are being prepared.
  let lastYield=performance.now(),visited=0,beads=0;
  const due=()=>performance.now()-lastYield>=8;
  const pause=async progress=>{onProgress(progress);await yieldTask();lastYield=performance.now();};
  const read=moves.reader?.(['extruding','from','to','phase','layer','operation','commandedVolumeMm3','volumeMm3','toolAxisFrom','toolAxisTo','toolUpFrom','toolUpTo'])??(i=>moves[i]);
  for(let i=0;i<moves.length;i++){
    if(i%256===0&&due())await pause(i/Math.max(1,moves.length)*.25);
    const move=read(i);if(!move.extruding)continue;
    // Stationary deposition is shown by its source event marker, not a bead
    // with an invented direction or a missing surface-frame warning.
    if(length(subtract(move.to,move.from))<1e-9){supported[i]=1;continue;}
    beads++;
    for(const point of [move.from,move.to])point.forEach((v,k)=>{bounds.min[k]=Math.min(bounds.min[k],v);bounds.max[k]=Math.max(bounds.max[k],v);});
    const key=materialKey(move);let group=byKey.get(key);
    if(!group){group={key,layerKey:layerKey(move),move:moves[i],indices:[],last:i};byKey.set(key,group);groups.push(group);}
    group.indices.push(i);group.last=i;
  }
  for(let i=0;i<groups.length;i++){
    const group=groups[i];
    let count=0,instances,indices;
    for(const index of group.indices){
      if(visited++%128===0&&due())await pause(.25+.75*(visited-1)/Math.max(1,beads));
      const move=read(index),s=beadSection(move,plan,geometry);
      if(s){
        instances??=new Float32Array(group.indices.length*18);indices??=new Uint32Array(group.indices.length);
        const offset=count*18;
        instances.set(s.a.center,offset);instances.set(s.b.center,offset+3);
        instances.set(s.a.wide,offset+6);instances.set(s.a.short,offset+9);
        instances.set(s.b.wide,offset+12);instances.set(s.b.short,offset+15);
        indices[count++]=index;supported[index]=1;
      }else unsupported.add(move.phase);
    }
    group.instances=count?instances.subarray(0,count*18):new Float32Array();
    group.indices=count?indices.subarray(0,count):new Uint32Array();
  }
  onProgress(1);
  return {moves,plan,geometry,groups,bounds,supported,unsupported:[...unsupported]};
}

export function materialTemplate(oval=true){
  const sides=oval?16:4,data=[];
  const ring=oval?Array.from({length:sides},(_,i)=>[Math.cos(i*2*Math.PI/sides),Math.sin(i*2*Math.PI/sides)])
    :[[1,1],[-1,1],[-1,-1],[1,-1]];
  for(let i=0;i<sides;i++){
    const p=ring[i],q=ring[(i+1)%sides],face=[(p[0]+q[0])/2,(p[1]+q[1])/2];
    for(const [x,point,cap] of [[0,p,0],[1,p,0],[1,q,0],[0,p,0],[1,q,0],[0,q,0],
      [0,[0,0],-1],[0,q,-1],[0,p,-1],[1,[0,0],1],[1,p,1],[1,q,1]]){
      data.push(x,...point,cap,...(oval?point:face));
    }
  }
  return new Float32Array(data);
}

export function materialProjection(project,width,height,bounds){
  const o=project([0,0,0]),axes=[[1,0,0],[0,1,0],[0,0,1]].map(p=>subtract(project(p),o));
  let low=Infinity,high=-Infinity;
  for(let bits=0;bits<8;bits++){const p=[0,1,2].map(i=>bounds[(bits>>i)&1?'max':'min'][i]),z=project(p)[2];low=Math.min(low,z);high=Math.max(high,z);}
  const mid=(low+high)/2,range=Math.max(10,high-low+10),matrix=new Float32Array(16);
  axes.forEach((a,i)=>matrix.set([2*a[0]/width,-2*a[1]/height,-2*a[2]/range,0],i*4));
  matrix.set([2*o[0]/width-1,1-2*o[1]/height,-2*(o[2]-mid)/range,1],12);
  const light=normalize(axes.map(a=>a[2]-a[1]/Math.max(1,project.pixelsPerMm??1)*.4));
  return {matrix,light};
}

// One instanced geometry buffer per layer/operation. The active oval gradually
// becomes the completed section during the fade, never at a discrete boundary.
// Camera, rotary, scrub and fading update uniforms/counts; curves stay cached.
export function createMaterialRenderer(documentApi=document){
  const canvas=documentApi.createElement('canvas'),gl=canvas.getContext('webgl2',{alpha:true,antialias:true,stencil:true,preserveDrawingBuffer:true});
  if(!gl)return null;
  let lost=false;canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;});
  const vertex=`#version 300 es
    precision highp float;layout(location=0) in vec4 vertex;layout(location=7) in vec2 normalUV;
    layout(location=1) in vec3 a;layout(location=2) in vec3 b;
    layout(location=3) in vec3 u0;layout(location=4) in vec3 v0;
    layout(location=5) in vec3 u1;layout(location=6) in vec3 v1;
    uniform mat4 projection;uniform vec3 light;uniform float detailed;out float shade;
    void main(){vec3 u=mix(u0,u1,vertex.x),v=mix(v0,v1,vertex.x);
      vec3 n=normalize(abs(vertex.w)>.5?normalize(b-a)*vertex.w:u*normalUV.x/dot(u,u)+v*normalUV.y/dot(v,v));
      vec2 rounded=vertex.yz;
      vec2 square=rounded/max(1e-6,max(abs(rounded.x),abs(rounded.y)));
      vec2 section=mix(square,rounded,detailed);
      gl_Position=projection*vec4(mix(a,b,vertex.x)+u*section.x+v*section.y,1.);
      float diffuse=max(0.,dot(n,light));shade=mix(.75+.25*diffuse,.50+.50*diffuse,detailed);
    }`;
  const fragment=`#version 300 es
    precision highp float;in float shade;uniform vec4 color;out vec4 result;
    void main(){result=vec4(color.rgb*shade*color.a,color.a);}`;
  const shaders=[gl.VERTEX_SHADER,gl.FRAGMENT_SHADER].map((type,i)=>{
    const shader=gl.createShader(type);gl.shaderSource(shader,i?fragment:vertex);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;
  });
  const program=gl.createProgram();shaders.forEach(s=>gl.attachShader(program,s));gl.linkProgram(program);shaders.forEach(s=>gl.deleteShader(s));
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
  const uniforms=Object.fromEntries(['projection','light','color','detailed'].map(name=>[name,gl.getUniformLocation(program,name)]));
  function template(oval){const data=materialTemplate(oval),buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return {buffer,count:data.length/6};}
  const templates=[template(false),template(true)];
  let scene=null,partial=null,machineLayer=null;const buffers=new Map();
  function release(entry){gl.deleteBuffer(entry.buffer);for(const vao of entry.vaos)gl.deleteVertexArray(vao);}
  function reset(next){for(const entry of buffers.values())release(entry);buffers.clear();scene=next;}
  function instanceBuffer(data,usage=gl.STATIC_DRAW){
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,usage);
    const vaos=templates.map(t=>{
      const vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,t.buffer);
      gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,4,gl.FLOAT,false,24,0);
      gl.enableVertexAttribArray(7);gl.vertexAttribPointer(7,2,gl.FLOAT,false,24,16);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      for(let i=0;i<6;i++){gl.enableVertexAttribArray(i+1);gl.vertexAttribPointer(i+1,3,gl.FLOAT,false,72,i*12);gl.vertexAttribDivisor(i+1,1);}
      return vao;
    });return {buffer,vaos};
  }
  return {
    canvas,
    draw(next,{at,current,fade,project,width,height,ratio,skinPhase,previousLayerOpacity=0.5,machine=null,machineMode='ghost',machinePalette}){
      if(lost)throw new Error('3D graphics context was lost. Refresh Studio to restore material rendering.');
      if(scene!==next)reset(next);
      // A fitted bead may be narrower than one screen pixel. Render enough
      // samples across it before downsampling, instead of allowing its oval
      // facets to alternate between visible and missing as the camera moves.
      const sampling=Math.max(ratio,Math.min(4,2/Math.max(.01,(project.pixelsPerMm??1)*scene.plan.process.lineWidthMm)));
      const w=Math.round(width*sampling),h=Math.round(height*sampling);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
      gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.depthMask(true);gl.stencilMask(0xff);gl.clearStencil(0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT|gl.STENCIL_BUFFER_BIT);
      const depthBounds=machine?{min:scene.bounds.min.map((v,i)=>Math.min(v,machine.bounds.min[i])),max:scene.bounds.max.map((v,i)=>Math.max(v,machine.bounds.max[i]))}:scene.bounds;
      const {matrix,light}=materialProjection(project,width,height,depthBounds),commands=[];
      for(const group of scene.groups){
        if(!group.indices.length||group.indices[0]>=at.completed)continue;
        if(!buffers.has(group))buffers.set(group,instanceBuffer(group.instances));
        let low=0,high=group.indices.length;
        while(low<high){const mid=(low+high)>>1;if(group.indices[mid]<at.completed)low=mid+1;else high=mid;}
        commands.push({entry:buffers.get(group),count:low,detail:group.layerKey===layerKey(current)?1:fade.weights.get(group.layerKey)??0,
          style:toolpathStyle(group.move,current,skinPhase,fade.weights.get(group.layerKey)??0,{previousLayerOpacity})});
      }
      const move=scene.moves[at.active];
      if(move?.extruding&&at.fraction<1){const section=beadSection(move,scene.plan,scene.geometry,move.from,at.point);
        if(section){
          const data=beadInstance(section);if(!partial)partial=instanceBuffer(data,gl.DYNAMIC_DRAW);
          else{gl.bindBuffer(gl.ARRAY_BUFFER,partial.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,data);}
          commands.push({entry:partial,count:1,detail:1,style:toolpathStyle(move,current,skinPhase)});
        }
      }
      gl.useProgram(program);gl.uniformMatrix4fv(uniforms.projection,false,matrix);gl.uniform3fv(uniforms.light,light);
      function drawCommands(){
        for(const {entry,count,detail,style} of commands){
          const rgb=[1,3,5].map(i=>parseInt(style.color.slice(i,i+2),16)/255);gl.uniform4f(uniforms.color,...rgb,style.opacity);gl.uniform1f(uniforms.detailed,detail);
          const shape=detail>0?1:0;
          gl.bindVertexArray(entry.vaos[shape]);gl.drawArraysInstanced(gl.TRIANGLES,0,templates[shape].count,count);
        }
      }
      // Resolve the nearest material surface before applying layer opacity.
      // Hidden surfaces do not accumulate darkness inside a completed block.
      gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.disable(gl.STENCIL_TEST);gl.colorMask(false,false,false,false);gl.depthFunc(gl.LESS);drawCommands();
      if(machine&&machineMode==='ghost'){
        machineLayer??=createMachineLayer(gl);
        machineLayer.draw(machine,{project,matrix,width,height,mode:machineMode,palette:machinePalette,filter:c=>c.role!=='tool',depth:false});
        gl.useProgram(program);gl.enable(gl.DEPTH_TEST);
      }
      // Coplanar/overlapping bead faces can share the winning depth. Shade
      // each visible sample once, avoiding repeated alpha blending stripes.
      gl.enable(gl.STENCIL_TEST);gl.stencilFunc(gl.EQUAL,0,0xff);gl.stencilOp(gl.KEEP,gl.KEEP,gl.INCR);
      gl.colorMask(true,true,true,true);gl.depthMask(false);gl.depthFunc(gl.EQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);drawCommands();
      gl.disable(gl.STENCIL_TEST);
      if(machine){
        machineLayer??=createMachineLayer(gl);
        machineLayer.draw(machine,{project,matrix,width,height,mode:machineMode,palette:machinePalette,filter:machineMode==='ghost'?c=>c.role==='tool':null});
      }
      gl.bindVertexArray(null);return {cachedGroups:buffers.size,detailedGroups:commands.filter(c=>c.detail).length};
    },
    dispose(){reset(null);if(partial)release(partial);machineLayer?.dispose();templates.forEach(t=>gl.deleteBuffer(t.buffer));gl.deleteProgram(program);}
  };
}
