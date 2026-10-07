// The visual check: after an operation commits new geometry or a new toolpath,
// its result names a PNG the agent opens. A software rasterizer draws two
// orthographic panels, isometric from front-right-above and top (+X right, +Y
// up), over a 10 mm grid on the bed: shaded z-buffered triangles for geometry,
// the saved SAAMpath's extrusion coloured by phase for a toolpath. No window.
import {writeFile,readdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {encodePng} from '../export/png.mjs';
import {NUMERIC_MM} from '../dimensions.mjs';
import {pathPreview} from '../../studio/path-preview.mjs';
import {bundleFor} from '../../studio/adapter-resolution.mjs';
import {resolvePhaseColours,phaseColour} from '../print/phase-colours.mjs';
import {readLocalPhaseColours} from './local-agent-notes.mjs';
import {createTemporaryWorkspace} from './temporary-workspace.mjs';

// Display budget: panel pixels, supersampling, margin, grid pitch and colours.
const PANEL=512,SAMPLES=2,MARGIN=0.06,GRID_MM=10,EDGE_PX=4;
// Beads draw at this share of their width, so gaps show neighbouring tracks.
const BEAD=0.6;
const BACKGROUND=[246,247,249],GRID=[214,219,226],GRID_MAJOR=[188,195,205],PART=[132,170,208],OUTLINE=[46,58,72],CURVE=[52,84,120];
const SQRT2=Math.SQRT2,SQRT6=Math.sqrt(6),SQRT3=Math.sqrt(3);
// right, up and toward-eye unit vectors of each panel.
const VIEWS=Object.freeze([
  {right:[1/SQRT2,1/SQRT2,0],up:[-1/SQRT6,1/SQRT6,2/SQRT6],toward:[1/SQRT3,-1/SQRT3,1/SQRT3]},
  {right:[1,0,0],up:[0,1,0],toward:[0,0,1]}
]);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));

function createCanvas(){
  const width=PANEL*SAMPLES*VIEWS.length,height=PANEL*SAMPLES,colour=new Uint8Array(width*height*3);
  for(let i=0;i<colour.length;i+=3){colour[i]=BACKGROUND[0];colour[i+1]=BACKGROUND[1];colour[i+2]=BACKGROUND[2];}
  return {width,height,colour,depth:new Float32Array(width*height).fill(-Infinity)};
}
// Each panel frames the world box `bounds`; depth grows toward the eye.
function frames(bounds){
  const size=PANEL*SAMPLES;
  return VIEWS.map((view,index)=>{
    const corners=[0,1,2,3,4,5,6,7].map(k=>[bounds.min[0]+(k&1?1:0)*(bounds.max[0]-bounds.min[0]),bounds.min[1]+(k&2?1:0)*(bounds.max[1]-bounds.min[1]),bounds.min[2]+(k&4?1:0)*(bounds.max[2]-bounds.min[2])]);
    const span=(axis)=>{const values=corners.map(p=>dot(p,axis));return [Math.min(...values),Math.max(...values)];};
    const [x0,x1]=span(view.right),[y0,y1]=span(view.up),[d0,d1]=span(view.toward);
    const scale=size*(1-2*MARGIN)/Math.max(x1-x0,y1-y0,1);
    // Key light from the eye, raised and to the left.
    const toward=[0,1,2].map(k=>view.toward[k]+0.45*view.up[k]-0.3*view.right[k]),length=Math.hypot(...toward);
    return {...view,light:toward.map(value=>value/length),scale,x0:index*size,x1:(index+1)*size,cx:index*size+size/2-(x0+x1)/2*scale,cy:size/2+(y0+y1)/2*scale,d0,d1};
  });
}
const project=(frame,p,out,k)=>{out[k]=frame.cx+dot(p,frame.right)*frame.scale;out[k+1]=frame.cy-dot(p,frame.up)*frame.scale;out[k+2]=dot(p,frame.toward);};

