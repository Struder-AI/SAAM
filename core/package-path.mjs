// Shared package spelling validation; it grants no file or package authority.
export function relativePackageFile(name,label='extension'){
  if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..')
    ||/[\x00-\x1f:*?"<>|]/.test(name))throw Error(`Invalid ${label} file path: ${name}.`);
  return name;
}
