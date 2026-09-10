// Experimental sibling: one shared producer, changing only the offset vector.
import {rimmingResults} from '../../rimming-planar/scripts/rimming.mjs';
export const rimmingNormalResults=options=>rimmingResults({...options,mode:'normal',skillId:'rimming-normal'});
