// The application, source runs and extension library share one installation home.
import {homedir} from 'node:os';
import {resolve} from 'node:path';

export function saamHome(){
  // Isolated installation trials explicitly supply their disposable home.
  if(process.env.SAAM_DATA)return resolve(process.env.SAAM_DATA);
  return process.platform==='win32'?resolve('C:/SAAM'):resolve(homedir(),'SAAM');
}
export function homePaths(root=saamHome()){
  const home=resolve(root),local=resolve(home,'local');
  return {home,local,tmp:resolve(home,'tmp'),notes:resolve(local,'LOCAL-AGENT-NOTES.md'),machineSetups:resolve(local,'machine-setups'),app:resolve(home,'app'),prints:resolve(local,'Prints'),
    extensions:resolve(local,'extensions'),state:resolve(home,'state')};
}
