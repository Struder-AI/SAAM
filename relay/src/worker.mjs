// Public relay: OAuth for chat clients, a pairing-code consent page, device
// endpoints and an MCP endpoint that forwards each JSON-RPC message to the
// paired computer through the shared relay object. It runs no SAAM operation.
import {OAuthProvider,AuthorizationError} from '@cloudflare/workers-oauth-provider';
import {rpcError} from './relay-object.mjs';
export {RelayObject} from './relay-object.mjs';

const MESSAGE_LIMIT=1_000_000,SCOPE='saam';
const relay=env=>env.RELAY.get(env.RELAY.idFromName('relay'));
const bearer=request=>/^Bearer (\S+)$/.exec(request.headers.get('Authorization')??'')?.[1];
const escape=value=>String(value).replace(/[&<>"']/g,char=>`&#${char.charCodeAt(0)};`);
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const text=(value,status)=>new Response(value,{status,headers:{'Content-Type':'text/plain; charset=utf-8'}});

// Streamable HTTP with JSON responses only: no server-initiated stream.
const mcpHandler={async fetch(request,env,ctx){
  const {deviceId}=ctx.props,session=request.headers.get('Mcp-Session-Id');
  if(request.method==='DELETE'){await relay(env).endSession(deviceId,session);return new Response(null,{status:204});}
  if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST, DELETE'}});
  if(Number(request.headers.get('Content-Length')??0)>MESSAGE_LIMIT)return json(rpcError(null,-32600,'Request exceeds the relay limit of 1 MB.'),413);
  let message;
  try{message=await request.json();}catch{return json(rpcError(null,-32700,'Parse error.'),400);}
  if(!message||typeof message!=='object'||Array.isArray(message))return json(rpcError(null,-32600,'Send one JSON-RPC message per request.'),400);
  const answer=await relay(env).forward(deviceId,session,message);
  const headers=answer.session?{'Mcp-Session-Id':answer.session}:{};
  return answer.message?json(answer.message,answer.status,headers):new Response(null,{status:answer.status,headers});
}};

function consentPage({client,request,handle,error}){
  const name=escape(client?.clientName??client?.clientId??'Your chat app');
  const host=request?new URL(request.redirectUri).hostname:null;
  const local=host&&/^(localhost|127(\.\d{1,3}){3}|\[::1\])$/.test(host);
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
<p>${name} will be able to read, create and change prints on the computer running SAAM, and start toolpath generation. It cannot confirm a print or run a machine: you confirm settings and toolpath in SAAM Studio.</p>
${error?`<p class="error">${escape(error)}</p>`:''}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <p><label>Code shown by SAAM on your computer<br><input name="code" autocomplete="one-time-code" required autofocus></label></p>
  <p><button name="decision" value="approve">Connect</button><button name="decision" value="deny" formnovalidate>Cancel</button></p>
</form>`;
}
const page=(html,headers)=>{headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers});};

async function authorize(request,env){
  const oauth=env.OAUTH_PROVIDER;
  try{
    if(request.method==='GET'){
      const parsed=await oauth.parseAuthRequest(request),client=await oauth.lookupClient(parsed.clientId);
      if(!client)return text('Unknown OAuth client.',400);
      const consent=await oauth.beginConsent(parsed);
      return page(consentPage({client,request:parsed,handle:consent.handle}),consent.headers);
    }
    if(request.method!=='POST')return new Response(null,{status:405});
    const form=await request.formData(),handle=String(form.get('handle')??'');
    if(form.get('decision')!=='approve'){const denied=await oauth.denyConsent(request,handle);return new Response(null,{status:302,headers:denied.headers});}
    // Check the code before consuming the single-use consent handle.
    const linked=await relay(env).redeemLinkCode(form.get('code'));
    if(linked.error)return page(consentPage({handle,error:linked.error}),new Headers({'X-Frame-Options':'DENY','Content-Security-Policy':"frame-ancestors 'none'"}));
    const approved=await oauth.approveConsent(request,handle,{scope:[SCOPE]});
    const {redirectTo}=await oauth.completeAuthorization({request:approved.request,userId:linked.deviceId,metadata:{},scope:[SCOPE],props:{deviceId:linked.deviceId}});
    approved.headers.set('Location',redirectTo);
    return new Response(null,{status:302,headers:approved.headers});
  }catch(error){
    if(error instanceof AuthorizationError&&error.redirectUri){
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

async function device(request,env,path){
  if(path==='/device/connect')return relay(env).fetch(request);
  if(request.method!=='POST')return new Response(null,{status:405});
  if(path==='/device/register'){const device=await relay(env).registerDevice();return device.error?json(device,403):json(device,201);}
  if(path==='/device/link-code'){const code=await relay(env).linkCode(bearer(request));return code?json(code):json({error:'Unknown device credential.'},401);}
  if(path==='/device/unpair'){
    const deviceId=await relay(env).unpair(bearer(request));if(!deviceId)return json({error:'Unknown device credential.'},401);
    for(const grant of (await env.OAUTH_PROVIDER.listUserGrants(deviceId)).items)await env.OAUTH_PROVIDER.revokeGrant(grant.id,deviceId);
    return json({unpaired:true});
  }
  return new Response(null,{status:404});
}

const defaultHandler={async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/authorize')return authorize(request,env);
  if(path.startsWith('/device/'))return device(request,env,path);
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

export default {fetch(request,env,ctx){return providerFor(env.PUBLIC_URL.replace(/\/$/,'')).fetch(request,env,ctx);}};
