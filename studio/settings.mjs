// Human-readable review of the same locked recipe used by every adapter.
const supportSkills=['supports','rimming-planar','rimming-normal'];
export const skillName=name=>({'full-fill':'Full fill','planar-infill':'Planar infill','vase-wall':'Vase wall','draped-skin':'Draped skin',supports:'Supports','rimming-planar':'Rimming · horizontal offsets','rimming-normal':'Rimming · normal offsets (experimental)'}[name]??name);
export const hasSkill=(plan,name)=>supportSkills.includes(name)?Boolean(plan.skills?.[name]?.enabled):plan.composition?.regions?.length
  ?plan.composition.regions.some(region=>Object.hasOwn(region.skills,name))
  :Boolean(plan.skills?.[name]?.enabled);
const value=v=>v===null||v===undefined?'Not set':Array.isArray(v)?v.join(', '):String(v);
const fields={
  pattern:['Pattern',''],maxPatternCells:['Pattern cell budget',''],interfaceDensity:['Interface fraction',''],
  interfaceLayers:['Interface layers',''],topGapMm:['Minimum top gap',' mm'],xyGapMm:['Part clearance',' mm'],treeChordMm:['Branch contour tolerance',' mm'],
  mode:['Fill mode',''],bottomLayers:['Solid bottom layers',''],topLayers:['Solid top layers',''],
  perimeters:['Walls',''],density:['Infill fraction',''],fillAnglesDeg:['Fill directions','°'],fillOverlap:['Wall overlap (bead fraction)',''],
  minFeatureMm:['Smallest sampled feature',' mm'],layers:['Skin layers',''],normalMm:['Skin thickness per layer',' mm'],
  strokeAngleDeg:['Stroke direction','°'],sampleStepMm:['Maximum sampling step',' mm'],surveyStepMm:['Surface survey grid',' mm'],
  maxAngleDegOverride:['Experimental angle override','°'],zStartMm:['Start above component base',' mm'],zEndMm:['End above component base',' mm'],
  toleranceMm:['Contour tolerance',' mm'],boundaryToleranceMm:['Boundary tolerance',' mm'],maxPoints:['Point budget',''],endTransition:['Wall ending','']
};
export function skillSettingsRows(name,settings,prefix=skillName(name)){
  const rows=[];
  for(const [key,v] of Object.entries(settings)){
    if(['enabled','part','parts'].includes(key))continue;
    if(key==='surfaces'){
      for(const s of v){
        rows.push([prefix+' · '+s.id,s.reason],[s.id+' · Base',s.baseEdge+(s.basePart?' on '+s.basePart:'')],
          [s.id+' · Supported edge',s.supportedEdge+(s.supportedPart?' on '+s.supportedPart:'')],
          [s.id+' · Wall','Two beads outward from the assigned reference surface; exact-edge contact'],
          [s.id+' · Reference surface',s.controlPoints.map(row=>row.map(p=>'('+p.join(', ')+')').join(' → ')).join('; ')+' mm; degrees '+s.degreeU+'/'+s.degreeV],
          [s.id+' · Outward side',s.outwardSide===1?'Along surface normal':'Opposite surface normal']);
      }
      continue;
    }
    if(key==='assignments'){
      for(const a of v){
        rows.push([prefix+' · '+a.id,a.style+' · '+a.reason],
          [a.id+' · Contact height',a.contactZMm+' mm above bed']);
        if(a.style==='standard')rows.push([a.id+' · Footprint',a.footprint.map(loop=>loop.map(p=>'('+p.join(', ')+')').join(' → ')).join('; ')+' mm from part placement']);
        else for(const n of a.treeNodes)rows.push([a.id+' · '+n.id,n.point.join(', ')+' mm · radius '+n.radiusMm+' mm · '+(n.parent===null?'bed root':'from '+n.parent)]);
      }
      continue;
    }
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
    ...(region.lowerSurfaceFrom?[[region.id+' · Bottom','Follows the finished surface of '+region.lowerSurfaceFrom]]:[])
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
    for(const name of supportSkills)if(plan.skills?.[name]?.enabled)rows.push(...skillSettingsRows(name,plan.skills[name]));
    rows.push(...regionRows(plan));
    for(const region of regions)for(const [name,overrides] of Object.entries(region.skills))rows.push(
      ...skillSettingsRows(name,{...plan.skills[name],...overrides},region.id+' · '+skillName(name))
        .filter(([label])=>!label.endsWith('above component base')));
  }else if(plan.skills){
    for(const [name,settings] of Object.entries(plan.skills))if(settings.enabled){
      rows.push([skillName(name)+' · Component',supportSkills.includes(name)?'Explicitly assigned supports':settings.parts?.join(', ')||settings.part||'All selected geometry']);
      rows.push(...skillSettingsRows(name,settings));
    }
  }
  return rows;
}
export function robotRows(plan){
  const c=plan.setup.denso;
  if(c)return [
    ['Robot / controller','DENSO VP-6242 / RC8'],['Installation basis',c.configurationSource??'Not configured'],['Mounting',c.mounting],
    ['Tool / work frame',value(c.toolFrame)+' / '+value(c.workFrame)],['Arm group / figure',value(c.armGroup)+' / '+value(c.figure)],
    ['Rotary interface',c.rotaryInterface??'Not confirmed'],['External axis',c.rotaryAxis+' · sign '+c.rotarySign+' · zero '+c.rotaryZeroDeg+'°'],
    ['Rotary center',value(c.rotaryCenterMm)+' mm'],['Work offset / yaw',value(c.workOffsetMm)+' mm / '+c.workYawDeg+'°'],
    ['External starting point',value(c.initialPositionMm)+' mm'],['Starting bed angle',c.initialPose.rotaryDeg+'°'],
    ['Starting tool direction',value(c.initialPose.toolAxis)],['Starting tool up',value(c.initialPose.toolUp)],
    ['Relay output / rate',value(c.extrusionOutput)+' / '+value(c.extrusionRateMm3S)+' mm³/s; estimate'],
    ['Transition retreat / time',c.retreatMm+' mm / '+c.transitionSeconds+' s'],['Heating',c.temperatureControl+' · '+plan.setup.nozzleC+' / '+plan.setup.bedC+'°C'],
    ['Motion interpretation','Nominal Cartesian / rotary progress; controller IK; robot feasibility deferred']
  ];
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
// User-selected display estimate: 1.2 g/cm³, shared by all materials/machines.
export const materialGrams=volumeMm3=>volumeMm3*1.2/1000;
