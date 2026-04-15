# Implementation Plan

**Project:** MCP Google Sheets (MVP)
**References:** [PRD](./prd.md) | [Technical Spec](./technical-spec.md)
**Last Updated:** 2026-04-15

---

## Phase 1: Project Scaffolding

Set up the project skeleton — no business logic yet, just a buildable TypeScript project.

**Files to create:**
- `package.json`
- `tsconfig.json`
- `.gitignore`
- `.env.example`
- `src/index.ts` (minimal — just a `console.error('hello')` placeholder)

**Steps:**
1. Run `npm init -y` and edit `package.json` with the correct metadata, `"type": "module"`, and scripts (`build`, `start`, `dev`).
2. Install all dependencies:
   - `npm install @modelcontextprotocol/sdk googleapis dotenv zod`
   - `npm install -D typescript tsx @types/node`
3. Create `tsconfig.json` per technical spec section 9.1.
4. Create `.gitignore` (node_modules, dist, .env).
5. Create `.env.example` per technical spec section 10.
6. Create placeholder `src/index.ts` that just logs to stderr.

### Verification Checklist

- [ ] `npm install` completes with no errors and no peer dependency warnings
- [ ] `npm ls zod` shows a single copy of zod (no duplicates — prevents TS2589 errors)
- [ ] `npm run build` compiles successfully, produces `dist/index.js`
- [ ] `npm start` runs and prints the placeholder message to stderr, then exits cleanly
- [ ] `npm run dev` runs `src/index.ts` directly via tsx without build step
- [ ] `.env` is in `.gitignore` (run `git status` after creating a dummy `.env` — it should not appear)

---

## Phase 2: Configuration Module

Implement `src/config.ts` — load and validate environment variables.

**Files to create:**
- `src/config.ts`

**Steps:**
1. Import `dotenv/config` to auto-load `.env`.
2. Define the `Config` interface and `loadConfig()` function.
3. Validate all 3 required vars are present and non-empty.
4. Parse `GOOGLE_PRIVATE_KEY` — replace literal `\n` with real newlines.
5. Parse `TOOLS` — split by comma, trim whitespace, return `null` if empty.
6. Parse `USER_NAME` — return `null` if empty/unset.
7. Return a frozen `Config` object.
8. Update `src/index.ts` to call `loadConfig()` and log the result (redact the private key).

### Verification Checklist

- [ ] **Happy path:** Create a `.env` with all 3 required vars filled → `npm run dev` prints the config object (with key redacted) and exits
- [ ] **Missing required var:** Remove `SPREADSHEET_ID` from `.env` → server exits with a clear error message naming the missing variable
- [ ] **Bad private key:** Set `GOOGLE_PRIVATE_KEY="not-a-key"` → server exits with error about invalid key format
- [ ] **Private key parsing:** Set key with `\n` literals → log the parsed key's first line to confirm it starts with `-----BEGIN PRIVATE KEY-----`
- [ ] **TOOLS parsing:** Set `TOOLS=get_sheet_data, add_rows` (with space) → config shows `['get_sheet_data', 'add_rows']` (trimmed)
- [ ] **TOOLS empty:** Leave blank → config shows `null`
- [ ] **USER_NAME optional:** Leave blank → config shows `null`; set it → config shows the value
- [ ] `npm run build` still compiles with zero errors

---

## Phase 3: Google Sheets Client

Implement `src/sheets-client.ts` — authenticate and expose typed API methods.

**Prerequisites:** You need a real Google Service Account and a test spreadsheet. Share the spreadsheet with the service account email (Editor role).

**Files to create:**
- `src/sheets-client.ts`

**Steps:**
1. Create the `SheetsClient` class.
2. In the constructor, create a `google.auth.JWT` client using config credentials.
3. Initialize `google.sheets({ version: 'v4', auth })`.
4. Implement all 6 methods (see technical spec section 4.2).
5. For `renameSheet` — implement the `old_title` → `sheetId` lookup fallback.
6. Update `src/index.ts` to instantiate `SheetsClient` and call `getSpreadsheetInfo()` as a smoke test.

### Verification Checklist

- [ ] **Auth success:** Run `npm run dev` with valid credentials → prints spreadsheet metadata (title, sheet names)
- [ ] **Auth failure — bad email:** Change email to `wrong@example.com` → returns clear auth error, does not crash
- [ ] **Auth failure — bad key:** Corrupt the private key → returns clear auth error, does not crash
- [ ] **Permission failure:** Use a spreadsheet NOT shared with the service account → returns "permission denied" style error
- [ ] **getSpreadsheetInfo:** Returns sheet titles, IDs, row/column counts — no `gridData` in response (check response size is small)
- [ ] **getSheetData:** Call with `'Sheet1!A1:C3'` → returns correct 2D array matching the spreadsheet content
- [ ] **getSheetData full tab:** Call with `'Sheet1'` → returns all data in the tab
- [ ] **createSheet:** Call with `title: 'TestTab'` → new tab appears in Google Sheets UI
- [ ] **renameSheet by ID:** Rename the test tab by `sheetId` → title changes in Google Sheets UI
- [ ] **renameSheet by title:** Rename by `old_title` → resolves correctly and renames
- [ ] **addRows:** Append 2 rows to a sheet → rows appear at the bottom in Google Sheets UI
- [ ] **updateRow:** Update row 2 → data changes in Google Sheets UI, other rows untouched
- [ ] `npm run build` still compiles with zero errors

