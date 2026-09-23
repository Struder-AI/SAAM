// Bounded Bambu output (H2D, X1 Carbon), not an interpreter for arbitrary
// Bambu Studio jobs. Firmware service commands are matched to the pinned
// envelope in the machine file, which also owns every model-specific fact.
// The intervening print body is reconstructed by the shared modal interpreter.
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {exportMotion} from './griffin.mjs';
import {interpretBody,prelude} from './bambu-player.mjs';
import {changeLines,nozzleOfTool,toolColor,usedTools} from './bambu-tool-change.mjs';
import {gcodeLines} from './gcode-lines.mjs';
import {packZip,unpackZip,crc32} from './zip.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {validateSetup,toolFor,toolBounds,feederSelector,startupPosition} from '../machine/profile.mjs';
const digest=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
export const toolChangeDigest=config=>digest(JSON.stringify(config));
const fmt=(n,d=5)=>Number(n.toFixed(d));
const json=value=>JSON.stringify(value)+'\n';
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const meta=values=>Object.entries(values).map(([k,v])=>`    <metadata key="${k}" value="${xml(v)}"/>`).join('\n');
const BEGIN=';SAAM_BODY_BEGIN\n',END=';SAAM_BODY_END\n',GCODE='Metadata/plate_1.gcode';
const BATCH_CONTRACT='h2d-02.08.02.61-pla-textured-batch-v1';
// Updated only after reviewing changes to the firmware service contract.
const ENVELOPE_HASHES={
  'h2d-02.08.02.61-pla-textured-v3':'913c45b16fb4f9fcefa0fb66174fcee1ff8f3fe55b11d0d486ea3339188ef610',
  [BATCH_CONTRACT]:'97e0a336ec2a3874de9f9a4553f5f1e69472fb631e81806ff196f156da0fe6db',
  'x1c-02.08.02.61-pla-textured-v1':'85020a9b75d1468099f2313f08c24318a3bf5d7bed30e0ac8cc67a00cc8f43d6',
};
// The pinned nozzle-change sequence, reviewed separately from the start and end envelope.
const TOOL_CHANGE_HASHES={
  'h2d-02.08.02.61-pla-textured-v3':'9be18024848d39d5b6f306d44c683c2f84413f958f112502e271e84ff07d1734',
  [BATCH_CONTRACT]:'9be18024848d39d5b6f306d44c683c2f84413f958f112502e271e84ff07d1734',
};
const marker=(lines,value)=>{const found=lines.reduce((all,line,i)=>(line===value&&all.push(i),all),[]);requireThat(found.length===1,`Expected one H2D startup marker: ${value}`);return found[0];};
function batchProgram(source){
  requireThat(source.contract==='h2d-02.08.02.61-pla-textured-v3','Batch startup requires the reviewed H2D v3 source envelope.');
  const start=[...source.start];
  const extrusion=marker(start,'M1002 judge_flag extrude_cali_flag'),purge=start.indexOf('M106 P1 S0',extrusion);
  requireThat(purge>extrusion,'Invalid H2D extrusion calibration boundary.');start.splice(extrusion,purge-extrusion);
  const leveling=marker(start,'M1002 judge_flag g29_before_print_flag'),offset=marker(start,'M1002 judge_flag auto_cali_toolhead_offset_flag');
  requireThat(offset>leveling,'Invalid H2D leveling boundary.');
  start.splice(leveling,offset-leveling,'M190 S{bedC}','M109 S140 A','M106 S0','G91','G1 Z5 F1200','G90','G1 X175 Y160 F30000','G28 R','M190 S{bedC}');
  const toolOffset=marker(start,'M1002 judge_flag auto_cali_toolhead_offset_flag'),offsetEnd=start.findIndex((line,i)=>i>toolOffset&&line==='M623'&&start[i+1]==='M400');
  requireThat(offsetEnd>toolOffset,'Invalid H2D toolhead-offset boundary.');start.splice(toolOffset,offsetEnd-toolOffset+1);
  return {...source,contract:BATCH_CONTRACT,start,end:[...source.end]};
}
function selectedOutput(plan,output){return (plan.setup.startupMode??'full')==='batch'?{...output,program:batchProgram(output.program)}:output;}
function configuration(plan,machine){
  validateSetup(plan,machine);
  const declared=machine.outputs.find(o=>o.id===plan.output),output=selectedOutput(plan,declared),s=plan.setup,k=output?.constraints;
  requireThat(plan.output==='bambu-gcode'&&Object.hasOwn(ENVELOPE_HASHES,output?.program?.contract),'Unsupported Bambu output contract.');
  const change=output.program.toolChange;
  if(change)requireThat(toolChangeDigest(change)===TOOL_CHANGE_HASHES[output.program.contract],'Unknown Bambu nozzle-change sequence; an interpreter update is required.');
  requireThat(usedTools(plan).length===1||change,`${machine.name} output declares no validated nozzle-change sequence, so a job cannot use more than one nozzle.`);
  requireThat(digest(JSON.stringify([output.program.start,output.program.end]))===ENVELOPE_HASHES[output.program.contract],'Unknown Bambu firmware envelope; an interpreter update is required.');
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
// The writer's side of a nozzle change: the pinned block for a change, and a heater line for the other nozzle.
function changeWriter(output,plan,machine){
  const config=output.program.toolChange;if(!config)return null;
  return {
    change:(a,{fan,changeIndex})=>{requireThat(Number.isFinite(a.lift),'A nozzle change needs a lift height.');return changeLines(config,{from:a.fromTool,to:a.toTool,changeIndex,lift:a.lift,fan,plan});},
    heater:a=>{requireThat(a.targetC===0||a.targetC===plan.setup.nozzleC,'Unplanned nozzle temperature.');return [`M104 T${machine.tools[a.tool].physicalExtruder} S${a.targetC} N0`];}
  };
}
function contextFor(path,plan,machine,release,output){
  const moves=path.actions.filter(a=>a.kind==='move'),points=[path.initialPosition,...moves.map(m=>m.to)];
  const deposits=moves.filter(m=>m.volumeMm3>0);requireThat(deposits.length,'Bambu output needs deposition.');
  const bounds=path.summary?.boundsMm;
  const layers=new Set(deposits.filter(m=>m.phase!=='prime').map(m=>`${m.phase}:${m.layer}`));
  const context={schema:'saam-bambu-artifact/1',contract:output.program.contract,release,bounds,initialPosition:path.initialPosition,
    pathMaxZ:points.reduce((maximum,p)=>Math.max(maximum,p[2]),-Infinity),layers:layers.size};
  checkContext(context,plan,machine);return context;
}
function checkContext(c,plan,machine){
  const reach=usedTools(plan).map(tool=>toolBounds(machine,tool));
  const b={min:[0,1,2].map(i=>Math.max(...reach.map(r=>r.min[i]))),max:[0,1,2].map(i=>Math.min(...reach.map(r=>r.max[i])))};
  const output=selectedOutput(plan,machine.outputs.find(o=>o.id===plan.output)),k=output.constraints;
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
function sections(c,plan,machine,output){
  // Shutdown lifts clear of the part, parks higher, then may settle back; it
  // never descends below the completed path.
  const k=output.constraints,endClearanceZ=fmt(Math.max(c.pathMaxZ,c.bounds.max[2]+k.endLiftMm));
  const parkZ=fmt(Math.max(endClearanceZ,Math.min(k.parkLimitMm,k.parkRiseMm+k.parkHeightFactor*c.bounds.max[2])));
  const values={...plan.setup,physicalTool:toolFor(machine,plan.setup.tool).physicalExtruder,
    filamentTool:feederSelector(plan,machine),wipeC:plan.setup.nozzleC-20,
    minX:fmt(c.bounds.min[0]),minY:fmt(c.bounds.min[1]),sizeX:fmt(c.bounds.max[0]-c.bounds.min[0]),sizeY:fmt(c.bounds.max[1]-c.bounds.min[1]),
    endClearanceZ,parkZ,parkSettleZ:fmt(Math.max(endClearanceZ,parkZ-k.parkSettleMm))};
  const render=lines=>lines.map(line=>line.replace(/\{([A-Za-z]+)\}/g,(_,key)=>{
    requireThat(Number.isFinite(values[key]),'Unknown Bambu template value.');return values[key];
  })).join('\n')+'\n';
  // A job that changes nozzles tells the firmware which filament each extruder starts with.
  const dual=usedTools(plan).length>1?output.program.toolChange.dualStart:{};
  return {start:render(output.program.start.map(line=>dual[line]??line)),end:render(output.program.end),endClearanceZ};
}
function header(c,program){
  return ['; HEADER_BLOCK_START',`; generated by SAAM ${c.release.generatorVersion}`,`; build date: ${c.release.buildDate}`,
    `; total layer number: ${c.layers}`,`; total filament length [mm] : ${fmt(program.summary.filamentMm,2)}`,
    `; total filament volume [cm^3] : ${fmt(program.volumeMm3/1000,4)}`,`; max_z_height: ${fmt(c.bounds.max[2])}`,
    '; filament_diameter: 1.75','; filament: 1','; HEADER_BLOCK_END','; EXECUTABLE_BLOCK_START'].join('\n')+'\n';
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
  const body=prelude(plan)+exportMotion(path,plan,{extrusionMode:'relative',toolChange:changeWriter(output,plan,machine)}).map(l=>l==='M107'?'M106 S0':l).join('\n')+'\n';
  const c=contextFor(path,plan,machine,release,output),s=sections(c,plan,machine,output);
  const program=interpretBody(body,plan,machine);
  const code=header(c,program)+s.start+BEGIN+body+END+s.end+'; EXECUTABLE_BLOCK_END\n';
  const bytes=packZip(packageEntries(code,c,program,plan,machine,output));
  return {bytes,program:completeProgram(program,code,c,s)};
}
export function interpretBambu(bytes,plan,machine){
  const output=configuration(plan,machine),entries=unpackZip(bytes);
  const c=JSON.parse(entries.get('Metadata/saam.json')?.toString()??'null');checkContext(c,plan,machine);
  const code=entries.get(GCODE)?.toString('utf8');requireThat(typeof code==='string','Missing Bambu G-code.');
  const begin=code.indexOf(BEGIN),end=code.indexOf(END);
  requireThat(begin>=0&&end>begin&&code.indexOf(BEGIN,begin+BEGIN.length)===-1&&code.indexOf(END,end+END.length)===-1,'Invalid Bambu body boundary.');
  const body=code.slice(begin+BEGIN.length,end),program=interpretBody(body,plan,machine),s=sections(c,plan,machine,output);
  requireThat(code===header(c,program)+s.start+BEGIN+body+END+s.end+'; EXECUTABLE_BLOCK_END\n','Bambu program differs from its declared firmware envelope.');
  const expected=packageEntries(code,c,program,plan,machine,output);
  requireThat(entries.size===expected.size&&[...expected].every(([name,value])=>entries.get(name)?.equals(Buffer.from(value))),'Bambu package metadata, checksum or thumbnail differs from the program.');
  return completeProgram(program,code,c,s);
}

function completeProgram(program,code,c,s){
  const begin=code.indexOf(BEGIN);
  requireThat(program.moves.every(m=>m.to[2]<=c.pathMaxZ+1e-5),'Bambu body exceeds declared shutdown clearance.');
  let prefixLines=-1;for(const _line of gcodeLines(code.slice(0,begin+BEGIN.length)))prefixLines++;
  for(const move of program.moves)move.line+=prefixLines;
  for(const event of program.events)event.line+=prefixLines;
  program.code=code;
  program.envelope={contract:c.contract,simulation:'not simulated',initialPosition:c.initialPosition,endClearanceZ:s.endClearanceZ,
    notice:'Firmware probing, wiping, calibration, purge, unload and service motions are checked against a fixed reference envelope; they are not simulated. Playback and timing cover the print body only.'};
  program.summary.startup=program.envelope.notice;
  program.summary.clearance='Deposited-height travel checked; physical head clearance is not modeled.';
  return program;
}

function packageEntries(code,c,program,plan,machine,output){
  const tool=plan.setup.tool,used=usedTools(plan),volume=program.volumeMm3,filament=program.summary.filamentMm,weight=volume/1000*1.26;
  // For a USB-started single-material job, preserve the requested AMS position
  // as a logical filament and declare every preceding position. M620 S3 is then
  // a real fourth entry rather than an invalid reference in a one-entry table.
  const selector=feederSelector(plan,machine),directTray=plan.setup.ams!==null&&used.length===1;
  const filaments=directTray?Array.from({length:selector+1},(_,i)=>({tool,active:i===selector,
    color:i===selector?toolColor(plan,tool,output.defaultFilamentColor):'#000000'}))
    :used.map(t=>({tool:t,active:true,color:toolColor(plan,t,output.defaultFilamentColor)}));
  const maps=filaments.map(f=>f.tool+1).join(' '),colors=filaments.map(f=>f.color),color=colors[selector];
  // Placeholder logical filaments consume no material.
  const share=filaments.map(f=>{
    if(!f.active)return {filament:0,weight:0};
    if(used.length===1)return {filament,weight};
    const v=program.moves.reduce((sum,m)=>m.tool===f.tool&&m.extruding?sum+m.volumeMm3:sum,0);
    return {filament:v/(Math.PI*(plan.setup.filamentMm/2)**2),weight:v/1000*1.26};
  });
  const logicalForTool=t=>directTray?selector:used.indexOf(t);
  const toolOrder=[tool,...program.events.filter(e=>e.kind==='tool').map(e=>e.tool)],order=toolOrder.map(logicalForTool);
  // An unselected nozzle is recorded as the standard 0.4 mm core. Bambu picks
  // the preset family from the first nozzle; mixed diameters are carried by
  // nozzle_diameter and the slice metadata.
  const nozzle=plan.setup.nozzleMm,tools=machine.tools,settings=output.package.projectSettings,perTool=value=>tools.map(()=>value),each=value=>filaments.map(()=>value);
  const nozzles=perTool('0.4');for(const t of used)nozzles[t]=String(nozzleOfTool(plan,t));
  const seconds=Math.ceil(program.seconds),bbox=[c.bounds.min[0],c.bounds.min[1],c.bounds.max[0],c.bounds.max[1]];
  const plate={bbox_all:bbox,bbox_objects:[{area:(bbox[2]-bbox[0])*(bbox[3]-bbox[1]),bbox,id:1,layer_height:plan.process.layerMm,name:'SAAM part'}],
    bed_type:'textured_plate',filament_colors:colors,filament_ids:filaments.map((_,i)=>i),first_extruder:selector,first_layer_time:0,is_seq_print:false,nozzle_diameter:nozzle,version:2};
  const entries=new Map([
    [GCODE,code],[GCODE+'.md5',digest(code,'md5')],['Metadata/saam.json',json(c)],
    ['Metadata/plate_1.json',json(plate)],
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="gcode" ContentType="text/x.gcode"/></Types>\n'],
    ['3D/3dmodel.model',`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"><metadata name="Application">SAAM-${xml(c.release.generatorVersion)}</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><resources/><build/></model>\n`],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/><Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/><Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/><Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/></Relationships>\n'],
    ['Metadata/_rels/model_settings.config.rels','<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/Metadata/plate_1.gcode" Id="rel-1" Type="http://schemas.bambulab.com/package/2021/gcode"/></Relationships>\n'],
    ['Metadata/model_settings.config',`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <plate>\n${meta({plater_id:1,plater_name:'SAAM',locked:false,filament_map_mode:settings.filament_map_mode,filament_maps:maps,filament_volume_maps:0,gcode_file:GCODE,thumbnail_file:'Metadata/plate_1.png',thumbnail_no_light_file:'Metadata/plate_no_light_1.png',top_file:'Metadata/top_1.png',pick_file:'Metadata/pick_1.png',pattern_bbox_file:'Metadata/plate_1.json'})}\n  </plate>\n</config>\n`],
    ['Metadata/slice_info.config',`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="${xml(output.package.clientVersion)}"/>\n  </header>\n  <plate>\n${meta({index:1,extruder_type:perTool(0).join(' '),nozzle_volume_type:perTool(0).join(' '),printer_model_id:output.package.printerModelId,nozzle_diameters:nozzles.join(','),timelapse_type:0,prediction:seconds,weight:fmt(weight,3),pause_count:0,first_layer_time:0,outside:false,support_used:false,label_object_enabled:false,support_material_on_wipe_tower:false,enable_filament_dynamic_map:false,has_filament_switcher:false,filament_maps:maps,limit_filament_maps:0})}\n    <object identify_id="1" name="SAAM part" skipped="false" />\n${filaments.map((f,i)=>`    <filament id="${i+1}" tray_info_idx="GFA00" type="PLA" color="${xml(colors[i])}" used_m="${fmt(share[i].filament/1000,4)}" used_g="${fmt(share[i].weight,3)}" group_id="${f.tool}" nozzle_diameter="${nozzleOfTool(plan,f.tool).toFixed(2)}" volume_type="Standard" used_for_object="${f.active}" used_for_support="false" total_load_time="${f.active?'26.00':'0.00'}" total_unload_time="0.00"/>`).join('\n')}\n${used.map(t=>`    <nozzle id="${t}" extruder_id="${t+1}" nozzle_diameter="${nozzleOfTool(plan,t)}" volume_type="Standard"/>`).join('\n')}\n    <layer_filament_lists>\n      <layer_filament_list filament_list="${filaments.map((f,i)=>f.active?i:null).filter(i=>i!==null).join(' ')}" layer_ranges="0 ${c.layers-1}" />\n    </layer_filament_lists>\n  </plate>\n</config>\n`],
    ['Metadata/filament_sequence.json',json({plate_1:{nozzle_sequence:toolOrder,optimal_assignment:filaments.map((_,i)=>i),sequence:order.map(i=>i+1)}})],
    ['Metadata/project_settings.config',json({printer_model:machine.name,printer_settings_id:`${machine.name} ${nozzle} nozzle`,gcode_flavor:'marlin',curr_bed_type:'Textured PEI Plate',physical_extruder_map:tools.map(t=>String(t.physicalExtruder)),filament_map:filaments.map(f=>String(f.tool+1)),filament_map_mode:'Manual',filament_nozzle_map:filaments.map(f=>String(f.tool)),nozzle_diameter:nozzles,nozzle_volume_type:perTool('Standard'),nozzle_type:null,filament_diameter:each('1.75'),filament_type:each('PLA'),filament_ids:each('GFA00'),filament_colour:colors,filament_density:each('1.26'),filament_flow_ratio:each('1'),nozzle_temperature:each(String(plan.setup.nozzleC)),nozzle_temperature_initial_layer:each(String(plan.setup.nozzleC)),hot_plate_temp:each(String(plan.setup.bedC)),hot_plate_temp_initial_layer:each(String(plan.setup.bedC)),chamber_temperatures:['0'],layer_height:String(plan.process.layerMm),initial_layer_print_height:String(plan.process.firstLayerMm),enable_arc_fitting:'0',...settings})]
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
