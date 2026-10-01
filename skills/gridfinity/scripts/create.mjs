import {compileGridfinity} from './gridfinity.mjs';

export async function gridfinityPlan(_source,parameters,{constructSolids}){
  return {geometry:await compileGridfinity(parameters,{constructSolids}),placement:{xMm:20,yMm:20}};
}
