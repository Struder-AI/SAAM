// The side panels: the shown print's facts, settings and guidance, review notes,
// and which controls the person can use now.
import {materialGrams,sliceSummary,depositionFamilyRows,hasConstruction,recipeRows} from './settings.mjs';
import {inspectionTypeTitle} from './inspection-ui.mjs';
import {outputView} from './refresh-plan.mjs';
import {completedOutputState} from '../core/print/review-state.mjs';
import {studioControls} from './studio-controls.mjs';

export function createPanels(ctx){
  // The page's records and values this part uses; ctx.NAME marks another part.
  const {$,$$,exportKey,exportedThisSession,machinePose,playState,printSync,studioWork,
    viewState}=ctx;
  function updateMachineStatus(sample=ctx.machineSample()){
    if(printSync.state?.inspection){$('#machine-control').hidden=true;$('#machine-info').hidden=true;$('#machine-status').textContent='Retained value · no machine pose';return;}
    const scene=machinePose.machineSession?.scene,pose=sample?.pose;
    $('#machine-control').hidden=viewState.tab!=='toolpath'||!ctx.presentedState()?.program||!ctx.presentedState()?.machine;
    $('#machine-view').checked=ctx.cameras.mode==='machine';$('#machine-view').disabled=studioWork.busy||(!pose&&ctx.cameras.mode!=='machine');
    $('#machine-info').hidden=viewState.tab!=='toolpath'||(!scene&&!machinePose.machineSession?.error);
    const diagnostic=sample?.snapshot?.diagnostics.map(d=>d.message).join(' · ');
    $('#machine-diagnostics').textContent=machinePose.machineSession?.error||diagnostic||'';
    $('#machine-diagnostics').hidden=!$('#machine-diagnostics').textContent;
    $('#machine-status').textContent=machinePose.machineSession?.error?'Machine model unavailable · see Machine model':'';
    if(!$('#machine-status').textContent)$('#machine-status').textContent=!scene?'Machine model unavailable':!sample?'Loading machine pose…':!pose?'Machine pose unavailable · see Machine model':
      (ctx.cameras.mode==='ghost'?'Ghost':'Machine')+(machinePose.manualValues?' · manual pose':' · simulated motion')+(sample.snapshot.status==='partial'||sample.snapshot.diagnostics.some(d=>d.code!=='jog-boundary')?' · limited model':'');
    ctx.updateManualControls(sample);
  }
  const message=(text,error=false)=>{$('#message').textContent=text;$('#message').classList.toggle('error',error);};
  const round2=v=>Number(v).toFixed(2);
  const materialFact=program=>program.materialModel==='relay-estimate'
    ? ['Material estimate',round2(materialGrams(program.estimatedRelayVolumeMm3))+' g from relay timing; unverified']
    : program.materialModel==='relay-estimate-unavailable' ? ['Material estimate','Unavailable; external extrusion rate is not configured']
    : [program.envelope?'Part material estimate':'Material estimate',round2(materialGrams(program.volumeMm3))+' g'];
  const materialSetup=state=>ctx.relay(state)
    ? ['Extrusion','External relay control · '+state.plan.setup.material]
    : ['Material',state.plan.setup.material+' · '+state.plan.setup.nozzleC+'°C'+(state.plan.setup.filamentColor?' · '+state.plan.setup.filamentColor:'')+(state.plan.setup.ams?' · intended AMS '+state.plan.setup.ams.unit+' slot '+state.plan.setup.ams.slot:'')];
  const vaseSettings=state=>{
    return (state.plan.slices?.assignments??[]).filter(a=>a.construction==='sleeve').flatMap(vase=>[
      [vase.pathMode==='segmented'?'Segmented paths':'Vase wall',vase.pattern?(vase.pathMode==='segmented'?'Repeated sleeve pattern with travel between gaps':'Continuous pattern wrapped around the sleeve'):'One continuous spiral; '+(vase.endTransition==='level'?'level rim':'spiral rim')],
      ['Path component',vase.part??'Part'],
      ['Path height range',vase.zStartMm+'–'+(vase.zEndMm??'geometry top')+' mm above component base'],
      ['Path sampling',vase.sampleStepMm+' mm maximum step'+(vase.pattern?'':' · '+vase.toleranceMm+' mm tolerance')]
    ]);
  };
  // The adapter's rows (computed by the server) follow the common settings.
  function machineSettings(state,rows){
    const omitted=new Set(ctx.relay(state)?['Bed temperature','Build volume temperature','Retraction','Cooling fan','Filament diameter']:[]);
    return [...rows.filter(([name])=>!omitted.has(name)),...state.settingsRows??[]];
  }
  // Studio reviews more than one kind of print. Everything that depends on which
  // package produced the bundle lives here; the viewer, approvals and playback
  // below are shared. A print names its kind in its own state.
  const views={
    shell:{
      eyebrow:'DEVELOPMENT PREVIEW',skinLabel:'Surface paths',exportName:'part.gcode',
      // Faces are named by the shape that built them, so the label is the name.
      names:{},
      facts(state,tab) {
        const {geometry:g,setup:s,process:p}=state.plan;
        const slices=state.plan.slices?.assignments??[],owners=slices.filter(a=>!a.construction),body=owners.find(a=>a.preset===null&&!a.within.length);
        const solid=g?.shape==='spatial'?g.solid:g,spatial=g?.shape==='spatial'||!g&&Boolean(state.geometry?.curves||state.geometry?.points);
        const shape=solid?({'blob-field':'Blob field',assembly:'Assembly',spline:'Spline surfaces',mesh:'Mesh'}[solid.shape]??solid.shape):'Curves and points';
        if(tab==='geometry') {
          if(!g&&!spatial)return [['Source',shape]];
          const bounds=state.geometry.boundsMm;
          const rows=[['Shape',spatial?(solid?'Solid, curves and points':'Curves and points'):shape],['Footprint',round2(bounds.max[0]-bounds.min[0])+' × '+round2(bounds.max[1]-bounds.min[1])+' mm'],['Height',round2(bounds.max[2]-bounds.min[2])+' mm']];
          if(spatial){
            const curves=g?.curves??state.geometry.curves??[],points=g?.points??state.geometry.points??[];
            if(solid)rows.push(['Solid',shape]);
            for(const [name,entries]of [['Curves',curves],['Points',points]])rows.push([name,entries.length+' authored · '+entries.filter(entry=>entry.visible!==false).length+' visible']);
          }
          if(solid?.shape==='mesh'&&solid.source?.format==='stl')rows.push(['STL units',solid.source.units+(solid.source.unitsInferred?' · assumed':'')+' · ask your agent to change']);
          if(solid?.shape==='spline')rows.push(['Patches',solid.patches.map(p=>p.name+' '+p.controlPoints.length+' × '+p.controlPoints[0].length).join(' · ')]);
          const extensionRows=(geometry,prefix='')=>{if(geometry?.shape==='extension')for(const [name,value] of geometry.rows)rows.push([prefix+name,value]);};
          const blobFieldRows=(geometry,prefix='')=>{if(geometry?.shape==='blob-field')rows.push([prefix+'Points',String(geometry.field.points.length)],[prefix+'Surface sampling',geometry.extraction.edgeMm+' mm · finer features may be missed'],[prefix+'Material threshold',String(geometry.field.threshold)]);};
          extensionRows(solid);
          blobFieldRows(solid);
          if(solid?.shape==='assembly')for(const part of solid.parts){rows.push([part.id,part.geometry.shape+' at '+[part.xMm,part.yMm,part.zMm].join(', ')+' mm']);extensionRows(part.geometry,part.id+' · ');blobFieldRows(part.geometry,part.id+' · ');}
          return rows;
        }
        if(tab==='plan')return [materialSetup(state),['Nozzle',(state.machine.tools.find(t=>t.index===s.tool)?.label??'#'+(s.tool+1))+' · '+s.core],['Layer height',p.layerMm+' mm'],
          ['Body',body?sliceSummary(body):owners.length?'Assigned volumes only':'Not printed'],...vaseSettings(state),
          ...(slices.length>(body?1:0)?[['Other deposition assignments',slices.filter(a=>a!==body).map(a=>a.id+' · '+sliceSummary(a)).join('; ')]]:[]),
          ...(solid?.shape==='assembly'?[['Sliced components',owners.some(a=>a.part===null)?'All':[...new Set(owners.map(a=>a.part))].join(', ')||'None']]:[])];
        if(!state.program)return [];
        const limit=state.pathSummary?.surfaceDomain;
        const rows=[...depositionFamilyRows(state.pathSummary?.inspection),
          [state.program.envelope?'Printing motion':'Estimated motion',Math.round((state.program.seconds??ctx.duration())/60)+' min'],materialFact(state.program)];
        for(const c of state.pathSummary?.curves??[])rows.push([c.id,c.strokes+' strokes · '+c.repetitions+' repetitions']);
        if(['relay-estimate','relay-estimate-unavailable'].includes(state.program.materialModel))rows.push(['Material intent',round2(materialGrams(state.program.volumeMm3))+' g; not metered']);
        if(hasConstruction(state.plan,'sleeve')){
          const selections=state.plan.slices.assignments.filter(a=>a.construction==='sleeve');
          rows.push(['Wall paths',selections.some(s=>s.pathMode==='segmented')?'Includes segmented paths with travel':selections.some(s=>s.pattern)?'Continuous pattern wrapped around the sleeve':'Continuous spiral within its assigned region']);
        }
        for(const stack of state.pathSummary?.referenceStacks?.normal??[])rows.push([stack.owner+' · Normal-offset slices',String(stack.layers??'')]);
        for(const instance of state.pathSummary?.slices?.instances??[])if(instance.fillOrder){const f=instance.fillOrder;rows.push(['Surface fronts · '+instance.id,(f.waves??0)+' fronts · '+(f.continuity?.passes??'unverified')+' pass(es) · '+(f.residualsUv?.length??0)+' residual region(s)']);}
        if(limit) {
          rows.push(['Surface not skinned',limit.excludedAreaPercent+'% steeper than '+limit.maxSlopeDeg+'°']);
        }
        return rows;
      },
      settings(state) {
        const {setup:s,process:p}=state.plan;
        const contract=state.machine.outputs.find(o=>o.id===state.plan.output)?.constraints;
        const declaredLimit=state.machine.nonplanar?.maxAngleDeg;
        return [['Bed temperature',s.bedC+'°C'],['Build volume temperature',s.buildVolumeC===0?'Heating off':s.buildVolumeC+'°C'],
          ...(contract?.bedType?[['Build surface',contract.bedType==='textured_plate'?'Textured PEI':contract.bedType],['Startup purge',contract.startupPurgeC+'°C · up to '+contract.startupPurgeFlowMm3S+' mm³/s']]:[]),
          ['First layer',p.firstLayerMm+' mm'],['Line width',p.lineWidthMm+' mm'],
          ['Flat / skin speed',p.planarSpeedMmS+' / '+p.skinSpeedMmS+' mm/s'],['First-layer speed',p.firstLayerSpeedMmS+' mm/s'],
          ['Travel / lift speed',p.travelSpeedMmS+' / '+p.zSpeedMmS+' mm/s'],['Retraction',p.retractMm+' mm at '+p.retractSpeedMmS+' mm/s'],
          ['Cooling fan',p.fanPercent+'%'],['Cooling preference window',p.minimumLayerSeconds+' s'],
          ['Filament diameter',s.filamentMm+' mm'],['Placement','X '+state.plan.placement.xMm+' / Y '+state.plan.placement.yMm+' mm'],
          ['Machine non-planar limit',(declaredLimit??'—')+'° (profile declaration)'],
          ['Travel','Comb up to '+p.maxCombMm+' mm; otherwise clear the whole plan by '+p.liftMm+' mm'],
          ['Startup',state.setupBasis]];
      }
    }
  };
  const view=()=>views.shell;
  const label=id=>{const edge=ctx.viewer.sceneState().edge(id);return edge?edge.names.map(label).join(' / ')+' · edge '+edge.number:view().names[id]??id.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());};
  function table(entries) {
    const dl=document.createElement('dl');
    for(const [key,value]of entries){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;row.append(dt,dd);dl.append(row);}
    return dl;
  }
  function selectStudioPresentation(state,tab,{facts,settings}){
    if(tab==='toolpath'&&state.neutralProgram)return {stage:'SAVED SAAMPATH',title:'Your toolpath',
      guidance:'Inspect the saved, machine-independent path.',facts:[['Moves',String(state.neutralProgram.summary.moves)],
        ['Deposited volume',round2(state.neutralProgram.summary.volumeMm3)+' mm³']],settings:[],
      reviewNote:[state.programError,state.neutralProgram.notice].filter(Boolean).join(' ')};
    if(!state.machine||!state.plan.slices||!state.plan.process)return {stage:null,title:'Your geometry',guidance:state.plan.slices?'Generate the toolpath; ask the agent to select a printer for its program.':'Ask the agent to add printing settings and a toolpath recipe.',facts:views.shell.facts(state,'geometry'),settings:[],reviewNote:state.neutralPathError??state.outputAvailability??''};
    const inspection=state.inspection;
    if(inspection)return {stage:'DEVELOPMENT INSPECTION',title:inspection.title,guidance:inspection.description,
      facts:inspection.facts,settings:inspection.settings,reviewNote:inspection.note};
    const title=state.tourExample?state.printName+(tab==='toolpath'?' · toolpath':''):{geometry:'Your geometry',toolpath:'Your toolpath'}[tab];
    const guidance={geometry:'Check the shape and dimensions.',toolpath:'Review the path and printing settings.'}[tab];
    const reviewNote=state.programViewError??state.outputAvailability??(tab==='toolpath'?(state.generationError??state.programError??state.neutralPathError??(!state.program
      ?'Generate the toolpath to review it with all printing settings.'
      :state.program.notice??state.program.envelope?.notice??'')):'');
    return {stage:null,title,guidance,facts:facts(),settings:settings(),reviewNote};
  }
  function render() {
    ctx.paathView.setVisible(viewState.tab==='toolpath');
    const playbackVisible=viewState.tab==='toolpath'&&ctx.paathView.model().mode!=='source';
    ctx.executionReview.bind(ctx.presentedState()?.program,{visible:playbackVisible});
    const retained=printSync.state.inspection;
    for(const id of ['facts','settings-detail'])$('#'+id).hidden=Boolean(retained);
    if(retained){
      $('#kind-label').textContent='RETAINED EXCHANGE';$('#view-title').textContent=inspectionTypeTitle(retained);
      $('#guidance').hidden=false;$('#guidance').textContent='Pinned historical value · input revision '+(retained.inputRevision??'unknown')+'. Return to normal review before Export.';
      for(const id of ['confirm','next','export-name-row','reviewed-download','reviewed-attribution','print-setup','more-settings','print-notes','repair-review','tour-panel','rotary-view','fit-program','machine-control','axial-colors','agent-working']){const e=$('#'+id);if(e)e.hidden=true;}
      $('#review-note').textContent='Inspection does not change the recipe, approve fabrication, or complete an unrelated request.';
      $('#selection').hidden=false;
      if(retained.kind!=='paath')$('#selection').textContent='Retained '+(retained.typeId??'value');
      $('#playback').hidden=!playbackVisible||!ctx.presentedState()?.program;$('#play').disabled=!playbackVisible||!ctx.presentedState()?.program;
      $('#scrub').max=ctx.duration();$('#scrub').value=playState.seconds;
      $$('[data-tab]').forEach(b=>{b.disabled=true;b.classList.toggle('active',b.dataset.tab===viewState.tab);});
      ctx.canvas.classList.remove('stale-toolpath','work-faded');ctx.activity('');ctx.requestDraw();return;
    }
    const shown=viewState.tab==='toolpath'?outputView(printSync.state):printSync.state,output=completedOutputState(printSync.state,{generating:ctx.generationPending()});
    const presentation=selectStudioPresentation(shown,viewState.tab,{facts:()=>view().facts(shown,viewState.tab),
      settings:()=>[...view().facts(shown,'plan'),...machineSettings(shown,view().settings(shown)),...recipeRows(shown.plan)]});
    if(viewState.tab==='toolpath'&&output.previous)presentation.reviewNote='Previous toolpath — recent edits are not included. '+(presentation.reviewNote??'');
    if(output.generating)presentation.guidance='Preparing your toolpath…';
    if(!studioWork.busy){
      const job=studioWork.generationTarget?.job;
      const progress=job?.printId===printSync.state.printId&&['preparing','generating','importing','constructing','committing','exporting'].includes(job.status)?job.progress:null;
      if(progress)ctx.showCalculationProgress(studioWork.generationTarget);
      else ctx.activity(output.generating?'Preparing your toolpath…':'');
    }
    $('#repair-review').hidden=viewState.tab!=='geometry'||!printSync.state.importRepair;
    $('#repair-summary').textContent=printSync.state.importRepair??'';
    // Limitations, including the recipe notes of the current recipe.
    const notes=printSync.state.limitations??[];
    $('#print-notes').hidden=!notes.length;
    $('#print-notes-list').replaceChildren(...notes.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    $('#stage-label').textContent=presentation.stage??'';$('#stage-label').hidden=!presentation.stage;
    $('#view-title').textContent=presentation.title;
    $('#guidance').textContent=presentation.guidance;$('#guidance').hidden=!presentation.guidance;
    $('#facts').replaceChildren(table(presentation.facts));
    $('#more-settings').hidden=viewState.tab!=='toolpath';
    $('#print-setup').hidden=viewState.tab!=='toolpath';
    $('#print-setup-values').textContent=shown.machine?[shown.machine.name,shown.plan.setup?.material].filter(Boolean).join(' · '):'No printer selected';
    const suggestedName=printSync.state.printName??'';
    if(!viewState.exportNameState||viewState.exportNameState.printId!==printSync.state.printId)viewState.exportNameState={printId:printSync.state.printId,suggested:suggestedName,value:suggestedName,dirty:false};
    else if(!viewState.exportNameState.dirty&&viewState.exportNameState.suggested!==suggestedName)Object.assign(viewState.exportNameState,{suggested:suggestedName,value:suggestedName});
    const exportNameInput=$('#export-name');
    if(document.activeElement!==exportNameInput)exportNameInput.value=viewState.exportNameState.value;
    $('#settings-detail').replaceChildren(table(presentation.settings));
    $('#planar-label').textContent=hasConstruction(printSync.state.plan,'cladding')?'Body':'Deposition';
    const palette=ctx.phasePalette();
    for(const [dot,phase] of [['planar','planar'],['inclined','curves'],['modulated','modulated']])$('.dot.'+dot).style.background=palette[phase];
    const pathView=ctx.viewer.sceneState().pathView;
    const samples=$('#axial-colors');samples.replaceChildren();samples.hidden=!hasConstruction(printSync.state.plan,'cladding')||!pathView;
    const sampledPhases=new Set();
    if(!samples.hidden)for(const [index,group] of pathView.groups.entries()){
      const move=pathView.moves.at(group.first);
      const swatch=ctx.sampleNames[move.phase]&&{name:ctx.sampleNames[move.phase],color:palette[move.phase]};
      if(!swatch||sampledPhases.has(move.phase))continue;
      sampledPhases.add(move.phase);
      const button=document.createElement('button'),dot=document.createElement('span');
      dot.className='dot';dot.style.background=swatch.color;
      button.append(dot,swatch.name);
      button.title='Inspect '+swatch.name;
      button.onclick=()=>{
        if(studioWork.busy)return;
        ctx.stop();ctx.layerFade.reset();
        const end=pathView.groups[index+1];
        playState.seconds=move.startSeconds+((end?pathView.moves.at(end.first).startSeconds:ctx.duration())-move.startSeconds)*(move.phase==='planar'?.98:.6);
        $('#scrub').value=playState.seconds;ctx.requestDraw();
      };
      samples.append(button);
    }
    $('#skin-label').textContent=hasConstruction(printSync.state.plan,'cladding')?'Surface cladding':hasConstruction(printSync.state.plan,'fronts')?'Wave fronts':view().skinLabel;
    const reviewed=$('#reviewed-download'),controls=studioControls(printSync.state,{tab:viewState.tab,busy:studioWork.busy,generating:studioWork.generating,exporting:studioWork.exporting,pending:ctx.generationPending(),
      exported:exportedThisSession.has(exportKey()),currentExportKey:exportKey(),inspection:printSync.state.inspection,
      machineView:ctx.cameras.mode==='machine',reviewedExportKey:reviewed?.dataset.exportKey});
    exportNameInput.disabled=controls.exportName.disabled;$('#export-name-row').hidden=controls.exportName.hidden;
    $('#next').disabled=controls.next.disabled;$('#next').hidden=controls.next.hidden;$('#next').textContent=controls.next.label;
    $('#confirm').disabled=controls.confirm.disabled;$('#confirm').textContent=controls.confirm.label;$('#confirm').hidden=controls.confirm.hidden;
    $('#confirm').setAttribute('aria-disabled',controls.confirm['aria-disabled']);
    if(reviewed)reviewed.hidden=controls.reviewedDownload.hidden;
    const attribution=$('#reviewed-attribution');
    if(attribution)attribution.hidden=controls.reviewedDownload.hidden||attribution.dataset.exportKey!==exportKey();
    $('#review-note').textContent=presentation.reviewNote;
    $('#playback').hidden=controls.playback.hidden||!playbackVisible;$('#play').disabled=controls.playback.playDisabled||!playbackVisible;
    $('#selection').hidden=controls.selection.hidden;
    ctx.canvas.setAttribute('aria-label',controls.canvas.label);ctx.canvas.classList.toggle('stale-toolpath',controls.canvas.stale);
    $('#scrub').max=ctx.duration();$('#scrub').value=playState.seconds;
    $('#rotary-view').hidden=!machinePose.machineSession?.scene;
    $('#fit-program').hidden=controls.fitProgram.hidden;
    updateMachineStatus();
    // Keep the tabs live during a toolpath generation: the geometry pane stays
    // reachable (and crisp), and the toolpath pane stays reachable whenever its
    // faded preview is available, so navigating between them never cancels work.
    $$('[data-tab]').forEach(b=>{const policy=controls.tabs[b.dataset.tab];b.classList.toggle('active',b.dataset.tab===viewState.tab);b.classList.toggle('done',Boolean(policy.done));b.disabled=policy.disabled;});
    studioWork.tourUI?.render(printSync.state);
    // A work episode spans intermediate saves and both inspection panes.
    ctx.canvas.classList.toggle('work-faded',studioWork.episodeWorking||viewState.tab==='toolpath'&&output.generating);
    ctx.requestDraw();
  }
  return {round2,materialFact,materialSetup,vaseSettings,machineSettings,views,view,label,table,selectStudioPresentation,render,updateMachineStatus,message};
}