---

## Phase 4: Tool Definitions (Read-Only Tools)

Implement the 3 read-only tools first — lowest risk, easiest to verify.

**Files to create:**
- `src/tools/types.ts`
- `src/tools/get-spreadsheet-info.ts`
- `src/tools/get-sheet-data.ts`
- `src/tools/create-sheet.ts`

**Steps:**
1. Create `src/tools/types.ts` with the shared `ToolDefinition` interface.
2. Implement `get-spreadsheet-info.ts` — no input, calls `sheetsClient.getSpreadsheetInfo()`, formats response as JSON text.
3. Implement `get-sheet-data.ts` — takes `range` input, returns 2D array.
4. Implement `create-sheet.ts` — takes `title` input, returns new sheet metadata.
5. Each tool: define Zod input schema, set annotations where applicable (`readOnlyHint`), implement handler with try/catch error pattern.

### Verification Checklist

- [ ] Each tool file exports a valid `ToolDefinition` with `name`, `config`, and `handler`
- [ ] **get_spreadsheet_info handler:** Call handler directly with mock sheetsClient → returns valid JSON with `title` and `sheets` array
- [ ] **get_sheet_data handler:** Call handler with `{ range: 'Sheet1!A1:B2' }` → returns JSON with `range` and `values`
- [ ] **create_sheet handler:** Call handler with `{ title: 'Test' }` → returns JSON with `success`, `sheetId`, `title`
- [ ] **Error path:** Simulate a Google API error → handler returns `{ isError: true }` with descriptive message, does not throw
- [ ] **Zod schemas:** Pass invalid input (e.g. missing `range` for get_sheet_data) → Zod rejects before handler runs
- [ ] `npm run build` compiles with zero errors

---

## Phase 5: Tool Definitions (Write Tools)

Implement the 3 remaining write tools.

**Files to create:**
- `src/tools/rename-sheet.ts`
- `src/tools/add-rows.ts`
- `src/tools/update-row.ts`

**Steps:**
1. Implement `rename-sheet.ts` — accepts `sheet_id` OR `old_title` + `new_title`, uses `.refine()` for validation.
2. Implement `add-rows.ts` — accepts `sheet_name` + `values` (2D array). Inject `USER_NAME` if configured.
3. Implement `update-row.ts` — accepts `sheet_name` + `row_index` (1-based) + `values` (1D array).

### Verification Checklist

- [ ] **rename_sheet with sheet_id:** Call with `{ sheet_id: 0, new_title: 'Renamed' }` → success response
- [ ] **rename_sheet with old_title:** Call with `{ old_title: 'Renamed', new_title: 'Original' }` → resolves ID and renames
- [ ] **rename_sheet missing both:** Call with `{ new_title: 'X' }` (no sheet_id or old_title) → Zod validation error
- [ ] **add_rows basic:** Call with 2 rows of data → rows appear at bottom of sheet
- [ ] **add_rows with USER_NAME:** Set `USER_NAME=Toan` in config → each row has "Toan" appended as last element
- [ ] **add_rows without USER_NAME:** Leave `USER_NAME` unset → rows written as-is, no extra column
- [ ] **add_rows empty array:** Call with `values: []` → returns validation error, does not call Google API
- [ ] **update_row:** Call with `{ sheet_name: 'Sheet1', row_index: 2, values: ['X', 'Y'] }` → row 2 in Google Sheets updated
- [ ] **update_row row 1:** Confirm row_index 1 maps to the actual first row (header row)
- [ ] **Error path for each tool:** Simulate API error → returns `{ isError: true }`, does not throw
- [ ] `npm run build` compiles with zero errors

---

## Phase 6: Tool Registry & TOOLS Filter

Wire all tools together with the filtering mechanism.

**Files to create:**
- `src/tools/index.ts`

**Steps:**
1. Import all 6 tool definitions.
2. Implement `registerAllTools(server, sheetsClient, config)`.
3. Iterate tools, skip any not in `config.enabledTools` (unless `null` = all enabled).
4. Log registered tool names to `stderr` for visibility.
5. Validate: if `TOOLS` has unknown names → log warning. If zero valid tools → `process.exit(1)`.

### Verification Checklist

- [ ] **All tools enabled:** Set `TOOLS=""` → stderr log shows all 6 tool names registered
- [ ] **Subset enabled:** Set `TOOLS=get_sheet_data,add_rows` → stderr shows only 2 tools registered
- [ ] **Unknown tool name:** Set `TOOLS=get_sheet_data,fake_tool` → stderr warns about `fake_tool`, registers only `get_sheet_data`
- [ ] **All names invalid:** Set `TOOLS=fake1,fake2` → server exits with error (no tools = useless)
- [ ] **Single tool:** Set `TOOLS=get_spreadsheet_info` → only 1 tool registered, server starts fine
- [ ] `npm run build` compiles with zero errors

