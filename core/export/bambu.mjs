// Bounded Bambu output (H2D, X1 Carbon), not an interpreter for arbitrary
// Bambu Studio jobs. Firmware service commands are matched to the pinned
// envelope in the machine file, which also owns every model-specific fact.
// The intervening print body is reconstructed by the shared modal interpreter.
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {exportBambuBody} from './bambu-body.mjs';
import {interpretBody} from './bambu-player.mjs';
import {gcodeLines} from './gcode-lines.mjs';
import {packZip,unpackZip,crc32} from './zip.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {validateSetup,toolBounds,startupPosition} from '../machine/profile.mjs';
import {resolveBambuJob} from './bambu-job.mjs';
import {materializeBambuProject,serializeBambuProject} from './bambu-project.mjs';
const digest=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const fmt=(n,d=5)=>Number(n.toFixed(d));
const json=value=>JSON.stringify(value)+'\n';
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const meta=values=>Object.entries(values).map(([k,v])=>`    <metadata key="${k}" value="${xml(v)}"/>`).join('\n');
const BEGIN=';SAAM_BODY_BEGIN\n',END=';SAAM_BODY_END\n',GCODE='Metadata/plate_1.gcode';
// Updated only after reviewing changes to the firmware service contract.
const ENVELOPE_HASHES={
  "h2d-saam-startup-v13": "9ed2f343095f6cf0331ad6359fee1cc637bb7a707f9cea3da538a33fa70779f9",
  "x1c-saam-startup-v5": "1efa6f410cdd5628d11cda4dc8732cf7555921f4e409c9246ea74e1d3911067e"
};
function configuration(plan,machine){
  validateSetup(plan,machine);
  const output=machine.outputs.find(o=>o.id===plan.output),s=plan.setup,k=output?.constraints;
  requireThat(plan.output==='bambu-gcode'&&Object.hasOwn(ENVELOPE_HASHES,output?.program?.contract),'Unsupported Bambu output contract.');
  requireThat(digest(JSON.stringify([output.program.start,output.program.end,output.constraints]))===ENVELOPE_HASHES[output.program.contract],'Unknown Bambu firmware envelope; an interpreter update is required.');
  requireThat(s.material===k.material&&k.nozzleMm.includes(s.nozzleMm)&&s.filamentMm===k.filamentMm&&s.buildVolumeC===k.chamberC,
    `${machine.name} output requires a declared ${k.nozzleMm.join(', ')} mm ${k.material} setup, ${k.filamentMm} mm filament and no chamber heating.`);
  // An envelope sliced on one side of a bed-temperature branch covers only that side.
  if(k.bedC)requireThat(s.bedC>=k.bedC[0]&&s.bedC<=k.bedC[1],`${machine.name} output requires a bed temperature of ${k.bedC[0]}–${k.bedC[1]} C.`);
  // The pinned startup ends by moving to the body's declared origin.
  const [x,y,z]=startupPosition(machine,plan),extruders=machine.tools.map(t=>t.physicalExtruder);
  requireThat(extruders.every(Number.isInteger)&&new Set(extruders).size===extruders.length
    &&output.program.start.slice(-3).join('\n')===`G1 Z${z} F300\nG1 X${x} Y${y} F3600\nM400`,'Bambu tool/startup contract mismatch.');
  return output;
}
function contextFor(path,plan,machine,release){
  const moves=path.actions.filter(a=>a.kind==='move'),points=[path.initialPosition,...moves.map(m=>m.to)];
  const deposits=moves.filter(m=>m.volumeMm3>0);requireThat(deposits.length,'Bambu output needs deposition.');
  const bounds=path.summary?.boundsMm;
  const layers=new Set(deposits.map(m=>`${m.phase}:${m.layer}`));
  const context={schema:'saam-bambu-artifact/1',contract:machine.outputs.find(o=>o.id===plan.output).program.contract,release,bounds,initialPosition:path.initialPosition,
    pathMaxZ:points.reduce((maximum,p)=>Math.max(maximum,p[2]),-Infinity),layers:layers.size};
  checkContext(context,plan,machine);return context;
}
function checkContext(c,plan,machine){
  const b=plan.composition.regions.some(r=>r.filament!==undefined)?machine.bounds:toolBounds(machine,plan.setup.tool),output=machine.outputs.find(o=>o.id===plan.output),k=output.constraints;
  requireThat(c?.schema==='saam-bambu-artifact/1'&&c.contract===output.program.contract&&JSON.stringify(c.initialPosition)===JSON.stringify(startupPosition(machine,plan)),'Invalid Bambu artifact context.');
  requireThat(c.bounds&&['min','max'].every(side=>Array.isArray(c.bounds[side])&&c.bounds[side].length===3&&c.bounds[side].every(Number.isFinite)),'Missing Bambu geometry bounds.');
  requireThat(c.bounds.min.every((v,i)=>v>=b.min[i]&&v<c.bounds.max[i])&&c.bounds.max.every((v,i)=>v<=b.max[i]),'Bambu geometry bounds exceed selected nozzle area.');
  // Actual travel may stay below unprinted geometry. Shutdown still uses the
  // fixed firmware contract's geometry bound independently of print-body Z.
  requireThat(Number.isFinite(c.pathMaxZ)&&c.pathMaxZ>=c.initialPosition[2]&&c.pathMaxZ<=b.max[2]&&Math.max(c.pathMaxZ,c.bounds.max[2]+k.endLiftMm)<=Math.min(k.parkLimitMm,b.max[2]),'Bambu shutdown clearance exceeds machine bounds.');
  // A shape check on the recorded count, not a ceiling: the layer total follows
  // the part and its layer height, both already bounded by the machine.
  requireThat(Number.isInteger(c.layers)&&c.layers>0,'Invalid Bambu layer count.');
  requireThat(c.release&&/^[a-zA-Z0-9.+-]{1,40}$/.test(c.release.generatorVersion)&&/^\d{4}-\d{2}-\d{2}$/.test(c.release.buildDate),'Invalid Bambu release metadata.');
}
function sections(c,job,output){
  // Shutdown lifts clear of the part, parks higher, then may settle back; it
  // never descends below the completed path.
  const k=output.constraints,endClearanceZ=fmt(Math.max(c.pathMaxZ,c.bounds.max[2]+k.endLiftMm));
  const parkZ=fmt(Math.max(endClearanceZ,Math.min(k.parkLimitMm,k.parkRiseMm+k.parkHeightFactor*c.bounds.max[2])));
  const values={...job.values,
    minX:fmt(c.bounds.min[0]),minY:fmt(c.bounds.min[1]),sizeX:fmt(c.bounds.max[0]-c.bounds.min[0]),sizeY:fmt(c.bounds.max[1]-c.bounds.min[1]),
    endClearanceZ,parkZ,parkSettleZ:fmt(Math.max(endClearanceZ,parkZ-k.parkSettleMm))};
  const render=lines=>lines.flatMap(line=>{
    if(typeof line==='object'){
      requireThat(Object.keys(line).length===1&&Array.isArray(line.fullStartOnly),'Invalid optional Bambu startup block.');
      return job.fastStart?[]:line.fullStartOnly;
    }
    return [line];
  }).flatMap(line=>{
    if(line==='{startupFlags}')return values.startupFlags;
    if(line==='{plateDetection}')return [values.plateDetection];
    return line.replace(/\{([A-Za-z]+)\}/g,(_,key)=>{
      requireThat(Number.isFinite(values[key]),'Unknown Bambu template value.');return values[key];
    });
  }).join('\n')+'\n';
  return {start:render(output.program.start),end:render(output.program.end),endClearanceZ};
}
function header(c,program,job){
  const usage=program.filamentUsage.slice().sort((a,b)=>a.filament-b.filament);
  const area=Math.PI*(job.filamentMm/2)**2;
  const perUsed=fn=>usage.map(fn).join(',');
  return ['; HEADER_BLOCK_START',`; generated by SAAM ${c.release.generatorVersion}`,`; build date: ${c.release.buildDate}`,
    `; total layer number: ${c.layers}`,`; total filament length [mm] : ${perUsed(u=>fmt(u.volumeMm3/area,2))}`,
    `; total filament volume [cm^3] : ${perUsed(u=>fmt(u.volumeMm3/1000,4))}`,
    `; total filament weight [g] : ${perUsed(u=>fmt(u.volumeMm3/1000*job.density,3))}`,`; max_z_height: ${fmt(c.bounds.max[2])}`,
    `; filament_density: ${perUsed(()=>job.density)}`,`; filament_diameter: ${perUsed(()=>job.filamentMm)}`,
    `; filament: ${perUsed(u=>u.filament+1)}`,'; HEADER_BLOCK_END','',
    ...configBlock(job.settings),'','; EXECUTABLE_BLOCK_START'].join('\n')+'\n';
}

