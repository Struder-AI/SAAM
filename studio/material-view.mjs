// Display-only material geometry, derived from interpreted moves. No slicing,
// machine commands, approval data or reference part mesh is changed here.
import {add,subtract,scale,dot,cross,length,normalize} from '../core/geom/tolerance.mjs';
import {createMachineLayer} from './machine-view.mjs';
import {CURRENT_LAYER_GAP_MM,layerKey,toolpathStyle} from './toolpath-view.mjs';

export const materialKey=move=>layerKey(move)+'\0'+(move.operation??'')+(move.filament===undefined?'':'\0'+move.filament);
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);

// The surface frame a bead's cross-section stands on: one selected normal
// function per move phase, with the nominal height and centering it implies.
// `null` refuses the bead rather than inventing a frame.
function beadFrame(move,plan,geometry,clad){
  const p=plan.process;
  if(clad){
    const center=plan.setup.denso?.rotaryCenterMm??[plan.placement.xMm,plan.placement.yMm,0];
    const height=plan.skills['pipe-cladding'].normalMm;
    if(plan.skills['pipe-cladding'].surface){
      // Recover the commanded surface frame from interpreted tool orientation.
      // The cladding producer tilts toward -V and sets tool Y to V cross normal.
      if(!move.toolAxisTo||!move.toolUpTo)return null;
      const tilt=plan.skills['pipe-cladding'].tiltDeg*Math.PI/180;
      const frame=(axis,up)=>normalize(add(scale(axis,-Math.sin(tilt)),scale(cross(up,axis),-Math.cos(tilt))));
      const a=frame(move.toolAxisFrom,move.toolUpFrom),b=frame(move.toolAxisTo,move.toolUpTo);
      const distanceAlong=point=>length(subtract(point,move.from))/Math.max(1e-12,length(subtract(move.to,move.from)));
      const surfaceNormal=point=>normalize(mix(a,b,Math.min(1,distanceAlong(point))));
      return {normal:surfaceNormal,height,centered:true};
    }
    const radialNormal=point=>normalize([point[0]-center[0],point[1]-center[1],0]);
    return {normal:radialNormal,height,centered:true};
  }
  if(move.phase==='inclined'&&geometry.roof){
    const roofNormal=()=>normalize([-geometry.roof.a,-geometry.roof.b,1]);
    return {normal:roofNormal,height:p.skinNormalMm,centered:false};
  }
  // Source records do not yet retain these skills' local surface normals.
  // Keep an explicitly labelled line fallback rather than inventing a frame.
  if(['draped-skin','rimming-normal','wave-overhangs'].includes(move.phase))return null;
  const layerNormal=()=>[0,0,1];
  return {normal:layerNormal,height:move.layer===0?p.firstLayerMm:p.layerMm,centered:false};
}

