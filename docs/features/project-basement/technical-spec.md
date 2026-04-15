# Technical Specification

**Project Name:** MCP Google Sheets (MVP)
**Based on:** [PRD v1](./prd.md)
**Language:** TypeScript
**Runtime:** Node.js v18+
**Last Updated:** 2026-04-15

---

## 1. Technology Stack

| Category | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript `^6.0.0` | Type safety across tool schemas, config parsing, and Google API responses |
| Runtime | Node.js 18+ | LTS baseline; native `fetch` available if needed |
| MCP SDK | `@modelcontextprotocol/sdk` `^1.29.0` | Official TypeScript SDK — provides `McpServer`, `StdioServerTransport`, and the `registerTool` API |
| Schema Validation | `zod` `^4.0.0` | MCP SDK v2 requires Standard Schema for `inputSchema`; Zod v4 implements Standard Schema. **Constraint:** MCP SDK peer dep is `zod ^3.25 \|\| ^4.0` — we use v4 since this is greenfield. |
| Google API | `googleapis` `^171.0.0` | Official Node.js client for Google Sheets API v4 |
| Env Management | `dotenv` `^17.0.0` | Loads `.env` into `process.env` at startup |
| Build | `tsc` | Standard TypeScript compiler; output to `dist/` |
| Dev Runner | `tsx` `^4.21.0` | Runs `.ts` files directly during development without a build step |

---

## 2. Project Structure

```
gg-sheets-mcp/
├── src/
│   ├── index.ts              # Entry point — bootstrap server & connect transport
│   ├── config.ts             # Load, validate, and export typed env config
│   ├── sheets-client.ts      # Thin wrapper around Google Sheets API v4
│   └── tools/
│       ├── index.ts           # Tool registry — iterates definitions, applies TOOLS filter
│       ├── get-spreadsheet-info.ts
│       ├── create-sheet.ts
│       ├── rename-sheet.ts
│       ├── get-sheet-data.ts
│       ├── add-rows.ts
│       └── update-row.ts
├── docs/
│   ├── prd.md
│   └── technical-spec.md
├── .env.example              # Template with placeholder values
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

### File Responsibilities

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Imports config, creates `McpServer`, calls tool registration, connects `StdioServerTransport`. No business logic. |
| `src/config.ts` | Reads `.env` via `dotenv`, validates required variables, parses `GOOGLE_PRIVATE_KEY` newlines, exports a frozen `Config` object. |
| `src/sheets-client.ts` | Authenticates via Google JWT, exposes typed methods mapping 1:1 to the Google Sheets API calls the tools need. |
| `src/tools/index.ts` | Exports `registerAllTools(server, sheetsClient, config)`. Imports every tool definition, checks each against `config.tools`, and calls `server.registerTool()` for allowed ones. |
| `src/tools/<tool>.ts` | Each file exports a `ToolDefinition` object: `{ name, config, handler }`. Pure functions — no side effects on import. |

---

## 3. Configuration & Validation (`src/config.ts`)

### 3.1. Environment Variables

| Variable | Required | Type | Description |
| --- | --- | --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Yes | `string` | Service Account email (e.g. `my-agent@project-id.iam.gserviceaccount.com`) |
| `GOOGLE_PRIVATE_KEY` | Yes | `string` | RSA private key (PEM). Users must wrap in double quotes in `.env` so `\n` literals are preserved. |
| `SPREADSHEET_ID` | Yes | `string` | Target spreadsheet ID from the Google Sheets URL |
| `TOOLS` | No | `string` | Comma-separated tool names. If empty/unset, all 6 tools are registered. |
| `USER_NAME` | No | `string` | Identifier appended to each row in `add_rows` for audit trail |

### 3.2. Validation Rules

```typescript
// Pseudocode — actual implementation uses plain checks, not Zod (config is env, not MCP input)
interface Config {
  googleServiceAccountEmail: string;   // must be non-empty
  googlePrivateKey: string;            // must start with "-----BEGIN"
  spreadsheetId: string;               // must be non-empty
  tools: string[] | null;       // null = all tools enabled
  userName: string | null;             // null = audit trail disabled
}
```

### 3.3. Private Key Parsing

The private key in `.env` contains literal `\n` sequences. These must be converted to real newline characters before passing to the Google Auth library:

```typescript
const googlePrivateKey = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n');
```

### 3.4. Startup Behavior

1. Call `dotenv.config()`.
2. Validate all required variables are present and non-empty.
3. Parse `GOOGLE_PRIVATE_KEY` newlines.
4. Parse `TOOLS` into `string[]` or `null`.
5. If validation fails → log a clear error message to `stderr` and `process.exit(1)`.
6. Export a frozen `Config` object.

---

## 4. Google Sheets Client (`src/sheets-client.ts`)

### 4.1. Authentication

Use a **JWT (Service Account)** client — no keyFile, credentials come from env vars:

```typescript
import { google } from 'googleapis';

