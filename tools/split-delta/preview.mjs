import {readFile,writeFile} from 'node:fs/promises';
import {loadMachine} from '../../core/machine/profile.mjs';
import {geometry} from '../../core/machine/split-delta.mjs';
import {exportSplitDeltaPreview,interpretSplitDelta} from '../../core/export/split-delta-player.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node tools/split-delta/preview.mjs path.json result.sdgcode');
const machine=loadMachine('split-delta'),path=JSON.parse(await readFile(input,'utf8')),source=exportSplitDeltaPreview(path,{filamentMm:machine.filamentDiameterMm});
const preview=interpretSplitDelta(source,geometry(machine.kinematicModel));await writeFile(output,source);console.log(JSON.stringify({output,samples:preview.samples.length,seconds:preview.seconds,coverage:preview.coverage},null,2));
