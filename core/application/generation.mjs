import * as Bundle from '../print/bundle.mjs';
import {construct} from '../print/construction-command.mjs';
import {PATH_CONTRACT} from '../path/dependencies.mjs';
import {VERSION} from '../print/version.mjs';
import {pathSource} from './generation-source.mjs';
import {createGenerationExecution} from './generation-execution.mjs';
export const {generateBundle,prepareGeneration,commitGeneration}=createGenerationExecution({Bundle,Construction:construct,sourceIdentity:pathSource,contract:PATH_CONTRACT,version:VERSION});
