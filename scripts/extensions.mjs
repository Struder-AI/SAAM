#!/usr/bin/env node
// Portable extension exchange. Import validates and saves files; execution is
// a separate, explicit operation through an extension's declared entry.
import {checkoutExtension,exportExtension,importExtension,listExtensions,resolveExtensions} from '../core/extensions/library.mjs';

const [command,...args]=process.argv.slice(2);
try{
  let result;
  if(command==='list'&&args.length===0)result=await listExtensions();
  else if(command==='resolve'&&args.length)result=await resolveExtensions(args);
  else if(command==='checkout'&&args.length===1)result=await checkoutExtension(args[0]);
  else if(command==='export'&&args.length===2)result=await exportExtension(args[0],args[1]);
  else if(command==='import'&&args.length===1)result=await importExtension(args[0]);
  else throw Error('Usage: node scripts/extensions.mjs list | resolve ID... | checkout ID | export ID PACKAGE.json | import PACKAGE.json');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
