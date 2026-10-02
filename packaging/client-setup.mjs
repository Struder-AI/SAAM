// User-level command discovery and narrow permissions; registration failures
// are returned to Studio and never prevent the application from starting.
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

function probe(command,args,platform){
  const result=spawnSync(command,args,{encoding:'utf8',windowsHide:true,timeout:10000,shell:platform==='win32'&&command.endsWith('.cmd')});
  if(result.error||result.status!==0)return null;
  return result.stdout.trim();
}
function commandPath(name,platform){
  const output=platform==='win32'?probe('where.exe',[name],platform):probe('/usr/bin/which',[name],platform);
  return output?.split(/\r?\n/)[0]??null;
}
function minimum(version,wanted){
  const numbers=version?.match(/\d+\.\d+\.\d+/)?.[0]?.split('.').map(Number);
  if(!numbers)return false;
  for(const [index,value] of wanted.entries()){if(numbers[index]>value)return true;if(numbers[index]<value)return false;}
  return true;
}
function codexDesktop(platform){
  if(platform==='win32'){
    const output=probe('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-AppxPackage | Where-Object { $_.Name -match 'Codex' } | Select-Object -First 1 | ForEach-Object { [string]$_.Version }"],platform);
    if(output)return output;
    return probe('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.Path -match 'OpenAI\\.Codex_' } | Select-Object -First 1 | ForEach-Object { if ($_.Path -match 'OpenAI\\.Codex_([0-9.]+)_') { $Matches[1] } else { (Get-Item -LiteralPath $_.Path).VersionInfo.ProductVersion } }"],platform)||null;
  }
  if(platform==='darwin')return probe('/usr/bin/defaults',['read','/Applications/Codex.app/Contents/Info','CFBundleShortVersionString'],platform);
  return null;
}

export async function clientStatus({clientHome=homedir(),platform=process.platform}={}){
  const codexPath=commandPath('codex',platform),claudePath=commandPath('claude',platform);
  const codexVersion=codexPath?probe(codexPath,['--version'],platform):null;
  const desktopVersion=codexDesktop(platform);
  const claudeVersion=claudePath?probe(claudePath,['--version'],platform):null;
  return {clients:[
    {id:'codex',name:'Codex',detected:!!(desktopVersion||codexVersion),version:desktopVersion??codexVersion,cliVersion:codexVersion,command:codexPath,
      ready:!!desktopVersion,reason:desktopVersion?null:'Studio launch needs Codex Desktop. You can connect from an existing chat with saam call maker_onboarding.',firstSend:true,waitReinvokes:false},
    {id:'claude',name:'Claude Code',detected:!!claudeVersion,version:claudeVersion,command:claudePath,
      ready:minimum(claudeVersion,[2,1,285]),reason:minimum(claudeVersion,[2,1,285])?null:'Studio launch needs Claude Code 2.1.285 or later. You can connect from an existing chat with saam call maker_onboarding.',firstSend:true,waitReinvokes:true}
  ],clientHome};
}

async function atomicWrite(path,text){
  await mkdir(dirname(path),{recursive:true});const temporary=path+'.saam-'+randomUUID();
  await writeFile(temporary,text);await rename(temporary,path);
}
async function optionalRead(path){try{return await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const marker='<!-- Managed by SAAM application -->';
function guidance(home){return `${marker}\n# SAAM\n\nUse the installed saam command for making parts, opening Studio and starting the tour. All prints are in ${join(home,'Prints')}; extensions are in ${join(home,'extensions')}.\n\nStart with saam help. Use saam call maker_onboarding to get the current maker context. Operation help comes from saam help OPERATION. Pass JSON through stdin or --input FILE, because PowerShell 5.1 changes quoted JSON arguments. If client registration needs repair, call saam call repair_client_setup and handle its reported errors; the person may need to restart the client to reload permissions.\n\nThe command sends the client's session ID when available. If its response supplies a chat ID, retain it for this chat and pass --chat-id ID on every later command. Naming an existing print attaches to its open Studio when available. Respect Bundle reservations and request IDs; the person confirms the current settings and exact toolpath in Studio before export.\n\nAfter working, wait for Studio requests with saam wait. Claude Code can run this in the background and resume the agent when it completes. Codex wakeup is unverified: keep the wait in the client's managed command session and report if it cannot resume.\n`;}
async function registerSkill(directory,home){
  const target=join(directory,'saam','SKILL.md'),previous=await optionalRead(target);
  if(previous&&!previous.includes(marker))throw Error(`Kept existing custom skill at ${target}; rename it before retrying.`);
  const skill=`---\nname: saam\ndescription: Make 3D printed parts through SAAM, work with print bundles and Studio, or start the SAAM tour.\n---\n\n${guidance(home)}`;
  await atomicWrite(target,skill);return target;
}
async function registerCodex(clientHome,home){
  const skill=await registerSkill(join(clientHome,'.agents','skills'),home);
  const directory=clientHome===homedir()?process.env.CODEX_HOME??join(clientHome,'.codex'):join(clientHome,'.codex');
  const rule=join(directory,'rules','saam.rules');
  const text='# Managed by SAAM application\nprefix_rule(pattern = ["saam"], decision = "allow", justification = "Call the installed SAAM local application.")\n';
  const previous=await optionalRead(rule);
  if(previous&&!previous.startsWith('# Managed by SAAM application'))throw Error(`Kept custom rules at ${rule}; rename that file before retrying.`);
  await atomicWrite(rule,text);return {skill,permissions:rule,restartRequired:true};
}
async function registerClaude(clientHome,home){
  const directory=clientHome===homedir()?process.env.CLAUDE_CONFIG_DIR??join(clientHome,'.claude'):join(clientHome,'.claude');
  const skill=await registerSkill(join(directory,'skills'),home),settingsFile=join(directory,'settings.json');
  const previous=await optionalRead(settingsFile),settings=previous?JSON.parse(previous):{};
  if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('Claude settings must be a JSON object.');
  settings.permissions??={};settings.permissions.allow??=[];
  if(!Array.isArray(settings.permissions.allow))throw Error('Claude permissions.allow must be an array.');
  for(const permission of ['Bash(saam *)','PowerShell(saam *)'])if(!settings.permissions.allow.includes(permission))settings.permissions.allow.push(permission);
  await atomicWrite(settingsFile,JSON.stringify(settings,null,2)+'\n');return {skill,permissions:settingsFile,restartRequired:true};
}

function installedProgram(path,{home,clientHome,platform}){
  const normalized=path.replaceAll('\\','/').toLowerCase();
  const local=clientHome===homedir()?process.env.LOCALAPPDATA??join(clientHome,'AppData','Local'):join(clientHome,'AppData','Local');
  const previous=platform==='win32'?join(local,'Programs','SAAM'):join(clientHome,'Applications','SAAM');
  return [previous,join(home,'app')].some(root=>normalized.startsWith(root.replaceAll('\\','/').toLowerCase()+'/'));
}
function ownedServer(record,options){
  return Array.isArray(record?.args)&&record.args.some(arg=>typeof arg==='string'&&arg.replaceAll('\\','/').endsWith('/adapters/mcp/src/server.mjs')&&installedProgram(arg,options));
}
async function retireClaude(options){
  const {clientHome}=options,removed=[];
  const directory=clientHome===homedir()?process.env.CLAUDE_CONFIG_DIR??join(clientHome,'.claude'):join(clientHome,'.claude');
  const configuration=join(clientHome,'.claude.json'),text=await optionalRead(configuration);
  if(text){
    const document=JSON.parse(text);
    if(ownedServer(document.mcpServers?.saam,options)){
      delete document.mcpServers.saam;await atomicWrite(configuration,JSON.stringify(document,null,2)+'\n');removed.push(configuration+'#mcpServers.saam');
    }
  }
  const pluginsFile=join(directory,'plugins','installed_plugins.json'),pluginsText=await optionalRead(pluginsFile);
  if(pluginsText){
    const document=JSON.parse(pluginsText),retired=[];
    for(const [id,entries] of Object.entries(document.plugins??{})){
      if(!id.startsWith('saam@')||!Array.isArray(entries))continue;
      const keep=entries.filter(entry=>!(typeof entry.installPath==='string'&&installedProgram(entry.installPath,options)&&entry.installPath.replaceAll('\\','/').endsWith('/adapters/claude/plugin')));
      if(keep.length===entries.length)continue;
      if(keep.length)document.plugins[id]=keep;else {delete document.plugins[id];retired.push(id);}
      removed.push(pluginsFile+'#'+id);
    }
    if(removed.some(item=>item.startsWith(pluginsFile))){
      await atomicWrite(pluginsFile,JSON.stringify(document,null,2)+'\n');
      const settingsFile=join(directory,'settings.json'),settingsText=await optionalRead(settingsFile);
      if(settingsText&&retired.length){
        const settings=JSON.parse(settingsText);
        for(const id of retired)if(settings.enabledPlugins?.[id])settings.enabledPlugins[id]=false;
        await atomicWrite(settingsFile,JSON.stringify(settings,null,2)+'\n');
      }
    }
  }
  return removed;
}
async function retireCodex(options){
  const directory=options.clientHome===homedir()?process.env.CODEX_HOME??join(options.clientHome,'.codex'):join(options.clientHome,'.codex');
  const configuration=join(directory,'config.toml'),text=await optionalRead(configuration);if(!text)return [];
  // Codex's own `mcp add` emits a table with a single-line JSON-compatible
  // args array. Only that recognized installed-SAAM registration is retired;
  // unfamiliar TOML and custom servers are left byte-for-byte intact.
  const sections=text.split(/(?=^\s*\[[^\]\r\n]+\]\s*$)/m);
  const server=sections.find(section=>/^\s*\[mcp_servers\.(?:saam|"saam")\]/.test(section));
  const argsLine=server?.match(/^\s*args\s*=\s*(\[[^\r\n]*\])\s*$/m);
  if(!argsLine)return [];
  const parsed={args:null};
  try{parsed.args=JSON.parse(argsLine[1]);}catch(error){if(error instanceof SyntaxError)return [];throw error;}
  if(!ownedServer({args:parsed.args},options))return [];
  const retained=sections.filter(section=>!/^\s*\[mcp_servers\.(?:saam|"saam")(?:\]|\.)/.test(section));
  await atomicWrite(configuration,retained.join(''));return [configuration+'#mcp_servers.saam'];
}

export async function setupClients({home,clientHome=homedir(),platform=process.platform,register=true}={}){
  if(!home)throw Error('Client setup requires the SAAM home.');
  const status=await clientStatus({clientHome,platform}),result={...status,home:resolve(home),errors:[]};
  try{
    await writeHomeGuidance(result.home);
  }catch(error){result.errors.push(error.message);}
  if(!register)return result;
  for(const client of result.clients){
    try{
      const options={home:result.home,clientHome,platform};
      if(client.id==='codex'){
        const retired=await retireCodex(options);client.registration=await registerCodex(clientHome,result.home);client.registration.retired=retired;
      }else {
        const retired=await retireClaude(options);client.registration=await registerClaude(clientHome,result.home);client.registration.retired=retired;
      }
    }catch(error){client.registration={error:error.message};result.errors.push(`${client.name}: ${error.message}`);}
  }
  return result;
}

export async function writeHomeGuidance(home){
  const written=[];
  for(const name of ['AGENTS.md','CLAUDE.md']){
    const target=join(home,name),previous=await optionalRead(target);
    if(previous&&!previous.includes(marker))continue;
    await atomicWrite(target,guidance(home));written.push(target);
  }
  return written;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  setupClients({home:process.argv[2],register:process.argv[3]!=='--no-register'})
    .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
