import {splineBox} from './shapes.mjs';
// The intended overlap is one micron; fuzzy regularization must report itself.
export default async function(G){const a=await G.buildGeometry(splineBox({runMm:5,widthMm:5,heightMm:5}));return {name:'One micron shim overlap',operation:'intersection',operands:[a,G.translateShell(a,4.999,0,0)]};}
