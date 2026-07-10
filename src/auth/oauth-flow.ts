import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { google, Auth } from 'googleapis';
import open from 'open';

const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

const SUCCESS_HTML = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding-top:4rem">
<h1>Authentication successful</h1><p>You can close this tab and return to your MCP client.</p>
</body></html>`;

const DENIED_HTML = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding-top:4rem">
<h1>Authentication denied</h1><p>Access was not granted. You can close this tab.</p>
</body></html>`;

/**
 * Runs the OAuth 2.0 installed-app loopback flow: opens the system browser for
 * consent and captures the authorization code on a temporary localhost server.
 */
export async function runLoopbackFlow(
  clientId: string,
  clientSecret: string,
  scope: string,
): Promise<Auth.Credentials> {
  const server = http.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Failed to bind loopback server'));
        return;
      }
      resolve(address.port);
    });
  });

  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const client = new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
  const state = crypto.randomBytes(16).toString('hex');

  // PKCE (RFC 7636): desktop-app client secrets are not confidential, so bind the
  // authorization code to this process via a code verifier.
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: Auth.CodeChallengeMethod.S256,
  });

  const shutdown = () => {
    server.close();
    server.closeAllConnections();
  };

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            'Google authentication timed out after 5 minutes. Retry the tool call to sign in again.',
          ),
        );
      }, FLOW_TIMEOUT_MS);

      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri);
        if (url.pathname !== '/oauth2callback') {
          res.writeHead(404).end();
          return;
        }

        const receivedState = Buffer.from(url.searchParams.get('state') ?? '');
        const expectedState = Buffer.from(state);
        if (
          receivedState.length !== expectedState.length ||
          !crypto.timingSafeEqual(receivedState, expectedState)
        ) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('State mismatch');
          clearTimeout(timeout);
          reject(new Error('OAuth state mismatch — possible CSRF, aborting'));
          return;
        }

        const error = url.searchParams.get('error');
        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(DENIED_HTML);
          clearTimeout(timeout);
          reject(
            new Error(
              error === 'access_denied'
                ? 'Google sign-in was denied. Retry the tool call and grant access to continue.'
                : `Google sign-in failed: ${error}`,
            ),
          );
          return;
        }

        const authCode = url.searchParams.get('code');
        if (!authCode) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing authorization code');
          clearTimeout(timeout);
          reject(new Error('Google sign-in returned no authorization code'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(SUCCESS_HTML);
        clearTimeout(timeout);
        resolve(authCode);
      });

      console.error(
        `[google-sheets-mcp] Opening your browser for Google sign-in...\n` +
          `[google-sheets-mcp] If it does not open, visit:\n${authUrl}`,
      );
      open(authUrl).catch(() => {
        console.error(
          '[google-sheets-mcp] Could not open a browser automatically — open the URL above manually.',
        );
      });
    });

    const { tokens } = await client.getToken({ code, codeVerifier });
    return tokens;
  } finally {
    shutdown();
  }
}
