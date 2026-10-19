// The same recipe authoring interface is supplied to every extension editor.
import {operationId,withOperationAfter} from './operation-references.mjs';
import {selectEdge,preparedSlices} from './geometric-references.mjs';
import {constructEdgePaths} from './edge-paths.mjs';

export function recipeTools(source){
  return Object.freeze({operationId,withOperationAfter,selectEdge:reference=>selectEdge(source,reference),
    slices:selection=>preparedSlices(source,selection),constructEdgePaths:request=>constructEdgePaths(source,request)});
}
