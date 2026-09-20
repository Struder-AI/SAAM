// Prototype-only colored assembly renderer; geometry and visibility remain separate.
export function createAssemblyRenderer(){
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{alpha:true,antialias:true,preserveDrawingBuffer:true});
  if(!gl)throw Error('This prototype needs WebGL2 for depth-correct assembly inspection.');
  const vs=gl.createShader(gl.VERTEX_SHADER),fs=gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(vs,'#version 300 es\nlayout(location=0) in vec3 p; layout(location=1) in vec4 color; out vec4 c; void main(){gl_Position=vec4(p,1.);c=color;}');
  gl.shaderSource(fs,'#version 300 es\nprecision highp float; in vec4 c; out vec4 result; void main(){result=c;}');
  for(const s of [vs,fs]){gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));}
  const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.deleteShader(vs);gl.deleteShader(fs);
  const buffer=gl.createBuffer(),vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,28,12);
  function paint(rows,mode){gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(rows),gl.DYNAMIC_DRAW);gl.drawArrays(mode,0,rows.length/7);}
  return {canvas,draw(parts,project,width,height,ratio,wire){
    const w=Math.round(width*ratio),h=Math.round(height*ratio);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
    const triangles=[],lines=[],through=[],row=(p,color)=>{const q=project(p);return [q[0]*2/width-1,1-q[1]*2/height,-q[2]/10000,...color];};
    for(const part of parts){
      const rgb=part.color.match(/\w\w/g).map(x=>parseInt(x,16)/255),isWire=wire&&['skin','controls'].includes(part.group);
      for(let fi=0;fi<part.faces.length;fi++){
        const face=part.faces[fi];if(face.length<3)continue;
        if(isWire){if(fi%3===0)for(let i=0;i<face.length;i++)through.push(...row(face[i],[.24,.37,.29,.5]),...row(face[(i+1)%face.length],[.24,.37,.29,.5]));continue;}
        const [a,b,c]=face,u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n)||1,light=.7+.28*Math.abs((n[0]*.2-n[1]*.4+n[2]*.9)/len),color=[...rgb.map(v=>v*light),1];
        for(let i=1;i<face.length-1;i++)for(const p of [face[0],face[i],face[i+1]])triangles.push(...row(p,color));
      }
      for(const line of part.lines)for(let i=1;i<line.length;i++)lines.push(...row(line[i-1],[.3,.4,.32,1]),...row(line[i],[.3,.4,.32,1]));
    }
    gl.disable(gl.BLEND);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);paint(triangles,gl.TRIANGLES);gl.disable(gl.POLYGON_OFFSET_FILL);paint(lines,gl.LINES);
    gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);paint(through,gl.LINES);gl.disable(gl.BLEND);
  },dispose(){gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteProgram(program);}};
}
