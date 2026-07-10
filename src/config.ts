import 'dotenv/config';

export type AuthConfig =
  | {
      readonly mode: 'oauth';
      readonly clientId: string;
      readonly clientSecret: string;
    }
  | {
      readonly mode: 'service_account';
      readonly email: string;
      readonly privateKey: string;
    };

export interface Config {
  readonly auth: AuthConfig;
  readonly tools: readonly string[] | null;
  readonly userName: string | null;
}

const ALL_TOOL_NAMES = [
  'get_spreadsheet_info',
  'get_sheet_schema',
  'create_sheet',
  'rename_sheet',
  'get_sheet_data',
  'find_rows',
  'add_rows',
  'add_columns',
  'update_row',
  'delete_rows',
] as const;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function parsePrivateKey(raw: string): string {
  const parsed = raw.replace(/\\n/g, '\n');
  if (!parsed.startsWith('-----BEGIN')) {
    console.error('Invalid GOOGLE_PRIVATE_KEY: must start with "-----BEGIN PRIVATE KEY-----"');
    process.exit(1);
  }
  return parsed;
}

function loadAuthConfig(): AuthConfig {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();

  if (clientId) {
    if (serviceAccountEmail) {
      console.error(
        'Both OAuth and Service Account credentials found — using OAuth (per-user sign-in).',
      );
    }
    return Object.freeze({
      mode: 'oauth' as const,
      clientId,
      clientSecret: requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    });
  }

  if (serviceAccountEmail) {
    return Object.freeze({
      mode: 'service_account' as const,
      email: serviceAccountEmail,
      privateKey: parsePrivateKey(requireEnv('GOOGLE_PRIVATE_KEY')),
    });
  }

  console.error(
    'Missing Google credentials. Configure ONE of:\n' +
      '  OAuth (per-user sign-in, recommended): GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET\n' +
      '  Service Account (legacy): GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY',
  );
  process.exit(1);
}

function parseTools(raw: string | undefined): string[] | null {
  if (!raw || raw.trim() === '') return null;

  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return null;

  const valid: string[] = [];
  for (const name of names) {
    if ((ALL_TOOL_NAMES as readonly string[]).includes(name)) {
      valid.push(name);
    } else {
      console.error(`Warning: unknown tool name "${name}" in TOOLS — skipping`);
    }
  }

  if (valid.length === 0) {
    console.error(
      'Error: TOOLS contains no valid tool names. Available tools: ' + ALL_TOOL_NAMES.join(', '),
    );
    process.exit(1);
  }

  return valid;
}

function parseUserName(raw: string | undefined): string | null {
  if (!raw || raw.trim() === '') return null;
  return raw.trim();
}

export function loadConfig(): Config {
  const auth = loadAuthConfig();
  const tools = parseTools(process.env.TOOLS);
  const userName = parseUserName(process.env.USER_NAME);

  return Object.freeze({
    auth,
    tools: tools ? Object.freeze(tools) : null,
    userName,
  });
}
