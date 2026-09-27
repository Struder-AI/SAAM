// Public relay: OAuth for chat clients, a pairing-code consent page, device
// endpoints, the operator's routes and an MCP endpoint that forwards each
// JSON-RPC message to the paired computer through the shared relay object. It
// runs no SAAM operation.
import {OAuthProvider,AuthorizationError} from '@cloudflare/workers-oauth-provider';
import {recordDaysFor,boundedText} from './relay-object.mjs';
export {RelayObject} from './relay-object.mjs';

const SCOPE='saam',FORM_LIMIT=16_000;
const relay=env=>env.RELAY.get(env.RELAY.idFromName('relay'));
const bearer=request=>/^Bearer (\S+)$/.exec(request.headers.get('Authorization')??'')?.[1];
// The caller's network address, for per-address limits; wrangler dev has none.
const address=request=>request.headers.get('CF-Connecting-IP')??'local';
const escape=value=>String(value).replace(/[&<>"']/g,char=>`&#${char.charCodeAt(0)};`);
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const text=(value,status)=>new Response(value,{status,headers:{'Content-Type':'text/plain; charset=utf-8'}});
const LOOPBACK=/^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;

// Chat apps may send a sign-in back only to CHAT_REDIRECTS: space-separated
// origins, plus "loopback" for an app on the person's own computer. Adding one
// is a configuration change; existing connections are unaffected.
function redirectAllowed(env,uri){
  let url;try{url=new URL(uri);}catch{return false;}
  const allowed=String(env.CHAT_REDIRECTS??'').split(/\s+/).filter(Boolean);
  return allowed.includes(url.origin)||allowed.includes('loopback')&&LOOPBACK.test(url.hostname)&&/^https?:$/.test(url.protocol);
}
const NOT_ALLOWED='SAAM connects only with the chat apps it supports: Claude and ChatGPT.';

// The relay object answers MCP for the device named by the verified token.
const mcpHandler={fetch(request,env,ctx){
  const headers=new Headers(request.headers);headers.set('X-SAAM-Device',ctx.props.deviceId);
  return relay(env).fetch(new Request(request,{headers}));
}};

// client: {clientId, clientName}; redirectUri names where access goes. Without
// handle the sign-in cannot continue and the page has no form.
function consentPage({client,redirectUri,handle,error,recordDays}){
  const name=escape(client?.clientName??client?.clientId??'Your chat app');
  const host=redirectUri?new URL(redirectUri).hostname:null,local=host&&LOOPBACK.test(host);
  const origin=client?.clientId?.startsWith('https://')?`Published by <strong>${escape(new URL(client.clientId).hostname)}</strong>.`:'This app registered itself; its name is not verified.';
  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect SAAM</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1d1d1f;background:#fff}
input{font:inherit;font-size:1.4rem;letter-spacing:.15em;padding:.4rem .6rem;width:12ch;text-transform:uppercase}
button{font:inherit;padding:.5rem 1rem;margin-right:.5rem}.error{color:#b00020}
@media (prefers-color-scheme:dark){body{color:#f2f2f2;background:#161616}}</style>
<h1>Connect ${name} to SAAM</h1>
${host?`<p>${origin} Access will be sent to <strong>${escape(host)}</strong>.</p>`:''}
${local?'<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>':''}
${handle?`<p>${name} will be able to read, create and change prints on the computer running SAAM, and start toolpath generation. It cannot confirm a print or run a machine: you confirm settings and toolpath in SAAM Studio.</p>`:''}
${handle&&recordDays?`<p>During the alpha, the relay keeps a record of every request and result between your chat and SAAM, and of what you do in SAAM Studio, for ${recordDays} days, so SAAM's developers can find and fix problems. Your chat messages themselves stay with your chat app.</p>`:''}
${error?`<p class="error">${escape(error)}</p>`:''}
${handle?`<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <p><label>Code shown by SAAM on your computer<br><input name="code" autocomplete="one-time-code" required autofocus></label></p>
  <p><button name="decision" value="approve">Connect</button><button name="decision" value="deny" formnovalidate>Cancel</button></p>
</form>`:''}`;
}
const page=(html,headers=new Headers({'X-Frame-Options':'DENY','Content-Security-Policy':"frame-ancestors 'none'",'Cache-Control':'no-store'}))=>{headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers});};

async function authorize(request,env){
  const oauth=env.OAUTH_PROVIDER;
  try{
    if(request.method==='GET'){
      // Each consent page writes to OAuth storage: bounded per address before any work.
      if(!await relay(env).admit('authorize',address(request)))return text('Too many sign-ins from this network. Wait an hour and try again.',429);
      const parsed=await oauth.parseAuthRequest(request),client=await oauth.lookupClient(parsed.clientId);
      if(!client)return text('Unknown OAuth client.',400);
      if(!redirectAllowed(env,parsed.redirectUri))return text(NOT_ALLOWED,400);
      const consent=await oauth.beginConsent(parsed);
      await relay(env).beginSignIn({handle:consent.handle,clientId:client.clientId,clientName:client.clientName??null,redirectUri:parsed.redirectUri});
      return page(consentPage({client,redirectUri:parsed.redirectUri,handle:consent.handle,recordDays:recordDaysFor(env)}),consent.headers);
    }
    if(request.method!=='POST')return new Response(null,{status:405});
    const {body,bytes}=await boundedText(request,FORM_LIMIT);if(bytes>FORM_LIMIT)return text('Request too large.',413);
    const form=new URLSearchParams(body),handle=form.get('handle')??'';
    if(form.get('decision')!=='approve'){const denied=await oauth.denyConsent(request,handle);return new Response(null,{status:302,headers:denied.headers});}
    // The sign-in, then the code, before consuming the single-use consent handle.
    const linked=await relay(env).redeemLinkCode({handle,code:form.get('code'),address:address(request)});
    if(linked.error)return page(consentPage({client:linked.client,redirectUri:linked.client?.redirectUri,handle:linked.expired?null:handle,error:linked.error,recordDays:recordDaysFor(env)}));
    const approved=await oauth.approveConsent(request,handle,{scope:[SCOPE]});
    const {redirectTo}=await oauth.completeAuthorization({request:approved.request,userId:linked.deviceId,metadata:{},scope:[SCOPE],props:{deviceId:linked.deviceId}});
    approved.headers.set('Location',redirectTo);
    return new Response(null,{status:302,headers:approved.headers});
  }catch(error){
    if(error instanceof AuthorizationError&&error.redirectUri&&redirectAllowed(env,error.redirectUri)){
      const redirect=new URL(error.redirectUri);
      redirect.searchParams.set('error',error.code);redirect.searchParams.set('error_description',error.description);
      if(error.state)redirect.searchParams.set('state',error.state);if(error.issuer)redirect.searchParams.set('iss',error.issuer);
      return Response.redirect(redirect.href,302);
    }
    if(error instanceof AuthorizationError)return text(error.description,400);
    if(error?.name==='CimdFetchError')return text('This app could not be verified.',400);
    throw error;
  }
}

// Dynamic client registration, bounded per address and limited to allowed
// redirects before the provider stores anything.
async function registerClient(request,env,provider,ctx){
  if(!await relay(env).admit('register',address(request)))return json({error:'slow_down',error_description:'Too many registrations from this network.'},429);
  const {body,bytes}=await boundedText(request,FORM_LIMIT);
  if(bytes>FORM_LIMIT)return json({error:'invalid_client_metadata',error_description:'Registration too large.'},413);
  let metadata;try{metadata=JSON.parse(body);}catch{return json({error:'invalid_client_metadata',error_description:'Registration is not JSON.'},400);}
  const uris=Array.isArray(metadata?.redirect_uris)?metadata.redirect_uris:[];
  if(!uris.length||!uris.every(uri=>redirectAllowed(env,uri)))return json({error:'invalid_redirect_uri',error_description:NOT_ALLOWED},400);
  return provider.fetch(new Request(request,{body}),env,ctx);
}

// A chat app holding a grant for a computer is revoked with it.
async function revokeGrants(env,deviceId){
  for(const grant of (await env.OAUTH_PROVIDER.listUserGrants(deviceId)).items)await env.OAUTH_PROVIDER.revokeGrant(grant.id,deviceId);
}
async function chatsFor(env,deviceId){
  const chats=[];
  for(const grant of (await env.OAUTH_PROVIDER.listUserGrants(deviceId)).items){
    const client=await env.OAUTH_PROVIDER.lookupClient(grant.clientId).catch(()=>null);
    chats.push({client:client?.clientName??grant.clientId});
  }
  return chats;
}

async function device(request,env,path){
  if(path==='/device/connect')return relay(env).fetch(request);
  if(request.method!=='POST')return new Response(null,{status:405});
  // Registration spends an invite: {"invite": "XXXX-XXXX-XXXX-XXXX"}.
  if(path==='/device/register'){
    const {body,bytes}=await boundedText(request,FORM_LIMIT);if(bytes>FORM_LIMIT)return json({error:'Request too large.'},413);
    let invite=null;try{invite=JSON.parse(body||'{}').invite??null;}catch{/* Refused below as no invite. */}
    const device=await relay(env).registerDevice({invite:typeof invite==='string'?invite:null,address:address(request)});
    return device.error?json(device,403):json(device,201);
  }
  if(path==='/device/link-code'){const code=await relay(env).linkCode(bearer(request));return code?json(code):json({error:'Unknown device credential.'},401);}
  // The chat apps holding a grant for this computer: a connector already added
  // needs no URL or code, so Studio offers them only for another chat app.
  if(path==='/device/chats'){
    const deviceId=await relay(env).deviceFor(bearer(request));if(!deviceId)return json({error:'Unknown device credential.'},401);
    return json({chats:await chatsFor(env,deviceId)});
  }
  if(path==='/device/unpair'){
    const deviceId=await relay(env).unpair(bearer(request));if(!deviceId)return json({error:'Unknown device credential.'},401);
    await revokeGrants(env,deviceId);
    return json({unpaired:true});
  }
  return new Response(null,{status:404});
}

// The operator's routes, behind the OPERATOR_TOKEN secret (unset, none exist):
//   GET /operator/devices, DELETE /operator/devices/ID
//   GET /operator/invites, POST /operator/invites {label, days}, DELETE /operator/invites/ID
//   GET /records/sessions?since=MS and /records?session=|device=&since=&until=&after=
//   (a page of the alpha records; its next continues).
async function operator(request,env,path){
  if(!env.OPERATOR_TOKEN)return new Response(null,{status:404});
  if(!await sameSecret(bearer(request),env.OPERATOR_TOKEN))return json({error:'Unknown operator token.'},401);
  const method=request.method,[,,collection,id]=path.split('/'),query=new URL(request.url).searchParams;
  const number=name=>query.has(name)?Number(query.get(name)):undefined;
  if(path==='/records/sessions'&&method==='GET')return json(await relay(env).recordSessions({since:number('since')}));
  if(path==='/records'&&method==='GET')return json(await relay(env).readRecords({session:query.get('session'),device:query.get('device'),since:number('since'),until:number('until'),after:number('after')}));
  if(collection==='devices'&&!id&&method==='GET'){
    const listed=await relay(env).listDevices();
    for(const device of listed.devices)device.chats=await chatsFor(env,device.id);
    return json(listed);
  }
  if(collection==='devices'&&id&&method==='DELETE'){
    if(!await relay(env).removeDevice(id))return json({error:'No such computer.'},404);
    await revokeGrants(env,id);return json({removed:id});
  }
  if(collection==='invites'&&!id&&method==='GET')return json({invites:await relay(env).listInvites()});
  if(collection==='invites'&&!id&&method==='POST'){
    const {body,bytes}=await boundedText(request,FORM_LIMIT);if(bytes>FORM_LIMIT)return json({error:'Request too large.'},413);
    let fields={};try{fields=JSON.parse(body||'{}');}catch{return json({error:'Send JSON.'},400);}
    const invite=await relay(env).createInvite({label:String(fields.label??''),days:fields.days});
    return invite.error?json(invite,400):json(invite,201);
  }
  if(collection==='invites'&&id&&method==='DELETE')return await relay(env).revokeInvite(id)?json({revoked:id}):json({error:'No unused invite with that id.'},404);
  return new Response(null,{status:404});
}
async function sameSecret(given,expected){
  if(!given)return false;
  const [a,b]=await Promise.all([given,expected].map(value=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
  return crypto.subtle.timingSafeEqual(a,b);
}

const defaultHandler={async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/authorize')return authorize(request,env);
  if(path.startsWith('/device/'))return device(request,env,path);
  if(path==='/records'||path.startsWith('/records/')||path.startsWith('/operator/'))return operator(request,env,path);
  if(path==='/')return text('SAAM relay. Add PUBLIC_URL/mcp as a custom connector in your chat app.',200);
  return new Response(null,{status:404});
}};

// The canonical resource comes from configuration, so one provider per origin.
const providers=new Map();
function providerFor(origin){
  if(!providers.has(origin))providers.set(origin,new OAuthProvider({
    apiRoute:'/mcp',apiHandler:mcpHandler,defaultHandler,
    authorizeEndpoint:'/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',
    clientIdMetadataDocumentEnabled:true,scopesSupported:[SCOPE],
    resourceMetadata:{resource:origin+'/mcp',authorization_servers:[origin],scopes_supported:[SCOPE],bearer_methods_supported:['header'],resource_name:'SAAM'}
  }));
  return providers.get(origin);
}

export default {fetch(request,env,ctx){
  const provider=providerFor(env.PUBLIC_URL.replace(/\/$/,''));
  if(new URL(request.url).pathname==='/oauth/register'&&request.method==='POST')return registerClient(request,env,provider,ctx);
  return provider.fetch(request,env,ctx);
}};
