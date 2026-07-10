import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface StoredTokens {
  refresh_token: string;
  access_token?: string;
  expiry_date?: number;
  /** The scope actually granted at consent time. */
  scope: string;
  /** OAuth client the tokens belong to — invalidates cache if the team rotates the client. */
  client_id: string;
}

export function tokenFilePath(): string {
  return path.join(os.homedir(), '.google-sheets-mcp', 'tokens.json');
}

export function loadTokens(): StoredTokens | null {
  try {
    const raw = fs.readFileSync(tokenFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.refresh_token !== 'string' ||
      typeof parsed?.scope !== 'string' ||
      typeof parsed?.client_id !== 'string'
    ) {
      return null;
    }
    return parsed as StoredTokens;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: StoredTokens): void {
  const file = tokenFilePath();
  // mode flags are POSIX-only; on Windows %USERPROFILE% NTFS ACLs already restrict access
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  try {
    // writeFileSync's mode only applies when the file is created — re-assert on overwrite
    fs.chmodSync(file, 0o600);
  } catch {
    // best-effort (no-op semantics vary on Windows)
  }
}

export function clearTokens(): void {
  try {
    fs.unlinkSync(tokenFilePath());
  } catch {
    // best-effort
  }
}