export function beadSection(move,plan,geometry,from=move.from,to=move.to,{gap=false}={}){
  if(!move.extruding||length(subtract(to,from))<1e-9)return null;
  const p=plan.process,tangent=normalize(subtract(to,from));
  const clad=['cladding-axial','cladding-hoop','cladding-helix-forward','cladding-helix-reverse'].includes(move.phase);
  const frame=beadFrame(move,plan,geometry,clad);
  if(!frame)return null;
  const centered=frame.centered;let height=frame.height;
  if(!(height>0))return null;
  const originalLength=length(subtract(move.to,move.from));
  const area=originalLength>1e-9?(move.commandedVolumeMm3??move.volumeMm3)/originalLength:NaN;
  if(!clad&&Number.isFinite(move.lineWidthMm)&&move.lineWidthMm>0&&Number.isFinite(area)&&area>0)height=area/move.lineWidthMm;
  const width=Number.isFinite(area)&&area>0?area/height:p.lineWidthMm;
  const displayWidth=gap?Math.max(width-CURRENT_LAYER_GAP_MM,width*.5):width;
  function end(point){
    const n=frame.normal(point),projected=subtract(n,scale(tangent,dot(n,tangent)));
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
  const indexedMove=i=>moves[i];
  const read=moves.reader?.(['extruding','from','to','phase','layer','operation','commandedVolumeMm3','volumeMm3','toolAxisFrom','toolAxisTo','toolUpFrom','toolUpTo','filament','lineWidthMm'])??indexedMove;
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

// Indexed so each shared corner is transformed once, and wound outward in the
// bead's right-handed (tangent, wide, short) frame so back faces can be culled.
// Cap normals come from the tangent; their unused section normal is zero.
export function materialTemplate(oval=true){
  const sides=oval?16:4,vertices=[],indices=[],known=new Map();
  const ring=oval?Array.from({length:sides},(_,i)=>[Math.cos(i*2*Math.PI/sides),Math.sin(i*2*Math.PI/sides)])
    :[[1,1],[-1,1],[-1,-1],[1,-1]];
  const vertex=(x,point,cap,normal)=>{
    const data=[x,...point,cap,...(cap?[0,0]:normal)],key=data.join();
    if(!known.has(key)){known.set(key,vertices.length/6);vertices.push(...data);}
    return known.get(key);
  };
  const triangle=(corners,outward)=>{
    const [a,b,c]=corners.map(([x,point])=>[x,...point]),n=cross(subtract(b,a),subtract(c,a));
    const ordered=dot(n,outward)<0?[corners[0],corners[2],corners[1]]:corners;
    indices.push(...ordered.map(([x,point,cap,normal])=>vertex(x,point,cap,normal)));
  };
  for(let i=0;i<sides;i++){
    const p=ring[i],q=ring[(i+1)%sides],face=[(p[0]+q[0])/2,(p[1]+q[1])/2],wall=point=>oval?point:face;
    triangle([[0,p,0,wall(p)],[1,p,0,wall(p)],[1,q,0,wall(q)]],[0,...face]);
    triangle([[0,p,0,wall(p)],[1,q,0,wall(q)],[0,q,0,wall(q)]],[0,...face]);
    triangle([[0,[0,0],-1],[0,q,-1],[0,p,-1]],[-1,0,0]);
    triangle([[1,[0,0],1],[1,p,1],[1,q,1]],[1,0,0]);
  }
  return {vertices:new Float32Array(vertices),indices:new Uint16Array(indices)};
}

// Bead centres plus the largest half-section bound every vertex of a group.
function groupBounds(data){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let reach=0;
  for(let i=0;i<data.length;i+=18){
    for(let k=0;k<3;k++){min[k]=Math.min(min[k],data[i+k],data[i+3+k]);max[k]=Math.max(max[k],data[i+k],data[i+3+k]);}
    for(const o of [6,12])reach=Math.max(reach,Math.hypot(data[i+o],data[i+o+1],data[i+o+2])+Math.hypot(data[i+o+3],data[i+o+4],data[i+o+5]));
  }
  return {min:min.map(v=>v-reach),max:max.map(v=>v+reach)};
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
  const canvas=documentApi.createElement('canvas'),gl=canvas.getContext('webgl2',{alpha:true,antialias:true,preserveDrawingBuffer:true});
  if(!gl)return null;
  let lost=false;canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;});
  const rendererInfo=gl.getExtension('WEBGL_debug_renderer_info');
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
  function template(oval){
    const {vertices,indices}=materialTemplate(oval),buffer=gl.createBuffer(),elements=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
    gl.bindVertexArray(null);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,elements);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
    return {buffer,elements,count:indices.length};
  }
  const templates=[template(false),template(true)];
  let scene=null,partial=null,machineLayer=null;const buffers=new Map();
  function release(entry){gl.deleteBuffer(entry.buffer);for(const vao of entry.vaos)gl.deleteVertexArray(vao);}
  function reset(next){for(const entry of buffers.values())release(entry);buffers.clear();scene=next;}
  function instanceBuffer(data,usage=gl.STATIC_DRAW){
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,usage);
    const vaos=templates.map(t=>{
      const vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,t.elements);gl.bindBuffer(gl.ARRAY_BUFFER,t.buffer);
      gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,4,gl.FLOAT,false,24,0);
      gl.enableVertexAttribArray(7);gl.vertexAttribPointer(7,2,gl.FLOAT,false,24,16);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      for(let i=0;i<6;i++){gl.enableVertexAttribArray(i+1);gl.vertexAttribPointer(i+1,3,gl.FLOAT,false,72,i*12);gl.vertexAttribDivisor(i+1,1);}
      return vao;
    });return {buffer,vaos};
  }
  return {
    canvas,
    // Reported with view performance: software rendering explains a slow viewer.
    renderer:String(gl.getParameter(rendererInfo?rendererInfo.UNMASKED_RENDERER_WEBGL:gl.RENDERER)),
    // quality 0 is the reviewed still image. Motion levels trade detail for
    // frame time: 1 halves and 2 thirds the render resolution, and 2 also draws
    // every bead with the square section.
    draw(next,{at,current,fade,project,width,height,ratio,skinPhase,previousLayerOpacity=0.5,machine=null,machineMode='ghost',machinePalette,quality=0}){
      if(lost)throw new Error('3D graphics context was lost. Refresh Studio to restore material rendering.');
      if(scene!==next)reset(next);
      // A fitted bead may be narrower than one screen pixel. Render enough
      // samples across it before downsampling, instead of allowing its oval
      // facets to alternate between visible and missing as the camera moves.
      const sampling=Math.max(ratio,Math.min(4,2/Math.max(.01,(project.pixelsPerMm??1)*scene.plan.process.lineWidthMm)));
      const resolution=sampling*(quality>=2?1/3:quality>=1?.5:1);
      const w=Math.max(1,Math.round(width*resolution)),h=Math.max(1,Math.round(height*resolution));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
      gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const depthBounds=machine?{min:scene.bounds.min.map((v,i)=>Math.min(v,machine.bounds.min[i])),max:scene.bounds.max.map((v,i)=>Math.max(v,machine.bounds.max[i]))}:scene.bounds;
      const {matrix,light}=materialProjection(project,width,height,depthBounds),commands=[];
      // A group whose projected bounds miss the viewport cannot reach a pixel.
      const offscreen=bounds=>{
        let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
        for(let bits=0;bits<8;bits++){const q=project([0,1,2].map(i=>bounds[(bits>>i)&1?'max':'min'][i]));left=Math.min(left,q[0]);right=Math.max(right,q[0]);top=Math.min(top,q[1]);bottom=Math.max(bottom,q[1]);}
        return right<0||left>width||bottom<0||top>height;
      };
      let culled=0;
      for(const group of scene.groups){
        if(!group.indices.length||group.indices[0]>=at.completed)continue;
        if(!buffers.has(group))buffers.set(group,{...instanceBuffer(group.instances),bounds:groupBounds(group.instances)});
        if(offscreen(buffers.get(group).bounds)){culled++;continue;}
        let low=0,high=group.indices.length;
        while(low<high){const mid=(low+high)>>1;if(group.indices[mid]<at.completed)low=mid+1;else high=mid;}
        commands.push({entry:buffers.get(group),count:low,detail:quality>=2?0:group.layerKey===layerKey(current)?1:fade.weights.get(group.layerKey)??0,
          style:toolpathStyle(group.move,current,skinPhase,fade.weights.get(group.layerKey)??0,{previousLayerOpacity})});
      }
      const move=scene.moves[at.active];
      if(move?.extruding&&at.fraction<1){const section=beadSection(move,scene.plan,scene.geometry,move.from,at.point);
        if(section){
          const data=beadInstance(section);if(!partial)partial=instanceBuffer(data,gl.DYNAMIC_DRAW);
          else{gl.bindBuffer(gl.ARRAY_BUFFER,partial.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,data);}
          commands.push({entry:partial,count:1,detail:quality>=2?0:1,style:toolpathStyle(move,current,skinPhase)});
        }
      }
      gl.useProgram(program);gl.uniformMatrix4fv(uniforms.projection,false,matrix);gl.uniform3fv(uniforms.light,light);
      const stats=()=>({cachedGroups:buffers.size,detailedGroups:commands.filter(c=>c.detail).length,
        groups:commands.length,culledGroups:culled,draws:commands.length,instances:commands.reduce((sum,c)=>sum+c.count,0),canvas:[w,h],sampling:+sampling.toFixed(2),quality});
      function drawCommands(){
        for(const {entry,count,detail,style} of commands){
          const rgb=[1,3,5].map(i=>parseInt(style.color.slice(i,i+2),16)/255);gl.uniform4f(uniforms.color,...rgb,style.opacity);gl.uniform1f(uniforms.detailed,detail);
          const shape=detail>0?1:0;
          gl.bindVertexArray(entry.vaos[shape]);gl.drawElementsInstanced(gl.TRIANGLES,templates[shape].count,gl.UNSIGNED_SHORT,0,count);
        }
      }
      // One pass: the nearest surface wins the depth test and is written
      // unblended, so hidden surfaces cannot accumulate opacity inside a
      // completed block. Beads are closed and convex, so a back face is never
      // the nearest surface. Clip space looks along +z, so an orientation-
      // preserving projection shows outward counter-clockwise faces clockwise.
      const m=matrix,handed=m[0]*(m[5]*m[10]-m[6]*m[9])-m[4]*(m[1]*m[10]-m[2]*m[9])+m[8]*(m[1]*m[6]-m[2]*m[5]);
      gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.frontFace(handed<0?gl.CCW:gl.CW);
      gl.disable(gl.BLEND);gl.colorMask(true,true,true,true);gl.depthMask(true);gl.depthFunc(gl.LESS);drawCommands();
      gl.disable(gl.CULL_FACE);
      if(machine){
        // The ghost machine composites underneath the material already drawn.
        machineLayer??=createMachineLayer(gl);
        if(machineMode==='ghost')machineLayer.draw(machine,{project,matrix,width,height,mode:machineMode,palette:machinePalette,filter:c=>c.role!=='tool',depth:false,under:true});
        machineLayer.draw(machine,{project,matrix,width,height,mode:machineMode,palette:machinePalette,filter:machineMode==='ghost'?c=>c.role==='tool':null});
      }
      gl.bindVertexArray(null);return stats();
    },
    dispose(){reset(null);if(partial)release(partial);machineLayer?.dispose();templates.forEach(t=>{gl.deleteBuffer(t.buffer);gl.deleteBuffer(t.elements);});gl.deleteProgram(program);}
  };
}
