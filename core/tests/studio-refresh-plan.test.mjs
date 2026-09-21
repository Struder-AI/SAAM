import test from 'node:test';
import assert from 'node:assert/strict';
import {planPresentation,planRefreshNavigation} from '../../studio/refresh-plan.mjs';
import {TOUR_LESSONS as L} from '../../studio/tour-catalog.mjs';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const state=(patch={})=>({printId:'part',generationHash:'plan',exportHash:'export',geometryHash:'shape',geometry:{geometryVersion:1,labels:['face']},...patch});
const view=(patch={})=>({follow:false,tab:'geometry',seconds:7,duration:20,selected:'face',hasSelectedEdge:false,...patch});

test('one presentation model distinguishes replacement, retained chat and retained tour source',()=>{
  const moves=freeze([{from:[0,0,0],to:[1,0,0]}]),program=freeze({moves}),previous=freeze(state({program}));
  const model=freeze({identity:{printId:'part',geometryHash:'shape',generationHash:'plan',exportHash:'export'},presentedState:previous,program,retained:false});
  const context=freeze({follow:true,pathMoves:moves,materialMoves:moves});
  const before=JSON.stringify({model,context}),same=planPresentation(model,previous,context);
  assert.equal(same.effects.program,'replace');assert.equal(same.model.program,program);
  assert.equal(same.effects.buildPath,false);assert.equal(same.effects.buildMaterial,false);assert.equal(same.model.retained,false);
  const changed=freeze(state({program:{moves:[]}})),replacement=planPresentation(model,changed,context);
  assert.equal(replacement.effects.buildPath,true);assert.equal(replacement.effects.buildMaterial,true);
  const pending=freeze(state({generationHash:'new-plan'})),held=planPresentation(model,pending,context);
  assert.equal(held.effects.program,'retain');assert.equal(held.model.presentedState,previous);assert.equal(held.model.program,program);assert.equal(held.model.reason,'replacement');
  const continued=planPresentation(held.model,pending,context);
  assert.equal(continued.effects.program,'retain');assert.equal(continued.model.presentedState,previous);
  const tour=freeze(state({tour:{active:true,step:L.import}}));
  const retained=planPresentation(model,tour,{...context,follow:false});
  assert.equal(retained.effects.program,'retain');assert.equal(retained.model.reason,'tour');
  for(const next of [state(),state({printId:'other',tour:tour.tour}),state({generationHash:'other',tour:tour.tour}),state({tour:{active:true,step:L.playback}})]){
    const cleared=planPresentation(model,freeze(next),{...context,follow:false});
    assert.equal(cleared.effects.program,'clear');assert.equal(cleared.model.program,null);assert.equal(cleared.model.presentedState.printId,next.printId);
  }
  assert.equal(JSON.stringify({model,context}),before,'decision stages never mutate their input model or retained program');
});

test('navigation decisions preserve playback until source changes and choose the changed review stage',()=>{
  const previous=freeze(state({program:{}})),next=freeze(state({program:{},toolpathApproved:true}));
  const unchanged=planRefreshNavigation(previous,next,freeze(view()));
  assert.equal(unchanged.seconds,7);assert.equal(unchanged.tab,'geometry');assert.equal(unchanged.resetSelection,false);
  const exported=planRefreshNavigation(previous,freeze({...next,exportHash:'new'}),view());
  assert.equal(exported.resetExport,true);assert.equal(exported.seconds,20);assert.equal(exported.resetView,false);
  const processEdit=planRefreshNavigation(previous,freeze({...next,generationHash:'new'}),view({follow:true}));
  assert.equal(processEdit.tab,'toolpath');assert.equal(processEdit.notice,'Updated from chat.');
  const geometryEdit=planRefreshNavigation(previous,freeze({...next,generationHash:'new',geometryHash:'new'}),view({follow:true,tab:'toolpath'}));
  assert.equal(geometryEdit.tab,'geometry');
  const generated=planRefreshNavigation(freeze(state()),next,view({follow:true}));
  assert.equal(generated.tab,'toolpath');assert.equal(generated.notice,null);
});

test('initial tour and ordinary print navigation retains explicit reset and restore ownership',()=>{
  const normal=planRefreshNavigation(null,freeze(state({program:{}})),view());
  assert.equal(normal.tab,'toolpath');assert.equal(normal.restoreSavedView,true);assert.equal(normal.resetView,true);assert.equal(normal.resetSelection,true);
  const tour=planRefreshNavigation(null,freeze(state({tourExample:{id:'surface-drape'}})),view({tourInitialTab:'geometry'}));
  assert.equal(tour.tab,'geometry');assert.equal(tour.surfaceDrape,true);assert.equal(tour.restoreSavedView,false);
  const previous=freeze(state());
  const edge=planRefreshNavigation(previous,previous,view({selected:'edge',hasSelectedEdge:true}));
  assert.equal(edge.resetSelection,false);
  const rebuilt=planRefreshNavigation(previous,freeze(state({geometry:{geometryVersion:2,labels:[]}})),view({selected:'edge',hasSelectedEdge:true}));
  assert.equal(rebuilt.resetSelection,true);
});