// Separators are per key, read from a Bambu Studio H2D program rather than
// assumed: most lists are comma separated, these few are semicolon separated,
// and filament_settings_id is additionally quoted because its values contain
// both separators.
const QUOTED_KEYS=new Set(['filament_settings_id','filament_extruder_variant','print_extruder_variant','printer_extruder_variant']);
const SEMICOLON_KEYS=new Set(['filament_colour','filament_ids','filament_type','extruder_ams_count',...QUOTED_KEYS]);
function configBlock(settings){
  const render=(key,value)=>{
    if(!Array.isArray(value))return String(value);
    const parts=QUOTED_KEYS.has(key)?value.map(v=>'"'+v+'"'):value.map(String);
    return parts.join(SEMICOLON_KEYS.has(key)?';':',');
  };
  return ['; CONFIG_BLOCK_START',...Object.entries(settings).filter(([,value])=>value!==null&&value!==undefined)
    .map(([key,value])=>'; '+key+' = '+render(key,value)),'; CONFIG_BLOCK_END'];
}

export function exportBambu(path,plan,machine,release){
  return exportAndInterpretBambu(path,plan,machine,release).bytes;
}

// The body must be interpreted to populate package totals and thumbnails. Keep
// that result with the exact bytes assembled from it instead of parsing the
// same million-command body again immediately after packaging. Imported bytes
// still enter through interpretBambu and its archive integrity checks.
export function exportAndInterpretBambu(path,plan,machine,release){
  const output=configuration(plan,machine);
  const filamentSequence=[plan.setup.bambu?.filament,...path.actions.filter(a=>a.kind==='toolChange').map(a=>a.filament)];
  const job=resolveBambuJob(plan,machine,output,{filamentSequence});
  const body=exportBambuBody(path,plan,machine);
  const program=interpretBody(body,plan,machine);
  requireThat(JSON.stringify(program.filamentSequence)===JSON.stringify(filamentSequence),'Bambu interpreted filament order differs from startup calibration.');
  const c=contextFor(path,plan,machine,release),s=sections(c,job,output);
  const code=header(c,program,job)+s.start+BEGIN+body+END+s.end+'; EXECUTABLE_BLOCK_END\n';
  const bytes=packZip(packageEntries(code,c,program,plan,output,job,s));
  return {bytes,program:completeProgram(program,code,c,s,job)};
}
export function interpretBambu(bytes,plan,machine){
  const output=configuration(plan,machine),entries=unpackZip(bytes);
  const c=JSON.parse(entries.get('Metadata/saam.json')?.toString()??'null');checkContext(c,plan,machine);
  const code=entries.get(GCODE)?.toString('utf8');requireThat(typeof code==='string','Missing Bambu G-code.');
  const begin=code.indexOf(BEGIN),end=code.indexOf(END);
  requireThat(begin>=0&&end>begin&&code.indexOf(BEGIN,begin+BEGIN.length)===-1&&code.indexOf(END,end+END.length)===-1,'Invalid Bambu body boundary.');
  const body=code.slice(begin+BEGIN.length,end),program=interpretBody(body,plan,machine);
  const job=resolveBambuJob(plan,machine,output,{filamentSequence:program.filamentSequence}),s=sections(c,job,output);
  requireThat(code===header(c,program,job)+s.start+BEGIN+body+END+s.end+'; EXECUTABLE_BLOCK_END\n','Bambu program differs from its declared firmware envelope.');
  const expected=packageEntries(code,c,program,plan,output,job,s);
  requireThat(entries.size===expected.size&&[...expected].every(([name,value])=>entries.get(name)?.equals(Buffer.from(value))),'Bambu package metadata, checksum or thumbnail differs from the program.');
  return completeProgram(program,code,c,s,job);
}

