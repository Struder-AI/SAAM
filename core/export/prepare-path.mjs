import {requireThat} from '../private/export/numeric.mjs';
import {validateSetup} from '../machine/rules.mjs';

// Admit a completed path and the selected device inputs. Never synthesize motion.
export function checkedMachinePath(path,plan,machine){
  // Bundle pins input identity when accepting/reusing this path. Export checks
  // representation and device compatibility, not the producer's recipe again.
  requireThat(path.schema==='saampath/1'&&path.completion?.contract==='saam-completed-motion/1',
    'Export requires completed SAAMpath. Generate the toolpath first.');
  validateSetup(plan,machine,{required:true});
  return path;
}