---

## Phase 7: MCP Server Bootstrap & Stdio Transport

Wire everything into `src/index.ts` — the server should now be a fully functional MCP server.

**Files to modify:**
- `src/index.ts` (replace placeholder with full bootstrap)

**Steps:**
1. Import `McpServer` and `StdioServerTransport` from the MCP SDK.
2. Follow the bootstrap sequence: loadConfig → SheetsClient → McpServer → registerAllTools → connect transport.
3. Add top-level `.catch()` for fatal errors.
4. Ensure all logging goes to `stderr` (never `console.log`).

### Verification Checklist

- [ ] **Build & run:** `npm run build && npm start` — server starts without errors, hangs waiting for stdio input (expected)
- [ ] **Dev mode:** `npm run dev` — same behavior via tsx
- [ ] **No stdout pollution:** Run `npm start 2>/dev/null` — stdout should be completely silent (no stray console.log)
- [ ] **Config error at startup:** Remove a required env var → server exits immediately with clear error (not a hang)
- [ ] **MCP Inspector test:** If available, connect MCP Inspector to the server:
  - [ ] Inspector shows server name `mcp-google-sheets` and version `1.0.0`
  - [ ] Inspector lists the correct set of tools (respects TOOLS)
  - [ ] Each tool shows its Zod-generated JSON schema
- [ ] `npm run build` produces clean output in `dist/`

---

## Phase 8: Integration Testing with Claude Code

Connect the server to Claude Code and test all 6 tools end-to-end with a real Google Sheet.

**Prerequisites:**
- A Google Sheet shared with the Service Account (Editor role)
- The sheet should have at least one tab with some sample data

**Steps:**
1. Build the project: `npm run build`.
2. Add the MCP server to Claude Code settings (see technical spec section 9.4).
3. Restart Claude Code to pick up the new MCP server.
4. Test each tool by prompting Claude.

### Verification Checklist

**Server connectivity:**
- [ ] Claude Code shows `google-sheets` as a connected MCP server (no error badge)
- [ ] Claude can discover and list available tools from the server

**Tool: get_spreadsheet_info**
- [ ] Ask Claude: "What sheets are in my spreadsheet?" → Claude calls the tool and reports sheet names, IDs, row/column counts

**Tool: get_sheet_data**
- [ ] Ask Claude: "Read data from Sheet1" → Claude returns the full tab data
- [ ] Ask Claude: "Read cells A1 to C5 from Sheet1" → Claude returns only that range
- [ ] Ask for data from a non-existent sheet → Claude reports the error gracefully

**Tool: create_sheet**
- [ ] Ask Claude: "Create a new sheet called Reports" → new tab appears in Google Sheets UI
- [ ] Ask Claude to create a sheet with a name that already exists → error returned, not a crash

**Tool: rename_sheet**
- [ ] Ask Claude: "Rename the Reports sheet to Monthly-Reports" → tab name changes in Google Sheets UI
- [ ] Ask Claude to rename by sheet ID → works correctly

**Tool: add_rows**
- [ ] Ask Claude: "Add these rows to Sheet1: [['Alice', 30], ['Bob', 25]]" → rows appended at bottom
- [ ] Verify USER_NAME injection: if `USER_NAME=Toan`, each row should have "Toan" as the last value
- [ ] Open Google Sheets UI and confirm the data is there

**Tool: update_row**
- [ ] Ask Claude: "Update row 2 of Sheet1 to ['Charlie', 35, 'HCMC']" → row 2 changes in Google Sheets UI
- [ ] Confirm row 1 (header) and row 3+ are untouched

**TOOLS filtering:**
- [ ] Set `TOOLS=get_spreadsheet_info,get_sheet_data` → restart Claude Code
- [ ] Ask Claude to add rows → Claude should NOT have access to `add_rows` tool
- [ ] Ask Claude to read data → works normally

**Error resilience:**
- [ ] Kill the Google Sheet (unshare from service account) → tool calls return errors, server stays alive
- [ ] Re-share the sheet → next tool call succeeds (no server restart needed)
- [ ] Send malformed input through Claude → error response, no crash

---

## Phase 9: Cleanup & Documentation

Final polish before the MVP is considered complete.

**Files to create/update:**
- `README.md`
- Clean up any debug logging or temporary code

**Steps:**
1. Write `README.md` with: project description, prerequisites, setup instructions (service account, .env), build & run commands, Claude Code configuration, available tools, TOOLS usage.
2. Remove any temporary `console.error` debug statements from earlier phases.
3. Verify `.gitignore` covers: `node_modules/`, `dist/`, `.env`.
4. Run a final full build and test cycle.

### Verification Checklist

- [ ] `README.md` covers all setup steps — a new developer can go from zero to running by following it
- [ ] `git status` shows no untracked sensitive files (.env, credentials)
- [ ] `rm -rf node_modules dist && npm install && npm run build` — clean install + build passes
- [ ] `npm run dev` starts the server with no warnings
- [ ] All 6 tools tested one final time via Claude Code — all pass
- [ ] No `console.log()` calls anywhere in `src/` (only `console.error`)
