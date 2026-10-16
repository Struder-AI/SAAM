import {splineBlock} from './shapes.mjs';
import {compileHeatSet} from '../../../skills/heat-set-inserts/scripts/geometry.mjs';
export default async function(G){const recipe=splineBlock({runMm:13,widthMm:11,heightsMm:[[6,6,6],[7,9,7],[6,6,6]]}),feature={id:'ridge-seat',insertId:'spirol-19-m2-short',positionMm:[6.8,5.3,7.2],axis:[-.31,.19,-1],chamferDepthMm:.4},compiled=await compileHeatSet(recipe,[feature],G);return {name:'Heat-set seat across a crowned ridge',operation:'difference',operands:await Promise.all(compiled.geometry.solid.operands.map(G.buildGeometry))};}
