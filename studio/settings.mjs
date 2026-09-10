// Human-readable review of the same locked recipe used by every adapter.
export const skillName=name=>({'full-fill':'Full fill','planar-infill':'Planar infill','vase-wall':'Vase wall','draped-skin':'Draped skin'}[name]??name);
export const hasSkill=(plan,name)=>plan.composition?.regions?.length
  ?plan.composition.regions.some(region=>Object.hasOwn(region.skills,name))
  :Boolean(plan.skills?.[name]?.enabled);
const value=v=>v===null||v===undefined?'Not set':Array.isArray(v)?v.join(', '):String(v);
const fields={
  mode:['Fill mode',''],bottomLayers:['Solid bottom layers',''],topLayers:['Solid top layers',''],
  perimeters:['Walls',''],density:['Infill fraction',''],fillAnglesDeg:['Fill directions','°'],fillOverlap:['Wall overlap (bead fraction)',''],
  minFeatureMm:['Smallest sampled feature',' mm'],layers:['Skin layers',''],normalMm:['Skin thickness per layer',' mm'],
  strokeAngleDeg:['Stroke direction','°'],sampleStepMm:['Maximum sampling step',' mm'],surveyStepMm:['Surface survey grid',' mm'],
  maxAngleDegOverride:['Experimental angle override','°'],zStartMm:['Start above component base',' mm'],zEndMm:['End above component base',' mm'],
  toleranceMm:['Contour tolerance',' mm'],maxPoints:['Point budget',''],endTransition:['Wall ending','']
};
export function skillSettingsRows(name,settings,prefix=skillName(name)){
  const rows=[];
  for(const [key,v] of Object.entries(settings)){
    if(['enabled','part','parts'].includes(key))continue;
    const [label,unit]=fields[key]??[key,''];
    const rendered=key==='maxAngleDegOverride'&&v===null?'Machine profile limit'
      :key==='zEndMm'&&v===null?'Geometry top'
      :key==='endTransition'?({'level':'Level rim','spiral':'Spiral rim'}[v]??value(v))
      :value(v)+unit;
    rows.push([prefix+' · '+label,rendered]);
  }
  return rows;
}
export function regionRows(plan){
  return (plan.composition?.regions??[]).flatMap(region=>[
    [region.id,(region.part??'Part')+' · '+(region.zEndMm===null?region.zStartMm+' mm to geometry top':region.zStartMm+'–'+region.zEndMm+' mm')+' · '+Object.keys(region.skills).map(skillName).join(' + ')],
    ...(region.lowerSurfaceFrom?[[region.id+' · Bottom','Follows the finished surface of '+region.lowerSurfaceFrom]]:[]),
    ...(region.supportPolicy==='bridge-experimental'?[[region.id+' · Support','Experimental bridging across hollow or unsupported spans; unvalidated']]:[])
  ]);
}
export function recipeRows(plan){
  const composition=plan.composition,regions=composition?.regions??[],rows=[];
  if(composition){
    rows.push(['Layer batching',composition.batchLayers+' layer(s) per component'],
      ['Requested operation order',composition.order.length?composition.order.join(' → '):'Shared dependency order'],
      ['Additional dependencies',composition.dependencies.length?composition.dependencies.map(e=>e.before+' → '+e.after).join('; '):'None']);
  }
  if(regions.length){
    rows.push(...regionRows(plan));
    for(const region of regions)for(const [name,overrides] of Object.entries(region.skills))rows.push(
      ...skillSettingsRows(name,{...plan.skills[name],...overrides},region.id+' · '+skillName(name))
        .filter(([label])=>!label.endsWith('above component base')));
  }else if(plan.skills){
    for(const [name,settings] of Object.entries(plan.skills))if(settings.enabled){
      rows.push([skillName(name)+' · Component',settings.parts?.join(', ')||settings.part||'All selected geometry']);
      rows.push(...skillSettingsRows(name,settings));
    }
  }
  return rows;
}
export function robotRows(plan){
  const d=plan.setup.dobot;if(!d)return [];
  return [
    ['Robot setup',d.configurationSource??'Not configured; supply installation settings through chat'],
    ['Tool / user frame',value(d.toolFrame)+' / '+value(d.userFrame)],
    ['Nozzle orientation',value(d.rDeg)+'° fixed'],
    ['XY calibration scale',value(d.scaleX)+' / '+value(d.scaleY)],
    ['XY calibration offset',value(d.offsetXMm)+' / '+value(d.offsetYMm)+' mm'],
    ['Bed Z offset',value(d.bedZMm)+' mm'],
    ['External starting position',value(d.initialPositionMm)+' mm in design coordinates'],
    ['Controller workspace minimum',value(d.workspaceMinMm)+' mm'],
    ['Controller workspace maximum',value(d.workspaceMaxMm)+' mm'],
    ['Controller linear speed limit',value(d.maxLinearSpeedMmS)+' mm/s'],
    ['Controller acceleration limit',value(d.maxLinearAccelMmS2)+' mm/s²'],
    ['Commanded acceleration',value(d.accelerationPercent)+'%'],
    ['Extrusion output',value(d.extrusionOutput)],
    ['Extrusion policy',value(d.relayPolicy)],
    ['External extrusion rate',value(d.extrusionRateMm3S)+' mm³/s; estimate only'],
    ['Thermal control',value(d.temperatureControl)],
    ['Externally established nozzle / bed temperature',plan.setup.nozzleC+' / '+plan.setup.bedC+'°C']
  ];
}
