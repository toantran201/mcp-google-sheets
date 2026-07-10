# MCP Google Sheets

An MCP (Model Context Protocol) server that gives AI agents read/write access to Google Spreadsheets. Built for use with Claude Code and other MCP-compatible clients.

## Features

- **9 tools** for spreadsheet interaction — read metadata, read cells, extract schemas, create/rename tabs, append rows, insert columns, set column validation, update rows
- **Per-user OAuth** (recommended) — each user signs in with their own Google account; sheet edit history shows who actually made each change
- **Service Account auth** (legacy) — fully headless, no OAuth popups
- **No fixed spreadsheet** — every tool takes a `spreadsheet` parameter (paste a Sheets URL or ID); any sheet the signed-in user can edit just works
- **Tool filtering** — expose only the tools you need via the `TOOLS` variable
- **Audit trail** — optionally stamp each written row with a user name

## Available Tools

Every tool takes a required `spreadsheet` parameter: a full Google Sheets URL (`https://docs.google.com/spreadsheets/d/<ID>/edit...`) or a bare spreadsheet ID.

| Tool | Description |
|---|---|
| `get_spreadsheet_info` | Returns spreadsheet title, sheet names, IDs, and dimensions |
| `get_sheet_schema` | Returns column schema: dropdowns, checkboxes, data types, formulas, notes |
| `get_sheet_data` | Reads cell values from a range (e.g. `Sheet1!A1:D10`) |
| `find_rows` | Finds rows matching a value in a column (or any column); returns 1-based row indices |
| `create_sheet` | Creates a new sheet tab |
| `rename_sheet` | Renames a sheet tab (by ID or current name) |
| `add_rows` | Appends rows to the bottom of a sheet |
| `add_columns` | Inserts empty columns at a 1-based position, or appends at the right edge |
| `update_row` | Overwrites cells in a row starting at a 1-based column (update specific columns without rewriting the whole row) |
| `delete_rows` | Deletes a contiguous block of rows (rows below shift up) |

## Install

If you use **Claude Code**, add the server with one command. You need an OAuth **Client ID** and **Client Secret** — ask whoever set up your team's Google Cloud project, or create them yourself via [OAuth Setup](#oauth-setup-recommended--one-time-per-team) below.

```bash
claude mcp add \
  --scope user \
  --env GOOGLE_OAUTH_CLIENT_ID=<your-client-id>.apps.googleusercontent.com \
  --env GOOGLE_OAUTH_CLIENT_SECRET=<your-client-secret> \
  --transport stdio \
  google-sheets \
  -- npx -y @toantran201/mcp-google-sheets
```