const auth = new google.auth.JWT({
  email: config.googleServiceAccountEmail,
  key: config.googlePrivateKey,               // parsed PEM string
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
```

### 4.2. Client Methods

The `SheetsClient` class exposes exactly the methods the tools need. Each method is a thin async wrapper around a single Google API call. All methods receive `config.spreadsheetId` internally — tools never pass it.

| Method | Google API Call | Returns |
| --- | --- | --- |
| `getSpreadsheetInfo()` | `sheets.spreadsheets.get({ fields: 'properties,sheets.properties' })` | Spreadsheet metadata (no `gridData`) |
| `createSheet(title)` | `sheets.spreadsheets.batchUpdate({ addSheet })` | New sheet properties |
| `renameSheet(identifier, newTitle)` | `sheets.spreadsheets.batchUpdate({ updateSheetProperties })` | void (success) |
| `getSheetData(range)` | `sheets.spreadsheets.values.get({ valueRenderOption: 'UNFORMATTED_VALUE' })` | 2D array of values |
| `addRows(sheetName, values)` | `sheets.spreadsheets.values.append({ valueInputOption: 'USER_ENTERED' })` | Append result metadata |
| `updateRow(sheetName, rowIndex, values)` | `sheets.spreadsheets.values.update({ valueInputOption: 'USER_ENTERED' })` | Update result metadata |

### 4.3. Key Design Decisions

- **`fields` parameter on reads:** Always request only `properties` and `sheets.properties` — never `gridData` or formatting metadata. This keeps responses small and saves LLM context tokens.
- **`valueRenderOption: 'UNFORMATTED_VALUE'`:** Returns raw cell values (numbers stay as numbers), not display strings.
- **`valueInputOption: 'USER_ENTERED'`:** Allows Google Sheets to parse formulas and auto-detect types on write (same behavior as typing into a cell).
- **`renameSheet` identifier resolution:** If the caller provides `old_title` instead of `sheet_id`, the method first calls `getSpreadsheetInfo()` to resolve the title → `sheetId` mapping before performing the rename.

---

## 5. Tool Definitions

Each tool file in `src/tools/` exports a `ToolDefinition`:

```typescript
// src/tools/types.ts (shared type)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';  // zod ^4.0.0 — import from 'zod' directly
import type { SheetsClient } from '../sheets-client.js';
import type { Config } from '../config.js';

export interface ToolDefinition {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodObject<any>;
    annotations?: {
      readOnlyHint?: boolean;
      idempotentHint?: boolean;
    };
  };
  handler: (args: any, sheetsClient: SheetsClient, config: Config) => Promise<CallToolResult>;
}
```

### 5.1. `get_spreadsheet_info`

- **Input Schema:** _(none — empty object)_
- **Annotations:** `readOnlyHint: true`
- **Behavior:** Calls `sheetsClient.getSpreadsheetInfo()`, returns JSON with spreadsheet title and an array of sheet summaries (sheetId, title, rowCount, columnCount).
- **Output example:**
  ```json
  {
    "title": "My Spreadsheet",
    "sheets": [
      { "sheetId": 0, "title": "Sheet1", "rowCount": 1000, "columnCount": 26 }
    ]
  }
  ```

### 5.2. `create_sheet`

- **Input Schema:**
  ```typescript
  z.object({
    title: z.string().describe('Name for the new sheet tab')
  })
  ```
- **Behavior:** Calls `sheetsClient.createSheet(title)`. Returns new sheet metadata.
- **Output example:**
  ```json
  { "success": true, "sheetId": 123456, "title": "NewTab" }
  ```

### 5.3. `rename_sheet`

- **Input Schema:**
  ```typescript
  z.object({
    sheet_id: z.number().optional().describe('Numeric sheet ID'),
    old_title: z.string().optional().describe('Current sheet title (used if sheet_id is not provided)'),
    new_title: z.string().describe('New name for the sheet tab')
  }).refine(
    data => data.sheet_id !== undefined || data.old_title !== undefined,
    { message: 'Either sheet_id or old_title must be provided' }
  )
  ```
- **Behavior:**
  1. If `sheet_id` is provided, use it directly.
  2. If only `old_title` is provided, resolve it to a `sheetId` via `getSpreadsheetInfo()`.
  3. Call `sheetsClient.renameSheet(sheetId, new_title)`.
- **Output example:**
  ```json
  { "success": true, "sheetId": 0, "newTitle": "Renamed" }
  ```

### 5.4. `get_sheet_data`

- **Input Schema:**
  ```typescript
  z.object({
    range: z.string().describe("A1 notation range, e.g. 'Sheet1!A1:D10' or 'Sheet1' for the entire tab")
  })
  ```
- **Annotations:** `readOnlyHint: true`
- **Behavior:** Calls `sheetsClient.getSheetData(range)`. Returns raw 2D array.
- **Output example:**
  ```json
  {
    "range": "Sheet1!A1:D3",
    "values": [
      ["Name", "Age", "City"],
      ["Alice", 30, "Hanoi"],
      ["Bob", 25, "HCMC"]
    ]
  }
  ```

### 5.5. `add_rows`

- **Input Schema:**
  ```typescript
  z.object({
    sheet_name: z.string().describe('Target sheet tab name'),
    values: z.array(z.array(z.any())).describe('2D array of rows to append')
  })
  ```
- **Behavior:**
  1. Validate that `values` is a non-empty 2D array.
  2. If `config.userName` is set, append it as the last element of **each** row.
  3. Call `sheetsClient.addRows(sheet_name, processedValues)`.
- **USER_NAME injection detail:** The value is appended, not prepended. If the header row has a corresponding column header for the user name, it is the AI Agent's responsibility to include it when creating the sheet structure — the tool only appends the value blindly.
- **Output example:**
  ```json
  { "success": true, "updatedRange": "Sheet1!A4:D5", "updatedRows": 2 }
  ```

### 5.6. `update_row`

- **Input Schema:**
  ```typescript
  z.object({
    sheet_name: z.string().describe('Target sheet tab name'),
    row_index: z.number().int().min(1).describe('1-based row number in the sheet'),
    values: z.array(z.any()).describe('1D array of values for the row')
  })
  ```
- **Behavior:**
  1. Convert 1-based `row_index` to A1 range: `"${sheet_name}!A${row_index}"`.
  2. Call `sheetsClient.updateRow(sheet_name, row_index, values)`.
- **Note:** `row_index` is **1-based** to match Google Sheets row numbering. Row 1 is typically the header.
- **Output example:**
  ```json
  { "success": true, "updatedRange": "Sheet1!A3:D3" }
  ```

---

## 6. TOOLS Filtering (`src/tools/index.ts`)

### 6.1. Mechanism

```
ALL_TOOL_NAMES = ['get_spreadsheet_info', 'create_sheet', 'rename_sheet',
                  'get_sheet_data', 'add_rows', 'update_row']
```

| `TOOLS` env value | Behavior |
| --- | --- |
| _(empty or unset)_ | All 6 tools are registered |
| `get_sheet_data,add_rows` | Only those 2 tools are registered; the rest are invisible to the Agent |

### 6.2. Validation

- After parsing, each name in the list is checked against `ALL_TOOL_NAMES`.
- Unknown tool names → log a warning to `stderr` (do not crash) and skip them.
- If all names are invalid → log an error and `process.exit(1)` (no tools = useless server).

### 6.3. Registration Flow

```typescript
export function registerAllTools(
  server: McpServer,
  sheetsClient: SheetsClient,
  config: Config
): void {
  const allTools: ToolDefinition[] = [
    getSpreadsheetInfo,
    createSheet,
    renameSheet,
    getSheetData,
    addRows,
    updateRow,
  ];

  const enabled = config.tools; // string[] | null

  for (const tool of allTools) {
    if (enabled !== null && !enabled.includes(tool.name)) {
      continue; // skip — not in the allowlist
    }

    server.registerTool(
      tool.name,
      tool.config,
      async (args) => tool.handler(args, sheetsClient, config)
    );
  }
}
```

---

## 7. MCP Server Bootstrap (`src/index.ts`)

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { SheetsClient } from './sheets-client.js';
import { registerAllTools } from './tools/index.js';

async function main() {
  // 1. Load & validate config (exits on failure)
  const config = loadConfig();

  // 2. Initialize Google Sheets client
  const sheetsClient = new SheetsClient(config);

  // 3. Create MCP server
  const server = new McpServer({
    name: 'mcp-google-sheets',
    version: '1.0.0',
  });

  // 4. Register tools (respects TOOLS)
  registerAllTools(server, sheetsClient, config);

  // 5. Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MCP Google Sheets server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

---

## 8. Error Handling Strategy

### 8.1. Principles

- **Never crash the server.** Tool handlers catch all errors and return them as MCP error responses (`isError: true`).
- **Fail fast at startup** for config/auth problems — no point running a broken server.
- **Log to `stderr`** only. MCP protocol uses `stdout` for communication; any `console.log()` would corrupt the protocol stream.

### 8.2. Error Categories

| Category | When | Handling |
| --- | --- | --- |
| **Config error** | Missing/invalid env var | Log to `stderr` + `process.exit(1)` |
| **Auth error** | Invalid service account email or private key | Caught on first API call; return `isError: true` with message `"Authentication failed: <details>"` |
| **API error** | Sheet not found, quota exceeded, permission denied | Return `isError: true` with Google API error message |
| **Validation error** | Bad tool input (e.g. empty values array) | Return `isError: true` with validation message |

### 8.3. Tool Handler Pattern

Every tool handler follows this structure:

```typescript
async (args) => {
  try {
    // ... business logic ...
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}
```

---

## 9. Build & Run Configuration

### 9.1. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

### 9.2. `package.json` Scripts

```json
{
  "name": "mcp-google-sheets",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  }
}
```

### 9.3. Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "googleapis": "^171.0.0",
    "dotenv": "^17.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^6.0.0",
    "tsx": "^4.21.0",
    "@types/node": "^22.0.0"
  }
}
```

> **Version note (2026-04-15):** Versions verified against npm registry. The critical constraint is `@modelcontextprotocol/sdk` peer dep `zod ^3.25 || ^4.0`. We use Zod v4 directly — import from `'zod'` (not the transitional `'zod/v4'` subpath which was for gradual migration from v3).

### 9.4. Claude Code MCP Client Configuration

For local testing, add to Claude Code's MCP settings:

```json
{
  "mcpServers": {
    "google-sheets": {
      "command": "node",
      "args": ["<absolute-path>/dist/index.js"]
    }
  }
}
```

Or during development with `tsx`:

```json
{
  "mcpServers": {
    "google-sheets": {
      "command": "npx",
      "args": ["tsx", "<absolute-path>/src/index.ts"]
    }
  }
}
```

---

## 10. `.env.example`

```env
# Required — Google Service Account credentials
GOOGLE_SERVICE_ACCOUNT_EMAIL="my-agent@project-id.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...your-key...\n-----END PRIVATE KEY-----\n"

# Required — Target spreadsheet
SPREADSHEET_ID="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"

# Optional — Restrict which tools are exposed to the Agent
# Leave blank to enable all. Comma-separated, no spaces.
# Available: get_spreadsheet_info,create_sheet,rename_sheet,get_sheet_data,add_rows,update_row
TOOLS=""

# Optional — Appended to each row written by add_rows
USER_NAME=""
```

---

## 11. Data Flow Diagram

```
┌─────────────┐     stdio (JSON-RPC)     ┌──────────────────────┐
│  AI Agent    │ ◄──────────────────────► │   MCP Server         │
│  (Claude)    │                          │                      │
└─────────────┘                          │  index.ts (bootstrap) │
                                          │  ┌────────────────┐  │
                                          │  │  Tool Registry  │  │
                                          │  │  (filtered by   │  │
                                          │  │  TOOLS) │  │
                                          │  └───────┬────────┘  │
                                          │          │            │
                                          │  ┌───────▼────────┐  │
                                          │  │ SheetsClient    │  │
                                          │  │ (JWT Auth)      │  │
                                          │  └───────┬────────┘  │
                                          └──────────┼───────────┘
                                                     │ HTTPS
                                          ┌──────────▼───────────┐
                                          │  Google Sheets API   │
                                          │  v4                  │
                                          └──────────────────────┘
```

---

## 12. Future Considerations (Post-MVP)

These items are **out of scope** for MVP but influence current architectural decisions:

| Item | How Current Design Accommodates |
| --- | --- |
| **npm publishing** | `package.json` already has `name`, `version`, `main`. Add `bin` field and a shebang to `index.ts` when ready. |
| **Multiple spreadsheets** | `spreadsheetId` is centralized in `Config` — can be extended to accept overrides per tool call. |
| **OAuth 2.0 flow** | Auth is isolated in `sheets-client.ts`. Swap JWT for OAuth without touching tools. |
| **Additional tools** | Drop a new file in `src/tools/`, add it to the array in `tools/index.ts`. TOOLS filter applies automatically. |
