import {planarWallTolerance} from '../core/machine/rules.mjs';
// Human-readable review of the same locked recipe used by every adapter.
const supportSkills=['supports','rimming-planar','rimming-normal'];
const globalSkills=[...supportSkills,'pipe-cladding','wave-overhangs'];
export const skillName=name=>({'line-network':'Line network','pipe-cladding':'Surface cladding','full-fill':'Full fill','planar-infill':'Planar infill','vase-wall':'Vase wall','draped-skin':'Draped skin',supports:'Supports','rimming-planar':'Rimming · horizontal offsets','rimming-normal':'Rimming · normal offsets (experimental)'}[name]??name);
export const pathModeName=settings=>settings?.pathMode==='segmented'?'Segmented paths':settings?.pattern?'Continuous sleeve pattern':'Vase wall';
export const hasSkill=(plan,name)=>globalSkills.includes(name)?Boolean(plan.skills?.[name]?.enabled):plan.composition?.regions?.length
  ?plan.composition.regions.some(region=>Object.hasOwn(region.skills,name))
  :Boolean(plan.skills?.[name]?.enabled);
const value=v=>v===null||v===undefined?'Not set':Array.isArray(v)?v.join(', '):String(v);
export const claddingPatternName=settings=>settings.pattern==='crossed-helices'?'crossed helices':'axial / circumferential';
export function claddingSubstrateName(plan){
  const clad=plan.skills['pipe-cladding'];
  if(!clad.surface)return 'Concentric horizontal loops';
  const regions=plan.composition?.regions??[],part=clad.part;
  const names=regions.length?regions.filter(r=>r.part===part).flatMap(r=>Object.keys(r.skills)):
    ['full-fill','planar-infill','vase-wall','draped-skin'].filter(name=>{
      const s=plan.skills[name];return s.enabled&&(plan.geometry.shape!=='assembly'||(s.parts?!s.parts.length||s.parts.includes(part):s.part===part));
    });
  return [...new Set(names)].map(skillName).join(' + ')+' · finished surface';
}
const fields={
  lineSpacingMm:['Wave spacing along surface',' mm'],beadHeightMm:['Bead height',' mm'],speedMmS:['Deposition speed',' mm/s'],
  fanPercent:['Part cooling','%'],propagationStepMm:['Surface propagation step',' mm'],
  spacingFactor:['Line spacing','× nominal spacing; bead width unchanged'],
  pattern:['Pattern',''],interfaceDensity:['Interface fraction',''],
  interfaceLayers:['Interface layers',''],topGapMm:['Minimum top gap',' mm'],xyGapMm:['Part clearance',' mm'],treeChordMm:['Branch contour tolerance',' mm'],
  mode:['Fill mode',''],bottomLayers:['Solid bottom layers',''],topLayers:['Solid top layers',''],
  perimeters:['Walls',''],density:['Infill fraction',''],fillAnglesDeg:['Fill directions','°'],fillOverlap:['Wall overlap (bead fraction)',''],
  minFeatureMm:['Smallest sampled feature',' mm'],layers:['Skin layers',''],normalMm:['Skin thickness per layer',' mm'],
  strokeAngleDeg:['Stroke direction','°'],sampleStepMm:['Maximum sampling step',' mm'],surveyStepMm:['Surface survey grid',' mm'],
  maxAngleDegOverride:['Experimental angle override','°'],zStartMm:['Start above component base',' mm'],zEndMm:['End above component base',' mm'],
  toleranceMm:['Contour tolerance',' mm'],boundaryToleranceMm:['Boundary tolerance',' mm'],offsetTightness:['Offset tightness',' · 0 loose / 1 exact'],endTransition:['Wall ending','']
};
export function skillSettingsRows(name,settings,prefix=skillName(name)){
  if(name==='vase-wall'&&settings.pathMode==='segmented')prefix=prefix.replace(skillName(name),'Segmented paths');
  const rows=[];
  for(const [key,v] of Object.entries(settings)){
    if(['enabled','part','parts'].includes(key))continue;
    if(name==='line-network'&&key==='layers'){
      rows.push([prefix+' · Courses',String(v)]);continue;
    }
    if(name==='line-network'&&key==='networks'){
      rows.push([prefix+' · Independent faces',String(v.length)],
        [prefix+' · Centerline strokes',String(v.reduce((sum,network)=>sum+network.strokes.length,0))]);continue;
    }
    if(name==='wave-overhangs'&&key==='slices'){
      for(const s of v)rows.push([s.id+' · Wave slice',s.reason],
        [s.id+' · Surface',s.surface.patch?`${s.surface.part??'Part'} / ${s.surface.patch}`:`Spline degrees ${s.surface.degreeU}/${s.surface.degreeV}; ${s.surface.controlPoints.length} × ${s.surface.controlPoints[0].length} controls`],
        [s.id+' · Seed / region',`${s.seedUv.length} supported seed loop(s); ${s.domainUv.length} region loop(s)`],
        [s.id+' · Print after',s.afterParts.map(p=>p??'Part').join(', ')||'Previously present support'],
        [s.id+' · Print before',s.beforeParts.map(p=>p??'Part').join(', ')||'No assigned successor']);
      continue;
    }
    if(name==='vase-wall'&&key==='meshSleeve'){
      if(v)rows.push([prefix+' · Mesh reference','Smooth fitted spline sleeve'],
        [prefix+' · Mesh fidelity',Math.round(v.fidelity*10000)/100+'% · continuous unilateral contact'],
        [prefix+' · Offset tightness',Math.round((v.offsetTightness??0)*10000)/100+'% · loose to exact normal distance'],
        [prefix+' · Contact side',v.contactSide==='inside'?'Keep pattern inside mesh envelope':'Keep pattern outside mesh envelope'],
        [prefix+' · Spline fit',v.circumferentialControls+' circumferential × '+v.heightControls+' height controls'],
        [prefix+' · Mesh detail tolerance',v.detailToleranceMm+' mm']);
      continue;
    }
    if(name==='vase-wall'&&key==='sleeveToleranceMm'){
      // Only the ordinary continuous wall uses this; a configured mesh sleeve or
      // an authored pattern own their own following behavior above.
      if(!settings.meshSleeve&&settings.pattern===null)rows.push([prefix+' · Wall following',v>0
        ?'Fitted NURBS sleeve within '+v+' mm; exact inset on thin or non-sleeve walls'
        :'Exact inset contour at every height']);
      continue;
    }
    if(key==='spacingFactor'&&v===1)continue;
    if(key==='pattern'&&name==='vase-wall'){
      if(v){
        const tiled=Boolean(v.motif),paths=tiled?[v.motif]:v.paths;
        rows.push([prefix+' · Pattern','Repeated motif on the selected solid or sleeve'],
          [prefix+' · Deposition','Motif strokes only; the guide surface is not printed'],
          [prefix+' · Repetitions',String(v.repeats)],
          [prefix+' · Advance',tiled?'1 perimeter turn / '+v.courseRiseMm+' mm rise':v.advance[0]+' perimeter turns / '+v.advance[1]+' mm rise'],
          [prefix+' · Mapping',settings.meshSleeve?'Smooth fitted sleeve, followed by one-sided mesh contact':'Actual inset contour at each height; fraction of perimeter length']);
        if(tiled)rows.push([prefix+' · Motif tiling',v.cellsPerTurn+' cells per course × '+v.repeats+' courses'],
          [prefix+' · Motif tilt',v.tiltDeg+'° about the cell advance direction']);
        for(const [i,path] of paths.entries())rows.push(
          [prefix+' · Motif path '+(i+1),path.points.length+' points'],
          [prefix+' · Start / end '+(i+1),path.points[0].join(', ')+' → '+path.points.at(-1).join(', ')+(tiled?' (cell fraction, mm)':' (turns, mm)')],
          [prefix+' · Bead height '+(i+1),Array.isArray(path.beadHeightMm)?path.beadHeightMm.join(', ')+' mm':path.beadHeightMm+' mm']);
        for(const [i,path] of paths.entries())if(path.offsetMm!==undefined){
          const values=Array.isArray(path.offsetMm)?path.offsetMm:[path.offsetMm];
          rows.push([prefix+' · Contour offset '+(i+1),Math.min(...values)+' to '+Math.max(...values)+' mm; negative extends inward']);
        }
        rows.push([prefix+' · Connections',settings.pathMode==='segmented'?'Shared travel across mapped gaps':'Continuous at mapped endpoints and repeat boundaries']);
      }
      continue;
    }
    if(key==='pathMode'){
      rows.push([prefix+' · Mode',v==='segmented'?'Segmented paths':'Continuous vase']);continue;
    }
    if(key==='surface'){
      rows.push([prefix+' · Surface',v?(v.kind==='spline'?'Native spline: '+v.patch:'Explicit mesh strip'):'Circular pipe'],
        [prefix+' · Boundary',v?'Substrate surface; cladding adds outward':'Finished pipe; cladding reserved inward']);
      continue;
    }
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
    const rendered=key==='pattern'&&name==='pipe-cladding'?claddingPatternName(settings)
      :key==='maxAngleDegOverride'&&v===null?'Machine profile limit'
      :key==='zEndMm'&&v===null?'Geometry top'
      :key==='endTransition'?(settings.pattern?({'level':'Flat motif courses at both ends','spiral':'Authored motif ending'}[v]??value(v)):({'level':'Level rim','spiral':'Spiral rim'}[v]??value(v)))
      :value(v)+unit;
    rows.push([prefix+' · '+label,rendered]);
  }
  return rows;
}
export function regionRows(plan){
  return (plan.composition?.regions??[]).flatMap(region=>[
    [region.id,(region.part??'Part')+' · '+(region.zEndMm===null?region.zStartMm+' mm to geometry top':region.zStartMm+'–'+region.zEndMm+' mm')+' · '+Object.keys(region.skills).map(name=>name==='vase-wall'?pathModeName({...plan.skills[name],...region.skills[name]}):skillName(name)).join(' + ')],
    ...(region.lowerSurfaceFrom?[[region.id+' · Bottom','Follows the finished surface of '+region.lowerSurfaceFrom]]:[])
  ]);
}
export function recipeRows(plan,machine){
  const composition=plan.composition,regions=composition?.regions??[],rows=[];
  rows.push(['Machine · Planar wall tolerance',planarWallTolerance(machine)+' mm']);
  if(composition){
    rows.push(['Layer batching',composition.batchLayers+' layer(s) per component'],
      ['Requested operation order',composition.order.length?composition.order.join(' → '):'Shared dependency order'],
      ['Additional dependencies',composition.dependencies.length?composition.dependencies.map(e=>e.before+' → '+e.after).join('; '):'None']);
  }
  if(regions.length){
    for(const name of globalSkills)if(plan.skills?.[name]?.enabled)rows.push(...skillSettingsRows(name,plan.skills[name]));
    if(hasSkill(plan,'pipe-cladding'))rows.push(['Cladding component',plan.skills['pipe-cladding'].part??'Part']);
    rows.push(...regionRows(plan));
    for(const region of regions)for(const [name,overrides] of Object.entries(region.skills))rows.push(
      ...skillSettingsRows(name,{...plan.skills[name],...overrides},region.id+' · '+skillName(name))
        .filter(([label])=>!label.endsWith('above component base')));
  }else if(plan.skills){
    for(const [name,settings] of Object.entries(plan.skills))if(settings.enabled){
      rows.push([(name==='vase-wall'?pathModeName(settings):skillName(name))+' · Component',supportSkills.includes(name)?'Explicitly assigned supports':settings.parts?.join(', ')||settings.part||'All selected geometry']);
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

// Only explicit version tokens advance; ordinary friendly names stay stable.
export function nextExportName(name){
  const match=/^(.*-V)(\d+)(-.+)$/i.exec(name.trim());
  return match?match[1]+(Number(match[2])+1)+match[3]:name;
}
