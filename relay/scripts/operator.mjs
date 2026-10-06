#!/usr/bin/env node
// Manage alpha invites, activated installations and received diagnostics.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const DEPLOYED='https://saam-relay.remettub.workers.dev';
// A bug report is read beside its installation's records from the preceding half hour.
const CONTEXT_MS=30*60_000,CONTEXT_ROWS=20;
const time=at=>at?new Date(at).toISOString().replace('T',' ').slice(0,19):'never';

function options(argv){
  const named={},positional=[];
  for(let i=0;i<argv.length;i++)argv[i].startsWith('--')?named[argv[i].slice(2)]=argv[++i]:positional.push(argv[i]);
  return {named,positional};
}
function since(value){
  if(!value)return undefined;
  const span=/^(\d+(?:\.\d+)?)([dhm])$/.exec(value);
  if(span)return Date.now()-Number(span[1])*{d:86_400_000,h:3_600_000,m:60_000}[span[2]];
  const at=Date.parse(value);
  if(Number.isNaN(at))throw Error(`Unreadable --since ${value}: use 7d, 12h, 30m or a date.`);
  return at;
}
async function operatorToken(){
  if(process.env.SAAM_OPERATOR_TOKEN)return process.env.SAAM_OPERATOR_TOKEN.trim();
  try{return (await readFile(resolve(root,'.local/relay-operator-token'),'utf8')).split(/\r?\n/)[0].trim();}
  catch{throw Error('Set SAAM_OPERATOR_TOKEN, or put the token in .local/relay-operator-token.');}
}
async function send(relay,secret,method,path,{query={},body}={}){
  const url=new URL(path,relay);
  for(const [key,value] of Object.entries(query))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
  const response=await fetch(url,{method,headers:{Authorization:`Bearer ${secret}`,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined});
  if(!response.ok)throw Error(`${method} ${url.pathname} answered ${response.status}: ${await response.text()}`);
  return response.json();
}
async function allRecords(relay,secret,query){
  const records=[];let after=0;
  for(;;){
    const page=await send(relay,secret,'GET','/records',{query:{...query,after}});
    records.push(...page.records);
    if(page.next===null)return records;
    after=page.next;
  }
}

async function main(){
  const {named,positional}=options(process.argv.slice(2)),[command,id]=positional;
  const relay=named.relay??process.env.SAAM_RELAY_URL??DEPLOYED,secret=await operatorToken();
  if(command==='invite'){
    if(!named.for)throw Error('Name who the invite is for: invite --for "NAME" [--days 14].');
    const invite=await send(relay,secret,'POST','/operator/invites',{body:{label:named.for,days:named.days?Number(named.days):undefined}});
    console.log(`Invite for ${invite.label} (id ${invite.id}), single use, valid until ${time(invite.expiresAt)} UTC:\n\n  ${invite.code}\n\nPaste it in Studio Connect. It is shown only now.`);
    return;
  }
  if(command==='invites'){
    const {invites}=await send(relay,secret,'GET','/operator/invites');
    for(const item of invites)console.log(`${item.id}  ${item.state.padEnd(7)}  ${item.label}  created ${time(item.created)}  ${item.used?`used ${time(item.used)} by ${item.device}`:`expires ${time(item.expires)}`}`);
    if(!invites.length)console.log('No invites.');return;
  }
  if(command==='revoke-invite'){
    if(!id)throw Error('revoke-invite ID (see invites).');
    console.log(JSON.stringify(await send(relay,secret,'DELETE',`/operator/invites/${encodeURIComponent(id)}`)));return;
  }
  if(command==='devices'){
    const {devices,limit,recordDays,databaseBytes}=await send(relay,secret,'GET','/operator/devices');
    for(const item of devices)console.log(`${item.id}  ${item.label??'(no invite)'}  activated ${time(item.activated)}  last received ${time(item.lastSeen)}`);
    console.log(`${devices.length} of ${limit} installations activated. Records kept ${recordDays} days; ${(databaseBytes/1e6).toFixed(1)} MB stored.`);return;
  }
  if(command==='remove'){
    const ids=positional.slice(1);if(!ids.length)throw Error('remove DEVICE [DEVICE…] (see devices).');
    for(const device of ids)console.log(JSON.stringify(await send(relay,secret,'DELETE',`/operator/devices/${encodeURIComponent(device)}`)));
    return;
  }
  if(command==='reports'){
    const from=since(named.since??'7d'),{devices}=await send(relay,secret,'GET','/operator/devices');
    const records=await allRecords(relay,secret,{device:named.device,since:from-CONTEXT_MS}),labels=new Map(devices.map(item=>[item.id,item.label]));
    const reports=records.filter(record=>record.name==='bug-report'&&record.at>=from);
    for(const report of reports){
      const {event={},about={}}=report.body??{};
      console.log(`\n${time(report.at)} UTC  ${labels.get(report.device)??'(removed installation)'} (${report.device})\n  SAAM ${about.version} · ${about.platform??'unknown platform'} · ${event.runtimeLabel??'installed'}`
        +`\n  ${event.reporter==='agent'?`Agent (${event.client??'unknown client'})`:`Studio ${event.studioInstanceId}`} · print ${event.printId??'(none open)'} · ${event.stage??'unknown stage'}\n\n  ${String(event.description).split('\n').join('\n  ')}\n`);
      const before=records.filter(record=>record.device===report.device&&record.id<report.id&&record.at>=report.at-CONTEXT_MS);
      console.log(`  Preceding records (${CONTEXT_MS/60_000} min): ${before.length}${before.length>CONTEXT_ROWS?`, last ${CONTEXT_ROWS} shown; pull --device ${report.device} for all`:''}`);
      for(const record of before.slice(-CONTEXT_ROWS)){
        const {event:detail={}}=record.body??{};
        console.log(`    ${time(record.at).slice(11)}  ${[record.name,detail.name,detail.stage].filter(Boolean).join(' ')}${detail.error?'  error: '+String(detail.error).replace(/\s+/g,' '):''}`);
      }
    }
    console.log(`\n${reports.length} bug report${reports.length===1?'':'s'} since ${time(from)} UTC.`);return;
  }
  if(command!=='pull')throw Error('Commands: invite --for NAME [--days N], invites, revoke-invite ID, devices, remove DEVICE…, reports [--device ID] [--since 7d], pull [--device ID] [--since 1d].');
  if(!named.device&&!named.since)throw Error('pull needs --device or --since.');
  const records=await allRecords(relay,secret,{device:named.device,since:since(named.since)});
  const folder=resolve(root,'.local/relay-records');await mkdir(folder,{recursive:true});
  const filename=`received-${new Date().toISOString().replace(/[:.]/g,'-')}.jsonl`;
  const path=resolve(folder,filename);
  await writeFile(path,records.map(record=>JSON.stringify(record)).join('\n')+(records.length?'\n':''));
  console.log(`${path}  (${records.length} records)`);
}

main().catch(error=>{console.error(error.message);process.exit(1);});
