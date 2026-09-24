import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PIPE_CLADDING_DEFAULTS,pipeCladdingResult} from '../../skills/pipe-cladding/scripts/clad.mjs';
import {validatePose} from '../../core/path/pose.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const number=value=>{if(!Number.isFinite(value))throw Error('Nonfinite coordinate');return String(Number(value.toFixed(8)));};
const angleDelta=(a,b)=>((a-b+540)%360)-180;
const near=(a,b)=>Math.abs(a-b)<1e-8;

// A bounded development artifact, separate from the production/rotary exporter.
// Select existing source strokes; no substrate, new shells, rotary or process IO.
export function claddingSector(plan,{frontDeg=-90,sectorDeg=72}={}){
  if(plan.geometry?.shape!=='pipe'||!plan.skills?.['pipe-cladding']?.enabled)throw Error('Requires the saved circular-pipe cladding recipe');
  if(!Number.isFinite(frontDeg)||!Number.isFinite(sectorDeg)||sectorDeg<=0||sectorDeg>360)throw Error('Dry-run sector must be in (0,360] degrees');
  const settings={...PIPE_CLADDING_DEFAULTS,...plan.skills['pipe-cladding']};
  if(settings.pattern!=='axial-hoop'||settings.surface||settings.part!==null)throw Error('Only circular axial/hoop cladding is supported');
  for(const v of [plan.geometry.heightMm,plan.geometry.outerRadiusMm,plan.geometry.innerRadiusMm,settings.normalMm,settings.sampleStepMm,settings.toleranceMm,plan.process.lineWidthMm])if(!Number.isFinite(v)||v<=0)throw Error('Invalid pipe dimensions or spacing');
  if(!Number.isInteger(settings.shells)||settings.shells<1||settings.tiltDeg<=0||settings.tiltDeg>=90)throw Error('Invalid shell count or nozzle tilt');
  if(plan.geometry.outerRadiusMm-settings.shells*settings.normalMm<=plan.geometry.innerRadiusMm)throw Error('No substrate remains');
  // Only the requested origin changes; source recipe geometry and track lattice stay intact.
  const atOrigin={...plan,placement:{xMm:0,yMm:0},skills:{...plan.skills,'pipe-cladding':settings}};
  const first=pipeCladdingResult({plan:atOrigin}).operations[0];
  if(first.phase!=='cladding-axial')throw Error('First shell is not vertical cladding');
  const candidates=first.strokes.map((stroke,index)=>({index,stroke,angle:Math.atan2(stroke.points[0][1],stroke.points[0][0])*180/Math.PI}));
  const startAngle=sectorDeg===360?frontDeg:frontDeg-sectorDeg/2;
  const selected=candidates.filter(item=>Math.abs(angleDelta(item.angle,frontDeg))<=sectorDeg/2+1e-9)
    .sort((a,b)=>((a.angle-startAngle+720)%360)-((b.angle-startAngle+720)%360));
  if(selected.length<2)throw Error('Sector contains fewer than two tracks');
  // Preserve cyclic source order and alternating track directions across its seam.
  if(selected.some((item,i)=>i&&item.index!==(selected[i-1].index+1)%first.strokes.length))throw Error('Noncontiguous source sector');
  const tracks=selected.map(({index,stroke,angle})=>{
    const start=stroke.points[0],end=stroke.points.at(-1),pose=validatePose(stroke.poses[0]);
    for(let i=0;i<stroke.points.length;i++){
      const p=stroke.points[i],q=stroke.poses[i];
      if(!near(p[0],start[0])||!near(p[1],start[1])||p[2]<Math.min(start[2],end[2])-1e-8||p[2]>Math.max(start[2],end[2])+1e-8)throw Error('Cannot collapse a nonvertical track');
      if(!q.toolAxis.every((v,j)=>near(v,pose.toolAxis[j]))||!q.toolUp.every((v,j)=>near(v,pose.toolUp[j])))throw Error('Cannot collapse a changing-posture track');
    }
    return {sourceTrackIndex:index,angleDeg:angle,start,end,toolAxis:pose.toolAxis,toolUp:pose.toolUp,sourceSamples:stroke.points.length};
  });
  return {tracks,totalTracks:first.strokes.length,settings,geometry:plan.geometry,frontDeg,sectorDeg};
}

