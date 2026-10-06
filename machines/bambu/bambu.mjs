// Bounded Bambu output (H2D, X1 Carbon). Firmware service commands come from
// the pinned envelope in the machine file, which also owns every model-specific fact.
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {exportBambuBody} from './bambu-body.mjs';
import {requireThat,startupPosition,feederSelector,validateBambuConnections} from './filaments.mjs';
import {resolveBambuJob} from './bambu-job.mjs';
import {materializeBambuProject,serializeBambuProject} from './bambu-project.mjs';
const digest=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const fmt=(n,d)=>Number(n.toFixed(d));
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
  const output=machine.outputs.find(o=>o.id===plan.output),k=output.constraints;
  requireThat(c?.schema==='saam-bambu-artifact/1'&&c.contract===output.program.contract&&JSON.stringify(c.initialPosition)===JSON.stringify(startupPosition(machine,plan)),'Invalid Bambu artifact context.');
  requireThat(c.bounds&&['min','max'].every(side=>Array.isArray(c.bounds[side])&&c.bounds[side].length===3&&c.bounds[side].every(Number.isFinite))
    &&c.bounds.min.every((v,i)=>v<c.bounds.max[i]),'Missing Bambu geometry bounds.');
  // Actual travel may stay below unprinted geometry. Shutdown still uses the
  // fixed firmware contract's geometry bound independently of print-body Z.
  requireThat(Number.isFinite(c.pathMaxZ)&&c.pathMaxZ>=c.initialPosition[2]&&Math.max(c.pathMaxZ,c.bounds.max[2]+k.endLiftMm)<=k.parkLimitMm,'Bambu shutdown clearance exceeds the park limit.');
  // A shape check on the recorded count, not a ceiling.
  requireThat(Number.isInteger(c.layers)&&c.layers>0,'Invalid Bambu layer count.');
  requireThat(c.release&&/^[a-zA-Z0-9.+-]{1,40}$/.test(c.release.generatorVersion)&&/^\d{4}-\d{2}-\d{2}$/.test(c.release.buildDate),'Invalid Bambu release metadata.');
}
function sections(c,job,output,number){
  // Shutdown lifts clear of the part, parks higher, then may settle back; it
  // never descends below the completed path.
  const k=output.constraints,endClearanceZ=number(Math.max(c.pathMaxZ,c.bounds.max[2]+k.endLiftMm));
  const parkZ=number(Math.max(endClearanceZ,Math.min(k.parkLimitMm,k.parkRiseMm+k.parkHeightFactor*c.bounds.max[2])));
  const values={...job.values,
    minX:number(c.bounds.min[0]),minY:number(c.bounds.min[1]),sizeX:number(c.bounds.max[0]-c.bounds.min[0]),sizeY:number(c.bounds.max[1]-c.bounds.min[1]),
    endClearanceZ,parkZ,parkSettleZ:number(Math.max(endClearanceZ,parkZ-k.parkSettleMm))};
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
function header(c,program,job,number){
  const usage=program.filamentUsage.slice().sort((a,b)=>a.filament-b.filament);
  const area=Math.PI*(job.filamentMm/2)**2;
  const perUsed=fn=>usage.map(fn).join(',');
  return ['; HEADER_BLOCK_START',`; generated by SAAM ${c.release.generatorVersion}`,`; build date: ${c.release.buildDate}`,
    `; total layer number: ${c.layers}`,`; total filament length [mm] : ${perUsed(u=>fmt(u.volumeMm3/area,2))}`,
    `; total filament volume [cm^3] : ${perUsed(u=>fmt(u.volumeMm3/1000,4))}`,
    `; total filament weight [g] : ${perUsed(u=>fmt(u.volumeMm3/1000*job.density,3))}`,`; max_z_height: ${number(c.bounds.max[2])}`,
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

// The Bambu adapter: setup.bambu holds the installation (plate, other nozzle,
// AMS connections, startup controls); logical filaments are neutral setup.
export function createAdapter(Export){
  return {output:'bambu-gcode',poses:false,
    settings:{key:'bambu',validate(plan){
      feederSelector(plan,plan.machine);validateBambuConnections(plan.setup.bambu.amsConnections??null,plan.machine);
    },rows},
    export:(prepared,settings)=>exportBambu(prepared,settings,settings.machine,settings.release,Export)};
}
// Studio settings rows: startup, the colour-change purge and each declared material's nozzle and feed.
function rows({machine,setup,process,output}){
  const result=[['Bambu startup',setup.bambu.fast_start?'Fast — reuse calibration; skip optional scans and vibration tests':'Full — calibration follows startup controls / printer choices']];
  const declared=[...new Set([setup.filament,...(setup.filaments??[]).keys()])].filter(i=>i!==undefined&&i!==null);
  const change=machine.outputs.find(o=>o.id===output)?.constraints;
  if(declared.length>1&&change?.materialChangeMode==='single-nozzle-ams')result.push(['AMS colour changes',`${change.materialChangeFlushMm3} mm³ purged into the rear chute per change, plus priming. No tower; service time/material are additional to part totals.`]);
  for(const id of declared){
    const entry=setup.filaments?.[id],tool=entry?.tool??setup.tool;
    const nozzleMm=tool===setup.tool?setup.nozzleMm:setup.bambu.otherNozzleMm;
    const p={...process,...entry?.process};
    const ams=entry?.source?.type==='ams'?{unit:entry.source.unit,slot:entry.source.slot}:
      entry?.source?.type==='external'?null:id===setup.filament?setup.ams:null;
    const source=entry?.source?.type==='external'?'External spool':entry?.source?.type==='ams-ht'?`Requested AMS HT ${entry.source.unit}`:ams?`Requested AMS ${ams.unit}, slot ${ams.slot}`:'Automatic material/colour matching';
    result.push([`Filament ${id+1}`,`${machine.tools.find(t=>t.index===tool)?.label??`Tool ${tool}`} · ${nozzleMm} mm nozzle · ${setup.material} ${entry?.colour??setup.filamentColor??''} · ${entry?.nozzleC??setup.nozzleC}°C · ${source}`],
      [`Filament ${id+1} · Process`,`${p.lineWidthMm} mm bead · ${p.layerMm} mm layers`]);
  }
  return result;
}
// Package totals, layer lists and thumbnails come from what the body writer
// wrote; the body is never read back.
function exportBambu(path,plan,machine,release,Export){
  const output=configuration(plan,machine);
  const filamentSequence=[plan.setup.filament,...path.actions.filter(a=>a.kind==='toolChange').map(a=>a.filament)];
  const job=resolveBambuJob(plan,machine,output,{filamentSequence});
  const {body,segments}=exportBambuBody(path,plan,machine,Export);
  const usage=new Map(),layerUse=new Map();let volumeMm3=0,seconds=0;
  for(const {filament,tool,tally} of segments){
    volumeMm3+=tally.volumeMm3;seconds+=tally.seconds;
    usage.set(filament,{filament,tool,volumeMm3:(usage.get(filament)?.volumeMm3??0)+tally.volumeMm3});
    for(const key of tally.layers){if(!layerUse.has(key))layerUse.set(key,new Set());layerUse.get(key).add(filament);}
  }
  const written={filamentSequence,filamentUsage:[...usage.values()].filter(u=>u.volumeMm3>0),volumeMm3,seconds,layerUse,
    strokes:segments.flatMap(segment=>segment.tally.strokes)};
  const c=contextFor(path,plan,machine,release),s=sections(c,job,output,Export.number);
  const code=header(c,written,job,Export.number)+s.start+BEGIN+body+END+s.end+'; EXECUTABLE_BLOCK_END\n';
  return {bytes:Export.packZip(packageEntries(code,c,written,plan,output,job,s,Export.crc32)),report:report(written,c,s,job)};
}
// What the person confirms beyond the drawn path: firmware service, feed mapping, estimates.
function report(written,c,s,job){
  const notice='Firmware probing, wiping, calibration, purge, tool changes and unload follow bounded service recipes; they are not simulated. Playback and timing cover body motion only.';
  const tray=job.requestedTray;
  const mapping=tray?`Requested AMS ${tray.unit}, slot ${tray.slot}: confirm the printer maps this job's filament to that tray before starting.`:
    'Material and colour are supplied for automatic matching; review the printer’s proposed feed mapping before starting.';
  const materialChangeCount=written.filamentSequence.slice(1).filter((id,i)=>job.selections[id].setup.tool===job.selections[written.filamentSequence[i]].setup.tool).length;
  const materialChanges=job.materialChange&&materialChangeCount?{...job.materialChange,count:materialChangeCount}:null;
  const envelope={contract:c.contract,simulation:'not simulated',initialPosition:c.initialPosition,endClearanceZ:s.endClearanceZ,notice,
    job:{tool:job.tool,fast_start:job.fastStart,nozzleMm:job.nozzle,nozzleDiametersMm:job.nozzles.map(Number),plate:job.plate.name,
      logicalFilament:job.used,filamentColor:job.color,requestedTray:tray,amsConnections:job.amsConnections,
      filamentUsage:written.filamentUsage,filamentSequence:written.filamentSequence,
      feeds:job.filaments.map((f,i)=>({filament:i,tool:job.selections[i].setup.tool,material:job.material,colour:f.colour,source:f.source??(job.selections[i].setup.ams?{type:'ams',...job.selections[i].setup.ams}:{type:'auto'})})),
      ...(materialChanges?{materialChanges}:{})}};
  const startup=(job.fastStart?'Fast startup: optional calibration, scans and vibration tests skipped. Homing, temperature waits, loading, wiping and priming remain. ':'')+notice+' '+mapping
    +(materialChanges?` Each same-nozzle AMS change requests ${job.materialChange.flushMm3} mm³ of chute flushing${job.nozzles.length===1?' plus 2 mm of filament for priming':''}; firmware loading/priming and service material/time are additional to the part totals.`:'');
  return {notice:startup,seconds:written.seconds,volumeMm3:written.volumeMm3,
    limitations:['Deposited-height travel checked; physical head clearance is not modeled.'],envelope};
}

function packageEntries(code,c,program,plan,output,job,s,crc32){
  const {tool,map,nozzle,nozzles,color,used,count:declared,declaredMaps,limitMaps:usedFlags,settings,toolZeros}=job;
  const volume=program.volumeMm3,weight=volume/1000*job.density;
  const usage=program.filamentUsage.slice().sort((a,b)=>a.filament-b.filament),area=Math.PI*(job.filamentMm/2)**2;
  const usedNozzles=[...new Set(usage.map(u=>u.tool))].sort();
  const filamentXml=usage.map(u=>`    <filament id="${u.filament+1}" tray_info_idx="${xml(job.filaments[u.filament].id)}" type="${xml(job.material)}" color="${xml(job.filaments[u.filament].colour)}" used_m="${fmt(u.volumeMm3/area/1000,4)}" used_g="${fmt(u.volumeMm3/1000*job.density,3)}" group_id="${u.tool}" nozzle_diameter="${Number(nozzles[u.tool]).toFixed(2)}" volume_type="${job.volumeType}" used_for_object="true" used_for_support="false" total_load_time="26.00" total_unload_time="0.00"/>`).join('\n');
  const nozzleXml=usedNozzles.map(t=>`    <nozzle id="${t}" extruder_id="${t+1}" nozzle_diameter="${nozzles[t]}" volume_type="${job.volumeType}"/>`).join('\n');
  const layerXml=program.filamentSequence.length===1?`      <layer_filament_list filament_list="${used}" layer_ranges="0 ${c.layers-1}" />`:
    [...program.layerUse.values()].map((ids,i)=>`      <layer_filament_list filament_list="${[...ids].sort().join(' ')}" layer_ranges="${i} ${i}" />`).join('\n');
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
    if(!thumbnails.has(size))thumbnails.set(size,thumbnail(program.strokes,c.bounds,size,crc32));
    entries.set(`Metadata/${name}.png`,thumbnails.get(size));
  }
  return entries;
}

// Fresh toolpath thumbnail from the written depositions, never the user's
// reference object's thumbnail. This is a schematic top view, not geometry.
function thumbnail(strokes,bounds,size,crc32){
  const pixels=Buffer.alloc(size*size*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=24;pixels[i+1]=30;pixels[i+2]=35;pixels[i+3]=255;}
  const span=Math.max(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1]),scale=(size-20)/span;
  const project=p=>[Math.round(10+(p[0]-bounds.min[0])*scale),Math.round(size-11-(p[1]-bounds.min[1])*scale)];
  for(const [from,to] of strokes){const a=project(from),b=project(to),n=Math.max(1,Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]));for(let j=0;j<=n;j++){
    const x=Math.round(a[0]+(b[0]-a[0])*j/n),y=Math.round(a[1]+(b[1]-a[1])*j/n);if(x<0||y<0||x>=size||y>=size)continue;
    const k=(y*size+x)*4;pixels[k]=40;pixels[k+1]=160;pixels[k+2]=144;
  }}
  const raw=Buffer.alloc(size*(1+size*4));for(let y=0;y<size;y++)pixels.copy(raw,y*(1+size*4)+1,y*size*4,(y+1)*size*4);
  const chunk=(name,data)=>{const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,crc]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
