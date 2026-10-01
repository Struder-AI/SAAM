import {editText} from './text/scripts/edit.mjs';
import {editHeatSet} from './heat-set-inserts/scripts/edit.mjs';
import {editGridfinity,gridfinityPlan} from './gridfinity/scripts/edit.mjs';

export const RECIPE_EDITORS=Object.freeze({text:editText,'heat-set-inserts':editHeatSet,gridfinity:editGridfinity});
export const RECIPE_CREATORS=Object.freeze({gridfinity:gridfinityPlan});
