// The declaration extractor's mapped code (graph.mjs): core and Studio product code, without the
// agent toolkit and the machine-output exporters, whose method names it does not treat as
// SAAM's own. A design set maps whatever it names.
import {mapSet} from './map-set.mjs';
const mappedExportFiles=new Set(['registry','travel-advisory'].map(name=>`core/export/${name}.mjs`));
const unmapped=file=>file.startsWith('core/agent/')||file.startsWith('core/export/')&&!mappedExportFiles.has(file);
export const isMapped=file=>mapSet?.mode==='design'||/^(core|studio)\//.test(file)&&!unmapped(file.split('::')[0]);
// A served path that is not the module path on disk: the import specifier cannot be resolved by
// the file system alone, so the serving alias is stated here rather than guessed.
export const importAliases={'studio/app.mjs:./studio/machine-session.mjs':'studio/machine-session.mjs'};
