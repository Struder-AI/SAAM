// User-level command discovery and narrow permissions; registration failures
// are returned by setup and never prevent the application from starting.
import {mkdir,readFile,writeFile,rename,rm,rmdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {homePaths} from '../core/application/home.mjs';

async function atomicWrite(path,text){
  await mkdir(dirname(path),{recursive:true});const temporary=path+'.saam-'+randomUUID();
  await writeFile(temporary,text);await rename(temporary,path);
}
async function optionalRead(path){try{return await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const marker='<!-- Managed by SAAM application -->',ruleMarker='# Managed by SAAM application';
const claudePermissions=['Bash(saam *)','PowerShell(saam *)'];
// Client configuration folders; their environment overrides apply only to the real home.
function clientFolders(clientHome){
  const real=clientHome===homedir();
  return {agents:join(clientHome,'.agents'),codex:real?process.env.CODEX_HOME??join(clientHome,'.codex'):join(clientHome,'.codex'),
    claude:real?process.env.CLAUDE_CONFIG_DIR??join(clientHome,'.claude'):join(clientHome,'.claude')};
}
// The home's AGENTS.md, CLAUDE.md and client skill are the installed program's
// AGENTS.md, with this home's folders and links resolved to the program's manuals.
const programRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Client hooks report events to the home's SAAM (`saam client-event`): this program's node runs
// scripts/saam.mjs. Claude Code spawns it directly (exec form); Codex runs a command line in the
// session's shell, so paths that need no quoting are written to read the same in sh, cmd and PowerShell.
// Codex runs Interrupt and SessionEnd synchronously within 3 s, and Claude Code's SessionEnd
// runs before it exits; the other events run in the background.
const script=join(programRoot,'scripts','saam.mjs'),foreground=new Set(['Interrupt','SessionEnd']);
const claudeEvents={Stop:null,StopFailure:null,UserPromptSubmit:null,Notification:'idle_prompt',SessionEnd:null};
const codexEvents=['Stop','Interrupt','UserPromptSubmit','SessionEnd'];
const isClaudeHook=hook=>Array.isArray(hook?.args)&&hook.args.at(-1)==='client-event'&&/[\\/]scripts[\\/]saam\.mjs$/.test(hook.args[0]??'');
const isCodexHook=hook=>typeof hook?.command==='string'&&/saam\.mjs'? client-event$/.test(hook.command);
function commandLine(windows){
  const parts=[process.execPath,script].map(path=>path.replaceAll('\\','/'));
  const quoted=parts.every(part=>/^[\w.:/-]+$/.test(part))?parts:windows?parts.map(part=>`'${part.replaceAll("'","''")}'`):parts.map(part=>`'${part.replaceAll("'","'\\''")}'`);
  return (windows&&quoted!==parts?'& ':'')+quoted.join(' ')+' client-event';
}
const claudeGroups=()=>Object.fromEntries(Object.entries(claudeEvents).map(([event,matcher])=>[event,{...(matcher&&{matcher}),
  hooks:[{type:'command',command:process.execPath,args:[script,'client-event'],...(!foreground.has(event)&&{async:true})}]}]));
const codexGroups=()=>Object.fromEntries(codexEvents.map(event=>[event,{hooks:[{type:'command',command:commandLine(false),commandWindows:commandLine(true),
  ...(foreground.has(event)?{timeout:3}:{async:true})}]}]));
// A client's hooks with SAAM's handlers replaced by `groups` (event: SAAM's group, placed last).
// Other hooks keep their place; an event that SAAM's removal empties is dropped.
function replaceHooks(hooks,isOwn,groups={}){
  if(!hooks||typeof hooks!=='object'||Array.isArray(hooks))throw Error('hooks must be a JSON object.');
  const result={hooks:{...hooks},removed:false};
  const owns=group=>Array.isArray(group?.hooks)&&group.hooks.some(isOwn);
  for(const [event,current] of Object.entries(hooks))if(Array.isArray(current)&&current.some(owns)){
    const kept=current.flatMap(group=>{if(!owns(group))return [group];const rest=group.hooks.filter(hook=>!isOwn(hook));return rest.length?[{...group,hooks:rest}]:[];});
    result.removed=true;if(kept.length)result.hooks[event]=kept;else delete result.hooks[event];
  }
  for(const [event,group] of Object.entries(groups)){
    if(!Array.isArray(result.hooks[event]??[]))throw Error(`hooks.${event} must be an array.`);
    result.hooks[event]=[...result.hooks[event]??[],group];
  }
  return result;
}
async function guidance(home){
  const source=await readFile(join(programRoot,'AGENTS.md'),'utf8');
  const linked=source.replace(/\]\((?!https?:|#)([^)\s]+)\)/g,(link,target)=>`](${join(programRoot,target)})`);
  const paths=homePaths(home);
  const located=`This SAAM home is ${paths.home}: prints are in ${paths.prints}, extensions in ${paths.extensions} and agent notes in ${paths.notes}. SAAM regenerates this file from ${join(programRoot,'AGENTS.md')}.`;
  return `${marker}\n${linked.replace(/^(# [^\n]*\n)/,`$1\n${located}\n`)}`;
}
async function registerSkill(directory,home){
  const target=join(directory,'saam','SKILL.md'),previous=await optionalRead(target);
  if(previous&&!previous.includes(marker))throw Error(`Kept existing custom skill at ${target}; rename it before retrying.`);
  const skill=`---\nname: saam\ndescription: Make 3D printed parts through SAAM, work with print bundles and Studio, or start the SAAM tour.\n---\n\n${await guidance(home)}`;
  await atomicWrite(target,skill);return target;
}
async function registerCodex(clientHome,home){
  const folders=clientFolders(clientHome),skill=await registerSkill(join(folders.agents,'skills'),home);
  const rule=join(folders.codex,'rules','saam.rules');
  const text=`${ruleMarker}\nprefix_rule(pattern = ["saam"], decision = "allow", justification = "Call the installed SAAM local application.")\n`;
  const previous=await optionalRead(rule);
  if(previous&&!previous.startsWith(ruleMarker))throw Error(`Kept custom rules at ${rule}; rename that file before retrying.`);
  await atomicWrite(rule,text);
  // Codex runs a new or changed hook only after the person trusts it in /hooks; SAAM never writes trust.
  const hooksFile=join(folders.codex,'hooks.json'),hooksText=await optionalRead(hooksFile),document=hooksText?JSON.parse(hooksText):{};
  if(!document||typeof document!=='object'||Array.isArray(document))throw Error('Codex hooks.json must be a JSON object.');
  const before=JSON.stringify(document.hooks);document.hooks=replaceHooks(document.hooks??{},isCodexHook,codexGroups()).hooks;
  const trustRequired=JSON.stringify(document.hooks)!==before;
  if(trustRequired)await atomicWrite(hooksFile,JSON.stringify(document,null,2)+'\n');
  return {skill,permissions:rule,hooks:hooksFile,trustRequired,...(trustRequired&&{tellPerson:"In Codex, open /hooks and trust SAAM's four hooks."}),restartRequired:true};
}
async function registerClaude(clientHome,home){
  const directory=clientFolders(clientHome).claude;
  const skill=await registerSkill(join(directory,'skills'),home),settingsFile=join(directory,'settings.json');
  const previous=await optionalRead(settingsFile),settings=previous?JSON.parse(previous):{};
  if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('Claude settings must be a JSON object.');
  settings.permissions??={};settings.permissions.allow??=[];
  if(!Array.isArray(settings.permissions.allow))throw Error('Claude permissions.allow must be an array.');
  for(const permission of claudePermissions)if(!settings.permissions.allow.includes(permission))settings.permissions.allow.push(permission);
  settings.hooks=replaceHooks(settings.hooks??{},isClaudeHook,claudeGroups()).hooks;
  await atomicWrite(settingsFile,JSON.stringify(settings,null,2)+'\n');return {skill,permissions:settingsFile,hooks:settingsFile+'#hooks',restartRequired:true};
}
// Each removal returns the paths it removed; unmarked files are someone else's and stay.
async function unregisterSkill(directory){
  const folder=join(directory,'saam'),skill=join(folder,'SKILL.md'),text=await optionalRead(skill);
  if(!text?.includes(marker))return [];
  await rm(skill);
  try{await rmdir(folder);}catch(error){if(error.code!=='ENOTEMPTY'&&error.code!=='EEXIST')throw error;}
  return [skill];
}
async function unregisterCodex(options){
  const folders=clientFolders(options.clientHome),rule=join(folders.codex,'rules','saam.rules');
  const removed=[...await retireCodex(options),...await unregisterSkill(join(folders.agents,'skills'))];
  if((await optionalRead(rule))?.startsWith(ruleMarker)){await rm(rule);removed.push(rule);}
  const hooksFile=join(folders.codex,'hooks.json'),text=await optionalRead(hooksFile),document=text===null?null:JSON.parse(text);
  const hooks=document?.hooks?replaceHooks(document.hooks,isCodexHook):{removed:false};
  if(hooks.removed){
    document.hooks=hooks.hooks;if(!Object.keys(document.hooks).length)delete document.hooks;
    if(Object.keys(document).length)await atomicWrite(hooksFile,JSON.stringify(document,null,2)+'\n');else await rm(hooksFile);
    removed.push(hooksFile+'#hooks');
  }
  return removed;
}
async function unregisterClaude(options){
  const directory=clientFolders(options.clientHome).claude,settingsFile=join(directory,'settings.json');
  const removed=[...await retireClaude(options),...await unregisterSkill(join(directory,'skills'))];
  const text=await optionalRead(settingsFile),settings=text===null?null:JSON.parse(text),allow=settings?.permissions?.allow;
  const changed=[];
  if(Array.isArray(allow)&&claudePermissions.some(permission=>allow.includes(permission))){
    settings.permissions.allow=allow.filter(permission=>!claudePermissions.includes(permission));changed.push(settingsFile+'#permissions.allow');
  }
  const hooks=settings?.hooks?replaceHooks(settings.hooks,isClaudeHook):{removed:false};
  if(hooks.removed){settings.hooks=hooks.hooks;if(!Object.keys(settings.hooks).length)delete settings.hooks;changed.push(settingsFile+'#hooks');}
  if(changed.length)await atomicWrite(settingsFile,JSON.stringify(settings,null,2)+'\n');
  return [...removed,...changed];
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
  const {clientHome}=options,removed=[],directory=clientFolders(clientHome).claude;
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
  const configuration=join(clientFolders(options.clientHome).codex,'config.toml'),text=await optionalRead(configuration);if(!text)return [];
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
  const result={clients:[{id:'codex',name:'Codex'},{id:'claude',name:'Claude Code'}],clientHome,home:resolve(home),errors:[]};
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

// Removes SAAM's skills, rule and permissions, and retired registrations of this
// home's program, from both clients; unrelated settings are kept.
export async function unregisterClients({home,clientHome=homedir(),platform=process.platform}={}){
  if(!home)throw Error('Client unregistration requires the SAAM home.');
  const options={home:resolve(home),clientHome,platform},result={clientHome,removed:[],errors:[]};
  try{result.removed.push(...await unregisterCodex(options));}catch(error){result.errors.push(`Codex: ${error.message}`);}
  try{result.removed.push(...await unregisterClaude(options));}catch(error){result.errors.push(`Claude Code: ${error.message}`);}
  return result;
}
function reportUnregistration(result){
  for(const item of result.removed)console.log(`Removed ${item}`);
  for(const error of result.errors)console.log(`Could not remove a client registration: ${error}`);
  if(result.errors.length)process.exitCode=1;
}

export async function writeHomeGuidance(home){
  const written=[],text=await guidance(home);
  for(const name of ['AGENTS.md','CLAUDE.md']){
    const target=join(home,name),previous=await optionalRead(target);
    if(previous&&!previous.includes(marker))continue;
    await atomicWrite(target,text);written.push(target);
  }
  return written;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [home,option]=process.argv.slice(2);
  const finished=option==='--unregister'?unregisterClients({home}).then(reportUnregistration)
    :setupClients({home,register:option!=='--no-register'}).then(result=>console.log(JSON.stringify(result)));
  finished.catch(error=>{console.error(error.message);process.exitCode=1;});
}
