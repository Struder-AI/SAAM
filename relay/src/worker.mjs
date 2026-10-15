// Optional alpha service: invite activation, authenticated release lookup and
// live diagnostics. Local SAAM operation never depends on this Worker.
import {boundedText,compact} from './relay-object.mjs';
export {RelayObject} from './relay-object.mjs';

const REGISTER_LIMIT=16_000,EVENT_LIMIT=64_000;
const relay=env=>env.RELAY.get(env.RELAY.idFromName('relay'));
const bearer=request=>/^Bearer (\S+)$/.exec(request.headers.get('Authorization')??'')?.[1];
const address=request=>request.headers.get('CF-Connecting-IP')??'local';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});

async function bodyJson(request,limit){
  const {body,bytes}=await boundedText(request,limit);
  if(bytes>limit)return {error:'Request too large.',status:413};
  try{return {value:JSON.parse(body)};}catch{return {error:'Send JSON.',status:400};}
}

// A stored bug report is also posted to the team's Slack channel when SLACK_WEBHOOK_URL is set.
// It carries the stored, redacted text; a failed post is logged and never reaches the reporter.
async function postBugReport(env,{device,label},body){
  const {event={},about={}}=compact(body),slack=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const name=slack(label??device),who=event.reporter==='agent'?`Agent (${slack(event.client??'unknown client')})`:'Studio';
  const text=`*SAAM ${slack(about.version??'(unknown version)')} bug report* from ${name} · ${slack(about.platform??'unknown platform')}`
    +`\n${who} · print ${slack(event.printId??'(none open)')}${event.stage?' · '+slack(event.stage):''}`
    +`\n>${slack(event.description).split('\n').join('\n>')}`
    +`\nContext: \`node relay/scripts/operator.mjs reports --device "${name}"\``;
  try{
    const response=await fetch(env.SLACK_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
    if(!response.ok)console.error(JSON.stringify({event:'slack-failed',status:response.status,error:(await response.text()).slice(0,200)}));
  }catch(problem){console.error(JSON.stringify({event:'slack-failed',error:problem.message}));}
}

function latestRelease(env){
  try{return JSON.parse(env.LATEST_RELEASE||'null');}catch{return null;}
}

async function device(request,env,ctx,path){
  if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
  if(path==='/device/register'){
    const parsed=await bodyJson(request,REGISTER_LIMIT);
    if(parsed.error)return json({error:parsed.error},parsed.status);
    const invite=parsed.value?.invite;
    const result=await relay(env).registerDevice({invite:typeof invite==='string'?invite:null,address:address(request)});
    return result.error?json(result,403):json(result,201);
  }
  if(path!=='/device/release'&&path!=='/device/events')return new Response(null,{status:404});
  const secret=bearer(request);
  if(!secret||!await relay(env).deviceFor(secret))return json({error:'Unknown device credential.'},401);
  if(path==='/device/release')return json({release:latestRelease(env)});
  const parsed=await bodyJson(request,EVENT_LIMIT);
  if(parsed.error)return json({error:parsed.error},parsed.status);
  const {event,about}=parsed.value??{};
  if(!event||typeof event!=='object'||Array.isArray(event)||about!==undefined&&(!about||typeof about!=='object'||Array.isArray(about)))
    return json({error:'Send {event: object, about?: object}.'},400);
  const result=await relay(env).receiveEvent({secret,event,about});
  if(result.error)return json(result,result.error==='Unknown device credential.'?401:503);
  if(event.kind==='bug-report'&&env.SLACK_WEBHOOK_URL)ctx.waitUntil(postBugReport(env,result,{event,about}));
  return json({received:true});
}

async function sameSecret(given,expected){
  if(!given)return false;
  const [a,b]=await Promise.all([given,expected].map(value=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
  return crypto.subtle.timingSafeEqual(a,b);
}

async function operator(request,env,path){
  if(!env.OPERATOR_TOKEN)return new Response(null,{status:404});
  if(!await sameSecret(bearer(request),env.OPERATOR_TOKEN))return json({error:'Unknown operator token.'},401);
  const method=request.method,[,,collection,id]=path.split('/'),query=new URL(request.url).searchParams;
  const number=name=>query.has(name)?Number(query.get(name)):undefined;
  if(path==='/records'&&method==='GET')return json(await relay(env).readRecords({device:query.get('device'),since:number('since'),until:number('until'),after:number('after')}));
  if(collection==='devices'&&!id&&method==='GET')return json(await relay(env).listDevices());
  if(collection==='devices'&&id&&method==='PATCH'){
    const parsed=await bodyJson(request,REGISTER_LIMIT);
    if(parsed.error)return json({error:parsed.error},parsed.status);
    const label=String(parsed.value?.label??'').trim().slice(0,200);
    if(!label)return json({error:'Send {label}.'},400);
    return await relay(env).renameDevice(id,label)?json({renamed:id,label}):json({error:'No such installation.'},404);
  }
  if(collection==='devices'&&id&&method==='DELETE')return await relay(env).removeDevice(id)?json({removed:id}):json({error:'No such installation.'},404);
  if(collection==='invites'&&!id&&method==='GET')return json({invites:await relay(env).listInvites()});
  if(collection==='invites'&&!id&&method==='POST'){
    const parsed=await bodyJson(request,REGISTER_LIMIT);
    if(parsed.error)return json({error:parsed.error},parsed.status);
    const fields=parsed.value??{};
    const invite=await relay(env).createInvite({label:String(fields.label??''),days:fields.days});
    return invite.error?json(invite,400):json(invite,201);
  }
  if(collection==='invites'&&id&&method==='DELETE')return await relay(env).revokeInvite(id)?json({revoked:id}):json({error:'No unused invite with that id.'},404);
  return new Response(null,{status:404});
}

export default {fetch(request,env,ctx){
  const path=new URL(request.url).pathname;
  if(path.startsWith('/device/'))return device(request,env,ctx,path);
  if(path==='/records'||path.startsWith('/operator/'))return operator(request,env,path);
  if(path==='/')return json({service:'SAAM release and diagnostics',activation:'/device/register'});
  return new Response(null,{status:404});
}};
