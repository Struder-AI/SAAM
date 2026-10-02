import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {solidKernel,meshFromSolid} from '../../core/geom/solid.mjs';
import {makeMesh} from '../../core/geom/mesh.mjs';
import {compileText,textFeature} from '../../skills/text/scripts/text.mjs';
import {textOutlines} from '../../core/geom/text-outline.mjs';
import {textLayout} from '../../core/geom/text-layout.mjs';

export const initialDesign={schema:'saam-switch-cover/1',country:'US',familyId:'na-wallplate',installation:'flush',coverage:'standard',width:115.8875,height:114.3,pitch:46.0375,thickness:3,cornerRadius:4,rearPocketDepth:1.2,rimWidth:4,screwDiameter:3.6,screwHeadDiameter:6.5,countersinkDepth:1,labelSize:7,reliefDepth:0.6,treatment:'raised',faceOrientation:'up',plateColor:'#eee5d7',textColor:'#334d43',decorationPrompt:'',decoration:[],devices:[{kind:'toggle',width:10.31,height:23.8,screwPitch:60.325,label:'LIGHTS',labelPosition:'bottom'},{kind:'toggle',width:10.31,height:23.8,screwPitch:60.325,label:'PORCH',labelPosition:'bottom'}]};
const fail=(ok,msg)=>{if(!ok)throw Error(msg);};
const range=(n,a,b,name)=>fail(Number.isFinite(n)&&n>=a&&n<=b,`${name} must be ${a}–${b} mm.`);
export function normalizeDesign(input){
 fail(input?.schema===initialDesign.schema,'Unsupported design format.');
 const d=structuredClone(input);d.faceOrientation??=['raised','two-color'].includes(d.treatment)?'up':'down';
 fail(['up','down'].includes(d.faceOrientation),'Choose face up or face down.');
 if(['raised','two-color'].includes(d.treatment))d.faceOrientation='up';
 fail(['flush','surface-device-box','surface-square-overlay'].includes(d.installation),'Choose a recessed box, surface device box or square-box overlay.');
 fail(['raised','recessed','two-color','two-color-flush'].includes(d.treatment),'Unknown lettering treatment.');
 fail(typeof d.country==='string'&&typeof d.familyId==='string','Select a location and cover family.');
 fail(Array.isArray(d.devices)&&d.devices.length>=1&&d.devices.length<=6,'Choose 1–6 positions.');
 for(const [key,a,b] of [['width',35,340],['height',50,300],['pitch',20,100],['thickness',2,8],['cornerRadius',0,15],['rearPocketDepth',0,4],['rimWidth',2,12],['screwDiameter',2,8],['screwHeadDiameter',3,12],['countersinkDepth',0,3],['labelSize',4,20],['reliefDepth',0.2,2]])range(d[key],a,b,key);
 fail(d.cornerRadius<Math.min(d.width,d.height)/2,'Corner radius exceeds the plate.');
 fail(d.rearPocketDepth+d.countersinkDepth<d.thickness-0.4,'Rear pocket and countersink leave too little material.');
 fail(d.reliefDepth<d.thickness-d.rearPocketDepth-0.5,'Letter recess must preserve the plate face.');
 fail(d.screwHeadDiameter>=d.screwDiameter,'Screw head diameter must exceed hole diameter.');
 for(const device of d.devices){
  fail(['toggle','rocker','blank','custom'].includes(device.kind),'Unknown opening type.');
  range(device.width,3,80,'Opening width');range(device.height,3,100,'Opening height');range(device.screwPitch,15,160,'Screw spacing');
  fail(typeof device.label==='string'&&device.label.length<=80,'Labels must be at most 80 characters.');
  fail(['top','bottom'].includes(device.labelPosition),'Choose top or bottom labels.');
 }
 fail(/^#[a-f0-9]{6}$/i.test(d.plateColor)&&/^#[a-f0-9]{6}$/i.test(d.textColor),'Choose valid colors.');
 fail(typeof d.decorationPrompt==='string'&&d.decorationPrompt.length<=4000,'Decoration request is too long.');
 fail(Array.isArray(d.decoration)&&d.decoration.length<=40,'Decoration supports up to 40 motifs.');
 for(const m of d.decoration){fail(['circle','diamond','stripe'].includes(m.shape),'Unknown motif shape.');range(m.x,0,d.width,'Motif X');range(m.y,0,d.height,'Motif Y');range(m.size,0.8,20,'Motif size');range(m.depth,0.2,1,'Motif depth');fail(m.depth<d.thickness-d.rearPocketDepth-0.5,'Motif recess leaves too little face material.');fail(['raised','recessed'].includes(m.mode),'Unknown motif relief.');}
 return d;
}
export function layout(d){
 return d.devices.map((v,i)=>({...v,x:d.width/2+(i-(d.devices.length-1)/2)*d.pitch,y:d.height/2}));
}
function overlaps(a,b,pad=0){return a[0]<b[2]+pad&&a[2]>b[0]-pad&&a[1]<b[3]+pad&&a[3]>b[1]-pad;}
export function fitLayout(d){
 const slots=layout(d),holes=[],openings=[];
 for(const s of slots){
  if(s.kind!=='blank')openings.push([s.x-s.width/2,s.y-s.height/2,s.x+s.width/2,s.y+s.height/2]);
  for(const y of [s.y-s.screwPitch/2,s.y+s.screwPitch/2])holes.push([s.x-d.screwHeadDiameter/2,y-d.screwHeadDiameter/2,s.x+d.screwHeadDiameter/2,y+d.screwHeadDiameter/2]);
 }
 const protectedRects=[...openings,...holes];
 for(const r of protectedRects)fail(r[0]>=2&&r[1]>=2&&r[2]<=d.width-2&&r[3]<=d.height-2,'Openings or screws fall too close to an edge; increase plate size or correct measurements.');
 for(let i=0;i<protectedRects.length;i++)for(let j=i+1;j<protectedRects.length;j++)fail(!overlaps(protectedRects[i],protectedRects[j],0.7),'Openings and screw heads overlap; correct dimensions or spacing.');
 return {slots,protectedRects};
}
let fontPromise;
const savedFont=()=>fontPromise??=readFile(new URL('../../skills/text/tests/fixtures/Abel-Regular.ttf',import.meta.url)).then(bytes=>({data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),postscriptName:null}));
function rectangleLoop(w,h,r){
 if(!r)return [[0,0],[w,0],[w,h],[0,h]];
 const out=[];for(const [cx,cy,start] of [[w-r,r,-90],[w-r,h-r,0],[r,h-r,90],[r,r,180]])for(let j=0;j<=8;j++){const a=(start+j*90/8)*Math.PI/180;out.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);}return out;
}
export async function buildCover(input){
 const d=normalizeDesign(input),{slots,protectedRects}=fitLayout(d),kernel=await solidKernel();
 const owned=[];const own=s=>{owned.push(s);return s;};
 const box=(w,h,z,x,y,bottom)=>own(kernel.Manifold.cube([w,h,z]).translate([x-w/2,y-h/2,bottom]));
 let body;
 try{
  body=own(kernel.Manifold.extrude([rectangleLoop(d.width,d.height,d.cornerRadius)],d.thickness));
  // Retain lands around each original device screw while relieving the yoke area.
  if(d.rearPocketDepth){
   let pocket=box(d.width-2*d.rimWidth,d.height-2*d.rimWidth,d.rearPocketDepth+0.1,d.width/2,d.height/2,-0.1);
   for(const s of slots)for(const y of [s.y-s.screwPitch/2,s.y+s.screwPitch/2]){const boss=own(kernel.Manifold.cylinder(d.rearPocketDepth+0.3,d.screwHeadDiameter/2+1.5,d.screwHeadDiameter/2+1.5,32).translate([s.x,y,-0.1]));pocket=own(pocket.subtract(boss));}
   body=own(body.subtract(pocket));
  }
  const down=d.faceOrientation==='down';
  const faceOffset=down?Math.max(['raised','two-color'].includes(d.treatment)&&slots.some(s=>s.label.trim())?d.reliefDepth:0,...d.decoration.filter(m=>m.mode==='raised').map(m=>m.depth+0.05)):0;
  for(const s of slots){
   if(s.kind!=='blank')body=own(body.subtract(box(s.width,s.height,d.thickness+2,s.x,s.y,-1)));
   for(const y of [s.y-s.screwPitch/2,s.y+s.screwPitch/2]){
    const cy=y;
    const hole=own(kernel.Manifold.cylinder(d.thickness+2,d.screwDiameter/2,d.screwDiameter/2,32).translate([s.x,cy,-1]));body=own(body.subtract(hole));
    if(d.countersinkDepth){const sink=own(kernel.Manifold.cylinder(d.countersinkDepth+0.01,d.screwDiameter/2,d.screwHeadDiameter/2,32).translate([s.x,cy,d.thickness-d.countersinkDepth]));body=own(body.subtract(sink));}
   }
  }
  const font=await savedFont(),features=[];
  for(const [i,s] of slots.entries())if(s.label.trim()){
   const f=textFeature({id:`label-${i+1}`,text:s.label,font,mode:d.treatment==='recessed'?'recessed':'raised',sizeMm:d.labelSize,lineHeightMm:d.labelSize*1.2,align:'center',outlineOffsetMm:0.12,depthMm:d.reliefDepth,positionMm:[s.x,s.labelPosition==='top'?d.height-23:15],reference:{kind:'plane',origin:down?[0,d.height,faceOffset]:[0,0,d.thickness],xAxis:[1,0,0],yAxis:down?[0,-1,0]:[0,1,0]}});
   const points=textOutlines(f,0.03).loops.flat().map(p=>textLayout(f,0.03)(...p));
   const r=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
   fail(r[0]>=3&&r[1]>=3&&r[2]<=d.width-3&&r[3]<=d.height-3,`Label ${i+1} does not fit. Shorten it, use a smaller size or enlarge the plate.`);
   fail(!protectedRects.some(p=>overlaps(r,p,2)),`Label ${i+1} overlaps an opening or screw. Change its placement or size.`);
   fail(!features.some(p=>overlaps(r,p._bounds,1)),`Labels overlap. Reduce text size or shorten labels.`);
   f._bounds=r;features.push(f);
  }
  for(const m of d.decoration){const r=[m.x-m.size/2,m.y-m.size/2,m.x+m.size/2,m.y+m.size/2];fail(r[0]>=3&&r[1]>=3&&r[2]<=d.width-3&&r[3]<=d.height-3,'Motif crosses a plate edge.');fail(!protectedRects.some(p=>overlaps(r,p,3))&&!features.some(f=>overlaps(r,f._bounds,2)),'Motif overlaps a label, opening or screw.');}
  for(const m of d.decoration){
   const bottom=m.mode==='raised'?d.thickness-0.05:d.thickness-m.depth;
   let motif;
   if(m.shape==='circle')motif=own(kernel.Manifold.cylinder(m.depth+0.1,m.size/2,m.size/2,32).translate([m.x,m.y,bottom]));
   else if(m.shape==='diamond')motif=own(kernel.Manifold.extrude([[[0,-m.size/2],[m.size/2,0],[0,m.size/2],[-m.size/2,0]]],m.depth+0.1).translate([m.x,m.y,bottom]));
   else motif=box(m.size,0.8,m.depth+0.1,m.x,m.y,bottom);
   body=own(m.mode==='raised'?body.add(motif):body.subtract(motif));
  }
  if(down)body=own(body.rotate([180,0,0]).translate([0,d.height,d.thickness+faceOffset]));
  const mesh=meshFromSolid(body),base={shape:'mesh',source:null,vertices:mesh.vertices,triangles:mesh.triangles};
  const labelBounds=features.map(f=>f._bounds);for(const f of features)delete f._bounds;
  let geometry=features.length&&d.treatment!=='two-color-flush'?await compileText(base,features,{buildGeometry:g=>makeMesh(g.vertices,g.triangles),toleranceMm:0.03,maxEdgeMm:2}):base;
  let previewMesh=null,previewMaterials=null;
  if(d.treatment==='two-color-flush'&&features.length){
   const cutFeatures=features.map(f=>({...f,mode:'recessed'}));
   const insertFeatures=features.map(f=>({...f,mode:'raised',offsetMm:-f.depthMm,overlapMm:0}));
   const plate=await compileText(base,cutFeatures,{buildGeometry:g=>makeMesh(g.vertices,g.triangles),toleranceMm:0.03,maxEdgeMm:2});
   const labels=await compileText(null,insertFeatures,{buildGeometry:g=>makeMesh(g.vertices,g.triangles),standalone:true,toleranceMm:0.03,maxEdgeMm:2});
   geometry={shape:'assembly',parts:[{id:'plate',xMm:0,yMm:0,zMm:0,geometry:plate},{id:'labels',xMm:0,yMm:0,zMm:0,geometry:labels}]};
   previewMesh=base;previewMaterials=[{id:'base',geometry:plate},{id:'text/labels',geometry:labels}];
  }
  return {design:d,geometry,previewMesh,previewMaterials,width:d.width,height:d.height,labelBounds,materialRoles:d.treatment.startsWith('two-color')?['plate','labels']:['plate'],faceOffset,warnings:[...(!down&&d.rearPocketDepth>0?[`Face-up printing leaves a ${d.rearPocketDepth.toFixed(2)} mm recessed underside. Add support beneath the rear pocket in Studio; review the pocket roof and screw bosses before export.`]:[]),...(faceOffset>0?[`Face-down relief lifts the plate ${faceOffset.toFixed(2)} mm above the bed. Review support or bridging beneath the plate in Studio.`]:[]),'Draft fit geometry: verify the opening height, screw heads and rear clearance against your existing cover.','No physical fit or electrical material qualification recorded.'],printFace:down?'down':'up'};
 }finally{for(const s of owned.reverse())s.delete();}
}
