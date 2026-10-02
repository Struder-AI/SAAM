// The application, source runs and extension library share one installation home.
import {homedir} from 'node:os';
import {resolve} from 'node:path';

export function saamHome(){
  // Isolated installation trials explicitly supply their disposable home.
  if(process.env.SAAM_DATA)return resolve(process.env.SAAM_DATA);
  return process.platform==='win32'?resolve('C:/SAAM'):resolve(homedir(),'SAAM');
}
export function homePaths(){
  const home=saamHome();
  return {home,app:resolve(home,'app'),prints:resolve(home,'Prints'),extensions:resolve(home,'extensions'),state:resolve(home,'state')};
}
