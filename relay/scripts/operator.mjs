#!/usr/bin/env node
// The relay operator's commands: invites, paired computers and the alpha
// records (D-039).
//   node relay/scripts/operator.mjs invite --for "NAME" [--days 14]
//   node relay/scripts/operator.mjs invites
//   node relay/scripts/operator.mjs revoke-invite ID
//   node relay/scripts/operator.mjs devices
//   node relay/scripts/operator.mjs remove DEVICE [DEVICE…]
//   node relay/scripts/operator.mjs sessions [--since 7d]
//   node relay/scripts/operator.mjs pull [SESSION] [--device ID] [--since 1d]
// pull writes each session's full records as JSONL and a readable timeline as
// Markdown under .local/relay-records/. The token is SAAM_OPERATOR_TOKEN or the
// first line of .local/relay-operator-token; the relay is SAAM_RELAY_URL,
// --relay URL or the deployed one.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const DEPLOYED='https://saam-relay.remettub.workers.dev',DETAIL_CHARS=300;

function options(argv){
  const named={},positional=[];
  for(let i=0;i<argv.length;i++)argv[i].startsWith('--')?named[argv[i].slice(2)]=argv[++i]:positional.push(argv[i]);
  return {named,positional};
}
// 7d, 12h, 30m, or a date; the start of the window in milliseconds.
function since(text){
  if(!text)return undefined;
  const span=/^(\d+(?:\.\d+)?)([dhm])$/.exec(text);
  if(span)return Date.now()-Number(span[1])*{d:86_400_000,h:3_600_000,m:60_000}[span[2]];
  const at=Date.parse(text);if(Number.isNaN(at))throw Error(`Unreadable --since ${text}: use 7d, 12h, 30m or a date.`);
  return at;
}
async function token(){
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
const get=(relay,secret,path,query)=>send(relay,secret,'GET',path,{query});
async function allRecords(relay,secret,query){
  const records=[];let after=0;
  for(;;){
    const page=await get(relay,secret,'/records',{...query,after});
    records.push(...page.records);
    if(page.next===null)return records;
    after=page.next;
  }
}

const time=at=>at?new Date(at).toISOString().replace('T',' ').slice(0,19):'never';
const clip=text=>text.length>DETAIL_CHARS?text.slice(0,DETAIL_CHARS)+'…':text;
const cell=text=>clip(String(text??'')).replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
function detail(record){
  const body=record.body;
  if(record.kind==='request'){
    if(body?.method==='tools/call')return JSON.stringify(body.params?.arguments??{});
    if(body?.method==='initialize')return JSON.stringify(body.params?.clientInfo??{});
    return body?.unparsed?'unparsed: '+body.unparsed:body?.method??'';
  }
  if(record.kind==='result'||record.kind==='relay-result'){
    if(record.error)return 'ERROR '+record.error;
    const content=body?.result?.content?.[0];
    return content?.json!==undefined?JSON.stringify(content.json):content?.text??JSON.stringify(body?.result??body);
  }
  if(record.kind==='device-event'){
    const {kind,seq,at,delivery,studioInstanceId,changes,...rest}=body??{};
    const changed=(changes??[]).map(change=>`${change.path}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`);
    return [...changed,Object.keys(rest).length?JSON.stringify(rest):''].filter(Boolean).join('; ');
  }
  return [record.error,body?JSON.stringify(body):''].filter(Boolean).join(' ');
}
function timeline(session,records,devices){
  const device=devices.find(item=>item.id===records[0]?.device),saam=device?.saam;
  const client=records.find(record=>record.kind==='request'&&record.name==='initialize')?.body?.params?.clientInfo;
  const requests=records.filter(record=>record.kind==='request').length,errors=records.filter(record=>record.error).length;
  const lines=[`# Relay session ${session}`,'',
    `- Client: ${client?`${client.name} ${client.version??''}`.trim():'unknown'}`,
    `- Computer: ${records[0]?.device??'unknown'}${saam?` · SAAM ${saam.version??'development'} (${saam.platform??saam.os??'?'})`:''}`,
    `- ${time(records[0].at)} → ${time(records.at(-1).at)} UTC · ${requests} requests · ${errors} errors`,
    `- Details are cut at ${DETAIL_CHARS} characters; the JSONL beside this file has every record in full.`,'',
    '| Time (UTC) | Kind | Name | ms | Detail |','|---|---|---|---:|---|'];
  for(const record of records)lines.push(`| ${time(record.at).slice(11)} | ${record.kind} | ${cell(record.name)} | ${record.ms??''} | ${cell(detail(record))} |`);
  return lines.join('\n')+'\n';
}

async function main(){
  const {named,positional}=options(process.argv.slice(2)),[command,sessionId]=positional;
  const relay=named.relay??process.env.SAAM_RELAY_URL??DEPLOYED,secret=await token();
  if(command==='invite'){
    if(!named.for)throw Error('Name who the invite is for: invite --for "NAME" [--days 14].');
    const invite=await send(relay,secret,'POST','/operator/invites',{body:{label:named.for,days:named.days?Number(named.days):undefined}});
    console.log(`Invite for ${invite.label} (id ${invite.id}), single use, valid until ${time(invite.expiresAt)} UTC:

  ${invite.code}

They paste it in SAAM Studio's Connect panel. It is shown only now.`);
    return;
  }
  if(command==='invites'){
    const {invites}=await get(relay,secret,'/operator/invites');
    for(const item of invites)console.log(`${item.id}  ${item.state.padEnd(7)}  ${item.label}  created ${time(item.created)}  ${item.used?`used ${time(item.used)} by ${item.device}`:`expires ${time(item.expires)}`}`);
    if(!invites.length)console.log('No invites.');
    return;
  }
  if(command==='revoke-invite'){if(!sessionId)throw Error('revoke-invite ID (see invites).');console.log(JSON.stringify(await send(relay,secret,'DELETE',`/operator/invites/${encodeURIComponent(sessionId)}`)));return;}
  if(command==='devices'){
    const {devices,limit,recordDays,databaseBytes}=await get(relay,secret,'/operator/devices');
    for(const item of devices)console.log(`${item.id}  ${item.online?'online ':'offline'}  ${item.label??'(no invite)'}  SAAM ${item.saam?.version??'?'} ${item.saam?.platform??item.saam?.os??''}  paired ${time(item.paired)}  connected ${time(item.connected)}  seen ${time(item.lastSeen)}  chats: ${item.chats.map(chat=>chat.client).join(', ')||'none'}`);
    console.log(`${devices.length} of ${limit} computers paired. Records kept ${recordDays} days; ${(databaseBytes/1e6).toFixed(1)} MB stored.`);
    return;
  }
  if(command==='remove'){
    const ids=positional.slice(1);if(!ids.length)throw Error('remove DEVICE [DEVICE…] (see devices).');
    for(const id of ids)console.log(JSON.stringify(await send(relay,secret,'DELETE',`/operator/devices/${encodeURIComponent(id)}`)));
    return;
  }
  if(command==='sessions'){
    const sessions=await get(relay,secret,'/records/sessions',{since:since(named.since)});
    for(const item of sessions)console.log(`${time(item.last)}  ${item.session}  ${item.client??'?'}  ${item.requests} requests  ${item.errors} errors  (from ${time(item.first)})`);
    if(!sessions.length)console.log('No sessions recorded in that window.');
    return;
  }
  if(command!=='pull')throw Error('Commands: invite --for NAME [--days N], invites, revoke-invite ID, devices, remove DEVICE…, sessions [--since 7d], pull [SESSION] [--device ID] [--since 1d].');
  if(!sessionId&&!named.device&&!named.since)throw Error('pull needs a session, --device or --since.');
  const [records,{devices}]=await Promise.all([allRecords(relay,secret,{session:sessionId,device:named.device,since:since(named.since)}),get(relay,secret,'/operator/devices')]);
  const bySession=Map.groupBy(records,record=>record.session??'no-session');
  const folder=resolve(root,'.local/relay-records');await mkdir(folder,{recursive:true});
  for(const [session,group] of bySession){
    const name=`${new Date(group[0].at).toISOString().slice(0,10)}-${session.split('.').at(-1).slice(0,12)}`;
    await writeFile(resolve(folder,name+'.jsonl'),group.map(record=>JSON.stringify(record)).join('\n')+'\n');
    await writeFile(resolve(folder,name+'.md'),timeline(session,group,devices));
    console.log(`${resolve(folder,name+'.md')}  (${group.length} records)`);
  }
  if(!bySession.size)console.log('No records matched.');
}

main().catch(error=>{console.error(error.message);process.exit(1);});