function completeProgram(program,code,c,s,job){
  const begin=code.indexOf(BEGIN);
  requireThat(program.moves.every(m=>m.to[2]<=c.pathMaxZ+1e-5),'Bambu body exceeds declared shutdown clearance.');
  let prefixLines=-1;for(const _line of gcodeLines(code.slice(0,begin+BEGIN.length)))prefixLines++;
  const notice='Firmware probing, wiping, calibration, purge, tool changes and unload follow bounded service recipes; they are not simulated. Playback and timing cover body motion only.';
  const tray=job.requestedTray;
  const mapping=tray?`Requested AMS ${tray.unit}, slot ${tray.slot}: confirm the printer maps this job's filament to that tray before starting.`:
    'Material and colour are supplied for automatic matching; review the printer’s proposed feed mapping before starting.';
  const materialChangeCount=program.filamentSequence.slice(1).filter((id,i)=>job.selections[id].setup.tool===job.selections[program.filamentSequence[i]].setup.tool).length;
  const materialChanges=job.materialChange&&materialChangeCount?{...job.materialChange,count:materialChangeCount}:null;
  const envelope={contract:c.contract,simulation:'not simulated',initialPosition:c.initialPosition,endClearanceZ:s.endClearanceZ,notice,
    job:{tool:job.tool,fast_start:job.fastStart,nozzleMm:job.nozzle,nozzleDiametersMm:job.nozzles.map(Number),plate:job.plate.name,
      logicalFilament:job.used,filamentColor:job.color,requestedTray:tray,amsConnections:job.amsConnections,
      filamentUsage:program.filamentUsage,filamentSequence:program.filamentSequence,
      feeds:job.filaments.map((f,i)=>({filament:i,tool:job.selections[i].setup.tool,material:job.material,colour:f.colour,source:f.source??(job.selections[i].setup.ams?{type:'ams',...job.selections[i].setup.ams}:{type:'auto'})})),
      ...(materialChanges?{materialChanges}:{})}};
  const startup=(job.fastStart?'Fast startup: optional calibration, scans and vibration tests skipped. Homing, temperature waits, loading, wiping and priming remain. ':'')+notice+' '+mapping
    +(materialChanges?` Each same-nozzle AMS change requests ${job.materialChange.flushMm3} mm³ of chute flushing${job.nozzles.length===1?' plus 2 mm of filament for priming':''}; firmware loading/priming and service material/time are additional to the part totals.`:'');
  return {...program,
    moves:program.moves.map(move=>({...move,line:move.line+prefixLines})),
    events:program.events.map(event=>({...event,line:event.line+prefixLines})),
    summary:{...program.summary,startup,clearance:'Deposited-height travel checked; physical head clearance is not modeled.'},
    code,envelope};
}

