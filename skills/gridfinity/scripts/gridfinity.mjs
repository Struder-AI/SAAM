import {solidKernel,meshFromSolid} from '../../../core/geom/solid.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {gridfinityDigest} from './record.mjs';

// Dimensional sources and height conventions live in the skill manual.
const COMMON={kind:'bin',xUnits:1,yUnits:1,toleranceMm:0.03};
const OPTIONS={
  bin:{heightUnits:3,wallMm:1.2,floorMm:2.25,compartmentsX:1,compartmentsY:1,stackingLip:true,magnetHoles:false},
  blank:{heightUnits:1,magnetHoles:false},
  baseplate:{floorMm:1.2}
};
export function gridfinityParameters(input={}){
  requireThat(input&&typeof input==='object'&&!Array.isArray(input),'Gridfinity parameters must be an object.');
  const kind=input.kind??'bin';
  requireThat(Object.hasOwn(OPTIONS,kind),'Gridfinity kind must be bin, blank or baseplate.');
  const template={...COMMON,kind,...OPTIONS[kind]};
  requireThat(Object.keys(input).every(key=>Object.hasOwn(template,key)),'Unknown or inapplicable gridfinity parameter.');
  const p={...template,...input};
  const range=(key,min,max,integer=false)=>requireThat(Number.isFinite(p[key])&&p[key]>=min&&p[key]<=max&&(!integer||Number.isInteger(p[key])),`${key} must be ${integer?'an integer ':''}between ${min} and ${max}.`);
  range('xUnits',1,8,true);range('yUnits',1,8,true);range('toleranceMm',0.005,0.1);
  if(kind!=='baseplate'){
    range('heightUnits',1,20,true);requireThat(typeof p.magnetHoles==='boolean','magnetHoles must be boolean.');
  }
  if(kind==='baseplate')range('floorMm',0,5);
  if(kind==='bin'){
    range('heightUnits',2,20,true);range('wallMm',0.8,2.5);range('floorMm',1,5);
    range('compartmentsX',1,16,true);range('compartmentsY',1,16,true);
    requireThat(typeof p.stackingLip==='boolean','stackingLip must be boolean.');
    const floor=4.75+p.floorMm,shoulder=7*p.heightUnits;
    requireThat(floor+3.8<shoulder,'Bin floor leaves insufficient depth beneath the rim.');
    for(const [axis,count] of [['xUnits','compartmentsX'],['yUnits','compartmentsY']])
      requireThat((42*p[axis]-0.5-p.wallMm*(p[count]+1))/p[count]>=4,'Compartments must have at least 4 mm clear width.');
  }
  return p;
}

// Convex rounded-rectangle loft. Corresponding quarter arcs share a segment
// count, so the straight 45-degree profile sections remain exactly linear.
function roundedRing(width,depth,radius,z,cx,cy,steps){
  const ring=[];
  for(let corner=0;corner<4;corner++){
    const angle=corner*Math.PI/2;
    const x=cx+(corner===0||corner===3?1:-1)*(width/2-radius);
    const y=cy+(corner<2?1:-1)*(depth/2-radius);
    for(let i=0;i<=steps;i++){
      const a=angle+i*Math.PI/(2*steps);
      ring.push([x+radius*Math.cos(a),y+radius*Math.sin(a),z]);
    }
  }
  return ring;
}