function fillTriangle(canvas,frame,p,a,b,c,r,g,bl){
  const ax=p[a],ay=p[a+1],az=p[a+2],bx=p[b],by=p[b+1],bz=p[b+2],cx=p[c],cy=p[c+1],cz=p[c+2];
  const area=(bx-ax)*(cy-ay)-(cx-ax)*(by-ay);if(!area)return;
  const minX=Math.max(frame.x0,Math.floor(Math.min(ax,bx,cx))),maxX=Math.min(frame.x1-1,Math.ceil(Math.max(ax,bx,cx)));
  const minY=Math.max(0,Math.floor(Math.min(ay,by,cy))),maxY=Math.min(canvas.height-1,Math.ceil(Math.max(ay,by,cy)));
  if(minX>maxX||minY>maxY)return;
  const {width,colour,depth}=canvas;
  // Edge functions evaluated directly: a shared edge gives exactly opposite
  // values in its two triangles, so no pixel between them is left uncovered.
  const sign=area>0?1:-1;
  for(let y=minY;y<=maxY;y++){
    const py=y+0.5;
    for(let x=minX,i=y*width+minX;x<=maxX;x++,i++){
      const px=x+0.5,ea=((bx-px)*(cy-py)-(cx-px)*(by-py))*sign,eb=((cx-px)*(ay-py)-(ax-px)*(cy-py))*sign,ec=((ax-px)*(by-py)-(bx-px)*(ay-py))*sign;
      if(ea<0||eb<0||ec<0)continue;
      const z=(ea*az+eb*bz+ec*cz)/(ea+eb+ec);
      if(z<=depth[i])continue;
      depth[i]=z;colour[i*3]=r;colour[i*3+1]=g;colour[i*3+2]=bl;
    }
  }
}
// A segment of square stamps `size` pixels across; depth-tested unless `under`.
function drawSegment(canvas,frame,a,b,size,r,g,bl,under=false){
  const n=Math.ceil(Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]))),half=(size-1)/2,{width,colour,depth}=canvas;
  for(let j=0;j<=n;j++){
    const t=n?j/n:0,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t,z=a[2]+(b[2]-a[2])*t;
    const left=Math.max(frame.x0,Math.round(x-half)),right=Math.min(frame.x1-1,Math.round(x+half)),top=Math.max(0,Math.round(y-half)),bottom=Math.min(canvas.height-1,Math.round(y+half));
    for(let py=top;py<=bottom;py++)for(let px=left;px<=right;px++){
      const i=py*width+px;
      if(!under){if(z<=depth[i])continue;depth[i]=z;}
      colour[i*3]=r;colour[i*3+1]=g;colour[i*3+2]=bl;
    }
  }
}
// The bed grid at Z = 0 under the content, every 10 mm (every 50 mm darker).
function drawGrid(canvas,frame,bounds){
  if(GRID_MM*frame.scale<EDGE_PX*SAMPLES)return;
  const lo=[0,1].map(k=>Math.floor(bounds.min[k]/GRID_MM-1)*GRID_MM),hi=[0,1].map(k=>Math.ceil(bounds.max[k]/GRID_MM+1)*GRID_MM);
  const a=new Float64Array(3),b=new Float64Array(3);
  for(let axis=0;axis<2;axis++)for(let v=lo[axis];v<=hi[axis];v+=GRID_MM){
    const other=1-axis,from=[0,0,0],to=[0,0,0];from[axis]=to[axis]=v;from[other]=lo[other];to[other]=hi[other];
    project(frame,from,a,0);project(frame,to,b,0);
    const colour=Math.round(v/GRID_MM)%5===0?GRID_MAJOR:GRID;
    drawSegment(canvas,frame,a,b,SAMPLES,...colour,true);
  }
}
// Silhouettes and depth steps darken: a pixel beside background, or whose depth
// departs from its neighbours' mean by EDGE_PX pixels' worth (steep smooth
// surfaces change depth fast but evenly, so they stay unmarked).
function outline(canvas,frame){
  const {width,height,colour,depth}=canvas,step=EDGE_PX/frame.scale,marked=[];
  const edge=(z,a,b)=>{const p=depth[a],q=depth[b];return p===-Infinity||q===-Infinity||Math.abs(2*z-p-q)>step;};
  for(let y=1;y<height-1;y++)for(let x=frame.x0+1;x<frame.x1-1;x++){
    const i=y*width+x,z=depth[i];if(z===-Infinity)continue;
    if(edge(z,i-1,i+1)||edge(z,i-width,i+width))marked.push(i);
  }
  for(const i of marked){colour[i*3]=OUTLINE[0];colour[i*3+1]=OUTLINE[1];colour[i*3+2]=OUTLINE[2];}
}
function encode(canvas){
  for(let k=1;k<VIEWS.length;k++)drawSegment(canvas,{x0:0,x1:canvas.width},[k*PANEL*SAMPLES,0,0],[k*PANEL*SAMPLES,canvas.height,0],SAMPLES,...GRID_MAJOR,true);
  const {width,height,colour}=canvas,w=width/SAMPLES,h=height/SAMPLES,out=new Uint8Array(w*h*3),n=SAMPLES*SAMPLES;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){
    let sum=0;for(let sy=0;sy<SAMPLES;sy++)for(let sx=0;sx<SAMPLES;sx++)sum+=colour[((y*SAMPLES+sy)*width+x*SAMPLES+sx)*3+c];
    out[(y*w+x)*3+c]=Math.round(sum/n);
  }
  return encodePng(out,w,h,{channels:3,level:6});
}
function extend(bounds,p){for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],p[k]);bounds.max[k]=Math.max(bounds.max[k],p[k]);}}
const emptyBounds=()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});

