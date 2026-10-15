import {compileGridfinity} from './gridfinity.mjs';

export async function gridfinityPlan(_source,parameters,{constructSolids}){
  const {geometry,notes}=await compileGridfinity(parameters,{constructSolids});
  return {geometry,placement:{xMm:20,yMm:20},...(notes.length?{report:{notes}}:{})};
}
