// Single-installation, in-memory OAuth for the temporary web-chat bridge.
// The SDK owns discovery, DCR, redirect matching, PKCE and token endpoints.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { InvalidClientMetadataError, InvalidGrantError, InvalidRequestError,
  InvalidScopeError, InvalidTokenError, TooManyRequestsError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

const secret = () => randomBytes(32).toString('base64url');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const equal = (a, b) => {
  const left = Buffer.from(String(a ?? '')), right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

export function page(title, body) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
  <style>body{font:17px/1.5 system-ui,sans-serif;max-width:620px;margin:8vh auto;padding:24px;color:#20332b;background:#f6f8f5}h1{line-height:1.15}input,button{font:inherit;padding:12px;box-sizing:border-box;width:100%;margin:8px 0}button{background:#214e3d;color:white;border:0;border-radius:6px;cursor:pointer}code{overflow-wrap:anywhere}small{color:#52665c}</style>
  <h1>${escape(title)}</h1>${body}</html>`;
}

export function createDevOAuth({ publicUrl, pairingCode = secret(), now = () => Date.now() }) {
  const issuer = new URL(publicUrl).origin, resource = `${issuer}/mcp`;
  const clients = new Map(), pending = new Map(), codes = new Map(), access = new Map(), refresh = new Map();
  let attempts = 0, attemptWindow = now();
  const expires = duration => now() + duration;
  const prune = map => { for (const [key, item] of map) if (item.expires <= now()) map.delete(key); };
  function room(map, limit) {
    prune(map);
    if (map.size >= limit) throw new TooManyRequestsError('Temporary connection capacity reached. Retry later or restart the bridge.');
  }
  function checkResource(requested) {
    // Older clients omit resource. Such tokens are still bound only to this MCP endpoint.
    if (requested && String(requested) !== resource) throw new InvalidRequestError('Resource must be this SAAM MCP endpoint.');
  }
  function checkScopes(scopes = []) {
    if (scopes.some(scope => scope !== 'saam')) throw new InvalidScopeError('Only the saam scope is supported.');
  }
  function grantFor(map, token, client) {
    const record = map.get(token);
    if (!record || record.expires <= now() || record.clientId !== client.client_id)
      throw new InvalidGrantError('Invalid or expired grant. Reconnect SAAM.');
    return record;
  }
  function issue(clientId, family, deadline) {
    room(access, 512); room(refresh, 512);
    const token = secret(), refreshToken = secret();
    const expiry = Math.min(expires(60 * 60 * 1000), deadline);
    access.set(token, { clientId, family, expires: expiry });
    refresh.set(refreshToken, { clientId, family, expires: deadline });
    return { access_token: token, token_type: 'Bearer', expires_in: Math.max(1, Math.floor((expiry - now()) / 1000)),
      refresh_token: refreshToken, scope: 'saam' };
  }
  const provider = {
    clientsStore: {
      getClient(id) { prune(clients); return clients.get(id)?.client; },
      registerClient(client) {
        room(clients, 128);
        if (!['none', 'client_secret_post'].includes(client.token_endpoint_auth_method ?? 'client_secret_post'))
          throw new InvalidClientMetadataError('Use none or client_secret_post authentication.');
        if (!client.redirect_uris?.length || client.redirect_uris.length > 8)
          throw new InvalidClientMetadataError('Supply one to eight redirect URIs.');
        for (const value of client.redirect_uris) {
          const url = new URL(value);
          if (url.username || url.password || url.hash || (url.protocol !== 'https:' &&
              !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))))
            throw new InvalidClientMetadataError('Redirects must use HTTPS, or HTTP loopback for local clients.');
        }
        if (client.scope) checkScopes(client.scope.split(' '));
        clients.set(client.client_id, { client, expires: expires(24 * 60 * 60 * 1000) });
        return client;
      }
    },
    async authorize(client, params, res) {
      checkResource(params.resource); checkScopes(params.scopes); room(pending, 128);
      if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidRequestError('A valid S256 PKCE challenge is required.');
      const id = secret();
      pending.set(id, { clientId: client.client_id, params, expires: expires(5 * 60 * 1000) });
      // Chromium also applies form-action to the 303 OAuth callback. The SDK
      // has matched this redirect to the client's registered URI already.
      const callbackOrigin = new URL(params.redirectUri).origin.replace(/[';]/g, character => '%' + character.charCodeAt(0).toString(16));
      res.set('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callbackOrigin}; frame-ancestors 'none'; base-uri 'none'`);
      res.type('html').send(page('Connect to local SAAM', `
        <p>This connection lets your chat client create and adjust prints, open Studio, and generate and deliver approved files on this computer.</p>
        <p>It cannot approve a print or run a machine. You give job approvals in Studio.</p>
        <p>Client name: <strong>${escape(client.client_name ?? 'Unnamed client')}</strong><br><small>Supplied by the connecting client. Confirm the return address belongs to the client you are connecting:</small><br><code>${escape(params.redirectUri)}</code></p>
        <form method="post" action="/connect"><input type="hidden" name="request" value="${id}">
        <label for="code">Pairing code from your local SAAM connection file</label>
        <input id="code" name="code" type="password" autocomplete="off" required maxlength="128">
        <button>Connect this client</button></form>
        <p><small>For this development session only. Restarting the bridge disconnects all clients.</small></p>`));
    },
    async challengeForAuthorizationCode(client, code) { return grantFor(codes, code, client).params.codeChallenge; },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, requestedResource) {
      checkResource(requestedResource);
      const grant = grantFor(codes, code, client);
      if (redirectUri !== grant.params.redirectUri) throw new InvalidGrantError('Redirect URI does not match the authorization request.');
      codes.delete(code);
      return issue(client.client_id, secret(), expires(8 * 60 * 60 * 1000));
    },
    async exchangeRefreshToken(client, token, scopes, requestedResource) {
      checkResource(requestedResource); checkScopes(scopes);
      const grant = grantFor(refresh, token, client);
      refresh.delete(token);
      return issue(client.client_id, grant.family, grant.expires);
    },
    async verifyAccessToken(token) {
      const grant = access.get(token);
      if (!grant || grant.expires <= now()) throw new InvalidTokenError('Invalid or expired SAAM token. Reconnect SAAM.');
      return { token, clientId: grant.clientId, scopes: ['saam'], expiresAt: Math.floor(grant.expires / 1000), resource: new URL(resource) };
    },
    async revokeToken(client, request) {
      const grant = access.get(request.token) ?? refresh.get(request.token);
      if (!grant || grant.clientId !== client.client_id) return;
      for (const map of [access, refresh]) for (const [token, item] of map) if (item.family === grant.family) map.delete(token);
    }
  };
  function connect(req, res) {
    if (req.headers.origin !== issuer) return res.status(403).send('Invalid connection origin.');
    if (now() - attemptWindow > 5 * 60 * 1000) { attempts = 0; attemptWindow = now(); }
    if (++attempts > 20) return res.status(429).send('Too many pairing attempts. Try again in five minutes.');
    const grant = pending.get(req.body.request);
    if (!grant || grant.expires <= now() || !equal(req.body.code, pairingCode))
      return res.status(403).send('Invalid or expired pairing request. Start the connection again.');
    room(codes, 128);
    pending.delete(req.body.request);
    const code = secret();
    codes.set(code, { ...grant, expires: expires(60 * 1000) });
    const redirect = new URL(grant.params.redirectUri);
    redirect.searchParams.set('code', code);
    if (grant.params.state !== undefined) redirect.searchParams.set('state', grant.params.state);
    res.redirect(303, redirect.href);
  }
  return { provider, connect, pairingCode, resource };
}