// Geometry as Studio receives it: polygon faces over vertices, plus curves and points.
export function geometryImage(geometry){
  const vertices=geometry?.vertices??[],faces=geometry?.faces??[],curves=geometry?.curves??[],points=geometry?.points??[];
  const bounds=emptyBounds();
  for(const p of vertices)extend(bounds,p);
  for(const curve of curves)for(const p of curve.points)extend(bounds,p);
  for(const {point} of points)extend(bounds,point);
  if(bounds.min[0]===Infinity)return null;
  const canvas=createCanvas();
  for(const frame of frames(bounds)){
    drawGrid(canvas,frame,bounds);
    const {light}=frame;
    const projected=new Float64Array(vertices.length*3);
    vertices.forEach((p,i)=>project(frame,p,projected,i*3));
    for(const face of faces)for(let k=1;k+1<face.length;k++){
      const a=vertices[face[0]],b=vertices[face[k]],c=vertices[face[k+1]];
      const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,size=Math.sqrt(nx*nx+ny*ny+nz*nz);if(size<NUMERIC_MM)continue;
      const shade=Math.min(1.08,0.42+0.64*Math.abs(nx*light[0]+ny*light[1]+nz*light[2])/size);
      fillTriangle(canvas,frame,projected,face[0]*3,face[k]*3,face[k+1]*3,Math.min(255,Math.round(PART[0]*shade)),Math.min(255,Math.round(PART[1]*shade)),Math.min(255,Math.round(PART[2]*shade)));
    }
    outline(canvas,frame);
    const a=new Float64Array(3),b=new Float64Array(3);
    for(const curve of curves)for(let k=1;k<curve.points.length;k++){project(frame,curve.points[k-1],a,0);project(frame,curve.points[k],b,0);drawSegment(canvas,frame,a,b,SAMPLES*2,...CURVE);}
    for(const {point} of points){project(frame,point,a,0);drawSegment(canvas,frame,a,a,SAMPLES*5,...CURVE);}
  }
  return encode(canvas);
}

