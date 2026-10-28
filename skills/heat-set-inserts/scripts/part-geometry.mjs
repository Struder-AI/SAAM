// Heat-set inserts' part geometry: edit turns a request into the next inserts and their
// reinforcement Trace operations; build bores the inserts into a base. Part edits supplies the
// part's ordinary Slice owners and this extension's own operations there, and keeps the rest.
import {compileHeatSet} from './geometry.mjs';
import {heatSetFeature,heatSetAssignmentId} from './feature.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const REQUEST_FIELDS=['feature','remove','toleranceMm','sourceAssignment','sourceAssignments'];
// Heat-set assignments saved before reinforcement became a source Trace (2026-10-01).
const legacyIds=(feature,part)=>{
  const canonical=heatSetAssignmentId(feature,part),legacy='heat-set-'+feature.id.toLowerCase().replace(/[^a-z0-9-]/g,'-');
  return id=>id===canonical||id===legacy||[[canonical,'--fin-'],[legacy,'-fin-']].some(([name,separator])=>id.startsWith(name+separator)&&/^\d+$/.test(id.slice(name.length+separator.length)));
};

async function edit({parameters,request,context},{dimensions}){
  requireThat(request&&Object.keys(request).every(k=>REQUEST_FIELDS.includes(k)),'Unknown heat-set request field.');
  requireThat(Boolean(request.feature)!==Boolean(request.remove),'Supply one heat-set feature or remove id.');
  requireThat(!(request.sourceAssignment&&request.sourceAssignments),'Choose sourceAssignment or sourceAssignments.');
  if(request.sourceAssignments)requireThat(Array.isArray(request.sourceAssignments)&&request.sourceAssignments.length&&
    request.sourceAssignments.every(id=>typeof id==='string')&&new Set(request.sourceAssignments).size===request.sourceAssignments.length,'sourceAssignments must contain distinct Slice ids.');
  const {part,slices,operations:own,assignments}=context,features=structuredClone(parameters?.features??[]);
  if(request.remove){const index=features.findIndex(f=>f.id===request.remove);requireThat(index>=0,'Heat-set feature not found.');features.splice(index,1);}
  else{
    const feature=request.feature,index=features.findIndex(f=>f.id===(feature.id??'insert'));
    // Same-print values are the actual last-used feature settings. New named
    // holes inherit dimensions and fin choices, but never copy placement silently.
    const previous=index>=0?features[index]:features.at(-1);
    const reusable=previous?Object.fromEntries(Object.entries(previous).filter(([k])=>!['id','positionMm','axis'].includes(k))):{};
    const next={...reusable,...(index>=0?features[index]:{}),...feature};
    requireThat(next.insertId,'Choose an exact insertId from the heat-set manual size/profile table.');
    if(index>=0)features[index]=next;else features.push(next);
  }
  const normalized=features.map(heatSetFeature),ownIds=new Set(own.map(op=>op.id));
  const deprecated=assignments.filter(id=>!ownIds.has(id)&&normalized.some(f=>legacyIds(f,part)(id)));
  requireThat(!deprecated.length,`Deprecated heat-set assignment form: ${deprecated.join(', ')}. Remove those assignments, then edit the insert again.`);
  const toleranceMm=request.toleranceMm??parameters?.toleranceMm??dimensions.CONSTRUCTION_TOLERANCE_MM;
  // A source Trace follows one real Slice owner per layer, without claiming material or reserving fill.
  const operations=normalized.flatMap(feature=>{
    const target=Boolean(request.feature)&&feature.id===(request.feature.id??'insert');
    const used=own.filter(op=>op.source.parameters?.feature?.id===feature.id).map(op=>op.source.assignment);
    const selected=(target?(request.sourceAssignments??(request.sourceAssignment?[request.sourceAssignment]:null)):null)??(used.length?[...new Set(used)]:slices);
    requireThat(selected.length,'Heat-set reinforcement needs a matching source Slice assignment.');
    requireThat(selected.every(id=>slices.includes(id)),'Heat-set sourceAssignments must name matching ordinary Slice owners.');
    const canonical=heatSetAssignmentId(feature,part);
    return selected.map((assignment,index)=>({id:index===0?canonical:canonical+'--source-'+assignment,source:{assignment,parameters:{feature,toleranceMm}}}));
  });
  return normalized.length?{parameters:{features:normalized,toleranceMm},operations}:{remove:true,operations:[]};
}

async function build({base,parameters},Geometry){
  return compileHeatSet(base,parameters.features,{...Geometry,toleranceMm:parameters.toleranceMm});
}

// The part-geometry entry: a factory, as every extension entry is.
export const heatSetPartGeometry=()=>Object.freeze({edit,build});
