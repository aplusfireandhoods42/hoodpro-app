// QuickBooks Online integration using Intuit's OAuth2 + Accounting API directly
// over HTTPS. No SDK — same philosophy as lib/notify.js. All calls are plain
// REST, documented at https://developer.intuit.com/app/developer/qbo/docs/api/accounting

const https = require('https');
const crypto = require('crypto');

const AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_HOST = 'oauth.platform.intuit.com';
const TOKEN_PATH = '/oauth2/v1/tokens/bearer';

function apiHost(environment) {
  return environment === 'production' ? 'quickbooks.api.intuit.com' : 'sandbox-quickbooks.api.intuit.com';
}

function httpsRequest({ hostname, path: urlPath, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = Object.assign({}, headers);
    if (data) reqHeaders['Content-Length'] = data.length;
    const req = https.request({ hostname, path: urlPath, method, headers: reqHeaders }, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function randomState() {
  return crypto.randomBytes(16).toString('hex');
}

// Step 1: build the URL to send the business owner to, to authorize this app
// against their QuickBooks Online company.
function getAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: redirectUri,
    state
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

// Step 2: exchange the ?code= Intuit redirected back with for an access/refresh token pair.
async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString();
  const res = await httpsRequest({
    hostname: TOKEN_HOST, path: TOKEN_PATH, method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  });
  if (res.status < 200 || res.status >= 300 || !res.json) {
    throw new Error(`QuickBooks token exchange failed (${res.status}): ${res.text}`);
  }
  return res.json; // { access_token, refresh_token, expires_in, x_refresh_token_expires_in, ... }
}

async function refreshTokens({ clientId, clientSecret, refreshToken }) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString();
  const res = await httpsRequest({
    hostname: TOKEN_HOST, path: TOKEN_PATH, method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  });
  if (res.status < 200 || res.status >= 300 || !res.json) {
    throw new Error(`QuickBooks token refresh failed (${res.status}): ${res.text}`);
  }
  return res.json;
}

// Generic authenticated call to the Accounting API for a connected company (realm).
async function apiRequest({ environment, realmId, accessToken, method, path: urlPath, body }) {
  const res = await httpsRequest({
    hostname: apiHost(environment),
    path: `/v3/company/${realmId}${urlPath}`,
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res;
}

function escapeQboString(s) {
  return String(s).replace(/'/g, "\\'");
}

module.exports = { getAuthUrl, exchangeCode, refreshTokens, apiRequest, randomState, escapeQboString, apiHost };