// A SAAMpath read through pathPreview as Studio reads it, streamed twice: once
// to frame the part's extrusion (the sacrificial prime line may fall outside),
// once to draw. Returns the PNG and the colour of each phase drawn. Callers pass
// the saved SAAMpath, not the prepared path: machine startup motion says nothing
// about the part, and preparing a large path costs seconds.
export function pathImage(path,{plan,palette,inspection}){
  const bounds=emptyBounds(),all=emptyBounds();
  pathPreview(path,{plan,moves:{push(move){if(!move.extruding)return;extend(all,move.from);extend(all,move.to);if(move.phase!=='prime'){extend(bounds,move.from);extend(bounds,move.to);}}}});
  const framed=bounds.min[0]===Infinity?all:bounds;
  if(framed.min[0]===Infinity)return null;
  const canvas=createCanvas(),frameList=frames(framed),phases={},colours=new Map(),a=new Float64Array(3),b=new Float64Array(3);
  for(const frame of frameList)drawGrid(canvas,frame,framed);
  pathPreview(path,{plan,moves:{push(move){
    if(!move.extruding)return;
    move.modulated=Boolean(inspection?.operations?.[move.operation]?.modifiers?.length);
    const hex=phaseColour(palette,move);phases[move.modulated?'modulated':move.phase]=hex;
    if(!colours.has(hex))colours.set(hex,rgb(hex));
    const base=colours.get(hex),injection=move.from===move.to;
    const nx=move.from[1]-move.to[1],ny=move.to[0]-move.from[0],across=Math.hypot(nx,ny);
    for(const frame of frameList){
      project(frame,move.from,a,0);project(frame,move.to,b,0);
      // Nearer is brighter; a bead lit as a wall facing across its direction.
      const near=frame.d1>frame.d0?((a[2]+b[2])/2-frame.d0)/(frame.d1-frame.d0):1,lit=across?0.7+0.45*Math.abs(nx*frame.light[0]+ny*frame.light[1])/across:1;
      const cue=(0.62+0.43*Math.min(1,Math.max(0,near)))*lit;
      const size=Math.max(SAMPLES,Math.round(BEAD*(move.lineWidthMm??plan?.process?.lineWidthMm??0)*frame.scale),injection?SAMPLES*4:0);
      drawSegment(canvas,frame,a,b,size,...base.map(value=>Math.min(255,Math.round(value*cue))));
    }
  }}});
  return {png:encode(canvas),phases};
}

// One runtime's images, kept in its own temporary workspace (tmp/jobs) until the
// runtime closes; a crash leaves it to the next start's workspace cleanup. Each
// bundle keeps its newest geometry and toolpath image.
export function createResultImages(paths){
  const owned={workspace:null};
  async function folder(){return (owned.workspace??=createTemporaryWorkspace('visual-check')).then(workspace=>workspace.directory);}
  async function write(bundleId,kind,key,png){
    const directory=await folder(),stem=String(bundleId).replace(/[^A-Za-z0-9_-]+/g,'_').slice(-48)+'-'+createHash('sha256').update(String(bundleId)).digest('hex').slice(0,6)+'-'+kind;
    for(const name of await readdir(directory))if(name.startsWith(stem+'-'))await rm(resolve(directory,name),{force:true});
    const file=resolve(directory,`${stem}-${String(key).replace(/[^A-Za-z0-9]/g,'').slice(0,12)}.png`);
    await writeFile(file,png);return file;
  }
  return {
    // The images an operation's result carries: geometry when its geometry
    // identity changed, toolpath when its generation did; null when neither.
    async capture(directory,bundleId,before,after){
      const geometry=Boolean(after?.geometryKey)&&after.geometryKey!==before?.geometryKey;
      const toolpath=Boolean(after?.generationKey)&&after.generationKey!==before?.generationKey;
      if(!geometry&&!toolpath)return null;
      const result={};
      try{
        const adapter=await bundleFor(directory),{state}=await adapter.loadBundleSnapshot(directory,{program:false});
        if(geometry){
          try{const png=geometryImage(state.geometry);if(png)result.geometry=await write(bundleId,'geometry',after.geometryKey,png);}
          catch(error){result.geometryError=error.message;}
        }
        if(toolpath){
          try{
            const local=await readLocalPhaseColours(paths).catch(error=>{result.phaseColoursProblem='Local phase colours ignored: '+error.message;return null;});
            const drawn=pathImage(JSON.parse(await adapter.readToolpath(state)),{plan:state.plan,
              palette:resolvePhaseColours(state.phaseColours,local),inspection:state.review.generation?.summary?.inspection});
            if(drawn){result.toolpath=await write(bundleId,'toolpath',after.generationKey,drawn.png);result.phases=drawn.phases;}
          }catch(error){result.toolpathError=error.message;}
        }
      }catch(error){result.error=error.message;}
      return Object.keys(result).length?result:null;
    },
    async close(){const workspace=await owned.workspace?.catch(()=>null);await workspace?.release();}
  };
}
