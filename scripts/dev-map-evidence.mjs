import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {root,loadModel} from './dev-map/model.mjs';
import {evidenceMarkdown} from './dev-map/evidence.mjs';

const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--out'))throw Error('Use: node scripts/dev-map-evidence.mjs [--out DIRECTORY]');
const out=resolve(root,args[1]??'dev-map/evidence');
const model=await loadModel();
const {graph,coverage:report}=model;
await mkdir(out,{recursive:true});
await writeFile(resolve(out,'graph.json'),JSON.stringify(graph,null,2)+'\n');
await writeFile(resolve(out,'evidence.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(resolve(out,'report.md'),evidenceMarkdown(report));
console.log(JSON.stringify({out,...report.summary,pilot:report.pilot.map(p=>({page:p.page,generated:p.generated.length,omitted:p.omitted.length}))},null,2));
