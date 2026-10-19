import {writeFileSync} from 'node:fs';

// Geometry inputs only; SAAM constructs and publishes the print bundle.
const N=288, grooves=24;
const wave=a=>Math.pow((1+Math.cos(grooves*a))/2,4);
const rounded=n=>Math.round(n*1e6)/1e6;
function revolved(profile) {
  const vertices=[], triangles=[], rings=[];
  for (const p of profile) {
    const [r,z,depth=0,scallop=0]=p;
    const ids=[];
    for(let i=0;i<(r===0?1:N);i++) {
      const a=i*2*Math.PI/N;
      const radius=r+scallop*Math.cos(grooves*a);
      ids.push(vertices.length);
      vertices.push([radius*Math.cos(a),radius*Math.sin(a),z-depth*wave(a)].map(rounded));
    }
    rings.push(ids);
  }
  for(let j=0;j<rings.length;j++) {
    const a=rings[j],b=rings[(j+1)%rings.length];
    if(a.length===1&&b.length===1)continue;
    for(let i=0;i<N;i++) {
      const k=(i+1)%N;
      if(a.length===1)triangles.push([a[0],b[k],b[i]]);
      else if(b.length===1)triangles.push([a[i],a[k],b[0]]);
      else triangles.push([a[i],a[k],b[k]],[a[i],b[k],b[i]]);
    }
  }
  let volume=0;
  for(const t of triangles){
    const [a,b,c]=t.map(i=>vertices[i]);
    volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  }
  if(volume<0)for(const t of triangles)[t[1],t[2]]=[t[2],t[1]];
  const edges=new Map();
  for(const t of triangles)for(let k=0;k<3;k++){
    const a=t[k],b=t[(k+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');
    edges.set(key,(edges.get(key)||0)+1);
  }
  if([...edges.values()].some(n=>n!==2))throw Error('Non-manifold mesh input');
  return {shape:'mesh',vertices,triangles,source:null};
}
const rotor=revolved([
  [10.6,0],[17,0],[17.6,.6],[17.6,1.4],[20,3.8],
  [17.6,6.2],[17.6,7],[17,7.6],[16.5,7.6,.6],
  [12,7.6,.6],[11.2,7.6],[10.6,7.6],[10,7],[10,.6]
]);
const ring=revolved([
  [18.2,0],[26.7,0,0,.2],[27.3,.6,0,.2],
  [27.3,7,0,.2],[26.7,7.6,0,.2],
  [26,7.6,.6],[21,7.6,.6],[19,7.6],
  [18.2,7],[18.2,6.2],[20.6,3.8],[18.2,1.4]
]);
const request={
  bundleId:'concentric-groove-fidget-20261017',
  plan:{
    schema:'saam-shell-plan/1',
    geometry:{shape:'assembly',parts:[
      {id:'outer-ring',xMm:0,yMm:0,zMm:0,geometry:ring},
      {id:'inner-disc',xMm:0,yMm:0,zMm:0,geometry:rotor}
    ]},
    setup:{material:'PLA',nozzleC:215},
    process:{lineWidthMm:.4,firstLayerMm:.2,layerMm:.2},
    slices:{version:1,assignments:[{
      id:'body',part:null,loops:3,fillDensity:.25,fillPattern:'rectilinear',
      fillAnglesDeg:[45,135],rotateFill:true,solidTop:4,solidBottom:4,
      description:'Two separate captive components; aligned face grooves; 0.6 mm radial running clearance.'
    }]}
  }
};
writeFileSync(new URL('./create-request.json',import.meta.url),JSON.stringify(request));
writeFileSync(new URL('./hole-edit.json',import.meta.url),JSON.stringify({
  bundleId:request.bundleId,
  expectedEditRevision:'99ba10be-2656-40a0-9e18-b3b2c35b6e25',
  expectedStudio:{studioInstanceId:'a2d01d90fb37b260574a1abf6efa1f8e',bundleId:request.bundleId,selectionVersion:'c42e715b94fedc1ce03d14b5c0fd7ef3'},
  patch:{geometry:request.plan.geometry}
}));
console.log(JSON.stringify({bundleId:request.bundleId,parts:request.plan.geometry.parts.map(p=>({id:p.id,vertices:p.geometry.vertices.length,triangles:p.geometry.triangles.length})),dimensionsMm:[55,55,7.6],radialClearanceMm:.6}));
