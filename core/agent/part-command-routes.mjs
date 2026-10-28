// Fixed shared CLI routing for native and agent generation. This layer admits
// identity/path only; all generation decisions belong to the Bundle owner.
import {createBundleGenerationOperations} from '../print/generation-operations.mjs';

export function createPartCommandRoutes({directory}={}){
  const generation=createBundleGenerationOperations();
  return {
    async generateToolpath({bundleId,...options},host){
      return generation.generate(await directory(bundleId),options,host);
    },
    generateAt(admittedDirectory,options,host){
      return generation.generate(admittedDirectory,options,host);
    }
  };
}
