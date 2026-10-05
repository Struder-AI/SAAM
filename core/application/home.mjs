// The application, source runs and extension library share one installation home.
import {homedir} from 'node:os';
import {resolve} from 'node:path';

export function saamHome(){
  // Isolated installation trials and tests explicitly supply their disposable home.
  if(process.env.SAAM_DATA)return resolve(process.env.SAAM_DATA);
  if(process.env.NODE_TEST_CONTEXT||process.execArgv.includes('--test'))
    throw Error('Tests never use the person\'s SAAM home: import core/tests/temporary-home.mjs (sets SAAM_DATA) or pass explicit paths.');
  return process.platform==='win32'?resolve('C:/SAAM'):resolve(homedir(),'SAAM');
}
export function homePaths(root=saamHome()){
  const home=resolve(root),local=resolve(home,'local');
  return {home,local,tmp:resolve(home,'tmp'),notes:resolve(local,'LOCAL-AGENT-NOTES.md'),phaseColours:resolve(local,'phase-colours.json'),machineSetups:resolve(local,'machine-setups'),app:resolve(home,'app'),prints:resolve(local,'Prints'),
    extensions:resolve(local,'extensions'),state:resolve(home,'state')};
}