export async function compileGridfinity(input={}){
  const p=gridfinityParameters(input),k=await solidKernel(),owned=[];
  const keep=object=>(owned.push(object),object);
  const steps=Math.max(2,Math.ceil(Math.PI/(4*Math.acos(1-p.toleranceMm/4))));
  // All temporaries, including inputs to lazy booleans, survive until extraction.
  const loft=(levels,cx,cy)=>{
    const vertices=levels.flatMap(([z,w,d,r])=>roundedRing(w,d,r,z,cx,cy,steps)),n=4*(steps+1),triangles=[];
    for(let layer=0;layer<levels.length-1;layer++)for(let j=0;j<n;j++){
      const a=layer*n+j,b=layer*n+(j+1)%n,c=b+n,d=a+n;
      triangles.push([a,b,c],[a,c,d]);
    }
    const bottom=vertices.length,top=bottom+1;
    vertices.push([cx,cy,levels[0][0]],[cx,cy,levels.at(-1)[0]]);
    for(let j=0;j<n;j++){
      triangles.push([bottom,(j+1)%n,j]);
      const offset=(levels.length-1)*n;
      triangles.push([top,offset+j,offset+(j+1)%n]);
    }
    return keep(new k.Manifold(new k.Mesh({numProp:3,vertProperties:Float32Array.from(vertices.flat()),triVerts:Uint32Array.from(triangles.flat())})));
  };
  const block=(w,d,r,z0,z1,cx,cy)=>loft([[z0,w,d,r],[z1,w,d,r]],cx,cy);
  const union=solids=>keep(k.Manifold.union(solids));
  const subtract=(a,b)=>keep(a.subtract(b));
  const w=42*p.xUnits-0.5,d=42*p.yUnits-0.5,cx=21*p.xUnits,cy=21*p.yUnits;
  try{
    let solid;
    if(p.kind==='baseplate'){
      const floor=p.floorMm,top=floor+4.75;
      solid=block(w+0.5,d+0.5,4,0,top,cx,cy);
      const sockets=[];
      for(let x=0;x<p.xUnits;x++)for(let y=0;y<p.yUnits;y++){
        // 5 mm reference socket, trimmed 0.25 mm below its zero-width rim.
        sockets.push(loft([
          [floor===0?-0.1:floor,36.3,36.3,1.15],
          [floor+0.35,36.3,36.3,1.15],
          [floor+1.05,37.7,37.7,1.85],
          [floor+2.85,37.7,37.7,1.85],
          [floor+5,42,42,4],
          [floor+5.1,42,42,4]
        ],21+42*x,21+42*y));
      }
      solid=subtract(solid,union(sockets));
    }else{
      const shoulder=7*p.heightUnits,top=shoulder+(p.stackingLip?3.8:0),parts=[];
      for(let x=0;x<p.xUnits;x++)for(let y=0;y<p.yUnits;y++)parts.push(loft([
        [0,35.6,35.6,0.8],[0.8,37.2,37.2,1.6],
        [2.6,37.2,37.2,1.6],[4.75,41.5,41.5,3.75]
      ],21+42*x,21+42*y));
      parts.push(block(w,d,3.75,4.75,top,cx,cy));
      solid=union(parts);
      if(p.kind==='bin'){
        const inset=p.wallMm,floor=4.75+p.floorMm;
        const cavityLevels=[[floor,w-2*inset,d-2*inset,3.75-inset]];
        if(p.stackingLip)cavityLevels.push(
          [shoulder-3.8,w-2*inset,d-2*inset,3.75-inset],
          [shoulder-1.2,w-5.2,d-5.2,1.15],
          [shoulder,w-5.2,d-5.2,1.15],
          [shoulder+0.7,w-3.8,d-3.8,1.85],
          [shoulder+2.5,w-3.8,d-3.8,1.85],
          [top,w-1.2,d-1.2,3.15],[top+0.1,w-1.2,d-1.2,3.15]);
        else cavityLevels.push([top+0.1,w-2*inset,d-2*inset,3.75-inset]);
        let cavity=loft(cavityLevels,cx,cy);
        const dividers=[],insideW=w-2*inset,insideD=d-2*inset;
        const cellW=(insideW-(p.compartmentsX-1)*inset)/p.compartmentsX;
        const cellD=(insideD-(p.compartmentsY-1)*inset)/p.compartmentsY;
        const cube=(size,position)=>keep(keep(k.Manifold.cube(size)).translate(position));
        const dividerHeight=(p.stackingLip?shoulder:top+0.2)-floor;
        for(let i=1;i<p.compartmentsX;i++)dividers.push(cube([inset,d,dividerHeight],[0.25+inset+i*cellW+(i-1)*inset,0.25,floor]));
        for(let i=1;i<p.compartmentsY;i++)dividers.push(cube([w,inset,dividerHeight],[0.25,0.25+inset+i*cellD+(i-1)*inset,floor]));
        if(dividers.length)cavity=subtract(cavity,union(dividers));
        solid=subtract(solid,cavity);
      }
      if(p.magnetHoles){
        const holes=[];
        for(let x=0;x<p.xUnits;x++)for(let y=0;y<p.yUnits;y++)for(const dx of [-13,13])for(const dy of [-13,13])
          holes.push(keep(keep(k.Manifold.cylinder(2.5,3.25,3.25,4*steps)).translate([21+42*x+dx,21+42*y+dy,-0.1])));
        solid=subtract(solid,union(holes));
      }
    }
    requireThat(solid.status()==='NoError'&&!solid.isEmpty()&&solid.volume()>0,'Gridfinity construction failed to produce a solid.');
    const mesh=meshFromSolid(solid);
    const record={shape:'gridfinity',parameters:p,vertices:mesh.vertices,triangles:mesh.triangles};
    return {...record,compiledHash:gridfinityDigest(record)};
  }finally{for(const object of owned.reverse())object.delete();}
}
