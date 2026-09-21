import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStudioState,withoutPreviewMaterial} from '../../studio/studio-state.mjs';
import {studioControls} from '../../studio/studio-controls.mjs';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const snapshot=(patch={})=>({printId:'part',generationHash:'plan',exportHash:'export',review:{generation:{mode:'production'}},program:{summary:{server:true},previewMaterial:{beads:[1]}},...patch});
const context=(patch={})=>({previous:null,follow:false,stalePresentation:null,playbackCache:null,pathMoves:null,materialMoves:null,
  decode:async()=>({moves:[1],summary:{decoded:true}}),bind:async()=>{},...patch});

test('state adoption never mutates frozen responses across decode, cache reuse and failure',async()=>{
  const fresh=freeze(snapshot()),freshBefore=structuredClone(fresh);
  const decoded=await prepareStudioState(fresh,context());
  assert.deepEqual(fresh,freshBefore);assert.notEqual(decoded.state,fresh);
  assert.deepEqual(decoded.state.program.summary,{decoded:true,server:true});
  assert.equal(decoded.state.program.previewMaterial,fresh.program.previewMaterial);

  const cachedProgram=freeze({moves:[2],summary:{cached:true}}),cached=freeze(snapshot()),calls=[];
  const reused=await prepareStudioState(cached,context({playbackCache:{printId:'part',generationHash:'plan',exportHash:'export',program:cachedProgram},
    bind:async value=>calls.push(value)}));
  assert.equal(calls[0],cached,'metadata binds before an adopted proxy store replaces the program');
  assert.equal(reused.state.program,cachedProgram);assert.equal(cached.program.previewMaterial.beads[0],1);

  const broken=freeze(snapshot({toolpathApproved:true})),failed=await prepareStudioState(broken,context({decode:async()=>{throw Error('bad source');}}));
  assert.equal(failed.state.program,undefined);assert.equal(failed.state.programError,'bad source');assert.equal(failed.state.toolpathApproved,false);
  assert.ok(failed.presentation.action==='clear');assert.ok(broken.program);

  const previous=freeze(snapshot()),pending=freeze(snapshot({generationHash:'edited',program:undefined}));
  const retained=await prepareStudioState(pending,context({previous,follow:true}));
  assert.equal(retained.state,pending);assert.equal(retained.presentation.action,'retain-replacement');
  assert.equal(retained.presentation.stalePresentation,previous);

  const consumed=withoutPreviewMaterial(decoded.state);
  assert.notEqual(consumed,decoded.state);assert.notEqual(consumed.program,decoded.state.program);
  assert.equal(consumed.program.moves,decoded.state.program.moves);assert.equal(consumed.program.previewMaterial,undefined);
  assert.ok(fresh.program.previewMaterial,'the frozen response retains its envelope');
});

test('control policy covers pending review, production approval, export and inspection states',()=>{
  const base={printId:'part',exportHash:'hash',review:{generation:{mode:'development'}}};
  const ui={tab:'geometry',busy:false,generating:false,pending:false,staleProgram:false,tourActive:false,exported:false,
    currentExportKey:'part:hash',reviewedExportKey:'',inspection:null,machineView:false};
  const geometry=studioControls(base,ui);
  assert.equal(geometry.confirm.label,'Next');assert.equal(geometry.tabs.toolpath.disabled,true);assert.equal(geometry.canvas.stale,false);

  const pending=studioControls(base,{...ui,tab:'toolpath',busy:true,generating:true,pending:true,staleProgram:true});
  assert.equal(pending.flags.pending,true);assert.equal(pending.flags.toolpathViewable,true);
  assert.equal(pending.confirm.disabled,false);assert.equal(pending.confirm['aria-disabled'],'false');assert.equal(pending.canvas.stale,true);

  const production={...base,program:{},toolpathApproved:false,review:{generation:{mode:'production'}}};
  const review=studioControls(production,{...ui,tab:'toolpath'});
  assert.equal(review.confirm.label,'Confirm settings & export');assert.equal(review.playback.hidden,false);assert.equal(review.tabs.toolpath.disabled,false);
  const approved=studioControls({...production,toolpathApproved:true},{...ui,tab:'toolpath',exported:true,reviewedExportKey:'part:hash',inspection:{}});
  assert.equal(approved.confirm.label,'Export again');assert.equal(approved.confirm.hidden,true);assert.equal(approved.exportName.hidden,true);
  assert.equal(approved.flags.exportReady,true);assert.equal(approved.flags.exported,true);
  assert.equal(approved.reviewedDownload.hidden,false);assert.equal(approved.tabs.toolpath.done,true);
});
