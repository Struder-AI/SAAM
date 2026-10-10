// The application, source runs and extension library share one installation home.
import {homedir} from 'node:os';
import {resolve} from 'node:path';

// Every runtime uses the installed library; choosing source code changes no home.
export function canonicalHome(){
  return process.platform==='win32'?resolve('C:/SAAM'):resolve(homedir(),'SAAM');
}
export function pathIdentity(path){const absolute=resolve(path);return process.platform==='win32'?absolute.toLowerCase():absolute;}
export function saamHome(){
  // Only Node's internal test processes may inject a disposable home. Production
  // commands and runtime children ignore ambient SAAM_DATA.
  if(process.env.NODE_TEST_CONTEXT||process.execArgv.includes('--test')){
    if(process.env.SAAM_DATA)return resolve(process.env.SAAM_DATA);
    throw Error('Tests need core/tests/temporary-home.mjs or explicit paths.');
  }
  return canonicalHome();
}
export function homePaths(root=saamHome()){
  const home=resolve(root),local=resolve(home,'local');
  return {home,local,tmp:resolve(home,'tmp'),notes:resolve(local,'LOCAL-AGENT-NOTES.md'),phaseColours:resolve(local,'phase-colours.json'),machineSetups:resolve(local,'machine-setups'),app:resolve(home,'app'),prints:resolve(local,'Prints'),
    extensions:resolve(local,'extensions'),state:resolve(home,'state')};
}
