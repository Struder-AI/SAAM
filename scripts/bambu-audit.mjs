// Read-only comparison aid: inspect SAAM or Bambu Studio sliced archives without
// borrowing their G-code, objects or thumbnails. Reports facts, not firmware safety.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {unpackZip} from '../core/export/zip.mjs';

const keys=/nozzle|extruder|filament_(map|nozzle_map|self_index|colour|ids|type|diameter|volume_map|cooling_before_tower)|curr_bed_type|plate_temp|chamber_temperatures|ams|temperature|enable_prime_tower|wipe_avoid/;
const commands=/^(?:M10[49]|M1[49][01]|G29(?:\.\d+)?|G151|G383(?:\.\d+)?|M620(?:\.\d+)?|M621|T\d+|M983(?:\.\d+)?|M1015(?:\.\d+)?|M972|G28(?:\.\d+)?|M1002 (?:judge_flag|set_flag|set_filament_type)|M622|M623)(?:\s|$)/;

// These observations describe the resolved slice, not saved project preferences
// or physical spool routing. In a remapped job T<n> is a filament index.
export function auditBambuChanges(lines,config){
  const numbers=value=>typeof value==='string'?value.split(',').map(Number):[];
  const maps=numbers(config.filament_map),diameters=numbers(config.nozzle_diameter);
  const loads=[],markers=[],issues=[],pendingFlush=[],calibration=[];let active=null,previous=null,towerSections=0;
  const nozzle=filament=>Number.isInteger(filament)&&Number.isInteger(maps[filament])?maps[filament]-1:null;
  const words=code=>Object.fromEntries([...code.matchAll(/(?:^|\s)([A-Z])(-?\d+(?:\.\d+)?)/g)].map(m=>[m[1],Number(m[2])]));
  const issue=(line,message)=>issues.push({line,message});
  const flush=(observation,w)=>{
    const filament=w.A===0?(active.fromFilament??active.filament):active.filament;
    const tool=nozzle(filament),expected=diameters[tool];
    active.flush.push({...observation,role:w.A===0?'outgoing':'incoming',filament,tool,nozzleMm:w.H});
    if(Number.isFinite(expected)&&w.H!==expected)issue(observation.line,`Flush A${w.A} H${w.H} disagrees with ${w.A===0?'outgoing':'incoming'} nozzle ${tool} diameter ${expected}.`);
  };
  for(const [i,raw] of lines.entries()){
    const text=raw.trim(),line=i+1,code=text.split(';')[0].trim();
    if(text==='; FEATURE: Prime tower')towerSections++;
    const marker=text.match(/^; NOZZLE_CHANGE_START OF(\d+) NF(\d+) ON(\d+) NN(\d+)$/);
    if(marker){const [fromFilament,toFilament,fromTool,toTool]=marker.slice(1).map(Number);markers.push({line,fromFilament,toFilament,fromTool,toTool});}
    const start=code.match(/^M620 S(\d+)A(?:\s|$)/);
    if(start){
      if(active&&!active.endLine)issue(line,'A material-load block started before the preceding M621.');
      // Large values are unload/service sentinels, not job filaments.
      const filament=Number(start[1]);active=null;
      if(filament>=maps.length)continue;
      const tool=nozzle(filament);
      active={startLine:line,fromFilament:previous,filament,tool,nozzleMm:diameters[tool]??null,
        flush:[],outgoing:[],detectors:[],cooling:[],retraction:[]};loads.push(active);
      for(const observation of pendingFlush)flush(observation,words(observation.text));pendingFlush.length=0;
      if(tool===null||tool<0||tool>=diameters.length)issue(line,'Logical filament has no resolved nozzle diameter.');
      continue;
    }
    const w=words(code),observation={line,text:code};
    if(/^M620\.17 /.test(code))calibration.push({...observation,physicalTool:w.T,filament:w.L,nozzleC:w.S});
    if(!active){if(previous===null&&/^M620\.10 A[01](?:\s|$)/.test(code))pendingFlush.push(observation);continue;}
    if(/^M620\.10 A[01](?:\s|$)/.test(code)){
      flush(observation,w);
    }
    if(/^M620\.11 /.test(code)&&w.I!==undefined){
      active.outgoing.push({...observation,filament:w.I,hotend:w.B??null});
      if(active.fromFilament!==null&&w.I!==active.fromFilament)issue(line,'Outgoing feeder descriptor disagrees with the preceding logical filament.');
    }
    if(/^M620\.15 /.test(code))active.cooling.push(observation);
    if(/^M620\.10 R/.test(code)||/^M983\.3 /.test(code))active.retraction.push(observation);
    const select=code.match(/^T(\d+)(?:\s|$)/);
    if(select&&Number(select[1])<maps.length){
      active.selection={...observation,filament:Number(select[1]),hotend:w.H??null};
      if(Number(select[1])!==active.filament)issue(line,'T selection disagrees with M620 logical filament.');
    }
    const end=code.match(/^M621 S(\d+)A(?:\s|$)/);
    if(end){
      active.endLine=line;
      if(Number(end[1])!==active.filament)issue(line,'M621 completion disagrees with M620 logical filament.');
      if(!active.selection)issue(line,'Material-load block has no matching ordinary T selection.');
      previous=active.filament;
    }
    if(/^M1015\.4 /.test(code)&&w.H!==undefined){
      active.detectors.push({...observation,nozzleMm:w.H});
      if(w.H!==active.nozzleMm)issue(line,'Air-print detector diameter disagrees with the selected nozzle.');
    }
    if(/^M620\.6 /.test(code)&&w.I!==undefined){
      active.detectors.push({...observation,filament:w.I});
      if(w.I!==active.filament)issue(line,'AMS detector disagrees with the selected logical filament.');
    }
  }
  for(const load of loads)if(!load.endLine)issue(load.startLine,'Material-load block has no M621 completion.');
  const physical=numbers(config.physical_extruder_map),temperatures=numbers(config.nozzle_temperature_initial_layer);
  for(const c of calibration){
    const targetUsed=loads.some(l=>physical[l.tool]===c.physicalTool);
    if(targetUsed&&physical[nozzle(c.filament)]!==c.physicalTool)issue(c.line,'Offset calibration filament disagrees with its physical extruder.');
    if(Number.isFinite(temperatures[c.filament])&&temperatures[c.filament]!==c.nozzleC)issue(c.line,'Offset calibration temperature disagrees with its logical filament.');
  }
  return {towerSections,nozzleChangeMarkers:markers,materialLoads:loads,
    nozzleChanges:loads.filter(l=>l.fromFilament!==null&&nozzle(l.fromFilament)!==l.tool).length,calibration,issues,
    scope:'Selected repeated fields only; not a G-code interpreter, physical spool mapping, or firmware safety verdict.'};
}