export function emitCladdingDryRun(sector,{name='SAAM_CLAD_FRONT',tool=6,work=2,figurePoint=10,speedPercent=50,accelPercent=100}={}){
  if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))throw Error('Invalid PacScript program name');
  for(const [label,v,max] of [['tool',tool,63],['work',work,7],['figurePoint',figurePoint,65535],['speedPercent',speedPercent,100],['accelPercent',accelPercent,100]])if(!Number.isInteger(v)||v<1||v>max)throw Error('Invalid '+label);
  const first=sector.tracks[0],radius=Math.hypot(...first.start.slice(0,2));
  const approach=[first.start[0]*(radius+10)/radius,first.start[1]*(radius+10)/radius,sector.geometry.heightMm+20];
  const lines=["' !TITLE \""+name+"\"","' MOTION-ONLY: stationary part, no extrusion or external-axis commands.","' W2 origin = pipe centre at base; +Z up; front is -Y.","' P10 must be taught with T6/W2 active; FIG is inherited, path posture is generated.","' Verify the initial approach and elevated tilt in Teach Check before descending.","' All track ends stop; this is not the blended production program.","#define SPD_MOVE "+speedPercent,"#define ACC_PCT "+accelPercent,'','Sub Main','  Dim ptT As Position','  TakeArm Keep = 0','  Tool '+tool+', P(155, 0, 35, 0, 90, 0)','  ChangeTool '+tool,'  ChangeWork '+work,'  Speed SPD_MOVE','  Accel ACC_PCT, ACC_PCT','  ptT = P'+figurePoint];
  ['X','Y','Z'].forEach((axis,i)=>lines.push('  Let'+axis+' ptT = '+number(approach[i])));
  lines.push('  Move P, @E ptT','  Delay 300');
  const moves=[];
  const emit=(point,track,phase)=>{
    const values=[...point,...track.toolUp,...track.toolAxis].map(number).join(', ');
    lines.push("  ' "+phase+' source track '+track.sourceTrackIndex,'  ptT = T2P(T('+values+', Fig(P'+figurePoint+')))','  Move L, @E ptT');
    moves.push({point:[...point],toolUp:[...track.toolUp],toolAxis:[...track.toolAxis],phase,sourceTrackIndex:track.sourceTrackIndex});
  };
  emit(approach,first,'elevated-tilt');
  lines.push('  Delay 300');
  emit(first.start,first,'approach-to-first-track');
  for(const [i,track] of sector.tracks.entries()){
    if(i)emit(track.start,track,'index');
    emit(track.end,track,'vertical');
  }
  lines.push("  ' End of selected first-shell sector. Hold here; no other shell or return move.",'  Delay 300','  GiveArm','End Sub','');
  const pcs=lines.join('\r\n');
  if(/[^\x00-\x7f]/.test(pcs))throw Error('PacScript must be ASCII');
  return {name,pcs,approach,moves,tool,work,figurePoint,speedPercent,accelPercent};
}

export async function createCladdingDryRun(sourcePlan,directory,{sectorDeg=72}={}){
  const input=resolve(sourcePlan),dir=resolve(directory);
  // Refuse to overwrite any existing print or previous candidate.
  try{await stat(dir);throw Error('Choose a new output directory');}catch(error){if(error.code!=='ENOENT')throw error;}
  const bytes=await readFile(input),plan=JSON.parse(bytes),sector=claddingSector(plan,{sectorDeg}),output=emitCladdingDryRun(sector,{name:sectorDeg===72?'SAAM_CLAD_FRONT':'SAAM_CLAD_'+number(sectorDeg).replace('.','_')});
  const manifest={schema:'saam-denso-cladding-dry-run/1',sourcePlan:input,sourcePlanSha256:digest(bytes),machine:'denso-vs068a4-rc8',
    status:'offline candidate; not controller compiled or physically run',rotary:'fixed; no commands',extrusion:'none; no IO commands',
    coordinateFrame:'Work 2: pipe centre at origin, base Z0, axis +Z, front -Y',toolDefinition:[155,0,35,0,90,0],
    figure:'runtime Fig(P10); P10 taught with Tool 6 / Work 2',posture:'generated 45-degree inward/downward axis; P10 orientation used only for initial approach',
    frontDeg:sector.frontDeg,requestedSectorDeg:sector.sectorDeg,totalFirstShellTracks:sector.totalTracks,selectedTracks:sector.tracks.length,
    selectedTrackFraction:sector.tracks.length/sector.totalTracks,sourceTrackIndices:sector.tracks.map(t=>t.sourceTrackIndex),
    angularEndpointsDeg:[sector.tracks[0].angleDeg,sector.tracks.at(-1).angleDeg],pathRadiusMm:Math.hypot(...sector.tracks[0].start.slice(0,2)),
    heightMm:sector.geometry.heightMm,tiltDeg:sector.settings.tiltDeg,approachMm:output.approach,
    speedPercent:output.speedPercent,accelPercent:output.accelPercent,end:'stopped at last track endpoint; no return or retreat',
    file:output.name+'.pcs',sha256:digest(output.pcs),moveLCount:output.moves.length};
  await mkdir(dir,{recursive:true});
  for(const [file,value] of [[output.name+'.pcs',output.pcs],['source-plan.json',bytes],['demo.json',JSON.stringify(manifest,null,2)+'\n'],['tracks.json',JSON.stringify(sector.tracks,null,2)+'\n'],['motion.json',JSON.stringify(output.moves,null,2)+'\n'],['PacAttri-entry.txt','test\\'+output.name+'.pcs,0,-2\r\n']])await writeFile(join(dir,file),value);
  return {directory:dir,...manifest};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [sourcePlan,directory,sectorArgument='72']=process.argv.slice(2);
  if(!sourcePlan||!directory)throw Error('Usage: node tools/denso/create-cladding-dry-run.mjs <source-plan.json> <new-directory> [sector-degrees]');
  console.log(JSON.stringify(await createCladdingDryRun(sourcePlan,directory,{sectorDeg:Number(sectorArgument)}),null,2));
}
