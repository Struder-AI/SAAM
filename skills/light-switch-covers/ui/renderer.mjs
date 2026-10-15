// Actual construction meshes, rendered with a per-pixel depth buffer.
export function renderCover(canvas,result,camera){
  const bounds=canvas.getBoundingClientRect(),dpi=devicePixelRatio;
  canvas.width=Math.round(bounds.width*dpi);canvas.height=Math.round(bounds.height*dpi);
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);if(!result)return;
  const w=result.width,h=result.height,scale=Math.min(bounds.width/(w+35),bounds.height/(h+35))*camera.zoom;
  const down=result.printFace==='down';
  const rotate=([px,py,pz])=>{
    const x=px-w/2,y=(down?h-py:py)-h/2,z=down?result.design.thickness+result.faceOffset-pz:pz;
    const a=y*Math.cos(camera.x)-z*Math.sin(camera.x),c=y*Math.sin(camera.x)+z*Math.cos(camera.x);
    return [x*Math.cos(camera.y)+c*Math.sin(camera.y),a,-x*Math.sin(camera.y)+c*Math.cos(camera.y)];
  };
  const project=([x,y,z])=>[(bounds.width/2+x*scale)*dpi,(bounds.height/2-y*scale)*dpi,z];
  const meshes=result.materials.length?result.materials:[{...result.mesh,id:'plate'}];
  const image=ctx.createImageData(canvas.width,canvas.height),depth=new Float64Array(canvas.width*canvas.height);depth.fill(-Infinity);
  for(const mesh of meshes){
    const rotated=mesh.vertices.map(rotate),points=rotated.map(project),color=mesh.id==='labels'?result.design.textColor:result.design.plateColor;
    for(const triangle of mesh.triangles){
      const [a,b,c]=triangle.map(index=>points[index]);
      const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
      // Display-only degenerate-pixel guard; construction is untouched.
      if(denominator===0)continue;
      const [p,q,r]=triangle.map(index=>rotated[index]),u=q.map((value,i)=>value-p[i]),v=r.map((value,i)=>value-p[i]);
      const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
      const shade=.65+.35*Math.max(0,length?(.25*normal[0]+.4*normal[1]+normal[2])/(length*1.105):0);
      const rgb=color.match(/\w\w/g).map(value=>Math.round(parseInt(value,16)*shade));
      const minX=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),maxX=Math.min(canvas.width-1,Math.ceil(Math.max(a[0],b[0],c[0])));
      const minY=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),maxY=Math.min(canvas.height-1,Math.ceil(Math.max(a[1],b[1],c[1])));
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
        const u=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/denominator;
        const v=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/denominator,t=1-u-v;
        if(u<0||v<0||t<0)continue;
        const z=u*a[2]+v*b[2]+t*c[2],index=y*canvas.width+x;
        if(z<depth[index])continue;depth[index]=z;image.data.set([...rgb,255],index*4);
      }
    }
  }
  ctx.putImageData(image,0,0);
}
