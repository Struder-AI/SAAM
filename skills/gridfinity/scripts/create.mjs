import {compileGridfinity} from './gridfinity.mjs';

export async function gridfinityPlan(_source,parameters,Geometry){
  const {geometry,notes}=await compileGridfinity(parameters,Geometry);
  return {geometry,placement:{xMm:20,yMm:20},...(notes.length?{report:{notes}}:{})};
}
