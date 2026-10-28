// Model-edge selectors resolve the manufacturing source, never its display mesh.
import {requireThat} from './tolerance.mjs';
import {buildShell} from './build.mjs';
import {selectedFace} from './reference-surface.mjs';
import {faceTrimRegion} from './surface-trim.mjs';
import {sampleSpatialCurve} from './spatial-curve.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

export function modelEdges(geometry,selection,{sampleStepMm}={}){
  requireThat(selection&&Object.keys(selection).every(key=>['path','vertices','closed','face','loop','edge'].includes(key)),'Model edges select an operand path and mesh vertices or a named face boundary.');
  requireThat([selection.loop,selection.edge].every(value=>value===undefined||Number.isSafeInteger(value)&&value>=0),'Face loop and edge indices are nonnegative integers.');
  const state={source:geometry?.shape==='spatial'?geometry.solid:geometry};
  const path=selection.path??[];
  requireThat(Array.isArray(path)&&path.every(i=>Number.isSafeInteger(i)&&i>=0),'Model edge path contains operand indices.');
  for(const index of path){requireThat(state.source?.shape==='boolean'&&state.source.operands[index],'Model edge operand is absent.');state.source=state.source.operands[index];}
  const source=state.source;
  requireThat(source,'Select solid model geometry.');
  if(Array.isArray(source.vertices)&&Array.isArray(source.triangles)){
    requireThat(selection.face===undefined&&selection.loop===undefined&&selection.edge===undefined,'Mesh edges select vertex indices.');
    const adjacency=new Map();
    for(const triangle of source.triangles)for(let i=0;i<3;i++){
      const a=triangle[i],b=triangle[(i+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');
      if(!adjacency.has(key))adjacency.set(key,[a,b]);
    }
    if(selection.vertices===undefined)return [...adjacency.values()].map(vertices=>({model:{path,vertices},curve:{closed:false,points:vertices.map(i=>source.vertices[i])}}));
    const vertices=selection.vertices,closed=selection.closed??false;
    requireThat(typeof closed==='boolean'&&Array.isArray(vertices)&&vertices.length>=(closed?3:2)&&vertices.every(i=>Number.isSafeInteger(i)&&source.vertices[i]),'Mesh edge needs existing vertex indices and explicit optional closure.');
    for(let i=0;i<vertices.length-(closed?0:1);i++){
      const a=vertices[i],b=vertices[(i+1)%vertices.length];
      requireThat(a!==b&&adjacency.has([Math.min(a,b),Math.max(a,b)].join(':')),'Selected mesh vertices do not follow a model edge: '+a+' -> '+b+'.');
    }
    return [{model:{path,vertices,...(closed?{closed:true}:{})},curve:{closed,points:vertices.map(i=>source.vertices[i])}}];
  }
  requireThat(selection.vertices===undefined&&selection.closed===undefined,'Named face edges select a boundary loop and optional edge index.');
  requireThat(typeof selection.face==='string','Select a named model face.');
  const shell=buildShell(null,source,{native:false}),patch=selectedFace(shell,selection.face),loops=faceTrimRegion(patch);
  const records=[];
  for(const [loop,points] of loops.entries()){
    if(selection.loop!==undefined&&loop!==selection.loop)continue;
    const boundary=selection.edge===undefined?points:[points[selection.edge],points[(selection.edge+1)%points.length]];
    requireThat(boundary.every(Boolean),'Named face boundary edge is absent.');
    const closed=selection.edge===undefined;
    const samples=sampleSpatialCurve({points:boundary,closed,surface:{kind:'patch',patch}},
      {toleranceMm:PRINT_RESOLUTION_MM/4,sampleStepMm:sampleStepMm??Infinity}).samples;
    records.push({model:{path,face:selection.face,loop,...(closed?{}:{edge:selection.edge})},
      curve:{closed,points:(closed?samples.slice(0,-1):samples).map(sample=>sample.point)}});
  }
  requireThat(records.length,'Named face boundary is absent.');return records;
}