export function auditBambu(bytes){
  const entries=unpackZip(bytes),reports=[];
  const project=JSON.parse(entries.get('Metadata/project_settings.config')?.toString()??'{}');
  for(const [name,bytes] of entries){
    if(!/^Metadata\/plate_\d+\.gcode$/.test(name))continue;
    const code=bytes.toString(),lines=code.split(/\r?\n/),config={},configOccurrences={};let inside=false,configPairCount=0;
    for(const line of lines){
      if(line==='; CONFIG_BLOCK_START')inside=true;
      else if(line==='; CONFIG_BLOCK_END')inside=false;
      else if(inside){const match=line.match(/^;\s*([^=]+?)\s*=\s*(.*)$/);if(match)configPairCount++;if(match&&keys.test(match[1])){
        config[match[1]]=match[2];(configOccurrences[match[1]]??=[]).push(match[2]);
      }}
    }
    const stem=name.slice(0,-6);
    const headerText=code.split('; HEADER_BLOCK_END')[0],headerFilaments=headerText.match(/^; filament:\s*(.*)$/m)?.[1].trim();
    const filamentIds=headerFilaments===undefined?null:headerFilaments.split(',').map(Number);
    const changes=auditBambuChanges(lines,config);
    if(filamentIds!==null){
      const selected=[...new Set(changes.materialLoads.map(l=>l.filament+1))];
      if(filamentIds.some(id=>!Number.isInteger(id)||id<1)||new Set(filamentIds).size!==filamentIds.length||selected.some(id=>!filamentIds.includes(id)))
        changes.issues.push({line:lines.findIndex(l=>/^; filament:/.test(l))+1,message:'Header filament IDs omit a selected logical filament or contain invalid/duplicate IDs; this field is an ID list, not a count.'});
    }
    // Studio's desktop ConfigBase reader requires this prefix and at least 80
    // recognized configuration pairs. Total pairs are only an upper bound:
    // unknown keys are ignored. This is NOT a printer-firmware compatibility test.
    const markerLine=lines.findIndex(l=>/^\s*(?:N\d+\s+)?; BambuStudio/.test(l));
    const studioReader={formatMarkerLine:markerLine<0?null:markerLine+1,configPairCount,
      minimumRecognizedPairs:80,necessaryConditionsMet:markerLine>=0&&configPairCount>=80,
      scope:'Necessary desktop Studio G-code configuration-reader conditions only; no firmware verdict, schema validation or proof of accepted mapping.'};
    reports.push({gcode:name,headerFilamentIds:filamentIds,studioReader,config,duplicateConfigKeys:Object.fromEntries(Object.entries(configOccurrences).filter(([,values])=>values.length>1)),
      commands:lines.flatMap((text,i)=>commands.test(text.trim())?[{line:i+1,text:text.trim()}]:[]),
      plate:JSON.parse(entries.get(stem+'.json')?.toString()??'null'),changes});
  }
  return {sha256:createHash('sha256').update(bytes).digest('hex'),
    project:Object.fromEntries(Object.entries(project).filter(([key])=>keys.test(key))),plates:reports,
    sliceInfo:entries.get('Metadata/slice_info.config')?.toString()??null,
    modelSettings:entries.get('Metadata/model_settings.config')?.toString()??null,
    sequence:JSON.parse(entries.get('Metadata/filament_sequence.json')?.toString()??'null'),
    saamJob:JSON.parse(entries.get('Metadata/saam-job.json')?.toString()??'null')};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length<3)throw new Error('Usage: node scripts/bambu-audit.mjs FILE.gcode.3mf [FILE.gcode.3mf ...]');
  for(const file of process.argv.slice(2))console.log(JSON.stringify({file:resolve(file),...auditBambu(await readFile(file))},null,2));
}
