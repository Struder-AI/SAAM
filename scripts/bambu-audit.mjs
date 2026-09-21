// Read-only comparison aid: inspect SAAM or Bambu Studio sliced archives without
// borrowing their G-code, objects or thumbnails. Reports facts, not firmware safety.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {unpackZip} from '../core/export/zip.mjs';

const keys=/nozzle|extruder|filament_(map|nozzle_map|self_index|colour|ids|type|diameter|volume_map)|curr_bed_type|plate_temp|chamber_temperatures|ams|temperature/;
const commands=/^(?:M10[49]|M1[49][01]|G29(?:\.\d+)?|G151|G383(?:\.\d+)?|M620(?:\.\d+)?|M621|T\d+|M983(?:\.\d+)?|M1015(?:\.\d+)?|M972|G28(?:\.\d+)?|M1002 (?:judge_flag|set_flag|set_filament_type)|M622|M623)(?:\s|$)/;

export function auditBambu(bytes){
  const entries=unpackZip(bytes),reports=[];
  const project=JSON.parse(entries.get('Metadata/project_settings.config')?.toString()??'{}');
  for(const [name,bytes] of entries){
    if(!/^Metadata\/plate_\d+\.gcode$/.test(name))continue;
    const code=bytes.toString(),lines=code.split(/\r?\n/),config={},configOccurrences={};let inside=false;
    for(const line of lines){
      if(line==='; CONFIG_BLOCK_START')inside=true;
      else if(line==='; CONFIG_BLOCK_END')inside=false;
      else if(inside){const match=line.match(/^;\s*([^=]+?)\s*=\s*(.*)$/);if(match&&keys.test(match[1])){
        config[match[1]]=match[2];(configOccurrences[match[1]]??=[]).push(match[2]);
      }}
    }
    const stem=name.slice(0,-6);
    reports.push({gcode:name,config,duplicateConfigKeys:Object.fromEntries(Object.entries(configOccurrences).filter(([,values])=>values.length>1)),
      commands:lines.flatMap((text,i)=>commands.test(text.trim())?[{line:i+1,text:text.trim()}]:[]),
      plate:JSON.parse(entries.get(stem+'.json')?.toString()??'null')});
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