> On Windows PowerShell, put it on a single line (drop the `\` line breaks), or replace `\` with a backtick `` ` ``.

- `--scope user` makes the server available in **all** your projects. Use `--scope project` instead to write it into a shared `.mcp.json` (checked into the repo for your whole team), or omit `--scope` for the current project only.
- `--transport stdio` is the default; it's shown here mainly so the server name doesn't sit directly after `--env` (the CLI rejects that).

That's it. On the **first tool call**, your browser opens for Google sign-in; your personal token is cached at `~/.google-sheets-mcp/tokens.json`. There is no fixed spreadsheet — just paste a Google Sheets URL into the conversation.

<details>
<summary>Prefer editing config by hand, or using another MCP client?</summary>

Add this to your `.mcp.json` (Claude Code) or your client's MCP config:

```json
{
  "mcpServers": {
    "google-sheets": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@toantran201/mcp-google-sheets"],
      "env": {
        "GOOGLE_OAUTH_CLIENT_ID": "xxxxx.apps.googleusercontent.com",
        "GOOGLE_OAUTH_CLIENT_SECRET": "GOCSPX-xxxxx"
      }
    }
  }
}
```

Optional `env` keys: `TOOLS` (comma-separated allowlist, blank = all — see [Restricting Tools](#restricting-tools)), `USER_NAME` (stamped onto `add_rows` writes). Pin a version with `@toantran201/mcp-google-sheets@1.2.3`.

</details>

## Prerequisites

- Node.js 20+ (only needed locally; `npx` handles it automatically)
- A Google Cloud project with the Sheets API enabled
- OAuth client credentials (recommended) **or** a Google Service Account

## OAuth Setup (recommended — one-time, per team)

With OAuth, each team member authenticates with their own Google account. Edits show up under their name in the sheet's version history, and they can access any sheet they already have permission on — no sharing to a robot account needed.

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top and select **New Project**
3. Give it a name (e.g. `mcp-sheets`) and click **Create**

### 2. Enable the Google Sheets API

1. Go to **APIs & Services > Library**
2. Find **Google Sheets API** and click **Enable**

### 3. Configure the OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Choose the user type:
   - **Internal** (available if your team uses Google Workspace) — recommended. No verification needed, refresh tokens never expire, and only members of your organization can sign in.
   - **External** — works with any Google account, but while the app is in **Testing** status you must add each teammate as a **test user**, and refresh tokens expire every **7 days** (the server detects this and simply re-opens the browser to sign in again).
3. Fill in the app name and contact emails, save

### 4. Create an OAuth Client ID

1. Go to **APIs & Services > Credentials**
2. Click **+ CREATE CREDENTIALS > OAuth client ID**
3. Application type: **Desktop app**
4. Copy the **Client ID** and **Client Secret**. Supply them via your MCP client's `env` config — the `--env` flags in the [Install](#install) command, or the `env` block in `.mcp.json`. (Only when developing locally do you put them in a `.env` file — see [Local development](#local-development).)

> Per [Google's documentation](https://developers.google.com/identity/protocols/oauth2#installed), a Desktop-app client secret is not treated as a confidential secret (installed apps can't keep secrets). It's fine to share it within your team, but keep it out of version control — don't commit a `.env` or a checked-in `.mcp.json` that contains it.

### First run

The first time any tool is called, the server opens your browser for Google sign-in. After you approve, tokens are cached at `~/.google-sheets-mcp/tokens.json` and later runs are silent. To switch Google accounts, delete that file.

> Changing `TOOLS` from a read-only set to one that includes write tools requires a broader OAuth scope — the server detects this and re-prompts in the browser once.

### Security notes

- The sign-in flow uses the OAuth installed-app pattern with PKCE (S256) and a CSRF `state` check; the loopback server binds only to `127.0.0.1` on an ephemeral port.
- The refresh token is cached **in plaintext** at `~/.google-sheets-mcp/tokens.json`, protected by file permissions (`0600`, directory `0700`; on Windows, your profile's NTFS ACLs). This is the same model used by `gcloud` and `gh`. Any process running as your OS user can read it — treat your user account as the trust boundary, and delete the file to revoke local access.
- The OAuth client secret is never written to disk by the server; it comes from the environment your MCP client passes in (the `env` config), or from `.env` during local development.
- All cell writes are sanitized against formula/CSV injection (leading `=`, `+`, `-`, `@`, tab, CR are neutralized with a `'` prefix).

## Service Account Setup (legacy alternative)

Headless auth with a shared robot account. Edits are attributed to the service account, not individual users, and every target sheet must be shared with it.

<details>
<summary>Expand instructions</summary>

### 1. Create a Service Account

1. In your Google Cloud project (Sheets API enabled), go to **APIs & Services > Credentials**
2. Click **+ CREATE CREDENTIALS > Service account**
3. Enter a name (e.g. `mcp-agent`) and click **Create and Continue**, then **Done**
4. Note the email address (e.g. `mcp-agent@mcp-sheets.iam.gserviceaccount.com`)

### 2. Generate a Private Key

1. Click on the service account, go to the **Keys** tab
2. Click **Add Key > Create new key**, select **JSON**, click **Create**
3. From the downloaded JSON: `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `private_key` → `GOOGLE_PRIVATE_KEY`

### 3. Share Your Spreadsheet

1. Open the Google Sheet, click **Share**
2. Paste the service account email
3. Set the role to **Editor** (Viewer is enough for read-only tools)

> **Tip:** The private key from the JSON file contains literal `\n` characters. Paste it as-is — the server handles the conversion.

</details>

## Local development

Clone and install only if you want to modify the server:

```bash
git clone <repo-url>
cd google-sheets-mcp
npm install
cp .env.example .env   # fill in ONE auth mode below
```

```env
# Mode A (recommended): per-user OAuth
GOOGLE_OAUTH_CLIENT_ID="xxxxx.apps.googleusercontent.com"
GOOGLE_OAUTH_CLIENT_SECRET="GOCSPX-xxxxx"

# Mode B (legacy): service account
# GOOGLE_SERVICE_ACCOUNT_EMAIL="mcp-agent@your-project.iam.gserviceaccount.com"
# GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"

# Optional — comma-separated list of tools to expose (blank = all)
TOOLS=""

# Optional — name appended to each row written by add_rows
USER_NAME=""
```

If both modes are configured, OAuth wins. There is no `SPREADSHEET_ID` — just paste a sheet link into your conversation and the agent passes it to the tools.

```bash
npm run dev      # run from TypeScript, no build
npm run build    # bundle to dist/index.js
npm start        # run the built server
```

Point `.mcp.json` at your local checkout while developing:

```json
{
  "mcpServers": {
    "google-sheets": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/google-sheets-mcp/src/index.ts"]
    }
  }
}
```

## Publishing a new version

Maintainers only. The package is public on npm under the `@toantran201` scope.

```bash
npm login                      # once per machine; sign in as the scope owner (toantran201)
npm version patch              # or minor / major — bumps package.json + git tag
npm publish                    # prepublishOnly runs the build automatically
git push --follow-tags
```

`files` in `package.json` limits the tarball to `dist/` (plus README + LICENSE) — source, `.env`, and docs are never published. Verify with `npm pack --dry-run` before publishing.

## Restricting Tools

Use the `TOOLS` environment variable to expose only specific tools. This reduces token usage when the agent doesn't need all capabilities, and in OAuth mode a read-only tool set requests the narrower read-only scope.

```env
# Read-only mode
TOOLS=get_spreadsheet_info,get_sheet_data

# Write-only (no reads)
TOOLS=add_rows,update_row

# All tools (default)
TOOLS=
```

## Project Structure

```
src/
  index.ts              Server bootstrap & stdio transport
  config.ts             Env var loading, auth-mode detection & validation
  sheets-client.ts      Google Sheets API wrapper (per-call spreadsheet ID)
  spreadsheet-ref.ts    Spreadsheet URL/ID parsing
  auth/
    auth-manager.ts     Auth entry point (OAuth or Service Account)
    oauth-flow.ts       Browser loopback sign-in flow
    token-store.ts      Per-user token cache (~/.google-sheets-mcp/)
    scopes.ts           Read-only vs read/write scope resolution
  tools/
    index.ts            Tool registry & TOOLS filter
    shared/             Non-tool helpers shared across tools
      types.ts          Shared ToolDefinition interface
      sanitize.ts       Formula-injection guard for cell writes
      result.ts         CallToolResult factory (success/error shapes)
    get-spreadsheet-info.ts
    get-sheet-schema.ts
    get-sheet-data.ts
    find-rows.ts
    create-sheet.ts
    rename-sheet.ts
    add-rows.ts
    add-columns.ts
    update-row.ts
    delete-rows.ts
```

## License

MIT
