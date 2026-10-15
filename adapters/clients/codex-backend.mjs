import {access,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
// Preserve an explicit backend; otherwise follow Codex's update cache.
export async function codexBackend(config){
  if(config.backend)return config.backend;
  if(process.platform==='win32'){
    const root=join(process.env.LOCALAPPDATA??join(process.env.USERPROFILE,'AppData','Local'),'OpenAI','Codex','bin');
    const entries=await readdir(root).catch(()=>[]),candidates=[];
    for(const entry of entries){const path=join(root,entry,'codex.exe');try{const info=await stat(path);candidates.push({path,mtime:info.mtimeMs});}catch{}}
    candidates.sort((a,b)=>b.mtime-a.mtime);if(candidates[0])return candidates[0].path;
  }
  for(const path of config.bundled??[])try{await access(path);return resolve(path);}catch{}
  if(process.platform==='win32'){
    // A fresh Store install may have no backend cache, and WindowsApps listing
    // may be denied. Query the current user's package registration instead.
    const result=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-AppxPackage -Name OpenAI.Codex | Select-Object -ExpandProperty InstallLocation | ConvertTo-Json -Compress'],{windowsHide:true}).catch(()=>({stdout:''}));
    const locations=result.stdout.trim()?JSON.parse(result.stdout.trim()):[];
    for(const location of Array.isArray(locations)?locations:[locations]){
      const path=join(location,'app','resources','codex.exe');try{await access(path);return path;}catch{}
    }
  }
  throw Error('Codex backend not found. Run saam call repair_client_setup after installing Codex.');
}
