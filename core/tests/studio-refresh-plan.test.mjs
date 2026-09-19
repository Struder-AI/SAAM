import test from 'node:test';
import assert from 'node:assert/strict';
import {planProgramPresentation,planRefreshNavigation} from '../../studio/refresh-plan.mjs';
import {TOUR_LESSONS as L} from '../../studio/tour-catalog.mjs';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const state=(patch={})=>({printId:'part',planHash:'plan',exportHash:'export',geometryHash:'shape',geometry:{geometryVersion:1,labels:['face']},...patch});
const view=(patch={})=>({follow:false,tab:'geometry',seconds:7,duration:20,selected:'face',hasSelectedEdge:false,...patch});

test('program decisions distinguish decoded replacement, stale chat presentation and retained tour source',()=>{
  const moves=freeze([{from:[0,0,0],to:[1,0,0]}]),program=freeze({moves}),previous=freeze(state({program}));
  const cache=freeze({printId:'part',planHash:'plan',exportHash:'export',program});
  const snapshot=freeze({previous,follow:true,stalePresentation:null,playbackCache:cache,pathMoves:moves,materialMoves:moves});
  const before=JSON.stringify(snapshot),same=planProgramPresentation(previous,snapshot);
  assert.equal(same.action,'replace');assert.equal(same.playbackCache.program,program);
  assert.equal(same.buildPath,false);assert.equal(same.buildMaterial,false);assert.equal(same.stalePresentation,null);
  const changed=freeze(state({program:{moves:[]}})),replacement=planProgramPresentation(changed,snapshot);
  assert.equal(replacement.buildPath,true);assert.equal(replacement.buildMaterial,true);
  const pending=freeze(state({planHash:'new-plan'})),held=planProgramPresentation(pending,snapshot);
  assert.equal(held.action,'retain-replacement');assert.equal(held.stalePresentation,previous);assert.equal(held.playbackCache,cache);
  const continued=planProgramPresentation(pending,{...snapshot,previous:pending,stalePresentation:previous});
  assert.equal(continued.action,'retain-replacement');assert.equal(continued.stalePresentation,previous);
  const tour=freeze(state({tour:{active:true,step:L.import}}));
  const retained=planProgramPresentation(tour,{...snapshot,follow:false});
  assert.equal(retained.action,'retain-tour');assert.equal(retained.playbackCache,cache);
  for(const next of [state(),state({printId:'other',tour:tour.tour}),state({planHash:'other',tour:tour.tour}),state({tour:{active:true,step:L.playback}})]){
    const cleared=planProgramPresentation(freeze(next),{...snapshot,follow:false});
    assert.equal(cleared.action,'clear');assert.equal(cleared.stalePresentation,null);assert.equal(cleared.playbackCache,null);
  }
  assert.equal(JSON.stringify(snapshot),before,'decision stages never mutate their input snapshot or retained program');
});

test('navigation decisions preserve playback until source changes and choose the changed review stage',()=>{
  const previous=freeze(state({program:{}})),next=freeze(state({program:{},toolpathApproved:true}));
  const unchanged=planRefreshNavigation(previous,next,freeze(view()));
  assert.equal(unchanged.seconds,7);assert.equal(unchanged.tab,'geometry');assert.equal(unchanged.resetSelection,false);
  const exported=planRefreshNavigation(previous,freeze({...next,exportHash:'new'}),view());
  assert.equal(exported.resetExport,true);assert.equal(exported.seconds,20);assert.equal(exported.resetView,false);
  const processEdit=planRefreshNavigation(previous,freeze({...next,planHash:'new'}),view({follow:true}));
  assert.equal(processEdit.tab,'toolpath');assert.equal(processEdit.notice,'Updated from chat.');
  const geometryEdit=planRefreshNavigation(previous,freeze({...next,planHash:'new',geometryHash:'new'}),view({follow:true,tab:'toolpath'}));
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
