import { google, type Auth } from 'googleapis';
import type { Config } from '../config.js';
import { runLoopbackFlow } from './oauth-flow.js';
import { resolveScope } from './scopes.js';
import { clearTokens, loadTokens, saveTokens, type StoredTokens } from './token-store.js';

const FULL_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export type GoogleAuthClient = Auth.JWT | Auth.OAuth2Client;

export class AuthManager {
  private client: GoogleAuthClient | null = null;
  private inflight: Promise<GoogleAuthClient> | null = null;

  constructor(private readonly config: Config) {}

  /** Returns a ready auth client. In OAuth mode this may run the interactive browser flow. */
  async getClient(): Promise<GoogleAuthClient> {
    if (this.client) return this.client;
    if (!this.inflight) {
      this.inflight = this.buildClient(false).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Drops cached credentials and forces a fresh interactive sign-in (OAuth mode). */
  async reset(): Promise<GoogleAuthClient> {
    this.client = null;
    if (this.config.auth.mode === 'oauth') {
      clearTokens();
    }
    if (!this.inflight) {
      this.inflight = this.buildClient(true).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async buildClient(forceInteractive: boolean): Promise<GoogleAuthClient> {
    const auth = this.config.auth;

    if (auth.mode === 'service_account') {
      const jwt = new google.auth.JWT({
        email: auth.email,
        key: auth.privateKey,
        scopes: [resolveScope(this.config.tools)],
      });
      this.client = jwt;
      return jwt;
    }

    const requiredScope = resolveScope(this.config.tools);
    const client = new google.auth.OAuth2({
      clientId: auth.clientId,
      clientSecret: auth.clientSecret,
    });

    const cached = forceInteractive ? null : loadTokens();
    if (cached && this.isCacheValid(cached, auth.clientId, requiredScope)) {
      client.setCredentials({
        refresh_token: cached.refresh_token,
        access_token: cached.access_token,
        expiry_date: cached.expiry_date,
      });
    } else {
      if (cached) clearTokens();
      const tokens = await runLoopbackFlow(auth.clientId, auth.clientSecret, requiredScope);
      if (!tokens.refresh_token) {
        throw new Error(
          "Google did not return a refresh token. Remove this app's access at " +
            'https://myaccount.google.com/permissions and retry.',
        );
      }
      client.setCredentials(tokens);
      saveTokens({
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token ?? undefined,
        expiry_date: tokens.expiry_date ?? undefined,
        scope: tokens.scope ?? requiredScope,
        client_id: auth.clientId,
      });
      console.error('[google-sheets-mcp] Google sign-in complete — tokens cached.');
    }

    // Persist rotated/refreshed tokens so later runs stay silent.
    client.on('tokens', (t) => {
      const existing = loadTokens();
      const refreshToken = t.refresh_token ?? existing?.refresh_token;
      if (!refreshToken) return;
      saveTokens({
        refresh_token: refreshToken,
        access_token: t.access_token ?? existing?.access_token,
        expiry_date: t.expiry_date ?? existing?.expiry_date,
        scope: t.scope ?? existing?.scope ?? requiredScope,
        client_id: auth.clientId,
      });
    });

    this.client = client;
    return client;
  }

  private isCacheValid(cached: StoredTokens, clientId: string, requiredScope: string): boolean {
    if (cached.client_id !== clientId) return false;
    const grantedScopes = cached.scope.split(/\s+/);
    // The full read/write scope satisfies a readonly requirement, not vice versa.
    return grantedScopes.includes(requiredScope) || grantedScopes.includes(FULL_SCOPE);
  }
}
