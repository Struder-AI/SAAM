// SAAM's job description. All repeated firmware/package declarations are
// projections of this record. A logical filament is never a physical AMS tray.
import {requireThat} from '../geom/tolerance.mjs';
import {feederSelector,toolFor} from '../machine/profile.mjs';

const PLATES={
  textured_plate:{name:'Textured PEI Plate',temperatureKey:'textured_plate_temp',h2dZ:-0.02,x1Z:-0.04,detection:'M972 S26 P0 C0'},
  hot_plate:{name:'Smooth PEI Plate',temperatureKey:'hot_plate_temp',h2dZ:0,x1Z:0,detection:'M972 S36 P0 C0 X1'},
};
const FLAGS={bedLeveling:'g29_before_print_flag',flowCalibration:'extrude_cali_flag',plateDetection:'build_plate_detect_flag',toolOffsetCalibration:'auto_cali_toolhead_offset_flag'};
const round=(value,digits)=>Number(value.toFixed(digits));

export function resolveBambuJob(plan,machine,output){
  const s=plan.setup,b=s.bambu;
  requireThat(b&&Object.keys(b).every(k=>['plate','otherNozzleMm','filaments','filament','startup','amsConnections'].includes(k)),
    'Bambu setup needs plate, otherNozzleMm, filaments, filament and startup fields; recreate an older setup before export.');
  const plate=PLATES[b.plate];
  requireThat(plate&&output.constraints.plates.includes(b.plate),'Unsupported Bambu build plate.');
  requireThat(s.core===`Hardened steel ${s.nozzleMm}`,'Bambu core and selected nozzle diameter disagree.');
  const tool=s.tool,physicalTool=toolFor(machine,tool).physicalExtruder;
  const nozzles=machine.tools.map(t=>{
    const diameter=t.index===tool?s.nozzleMm:b.otherNozzleMm;
    requireThat(t.nozzleDiametersMm.includes(diameter),'Declare the other installed Bambu nozzle diameter in setup.bambu.otherNozzleMm.');
    return String(diameter);
  });
  if(machine.tools.length===1)requireThat(b.otherNozzleMm===null,'A single-nozzle Bambu has no other nozzle.');
  const color=s.filamentColor??output.defaultFilamentColor;
  const filaments=b.filaments??[{id:'GFA00',colour:color}];
  requireThat(Array.isArray(filaments)&&filaments.length>0&&filaments.length<=16&&filaments.every(f=>
    f&&Object.keys(f).every(k=>['id','colour'].includes(k))&&typeof f.id==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(f.id)&&typeof f.colour==='string'&&/^#[0-9a-f]{6}$/i.test(f.colour)),
    'Bambu logical filaments need a material preset id and six-digit hex colour; they are not an AMS inventory.');
  const used=b.filament;
  requireThat(Number.isInteger(used)&&used>=0&&used<filaments.length,'Bambu filament index is outside the declared logical filament list.');
  requireThat(s.filamentColor==null||filaments[used].colour.toUpperCase()===s.filamentColor.toUpperCase(),
    'Selected logical filament colour disagrees with setup.filamentColor.');
  const requestedTray=s.ams==null?null:{...s.ams,index:feederSelector(plan,machine)};
  const connections=b.amsConnections;
  requireThat(connections===null||Array.isArray(connections)&&connections.every(c=>c&&Object.keys(c).length===2&&
    Number.isInteger(c.unit)&&c.unit>=1&&c.unit<=machine.ams?.units&&machine.tools.some(t=>t.index===c.tool))&&
    new Set(connections.map(c=>c.unit)).size===connections.length,'Bambu AMS connections need unique one-based units and their connected logical tool.');
  if(requestedTray&&connections!==null)requireThat(connections.some(c=>c.unit===requestedTray.unit&&c.tool===tool),
    'Requested AMS unit is not connected to the selected Bambu nozzle.');
  requireThat(b.startup&&Object.keys(b.startup).every(k=>Object.hasOwn(FLAGS,k)),'Invalid Bambu startup controls.');
  const startupFlags=[];
  for(const [key,flag] of Object.entries(FLAGS)){
    const mode=b.startup[key]??'printer';
    requireThat(['printer','on','off'].includes(mode),`Bambu startup ${key} must be printer, on or off.`);
    requireThat(machine.tools.length>1||!['plateDetection','toolOffsetCalibration'].includes(key)||mode==='printer',
      `The X1 envelope does not implement ${key} control.`);
    if(mode!=='printer')startupFlags.push(`M1002 set_flag ${flag}=${mode==='on'?1:0}`);
  }
  // No package-level escape hatch can override resolved job fields.
  const facts=output.package.projectSettings??{};
  requireThat(Object.keys(facts).length===0,
    'Bambu package facts cannot override generated job settings.');
  const count=filaments.length,map=tool+1,density=1.26,volumeType='Standard',nozzleType='hardened_steel';
  const perFilament=value=>filaments.map(()=>String(value)),perTool=value=>nozzles.map(()=>value);
  // The supplied right-connected four-slot H2D reference uses 1#0|4#1 on
  // the right and 1#0|4#0 on the left. Only four-slot units are represented
  // here; this is a connection count, never a logical-filament/tray map.
  if(connections!==null)requireThat(machine.ams.slotsPerUnit===4,'Only four-slot Bambu AMS connection metadata is supported.');
  const amsCounts=connections===null?{}:{extruder_ams_count:machine.tools.map(t=>`1#0|4#${connections.filter(c=>c.tool===t.index).length}`)};
  const settings={...amsCounts,default_ams_type:'-1',printer_model:machine.name,printer_settings_id:`${machine.name} ${s.nozzleMm} nozzle`,
    gcode_flavor:'marlin',curr_bed_type:plate.name,physical_extruder_map:machine.tools.map(t=>String(t.physicalExtruder)),
    filament_map:perFilament(map),filament_map_2:perFilament(tool),filament_map_mode:machine.tools.length===2?'Manual':'Auto For Flush',
    // These are resolved slice values, not the unsliced project's preferences.
    // map_2 indexes the compact standard-only variant table, zero-based.
    filament_nozzle_map:perFilament(tool),filament_volume_map:perFilament(0),
    print_extruder_id:machine.tools.map(t=>String(t.index+1)),print_extruder_variant:perTool('Direct Drive Standard'),
    printer_extruder_id:machine.tools.map(t=>String(t.index+1)),printer_extruder_variant:perTool('Direct Drive Standard'),
    filament_extruder_variant:perFilament('Direct Drive Standard'),
    nozzle_diameter:nozzles,nozzle_volume_type:perTool(volumeType),nozzle_type:perTool(nozzleType),
    filament_diameter:perFilament(s.filamentMm),filament_type:perFilament(s.material),
    filament_ids:filaments.map(f=>f.id),filament_self_index:filaments.map((_,i)=>String(i+1)),
    filament_is_support:perFilament(0),filament_colour:filaments.map(f=>f.colour),
    filament_density:perFilament(density),filament_flow_ratio:perFilament(1),
    nozzle_temperature:perFilament(s.nozzleC),nozzle_temperature_initial_layer:perFilament(s.nozzleC),
    [plate.temperatureKey]:perFilament(s.bedC),[plate.temperatureKey+'_initial_layer']:perFilament(s.bedC),
    chamber_temperatures:perFilament(s.buildVolumeC),enable_filament_dynamic_map:'0',
    layer_height:String(plan.process.layerMm),initial_layer_print_height:String(plan.process.firstLayerMm),enable_arc_fitting:'0'};
  const k=output.constraints;
  const values={...s,physicalTool,filamentTool:used,plateOffset:machine.tools.length===2?plate.h2dZ:plate.x1Z,
    plateDetection:plate.detection,startupFlags,wipeC:s.nozzleC-20,
    purgeC:k.startupPurgeC??k.startupFlushC,flushC:k.startupFlushC,
    flushFeed:round(k.startupPurgeFlowMm3S/2.4053*60,3),
    reducedFlushFeed:round(k.startupPurgeFlowMm3S/2.4053*60*0.8,3),
    calibrationFeed:round(k.startupPurgeFlowMm3S/2.4,4)};
  return {tool,map,physicalTool,nozzle:s.nozzleMm,nozzles,plate:{id:b.plate,...plate},
    filaments:filaments.map(f=>({...f})),used,count,color:filaments[used].colour,material:s.material,
    filamentMm:s.filamentMm,density,volumeType,nozzleType,requestedTray,amsConnections:connections===null?null:connections.map(c=>({...c})),settings,values,
    declaredMaps:perFilament(map).join(' '),limitMaps:perFilament(0).join(' '),toolZeros:perTool(0).join(' ')};
}