function packageEntries(code,c,program,plan,output,job,s){
  const {tool,map,nozzle,nozzles,color,used,count:declared,declaredMaps,limitMaps:usedFlags,settings,toolZeros}=job;
  const usedTray=job.filaments[used],volume=program.volumeMm3,filament=program.summary.filamentMm,weight=volume/1000*job.density;
  const usage=program.filamentUsage.slice().sort((a,b)=>a.filament-b.filament),area=Math.PI*(job.filamentMm/2)**2;
  const usedNozzles=[...new Set(usage.map(u=>u.tool))].sort();
  const layerUse=new Map();
  for(const move of program.moves)if(move.extruding){const key=`${move.phase}:${move.layer}`;if(!layerUse.has(key))layerUse.set(key,new Set());layerUse.get(key).add(move.filament??used);}
  const filamentXml=usage.map(u=>`    <filament id="${u.filament+1}" tray_info_idx="${xml(job.filaments[u.filament].id)}" type="${xml(job.material)}" color="${xml(job.filaments[u.filament].colour)}" used_m="${fmt(u.volumeMm3/area/1000,4)}" used_g="${fmt(u.volumeMm3/1000*job.density,3)}" group_id="${u.tool}" nozzle_diameter="${Number(nozzles[u.tool]).toFixed(2)}" volume_type="${job.volumeType}" used_for_object="true" used_for_support="false" total_load_time="26.00" total_unload_time="0.00"/>`).join('\n');
  const nozzleXml=usedNozzles.map(t=>`    <nozzle id="${t}" extruder_id="${t+1}" nozzle_diameter="${nozzles[t]}" volume_type="${job.volumeType}"/>`).join('\n');
  const layerXml=program.filamentSequence.length===1?`      <layer_filament_list filament_list="${used}" layer_ranges="0 ${c.layers-1}" />`:
    [...layerUse.values()].map((ids,i)=>`      <layer_filament_list filament_list="${[...ids].sort().join(' ')}" layer_ranges="${i} ${i}" />`).join('\n');
  const seconds=Math.ceil(program.seconds),bbox=[c.bounds.min[0],c.bounds.min[1],c.bounds.max[0],c.bounds.max[1]];
  const plate={bbox_all:bbox,bbox_objects:[{area:(bbox[2]-bbox[0])*(bbox[3]-bbox[1]),bbox,id:1,layer_height:plan.process.layerMm,name:'SAAM part'}],
    bed_type:job.plate.id,filament_colors:usage.map(u=>job.filaments[u.filament].colour),filament_ids:usage.map(u=>u.filament),first_extruder:used,first_layer_time:0,is_seq_print:false,nozzle_diameter:nozzle,version:2};
  const entries=new Map([
    [GCODE,code],[GCODE+'.md5',digest(code,'md5')],['Metadata/saam.json',json(c)],['Metadata/saam-job.json',json({schema:'saam-bambu-job/1',tool,nozzles,plate:job.plate.id,fast_start:job.fastStart,logicalFilament:used,filaments:job.filaments,requestedTray:job.requestedTray,amsConnections:job.amsConnections,amsMapping:'Confirm logical filament to physical tray mapping on the printer before starting.'})],
    ['Metadata/plate_1.json',json(plate)],
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="gcode" ContentType="text/x.gcode"/></Types>\n'],
    ['3D/3dmodel.model',`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"><metadata name="Application">SAAM-${xml(c.release.generatorVersion)}</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><resources/><build/></model>\n`],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/><Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/><Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/><Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/></Relationships>\n'],
    ['Metadata/_rels/model_settings.config.rels','<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/Metadata/plate_1.gcode" Id="rel-1" Type="http://schemas.bambulab.com/package/2021/gcode"/></Relationships>\n'],
    ['Metadata/model_settings.config',`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <plate>\n${meta({plater_id:1,plater_name:'SAAM',locked:false,filament_map_mode:settings.filament_map_mode,filament_maps:declaredMaps,filament_volume_maps:Array.from({length:declared},()=>0).join(' '),gcode_file:GCODE,thumbnail_file:'Metadata/plate_1.png',thumbnail_no_light_file:'Metadata/plate_no_light_1.png',top_file:'Metadata/top_1.png',pick_file:'Metadata/pick_1.png',pattern_bbox_file:'Metadata/plate_1.json'})}\n  </plate>\n</config>\n`],
    ['Metadata/slice_info.config',`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="${xml(output.package.clientVersion)}"/>\n  </header>\n  <plate>\n${meta({index:1,extruder_type:toolZeros,nozzle_volume_type:toolZeros,printer_model_id:output.package.printerModelId,nozzle_diameters:nozzles.join(','),timelapse_type:0,prediction:seconds,weight:fmt(weight,3),pause_count:0,first_layer_time:0,outside:false,support_used:false,label_object_enabled:false,support_material_on_wipe_tower:false,enable_filament_dynamic_map:false,has_filament_switcher:false,filament_maps:declaredMaps,limit_filament_maps:usedFlags})}\n    <object identify_id="1" name="SAAM part" skipped="false" />\n${filamentXml}\n${nozzleXml}\n    <layer_filament_lists>\n${layerXml}\n    </layer_filament_lists>\n  </plate>\n</config>\n`],
    ['Metadata/filament_sequence.json',json({plate_1:{nozzle_sequence:program.filamentSequence.map(i=>Number(settings.filament_map[i])-1),sequence:program.filamentSequence.map(i=>i+1)}})],
    ['Metadata/project_settings.config',output.package.projectSchema?serializeBambuProject(materializeBambuProject(job.projectSettings,s)):json(job.projectSettings)]
  ]);
  const thumbnails=new Map();
  for(const [name,size] of [['plate_1',256],['plate_1_small',128],['plate_no_light_1',256],['top_1',256],['pick_1',256]]){
    if(!thumbnails.has(size))thumbnails.set(size,thumbnail(program.moves,c.bounds,size));
    entries.set(`Metadata/${name}.png`,thumbnails.get(size));
  }
  return entries;
}

// Fresh toolpath thumbnail from the interpreted output, never the user's
// reference object's thumbnail. This is a schematic top view, not geometry.
function thumbnail(moves,bounds,size){
  const pixels=Buffer.alloc(size*size*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=24;pixels[i+1]=30;pixels[i+2]=35;pixels[i+3]=255;}
  const span=Math.max(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1]),scale=(size-20)/span;
  const project=p=>[Math.round(10+(p[0]-bounds.min[0])*scale),Math.round(size-11-(p[1]-bounds.min[1])*scale)];
  for(const m of moves){if(!m.extruding)continue;const a=project(m.from),b=project(m.to),n=Math.max(1,Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]));for(let j=0;j<=n;j++){
    const x=Math.round(a[0]+(b[0]-a[0])*j/n),y=Math.round(a[1]+(b[1]-a[1])*j/n);if(x<0||y<0||x>=size||y>=size)continue;
    const k=(y*size+x)*4;pixels[k]=40;pixels[k+1]=160;pixels[k+2]=144;
  }}
  const raw=Buffer.alloc(size*(1+size*4));for(let y=0;y<size;y++)pixels.copy(raw,y*(1+size*4)+1,y*size*4,(y+1)*size*4);
  const chunk=(name,data)=>{const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,crc]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
