import 'dotenv/config';

export interface Config {
  readonly googleServiceAccountEmail: string;
  readonly googlePrivateKey: string;
  readonly spreadsheetId: string;
  readonly tools: readonly string[] | null;
  readonly userName: string | null;
}

const ALL_TOOL_NAMES = [
  'get_spreadsheet_info',
  'create_sheet',
  'rename_sheet',
  'get_sheet_data',
  'add_rows',
  'update_row',
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
    console.error(
      'Invalid GOOGLE_PRIVATE_KEY: must start with "-----BEGIN PRIVATE KEY-----"'
    );
    process.exit(1);
  }
  return parsed;
}

function parseTools(raw: string | undefined): string[] | null {
  if (!raw || raw.trim() === '') return null;

  const names = raw.split(',').map((s) => s.trim()).filter(Boolean);
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
    console.error('Error: TOOLS contains no valid tool names. Available tools: ' + ALL_TOOL_NAMES.join(', '));
    process.exit(1);
  }

  return valid;
}

function parseUserName(raw: string | undefined): string | null {
  if (!raw || raw.trim() === '') return null;
  return raw.trim();
}

export function loadConfig(): Config {
  const googleServiceAccountEmail = requireEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const googlePrivateKey = parsePrivateKey(requireEnv('GOOGLE_PRIVATE_KEY'));
  const spreadsheetId = requireEnv('SPREADSHEET_ID');
  const tools = parseTools(process.env.TOOLS);
  const userName = parseUserName(process.env.USER_NAME);

  return Object.freeze({
    googleServiceAccountEmail,
    googlePrivateKey,
    spreadsheetId,
    tools: tools ? Object.freeze(tools) : null,
    userName,
  });
}
