import {requireThat} from '../../../core/private/agent/numeric.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

import {applyExtensionEdit} from '../../../core/print/extension-edits.mjs';

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),directory=args.shift();
  requireThat(directory&&!directory.startsWith('--'),'Usage: node skills/advanced-vase-wall/scripts/cli.mjs PRINT [--options options.json] [--expected-revision REVISION]');
  let options={},expectedRevision;
  while(args.length){
    const flag=args.shift(),value=args.shift();requireThat(value&&['--options','--expected-revision'].includes(flag),'Expected --options FILE or --expected-revision REVISION.');
    if(flag==='--options')options=JSON.parse(await readFile(resolve(value),'utf8'));else expectedRevision=value;
  }
  const state=await applyExtensionEdit(resolve(directory),'advanced-vase-wall',options,{expectedRevision});
  console.log(JSON.stringify({directory:state.dir,revision:state.revision,geometryHash:state.geometryHash,toolpathApproved:state.toolpathApproved,
    settings:state.plan.slices.assignments.find(a=>a.construction==='sleeve'),report:state.extensionReport},null,2));
}
