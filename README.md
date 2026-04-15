# MCP Google Sheets

An MCP (Model Context Protocol) server that gives AI agents read/write access to a Google Spreadsheet. Built for use with Claude Code and other MCP-compatible clients.

## Features

- **6 tools** for spreadsheet interaction — read metadata, read cells, create/rename tabs, append rows, update rows
- **Google Service Account auth** — fully headless, no OAuth popups
- **Single `.env` config** — no credential files to manage
- **Tool filtering** — expose only the tools you need via the `TOOLS` variable
- **Audit trail** — optionally stamp each written row with a user name

## Available Tools

| Tool | Description |
|---|---|
| `get_spreadsheet_info` | Returns spreadsheet title, sheet names, IDs, and dimensions |
| `get_sheet_data` | Reads cell values from a range (e.g. `Sheet1!A1:D10`) |
| `create_sheet` | Creates a new sheet tab |
| `rename_sheet` | Renames a sheet tab (by ID or current name) |
| `add_rows` | Appends rows to the bottom of a sheet |
| `update_row` | Overwrites a single row by 1-based index |

## Prerequisites

- Node.js 18+
- A Google Cloud project with the Sheets API enabled
- A Google Service Account with access to the target spreadsheet

## Setting Up a Google Service Account

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top and select **New Project**
3. Give it a name (e.g. `mcp-sheets`) and click **Create**
4. Make sure the new project is selected in the dropdown

### 2. Enable the Google Sheets API

1. Go to **APIs & Services > Library** (or search "Sheets API" in the top search bar)
2. Find **Google Sheets API** and click **Enable**

### 3. Create a Service Account

1. Go to **APIs & Services > Credentials**
2. Click **+ CREATE CREDENTIALS > Service account**
3. Enter a name (e.g. `mcp-agent`) and click **Create and Continue**
4. Skip the optional role/access steps — click **Done**
5. You'll see the new service account listed. Note the email address (e.g. `mcp-agent@mcp-sheets.iam.gserviceaccount.com`) — you'll need it later

### 4. Generate a Private Key

1. Click on the service account you just created
2. Go to the **Keys** tab
3. Click **Add Key > Create new key**
4. Select **JSON** and click **Create**
5. A JSON file will download. Open it and find these two fields:
   - `client_email` — this is your `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` — this is your `GOOGLE_PRIVATE_KEY`

### 5. Share Your Spreadsheet

1. Open the Google Sheet you want to connect
2. Click **Share**
3. Paste the service account email address (from step 3)
4. Set the role to **Editor** (required for write tools; Viewer is enough for read-only)
5. Uncheck "Notify people" and click **Share**

### 6. Get the Spreadsheet ID

The spreadsheet ID is in the URL:

```
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_IS_HERE/edit
```

Copy the string between `/d/` and `/edit`.

## Installation

```bash
git clone <repo-url>
cd gg-sheets-mcp
npm install
```

## Configuration

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required
GOOGLE_SERVICE_ACCOUNT_EMAIL="mcp-agent@your-project.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
SPREADSHEET_ID="your-spreadsheet-id"

# Optional — comma-separated list of tools to expose (blank = all)
TOOLS=""

# Optional — name appended to each row written by add_rows
USER_NAME=""
```

> **Tip:** The private key from the JSON file contains literal `\n` characters. Paste it as-is — the server handles the conversion.

## Build & Run

```bash
# Build
npm run build

# Run (production)
npm start

# Run (development — no build needed)
npm run dev
```

## Claude Code Configuration

Add the server to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "google-sheets": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/gg-sheets-mcp/dist/index.js"]
    }
  }
}
```

For development (runs TypeScript directly):

```json
{
  "mcpServers": {
    "google-sheets": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/gg-sheets-mcp/src/index.ts"]
    }
  }
}
```

Restart Claude Code after adding the configuration.

## Restricting Tools

Use the `TOOLS` environment variable to expose only specific tools. This reduces token usage when the agent doesn't need all capabilities.

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
  config.ts             Env var loading & validation
  sheets-client.ts      Google Sheets API wrapper
  tools/
    types.ts            Shared ToolDefinition interface
    index.ts            Tool registry & TOOLS filter
    get-spreadsheet-info.ts
    get-sheet-data.ts
    create-sheet.ts
    rename-sheet.ts
    add-rows.ts
    update-row.ts
```

## License

ISC
