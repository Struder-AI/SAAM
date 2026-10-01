import {editText} from './text/scripts/edit.mjs';
import {editHeatSet} from './heat-set-inserts/scripts/edit.mjs';
import {editGridfinity,gridfinityPlan} from './gridfinity/scripts/edit.mjs';
import {prepareMeshVase} from './advanced-vase-wall/scripts/prepare-mesh.mjs';

export const GEOMETRY_EDITORS=Object.freeze({text:editText,'heat-set-inserts':editHeatSet,gridfinity:editGridfinity});
export const GEOMETRY_CREATORS=Object.freeze({gridfinity:gridfinityPlan});
export const DEPOSITION_EDITORS=Object.freeze({'advanced-vase-wall':prepareMeshVase});
