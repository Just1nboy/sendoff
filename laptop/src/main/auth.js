/* Google OAuth for an installed desktop app: loopback redirect + PKCE.
   The refresh token lands in electron-store and outlives restarts, as long as
   the Cloud project's consent screen is "In production", not "Testing"
   (Testing-mode refresh tokens die after 7 days; see SETUP.md). */
import http from 'node:http';
import { shell } from 'electron';
import { google } from 'googleapis';

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

let activeLoginServer = null;

export function hasCreds(creds) {
  return Boolean(creds && creds.clientId && creds.clientSecret);
}

export function isLoggedIn(store) {
  const tokens = store.get('tokens');
  return Boolean(tokens && tokens.refresh_token);
}

export async function login(store, creds) {
  if (!hasCreds(creds)) {
    throw new Error('OAuth client id and secret are not configured yet.');
  }
  // a previous attempt may still be waiting on its loopback server
  if (activeLoginServer) {
    activeLoginServer.close();
    activeLoginServer = null;
  }

  const server = http.createServer();
  activeLoginServer = server;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // guarantees a refresh_token even on re-login
    scope: [SCOPE],
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
  });

  const codePromise = waitForCode(server);
  shell.openExternal(authUrl);

  let code;
  try {
    code = await codePromise;
  } finally {
    server.close();
    if (activeLoginServer === server) activeLoginServer = null;
  }

  const { tokens } = await client.getToken({ code, codeVerifier });
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Sign out of the app in ' +
        'https://myaccount.google.com/permissions and try again.'
    );
  }
  store.set('tokens', tokens);
  return tokens;
}

function waitForCode(server) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Sign-in timed out after 5 minutes.'));
    }, LOGIN_TIMEOUT_MS);

    server.on('request', (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(resultPage(!error));
      clearTimeout(timer);
      if (error) reject(new Error(`Google sign-in failed: ${error}`));
      else if (code) resolve(code);
      else reject(new Error('Google sign-in returned no code.'));
    });
  });
}

function resultPage(ok) {
  const line = ok
    ? 'Connected. You can close this tab and go back to Neku.'
    : 'Sign-in was not completed. Close this tab and try again from Neku.';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Neku</title></head>
<body style="background:#0a0a0a;color:#ffffff;font-family:Helvetica,Arial,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:40px;margin-bottom:12px">${ok ? '&#10003;' : '!'}</div>
<div style="font-size:17px;max-width:36ch">${line}</div></div></body></html>`;
}

/** OAuth2 client wired to persist refreshed tokens back into the store.
    Returns null when there is no stored refresh token. */
export function getAuthedClient(store, creds) {
  const tokens = store.get('tokens');
  if (!tokens || !tokens.refresh_token) return null;
  const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  client.setCredentials(tokens);
  client.on('tokens', (fresh) => {
    store.set('tokens', { ...store.get('tokens'), ...fresh });
  });
  return client;
}

export async function logout(store, creds) {
  const client = getAuthedClient(store, creds);
  if (client) {
    try {
      await client.revokeCredentials();
    } catch {
      // offline or already revoked; local sign-out still proceeds
    }
  }
  store.delete('tokens');
}

/** True for errors that mean "the stored grant is dead, re-login needed",
    not transient network/server hiccups. */
export function isAuthError(err) {
  if (!err) return false;
  const msg = String(err.message || '');
  const dataError = err.response && err.response.data && err.response.data.error;
  return (
    err.code === 401 ||
    err.status === 401 ||
    dataError === 'invalid_grant' ||
    dataError === 'invalid_client' ||
    /invalid_grant|invalid_client/i.test(msg)
  );
}
