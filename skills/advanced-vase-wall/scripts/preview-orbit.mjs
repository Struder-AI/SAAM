// Read-only experiment against an ingested native mesh; emits no machine program.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {orbitPrimaryPath} from './orbit.mjs';
const [root,file,out='.tmp/orbit-preview']=process.argv.slice(2);
if(!root||!file)throw new Error('Usage: node preview-orbit.mjs SAAM_ROOT NATIVE_MESH_JSON OUTPUT_DIRECTORY');
const {createSectionQuery}=await import(pathToFileURL(resolve(root,'core/geom/query.mjs')));
const {contourPath}=await import(pathToFileURL(resolve(root,'core/geom/contour-path.mjs')));
const {signedArea}=await import(pathToFileURL(resolve(root,'core/geom/shell.mjs')));
const begin=performance.now(),native=JSON.parse(await readFile(file,'utf8')).geometry;
const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};for(const p of native.vertices)for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],p[k]);bounds.max[k]=Math.max(bounds.max[k],p[k]);}
const query=createSectionQuery({...native,kind:'triangle-mesh',bounds});
const start=.8,end=2.8,rise=.2,sections=[];let anchor=null;
for(let z=start;z<=end+1e-8;z+=rise){const loops=query(z).loops,outer=loops.filter(l=>signedArea(l)>0).sort((a,b)=>signedArea(b)-signedArea(a))[0];if(!outer)throw new Error('No outer loop');const path=contourPath(outer,anchor);anchor??=path.seam;sections.push({z,path});}
const primary=[],turns=(end-start)/rise,samples=Math.ceil(sections[0].path.length/.1),count=Math.round(turns*samples);
for(let n=0;n<=count;n++){const turn=n/samples,i=Math.min(sections.length-2,Math.floor(turn)),f=turn-i,u=turn%1,a=sections[i].path.at(u),b=sections[i+1].path.at(u);const p=a.map((v,k)=>v+f*(b[k]-v));const delta=1e-5,aa=sections[i].path.at(u-delta),bb=sections[i].path.at(u+delta),dx=bb[0]-aa[0],dy=bb[1]-aa[1],h=Math.hypot(dx,dy);primary.push([p[0]-.2*dy/h,p[1]+.2*dx/h,start+turn*rise]);}
const primaryDone=performance.now();
const constant=orbitPrimaryPath(primary,{wallWidthMm:2}),constantDone=performance.now();
const taper=orbitPrimaryPath(primary,{widthAtHeight:z=>5-3*Math.min(1,(z-start)/10)}),done=performance.now();
await mkdir(out,{recursive:true});
const report={source:file,sourceUnchanged:true,previewOnly:true,wallRangeMm:[start,end],sections:sections.length,primaryPoints:primary.length,primaryConstruction:'Original triangle sections every 0.2 mm; linear interpolation in height and normalized perimeter. No fitted surface. Half-bead inward normal standoff.',timingsSeconds:{readAndPrimary:(primaryDone-begin)/1000,constantPattern:(constantDone-primaryDone)/1000,taperPattern:(done-constantDone)/1000},constant:constant.report,taper:taper.report};
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));await writeFile(resolve(out,'paths.json'),JSON.stringify({primary,constant:constant.points,taper:taper.points}));
const poly=points=>points.map(p=>`${(40+(p[0]-bounds.min[0])*5).toFixed(2)},${(470-(p[1]-bounds.min[1])*5).toFixed(2)}`).join(' ');
const source=sections[0].path.breakpoints().map(v=>v.p),course=p=>p.filter(v=>v[2]<=1.00001);
const panel=(name,points)=>`<div><h2>${name}</h2><svg viewBox="0 0 500 520"><polyline points="${poly(source)}" fill="none" stroke="#909090" stroke-width="2"/><polyline points="${poly(course(primary))}" fill="none" stroke="#2186e3" stroke-width="1.2"/><polyline points="${poly(course(points))}" fill="none" stroke="#e36c16" stroke-width="2" opacity=".75"/></svg></div>`;
await writeFile(resolve(out,'preview.html'),`<!doctype html><meta charset="utf-8"><title>Original vase — orbit experiment</title><style>body{font:16px system-ui;background:#fafafa;color:#222;margin:24px}.panels{display:flex} .panels div{width:50%}svg{width:100%;max-height:70vh}h2{font-size:19px}</style><h1>Original vase: local orbit experiment</h1><p>One course viewed from above. Gray: original STL contour. Blue: primary spiral. Orange: 0.4 mm deposited bead. Corner distortions retained.</p><div class="panels">${panel('Constant 2 mm wall',constant.points)}${panel('Optional 5 → 2 mm taper (first course)',taper.points)}</div><p>Ten rising courses calculated from Z 0.8–2.8 mm. This preview is not a machine program or a completed skill integration.</p><pre>${JSON.stringify(report.timingsSeconds,null,2)}</pre>`);
console.log(JSON.stringify(report,null,2));
