// Gridfinity's part geometry: a bin, blank or baseplate is a part's whole geometry. edit
// turns a request into complete parameters; build constructs the solid. Part edits keeps
// the record and rebuilds anything placed on top of it.
import {compileGridfinity,editedGridfinityParameters,gridfinityParameters} from './gridfinity.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

async function edit({base,parameters,request},{dimensions}){
  requireThat(request&&typeof request==='object'&&!Array.isArray(request),'Gridfinity parameters must be an object.');
  requireThat(parameters||!base,'Select an existing gridfinity part.');
  const next=gridfinityParameters(parameters?editedGridfinityParameters(parameters,request):request,dimensions.FEATURE_TOLERANCE_MM);
  return {parameters:next,...(parameters?{}:{placement:{xMm:20,yMm:20}})};
}

async function build({parameters},Geometry){
  return compileGridfinity(parameters,Geometry);
}

// The part-geometry entry: a factory, as every extension entry is.
export const gridfinityPartGeometry=()=>Object.freeze({edit,build});
