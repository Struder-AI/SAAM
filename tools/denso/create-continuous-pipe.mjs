import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const n=x=>String(Number(x.toFixed(8))),rad=Math.PI/180;
const axes=([,tilt,yaw])=>({toolUp:[-Math.sin(yaw*rad),Math.cos(yaw*rad),0],toolAxis:[-Math.cos(yaw*rad)*Math.sin(tilt*rad),-Math.sin(yaw*rad)*Math.sin(tilt*rad),-Math.cos(tilt*rad)]});
export async function createContinuousPipe(tubeDir,claddingDir,directory){
 const dir=resolve(directory);try{await stat(dir);throw Error('Choose a new output directory');}catch(e){if(e.code!=='ENOENT')throw e;}
 const read=async(d,f)=>JSON.parse(await readFile(resolve(d,f),'utf8'));
 const tube=await read(tubeDir,'tube.json'),layers=await read(tubeDir,'layers.json'),clad=await read(claddingDir,'demo.json'),tracks=await read(claddingDir,'tracks.json');
 assert.equal(tube.sourcePlanSha256,clad.sourcePlanSha256);assert.equal(layers.length,60);assert.equal(layers[0].rings.length,3);
 const sector=clad.requestedSectorDeg;assert.ok([180,360].includes(sector));
 const startDeg=sector===180?-180:-90,radii=layers[0].rings.map(r=>r.radius),initial=[radii[0]*Math.cos(startDeg*rad),radii[0]*Math.sin(startDeg*rad),layers[0].z],down=[0,0,-90];
 for(const [i,layer] of layers.entries()){assert.ok(Math.abs(layer.z-.2*(i+1))<1e-7);assert.equal(layer.rings.length,3);layer.rings.forEach((r,j)=>assert.ok(Math.abs(r.radius-(8.2+.4*j))<1e-7));}
 assert.ok(Math.abs(clad.pathRadiusMm-9.3)<1e-7);assert.equal(clad.heightMm,12);assert.equal(clad.tiltDeg,45);assert.equal(clad.totalFirstShellTracks,148);
 tracks.forEach((t,i)=>{const a=(startDeg+i*360/148)*rad;assert.ok(Math.abs(t.start[0]-9.3*Math.cos(a))<1e-7&&Math.abs(t.start[1]-9.3*Math.sin(a))<1e-7);});
 const pose=(p,angles)=>{const a=axes(angles);return `T2P(T(${[...p,...a.toolUp,...a.toolAxis].map(n).join(', ')}, Fig(P10)))`;};
 const lines=[`' !TITLE "SAAM_PIPE_${sector}"`,"' Continuous tube + first cladding shell. Extrusion belongs to separate controller.","' NO automatic approach or retreat. Pre-position at FIRST POINT before extrusion starts.",`' FIRST POINT W2: ${initial.map(n).join(', ')}; nozzle down, tool +Y toward W2 +X.`,"' All intermediate moves pass; final endpoint stops. No IO, heat or rotary commands.","' Offline candidate; controller compilation and physical run not performed.",`#define START_DEG ${startDeg}`,'#define INNER_R 8.2','#define RADIAL_STEP 0.4','#define LAYER_MM 0.2','','Sub Main','  Dim layerNo As Integer','  Dim ringNo As Integer','  Dim quarterNo As Integer','  Dim layerZ As Single','  Dim ringRadius As Single','  Dim routeAngle As Single','  Dim endAngle As Single','  Dim ptR As Position','  Dim ptT As Position','  TakeArm Keep = 0','  Tool 6, P(155, 0, 35, 0, 90, 0)','  ChangeTool 6','  ChangeWork 2','  Speed 50','  Accel 100, 100',`  ptT = ${pose(initial,down)}`,'  ptR = ptT'];
 // Use the same shared rings and layer elevations as the tube source. The
 // last outer ring is reserved for moving reorientation into the cladding.
 const ringBody=(indent,guard=false)=>{
  const p=indent;lines.push(p+'ringRadius = INNER_R + ringNo * RADIAL_STEP',p+'LetX ptT = ringRadius * Cos(START_DEG)',p+'LetY ptT = ringRadius * Sin(START_DEG)',p+'LetZ ptT = layerZ');
  if(guard)lines.push(p+'If layerNo > 0 Or ringNo > 0 Then',p+'  Move L, @P ptT',p+'End If');else lines.push(p+'Move L, @P ptT');
  lines.push(p+'For quarterNo = 0 To 3',p+'  routeAngle = START_DEG + 90.0 * quarterNo + 45.0',p+'  endAngle = START_DEG + 90.0 * quarterNo + 90.0',p+'  LetX ptR = ringRadius * Cos(routeAngle)',p+'  LetY ptR = ringRadius * Sin(routeAngle)',p+'  LetZ ptR = layerZ',p+'  LetX ptT = ringRadius * Cos(endAngle)',p+'  LetY ptT = ringRadius * Sin(endAngle)',p+'  LetZ ptT = layerZ',p+'  Move C, ptR, @P ptT',p+'Next quarterNo');
 };
 lines.push('  For layerNo = 0 To 58','    layerZ = (layerNo + 1) * LAYER_MM','    For ringNo = 0 To 2');ringBody('      ',true);lines.push('    Next ringNo','  Next layerNo','  layerZ = 12','  For ringNo = 0 To 1');ringBody('    ');lines.push('  Next ringNo');
 const source={schema:'saam-machine-study-source/1',orientation:'euler-xyz',initial:{tcp:initial,anglesDeg:down},moves:[]},commands=[];let from=initial;
 function add(point,angles,phase,layer,{arcLength,route,emit=false,final=false}={}){
  const length=arcLength??Math.hypot(...point.map((v,i)=>v-from[i]));assert.ok(length>1e-8,'Stationary move');
  if(emit)lines.push(`  ptT = ${pose(point,angles)}`,`  Move L, @${final?'E':'P'} ptT`);
  const speed=phase.startsWith('cladding')?8:layer===0?12:20;
  source.moves.push({tcp:point,anglesDeg:angles,seconds:length/speed,volumeMm3:length*.08,phase,layer,operation:phase});from=point;
 }
 for(const [layerIndex,layer] of layers.entries())for(const [ringIndex,ring] of layer.rings.entries()){
  if(layerIndex===59&&ringIndex===2)continue;
  const start=[ring.radius*Math.cos(startDeg*rad),ring.radius*Math.sin(startDeg*rad),layer.z];
  if(Math.hypot(...start.map((v,i)=>v-from[i]))>1e-8){commands.push({kind:'L',to:start});add(start,down,'tube-link',layerIndex);}
  for(let q=0;q<4;q++){
   const a=(startDeg+q*90)*rad,route=[ring.radius*Math.cos(a+Math.PI/4),ring.radius*Math.sin(a+Math.PI/4),layer.z],end=[ring.radius*Math.cos(a+Math.PI/2),ring.radius*Math.sin(a+Math.PI/2),layer.z];commands.push({kind:'C',to:end,route});
   for(let j=1;j<=20;j++){const theta=a+j*Math.PI/40;add([ring.radius*Math.cos(theta),ring.radius*Math.sin(theta),layer.z],down,'tube-ring',layerIndex,{arcLength:ring.radius*Math.PI/40});}
  }
 }
 // Roll while printing the first three quarters of the last top ring, then
 // tilt inward while printing its final quarter. No rotation at a stopped TCP.
 const r=radii[2],top=layers.at(-1).z,start=[r*Math.cos(startDeg*rad),r*Math.sin(startDeg*rad),top];
 lines.push("  ' Last top ring: moving roll alignment, then inward tilt to 45 degrees.");commands.push({kind:'L',to:start});add(start,down,'tube-link',59,{emit:true});
 for(let j=1;j<=80;j++){
  const f=j/80,theta=(startDeg+360*f)*rad,yaw=f<=.75?-90+(startDeg)*f/.75:startDeg-90+(f-.75)*360,tilt=f<=.75?0:(f-.75)*180,point=[r*Math.cos(theta),r*Math.sin(theta),top],angles=[0,tilt,yaw];
  commands.push({kind:'L',to:point,angles});add(point,angles,'tube-orientation-transition',59,{emit:true});
 }
 const topFirst=tracks.map((t,i)=>({...t,start:(i%2===0?[t.start,t.end].sort((a,b)=>b[2]-a[2]):[t.start,t.end].sort((a,b)=>a[2]-b[2]))[0],end:(i%2===0?[t.start,t.end].sort((a,b)=>a[2]-b[2]):[t.start,t.end].sort((a,b)=>b[2]-a[2]))[0]}));
 lines.push("  ' Deposited link to top of first cladding track; alternate down/up.");
 for(const [i,t] of topFirst.entries()){
  const yaw=startDeg+i*360/clad.totalFirstShellTracks,angles=[0,45,yaw];
  for(const [end,point] of [[false,t.start],[true,t.end]]){commands.push({kind:'L',to:point,angles});add(point,angles,i===0&&!end?'tube-to-cladding':end?'cladding-vertical':'cladding-index',60,{emit:true,final:i===topFirst.length-1&&end});}
 }
 lines.push('  GiveArm','End Sub','');
 const pcs=lines.join('\r\n'),manifest={schema:'saam-denso-continuous-pipe/1',file:`SAAM_PIPE_${sector}.pcs`,sha256:createHash('sha256').update(pcs).digest('hex'),sourcePlanSha256:tube.sourcePlanSha256,sectorDeg:sector,tube:{boreMm:16,outerDiameterMm:18.4,heightMm:12,layers:60,radiiMm:radii},claddingTracks:tracks.length,firstPoint:initial,firstAnglesDeg:down,finalPoint:from,motion:'One depositing path; no intermediate travel, dwell, lift, or stationary orientation change',extrusion:'Separate controller; no process commands',orientation:'Fixed explicit downward pose until final top ring; moving roll/tilt transition; cladding inward/down 45 degrees',transition:'Final top ring changes tool orientation; short deposited link to first track at top. 180-degree tracks reversed to start downward.',programArcs:commands.filter(c=>c.kind==='C').length,programLines:commands.filter(c=>c.kind==='L').length,controllerCompilation:'not performed',physicalExecution:'not performed',previewTiming:'Illustrative recipe speeds, not RC8 Speed 50 timing'};
 await mkdir(dir,{recursive:true});for(const [file,data] of [[manifest.file,pcs],['continuous.json',JSON.stringify(manifest,null,2)+'\n'],['motion.json',JSON.stringify(source,null,2)+'\n'],['commands.json',JSON.stringify(commands,null,2)+'\n'],['PacAttri-entry.txt',`test\\${manifest.file},0,-2\r\n`]])await writeFile(resolve(dir,file),data);
 return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [tube,clad,dir]=process.argv.slice(2);console.log(JSON.stringify(await createContinuousPipe(tube,clad,dir)));}
