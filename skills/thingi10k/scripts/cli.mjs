import {createThingi10KClient} from './library.mjs';
import {importThingi10KBundle} from './import.mjs';
import {resolve} from 'node:path';

const [command, ...args] = process.argv.slice(2);
try {
  const client = createThingi10KClient(); let result;
  if (command === 'search' && args.length >= 1 && args.length <= 3) {
    result = await client.search({query: args[0], limit: args[1] === undefined ? 10 : Number(args[1]), offset: args[2] === undefined ? 0 : Number(args[2])});
  } else if (command === 'import' && args.length >= 3 && args.length <= 4) {
    result = await importThingi10KBundle(client, resolve(args[0]), args[1], {machineId: args[2], units: args[3] ?? 'auto'});
    if (!result.imported) process.exitCode = 1;
  } else throw Error('Use search "bunny or Thingiverse URL or file ID" [limit] [offset], or import Prints/name FILE_ID MACHINE_ID [auto|mm|inch].');
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
