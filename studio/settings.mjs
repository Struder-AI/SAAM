import {planarWallTolerance} from '../core/machine/rules.mjs';
import {filamentPlan,assignedFilaments} from '../core/machine/filaments.mjs';
// Human-readable review of the same locked recipe used by every adapter.
const supportSkills=['supports'];
export const skillName=name=>({'pipe-cladding':'Surface cladding','vase-wall':'Vase wall',supports:'Tree supports'}[name]??name);
export const hasConstruction=(plan,kind)=>(plan.slices?.assignments??[]).some(a=>a.construction===kind);
export const pathModeName=settings=>settings?.pathMode==='segmented'?'Segmented paths':settings?.pattern?'Continuous sleeve pattern':'Vase wall';
export const hasSkill=(plan,name)=>Boolean(plan.skills?.[name]?.enabled);
const value=v=>v===null||v===undefined?'Not set':Array.isArray(v)?v.join(', '):String(v);
export const claddingPatternName=settings=>settings.pattern==='crossed-helices'?'crossed helices':'axial / circumferential';
export function claddingSubstrateName(plan,clad=plan.slices.assignments.find(a=>a.construction==='cladding')){
  if(clad.source!==null)return clad.source+' · deposited surface';
  const sources=(plan.slices?.assignments??[]).filter(a=>a.id!==clad.id&&a.preset!=='support'&&a.part===clad.part);
  return sources.length?sources.map(a=>a.id).join(' + ')+' · deposited surface':'No deposited source';
}
const fields={
  lineSpacingMm:['Wave spacing along surface',' mm'],beadHeightMm:['Bead height',' mm'],speedMmS:['Deposition speed',' mm/s'],
  fanPercent:['Part cooling','%'],propagationStepMm:['Surface propagation step',' mm'],
  spacingFactor:['Line spacing','× nominal spacing; bead width unchanged'],
  pattern:['Pattern',''],topGapMm:['Minimum top gap',' mm'],xyGapMm:['Part clearance',' mm'],treeChordMm:['Branch contour tolerance',' mm'],
  perimeters:['Walls',''],layers:['Skin layers',''],normalMm:['Skin thickness per layer',' mm'],
  strokeAngleDeg:['Stroke direction','°'],sampleStepMm:['Maximum sampling step',' mm'],surveyStepMm:['Surface survey grid',' mm'],
  maxAngleDegOverride:['Experimental angle override','°'],zStartMm:['Start above component base',' mm'],zEndMm:['End above component base',' mm'],
  toleranceMm:['Contour tolerance',' mm'],boundaryToleranceMm:['Boundary tolerance',' mm'],offsetTightness:['Offset tightness',' · 0 loose / 1 exact'],endTransition:['Wall ending','']
};
export function skillSettingsRows(name,settings,prefix=skillName(name)){
  if(name==='vase-wall'&&settings.pathMode==='segmented')prefix=prefix.replace(skillName(name),'Segmented paths');
  const rows=[];
  for(const [key,v] of Object.entries(settings)){
    if(['enabled','part','parts','construction','id','filament','process','after'].includes(key))continue;
    if(name==='vase-wall'&&key==='meshSleeve'){
      if(v)rows.push([prefix+' · Mesh reference','Smooth fitted spline sleeve'],
        [prefix+' · Mesh fidelity',Math.round(v.fidelity*10000)/100+'% · continuous unilateral contact'],
        [prefix+' · Contour offset','Native spline contours, resolved at crossings'],
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
        const tiled=Boolean(v.tile),paths=tiled?[v.tile]:v.paths;
        rows.push([prefix+' · Pattern','Repeated tile on the selected solid or sleeve'],
          [prefix+' · Deposition','Pattern strokes only; the sleeve is not printed'],
          [prefix+' · Repetitions',String(v.repeats)],
          [prefix+' · Advance',tiled?'1 perimeter turn / '+v.courseRiseMm+' mm rise':v.advance[0]+' perimeter turns / '+v.advance[1]+' mm rise'],
          [prefix+' · Mapping',settings.meshSleeve?'Smooth fitted sleeve, followed by one-sided mesh contact':'Actual inset contour at each height; fraction of perimeter length']);
        if(tiled)rows.push([prefix+' · Tiling',v.cellsPerTurn+' cells per course × '+v.repeats+' courses'],
          [prefix+' · Tile tilt',v.tiltDeg+'° about the cell advance direction']);
        for(const [i,path] of paths.entries())rows.push(
          [prefix+' · Pattern path '+(i+1),path.points.length+' points'],
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
        rows.push([prefix+' · '+a.id,a.reason],
          [a.id+' · Contact height',a.contactZMm+' mm above bed']);
        for(const n of a.treeNodes)rows.push([a.id+' · '+n.id,n.point.join(', ')+' mm · radius '+n.radiusMm+' mm · '+(n.parent===null?'bed root':'from '+n.parent)]);
      }
      continue;
    }
    const [label,unit]=fields[key]??[key,''];
    const rendered=key==='pattern'&&name==='pipe-cladding'?claddingPatternName(settings)
      :key==='maxAngleDegOverride'&&v===null?'Machine profile limit'
      :key==='zEndMm'&&v===null?'Geometry top'
      :key==='endTransition'?(settings.pattern?({'level':'Flat pattern courses at both ends','spiral':'Authored pattern ending'}[v]??value(v)):({'level':'Level rim','spiral':'Spiral rim'}[v]??value(v)))
      :value(v)+unit;
    rows.push([prefix+' · '+label,rendered]);
  }
  return rows;
}
// Slice assignments in definition order: where each owner slices and how.
const volumeName=v=>v.kind==='slab'?(v.toMm===null?v.fromMm+' mm to top':v.fromMm+'–'+v.toMm+' mm'):v.kind==='geometry'?'assigned volume'
  :v.kind==='outline'?'first-layer outline':'footprint to '+v.contactZMm+' mm';
export function sliceSummary(a){
  if(a.construction==='inject')return a.points.length+' injection point(s) · '+a.points.reduce((sum,p)=>sum+p.volumeMm3,0)+' mm³ authored volume';
  if(a.construction==='rim')return a.steps.join(', ')+' rings per course · source '+a.source;
  if(a.construction==='cladding')return a.shells+' surface courses · '+claddingPatternName(a);
  if(a.construction==='sleeve')return pathModeName(a)+' · '+a.zStartMm+'–'+(a.zEndMm??'geometry top')+' mm';
  if(a.construction==='skin')return a.layers+' roof courses · '+a.pitchMm+' mm mean normal gap';
  if(a.construction==='fronts')return 'Seeded surface fronts · '+a.lineSpacingMm+' mm spacing';
  if(a.construction==='curves')return a.curves.length+' centerline(s) · '+(a.repeat?.count??1)+' course(s)';
  if(a.construction==='bridges')return a.bridges.length+' bridge(s)';
  if(a.preset==='brim')return a.loops+(a.loops===1?' loop':' loops')+' around the first-layer outline';
  const fill=a.fillDensity>=1?'solid':a.fillDensity===0?'no fill':Math.round(a.fillDensity*100)+'% '+a.fillPattern+' fill';
  const solid=a.fillDensity<1&&(a.solidBottom||a.solidTop)?[a.preset==='support'?a.solidTop+' interface layers':a.solidBottom+' bottom / '+a.solidTop+' top solid layers']:[];
  return [a.loops+(a.loops===1?' loop':' loops'),fill,...solid].join(' · ');
}
export function sliceRows(plan){
  return (plan.slices?.assignments??[]).flatMap(a=>[...(a.construction?(a.construction==='inject'?injectionRows(a):['skin','fronts'].includes(a.construction)?surfaceAssignmentRows(a):curveAssignmentRows(a)):[
    [a.id,(a.preset==='support'?'Support':(a.part??'Part'))+' · '+(a.within.length?a.within.map(volumeName).join(' within '):'the rest of the part')+' · '+sliceSummary(a)],
    [a.id+' · Fill directions',a.fillAnglesDeg.join(', ')+'°'+(a.rotateFill&&a.fillAnglesDeg.length>1?', alternating by layer':'')],
    ...(a.stack?[[a.id+' · Layers',a.stack.firstLayerMm+' mm first, then '+a.stack.layerMm+' mm']]:[]),
    [a.id+' · Reference',sliceReferenceName(a.surface)],
    ...(a.spacingFactor!==1?[[a.id+' · Line spacing',a.spacingFactor+'× nominal spacing; bead width unchanged']]:[])
  ]),
    ...(a.filament!==null?[[a.id+' · Filament',String(a.filament+1)]]:[]),
    ...Object.entries(a.process??{}).map(([key,v])=>[a.id+' · '+({firstLayerMm:'First layer',layerMm:'Layer pitch',lineWidthMm:'Bead width',planarSpeedMmS:'Deposition speed',firstLayerSpeedMmS:'First-layer speed',fanPercent:'Part cooling'}[key]??key),v+(key==='fanPercent'?'%':key.endsWith('MmS')?' mm/s':' mm')])
  ]);
}
export function injectionPoints(plan){
  return (plan.slices?.assignments??[]).filter(a=>a.construction==='inject').flatMap(a=>a.points.map((p,index)=>({...p,id:`${a.id}:${index}`})));
}
export function depositionFamilyRows(plan,inspection){
  const families=new Map();
  for(const operation of Object.values(inspection?.operations??{})){
    if(!families.has(operation.family))families.set(operation.family,new Set());
    families.get(operation.family).add(operation.index);
  }
  return [...families].map(([id,indices])=>{
    const kind=plan.slices.assignments.find(a=>a.id===id)?.construction;
    return [id+' · Family',indices.size+' '+(kind==='inject'?'injection point(s)':kind==='curves'?'trace course(s)':kind==='bridges'?'bridge course(s)':'slice(s)')];
  });
}
function injectionRows(a){
  return [[a.id,sliceSummary(a)],[a.id+' · Print after',a.dependencies.after.join(', ')||'Shared dependency order'],[a.id+' · Temperature',a.nozzleC===null?'Selected material setup':a.nozzleC+'°C, then restore setup'],
    ...a.points.flatMap((p,index)=>[[a.id+' · Point '+(index+1),p.point.join(', ')+' mm before XY placement'],
      [a.id+' · Injection '+(index+1),p.volumeMm3+' mm³ at '+p.flowMm3S+' mm³/s · '+p.holdSeconds+' s hold · '+p.approachMm+' mm vertical approach']])];
}
function sliceReferenceName(surface){
  if(!surface||surface.kind==='horizontal')return 'Horizontal plane';
  if(surface.kind==='plane')return 'Plane at '+surface.origin.join(', ')+' mm · normal '+surface.normal.join(', ');
  return (surface.kind==='roof'?'Part roof':'Spline surface')+' · vertical offset '+surface.offsetMm+' mm';
}
function curveAssignmentRows(a){
  const rows=[[a.id,sliceSummary(a)],[a.id+' · Print after',(a.after??a.dependencies?.after??[]).join(', ')||'Shared dependency order']];
  if(a.construction==='sleeve')return [...rows,[a.id+' · Part',a.part??'Part'],...skillSettingsRows('vase-wall',a,a.id)];
  if(a.construction==='rim')return [...rows,[a.id+' · Part',a.part??'Part'],[a.id+' · Minimum feature',a.minFeatureMm+' mm']];
  if(a.construction==='cladding')return [...rows,[a.id+' · Part',a.part??'Part'],[a.id+' · Source',a.source??'Finalized producers of the selected part'],
    [a.id+' · Thickness / tilt',a.normalMm+' mm per course · '+a.tiltDeg+'°'],[a.id+' · Line spacing',a.spacingFactor+'× nominal'],
    [a.id+' · Offset tightness',a.offsetTightness+' · 0 loose / 1 normal distance']];
  if(a.construction==='curves'){
    if(a.repeat)rows.push([a.id+' · Repetition',a.repeat.family?'Family '+a.repeat.family+' · '+(a.repeat.indices?.join(', ')??'all layers'):a.repeat.translation.join(', ')+' mm × '+a.repeat.count]);
    for(const [i,c] of a.curves.entries()){
      const label=a.id+' · Curve '+(i+1);
      const source=c.text?'Text “'+c.text.text+'” · '+c.text.fontId:c.uv?'UV '+c.uv.reference.kind+' reference':c.nurbs?'NURBS degree '+c.nurbs.degree:c.points.length+' points';
      rows.push([label,(c.closed?'Closed':'Open')+' · '+source+' · '+(c.role??'trace')]);
      if(c.courses)rows.push([label+' courses',c.courses.map(n=>n+1).join(', ')]);
      for(const [key,title,unit] of [['beadWidthMm','Bead width',' mm'],['heightMm','Bead height',' mm'],['speedMmS','Speed',' mm/s'],['flowMultiplier','Flow multiplier','×']])
        if(c[key]!==undefined)rows.push([label+' · '+title,c[key]+unit]);
    }
  }else{
    rows.push([a.id+' · Maximum vertical excursion',a.maxExcursionMm+' mm']);
    for(const b of a.bridges){
      const label=a.id+' · '+b.id;
      rows.push([label,b.mode+' · '+b.rails[0].length+' spans'],[label+' · Support',b.supportBridge??'Finalized model deposition'],
        [label+' · Span',b.speedMmS+' mm/s · '+b.flowMultiplier+'× flow'],
        [label+' · Attachment',b.attachmentSpeedMmS+' mm/s · '+b.overlapMm+' mm overlap · '+b.pressMm+' mm press'],
        [label+' · Approach',b.leadInMm+' mm lead · '+b.jogMm+' mm jog']);
      if(b.endAttachment){const e=b.endAttachment;rows.push([label+' · End attachment',e.speedMmS+' mm/s · '+e.flowMultiplier+'× flow · '+e.overlapMm+' mm overlap · '+e.pressMm+' mm press · '+e.jogMm+' mm jog']);}
    }
  }
  return rows;
}
function surfaceAssignmentRows(a){
  const rows=[[a.id,sliceSummary(a)],[a.id+' · Print after',(a.after??a.dependencies?.after??[]).join(', ')||'Shared dependency order']];
  if(a.construction==='skin')rows.push([a.id+' · Roof',a.part??'Part'],[a.id+' · Substrate source',a.supportFrom??'Part body'],[a.id+' · Stroke direction',a.strokeAngleDeg+'°'],
    [a.id+' · Spacing',a.spacingFactor+'× nominal'],[a.id+' · Angle limit',a.maxAngleDegOverride===null?'Machine profile':a.maxAngleDegOverride+'° experimental override']);
  else rows.push([a.id+' · Surface',a.surface.kind==='patch'?(a.surface.part??'Part')+' / '+a.surface.patch:'Authored spline reference'],
    [a.id+' · Seed',a.seedUv.length+' supported loop(s) · '+a.reason],
    [a.id+' · Process',a.beadHeightMm+' mm bead height · '+a.speedMmS+' mm/s · '+a.fanPercent+'% fan'],
    [a.id+' · Supporting parts',a.afterParts.map(p=>p??'Part').join(', ')||'Externally supported seed'],
    [a.id+' · Before parts',a.beforeParts.map(p=>p??'Part').join(', ')||'No assigned successor']);
  return rows;
}
export function recipeRows(plan,machine){
  const composition=plan.composition,rows=[];
  rows.push(['Experimental substrate adaptation',plan.experimental?.substrateAdaptation?'On · final deposited contact sets gap and volume; surface-following constructions may change placement':'Off · nominal reference geometry and bead rules']);
  if(plan.setup.bambu){
    rows.push(['Bambu startup',plan.setup.bambu.fast_start?'Fast — reuse calibration; skip optional scans and vibration tests':'Full — calibration follows startup controls / printer choices']);
    const used=[...new Set([plan.setup.bambu.filament,...assignedFilaments(plan)].filter(i=>i!==undefined))];
    const change=machine.outputs.find(o=>o.id===plan.output)?.constraints;
    if(used.length>1&&change?.materialChangeMode==='single-nozzle-ams')rows.push(['AMS colour changes',`${change.materialChangeFlushMm3} mm³ purged into the rear chute per change, plus priming. No tower; service time/material are additional to part totals.`]);
    for(const id of used){
      const selected=filamentPlan(plan,machine,id),s=selected.setup,p=selected.process,entry=plan.setup.bambu.filaments?.[id];
      const source=entry?.source?.type==='external'?'External spool':entry?.source?.type==='ams-ht'?`Requested AMS HT ${entry.source.unit}`:s.ams?`Requested AMS ${s.ams.unit}, slot ${s.ams.slot}`:'Automatic material/colour matching';
      rows.push([`Filament ${id+1}`,`${machine.tools.find(t=>t.index===s.tool).label} · ${s.nozzleMm} mm nozzle · ${s.material} ${entry?.colour??s.filamentColor??''} · ${s.nozzleC}°C · ${source}`],
        [`Filament ${id+1} · Process`,`${p.lineWidthMm} mm bead · ${p.layerMm} mm layers · ${p.maxFlowMm3S} mm³/s maximum flow`]);
    }
  }
  rows.push(['Machine · Planar wall tolerance',planarWallTolerance(machine)+' mm'],...sliceRows(plan));
  for(const m of plan.modulations?.modifiers??[])rows.push([m.id+' · Modulation',m.channel+' · '+m.field.kind+' field · amplitude '+m.amplitude+(m.channel==='displacement'?' mm':'')],
    [m.id+' · Applies to',(m.assignments?.join(', ')??'All assignments')+' · '+(m.roles?.join(', ')??'All stroke roles')],
    ...(m.direction?[[m.id+' · Direction',typeof m.direction==='string'?m.direction:m.direction.join(', ')+' in '+(m.frame??'world')+' coordinates']]:[]),
    [m.id+' · Placement',(m.frame??'world')+' frame'+(m.layers?' · layers '+m.layers.from+'–'+m.layers.to:'')+(m.topN?' · top '+m.topN+' layers':'')+(m.phasePerLayerRad?' · '+m.phasePerLayerRad+' rad phase per layer':'')]);
  if(composition){
    rows.push(['Layer batching',composition.batchLayers+' layer(s) per component'],
      ['Requested operation order',composition.order.length?composition.order.join(' → '):'Shared dependency order'],
      ['Additional dependencies',composition.dependencies.length?composition.dependencies.map(e=>e.before+' → '+e.after).join('; '):'None']);
  }
  if(plan.skills){
    for(const [name,settings] of Object.entries(plan.skills))if(settings.enabled){
      rows.push([(name==='vase-wall'?pathModeName(settings):skillName(name))+' · Component',supportSkills.includes(name)?'Explicitly assigned supports':settings.parts?.join(', ')||settings.part||'All selected geometry']);
      rows.push(...skillSettingsRows(name,settings));
    }
  }
  return rows;
}
export function robotRows(plan,machine){
  const c=plan.setup.denso;
  if(c)return [
    ['Robot / controller',machine?.name??'DENSO / RC8A'],['Installation basis',c.configurationSource??'Not configured'],['Mounting',c.mounting],
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
