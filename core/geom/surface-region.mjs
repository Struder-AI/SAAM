// A rectangular surface chart shared by surface pattern producers. Native
// spline evaluation or an explicitly mapped triangle strip; no inverse mapping.
import {evaluate} from './nurbs.mjs';
import {requireThat,subtract,cross,normalize,scale,add,distance} from './tolerance.mjs';

export function validateSurfaceSelection(s){
  requireThat(s&&['spline','mesh-strip'].includes(s.kind)&&typeof s.periodicU==='boolean'&&[1,-1].includes(s.normalSide),'Invalid cladding surface selection.');
  const keys=s.kind==='spline'?'kind,normalSide,patch,periodicU,uvBounds':'kind,normalSide,periodicU,rows';
  requireThat(Object.keys(s).sort().join()===keys,'Unexpected surface selection fields.');
  if(s.kind==='spline')requireThat(typeof s.patch==='string'&&s.patch.length>0&&Array.isArray(s.uvBounds)&&s.uvBounds.length===2&&s.uvBounds.every(b=>Array.isArray(b)&&b.length===2&&b.every(Number.isFinite)&&b[1]>b[0]),'Select a native patch and two increasing UV bounds.');
  else requireThat(Array.isArray(s.rows)&&s.rows.length>=2&&s.rows.every(r=>Array.isArray(r)&&r.length===s.rows[0].length&&r.length>=2&&r.every(i=>Number.isInteger(i)&&i>=0)),'Mesh-strip rows must be a rectangular grid of native vertex indices.');
}

export function surfaceRegion(shell,spec){
  validateSurfaceSelection(spec);let at,breaksU,breaksV;
  if(spec.kind==='spline'){
    const patch=shell.patches?.find(p=>p.name===spec.patch);
    requireThat(patch,'Selected native spline patch is missing.');
    const [u,v]=spec.uvBounds;
    requireThat(u[0]>=patch.domainU[0]&&u[1]<=patch.domainU[1]&&v[0]>=patch.domainV[0]&&v[1]<=patch.domainV[1],'Selected UV region exceeds the native patch.');
    at=(a,b)=>{const e=evaluate(patch,u[0]+a*(u[1]-u[0]),v[0]+b*(v[1]-v[0]));
      requireThat(e.normal,'Surface region has a singular tangent.');
      return {point:e.point,normal:scale(e.normal,spec.normalSide),du:scale(e.du,u[1]-u[0]),dv:scale(e.dv,v[1]-v[0])};};
    const breaks=(knots,b)=>[0,...new Set([...knots].filter(x=>x>b[0]&&x<b[1]).map(x=>(x-b[0])/(b[1]-b[0]))),1];
    breaksU=breaks(patch.knotsU,u);breaksV=breaks(patch.knotsV,v);
  }else{
    requireThat(shell.kind==='triangle-mesh','Mesh-strip selection requires native mesh geometry.');
    const rows=spec.rows,nu=rows.length-1,nv=rows[0].length-1;
    requireThat(rows.flat().every(i=>i<shell.vertices.length),'Mesh strip references an absent vertex.');
    const faces=new Set(shell.triangles.map(t=>[...t].sort((a,b)=>a-b).join(','))),normals=new Map(),cells=[];
    const addFace=t=>{requireThat(faces.has([...t].sort((a,b)=>a-b).join(',')),'Mesh chart cell does not match native triangles.');
      const n=cross(subtract(shell.vertices[t[1]],shell.vertices[t[0]]),subtract(shell.vertices[t[2]],shell.vertices[t[0]]));
      for(const i of t)normals.set(i,add(normals.get(i)??[0,0,0],n));};
    for(let i=0;i<nu;i++){cells[i]=[];for(let j=0;j<nv;j++){
      const [a,b,c,d]=[rows[i][j],rows[i+1][j],rows[i+1][j+1],rows[i][j+1]];
      const ac=faces.has([a,b,c].sort((a,b)=>a-b).join(','));
      const ts=ac?[[a,b,c],[a,c,d]]:[[a,b,d],[b,c,d]];ts.forEach(addFace);cells[i][j]={a,b,c,d,ac};
    }}
    for(const [id,n] of normals)normals.set(id,scale(normalize(n),spec.normalSide));
    at=(u,v)=>{
      const i=Math.min(nu-1,Math.floor(u*nu)),j=Math.min(nv-1,Math.floor(v*nv)),x=u*nu-i,y=v*nv-j,{a,b,c,d,ac}=cells[i][j];
      let ids,w;
      if(ac){if(y<=x){ids=[a,b,c];w=[1-x,x-y,y];}else{ids=[a,c,d];w=[1-y,x,y-x];}}
      else if(x+y<=1){ids=[a,b,d];w=[1-x-y,x,y];}else{ids=[b,c,d];w=[1-y,x+y-1,1-x];}
      const blend=fn=>[0,1,2].map(k=>ids.reduce((s,id,n)=>s+fn(id)[k]*w[n],0));
      const point=blend(id=>shell.vertices[id]),normal=normalize(blend(id=>normals.get(id)));
      // One-sided cell derivatives; the reference remains the actual triangles.
      const du=scale(subtract(shell.vertices[ac?(y<=x?b:c):(x+y<=1?b:c)],shell.vertices[ac?(y<=x?a:d):(x+y<=1?a:d)]),nu);
      const dv=scale(subtract(shell.vertices[ac?(y<=x?c:d):(x+y<=1?d:c)],shell.vertices[ac?(y<=x?b:a):(x+y<=1?a:b)]),nv);
      return {point,normal,du,dv};
    };
    breaksU=Array.from({length:nu+1},(_,i)=>i/nu);breaksV=Array.from({length:nv+1},(_,i)=>i/nv);
  }
  const sample=(u,v)=>{requireThat(u>=0&&u<=1&&v>=0&&v<=1,'Surface sample outside selected region.');return at(u,v);};
  if(spec.periodicU)for(let j=0;j<=16;j++){
    const a=sample(0,j/16),b=sample(1,j/16);
    requireThat(distance(a.point,b.point)<1e-6&&distance(a.normal,b.normal)<1e-4,'Periodic surface seam must match in position and normal.');
  }
  return {at:sample,breaksU,breaksV,periodicU:spec.periodicU,backend:spec.kind};
}
