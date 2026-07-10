# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

An MCP (Model Context Protocol) stdio server that gives AI agents read/write access to Google Spreadsheets. Two auth modes, auto-detected from env: **per-user OAuth** (browser sign-in, edits attributed to the real user) or **Service Account** (headless JWT, legacy). There is no fixed target spreadsheet — every tool takes a required `spreadsheet` parameter (URL or ID). Written in TypeScript, ESM-only, bundled with tsup.

## Commands

```bash
npm run dev      # Run directly from TypeScript via tsx (no build) — primary dev loop
npm run build    # Bundle src/index.ts → dist/index.js with tsup
npm start        # Run the built server (node dist/index.js)

npm run typecheck     # tsc --noEmit (type validation)
npm run lint          # eslint .
npm run format        # prettier --write . (format:check to verify without writing)

npx tsx src/test-tools.ts <spreadsheet-url-or-id>   # Manual end-to-end test: hits a REAL Google Sheet
```

There is no unit test framework. Linting (ESLint flat config, `eslint.config.js`), formatting (Prettier, `.prettierrc.json` — single quotes, markdown ignored) and typechecking scripts exist; run them before committing. `test-tools.ts` is a manual integration harness that runs every tool handler against the live spreadsheet passed as argv[2] (or `TEST_SPREADSHEET` env). It creates a `TestTab_<timestamp>` sheet and writes rows — expect side effects on the real sheet. Run it to verify changes end-to-end.

Requires a `.env` (copy `.env.example`) with ONE auth mode:
- OAuth: `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` (wins if both modes are set)
- Service Account: `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`

Optional: `TOOLS` (comma-separated allowlist), `USER_NAME` (stamped onto `add_rows` writes). `SPREADSHEET_ID` no longer exists.

## Architecture

Startup flow (`src/index.ts`): `loadConfig()` → `new AuthManager(config)` → `new SheetsClient(authManager)` → `registerAllTools(server, client, config)` → connect stdio transport. Diagnostics go to `console.error` (**stdout is reserved for the MCP protocol — never write to it, and never prompt on it**).

Layers:
- **`config.ts`** — loads/validates env vars, auto-detects the auth mode (`Config.auth` is a discriminated union on `mode`), exits the process on missing/invalid required vars. Freezes the `Config` object.
- **`auth/`** — all authentication:
  - `auth-manager.ts` — the only auth entry point. `getClient()` is memoized and serializes concurrent callers; in OAuth mode it may run the interactive browser flow. `reset()` clears the token cache and forces a fresh sign-in (used on `invalid_grant`).
  - `oauth-flow.ts` — installed-app loopback flow: ephemeral `127.0.0.1` HTTP server, `state` CSRF check, 5-minute timeout, opens the browser via the `open` package.
  - `token-store.ts` — per-user token cache at `~/.google-sheets-mcp/tokens.json` (stores `scope` + `client_id` for cache invalidation).
  - `scopes.ts` — `resolveScope()` + `WRITE_TOOLS`.
- **`sheets-client.ts`** — thin wrapper around `googleapis` `sheets_v4`. Builds the API handle lazily on first call (this is what defers the OAuth browser flow to the first tool call, not server startup). **Every method takes `spreadsheetId` as its first parameter** — there is no stored default. `withAuthRetry()` catches `invalid_grant` (revoked/expired refresh token), resets auth, and retries once.
- **`spreadsheet-ref.ts`** — `parseSpreadsheetRef()` (URL or bare ID → ID, throws on garbage) and the shared `SPREADSHEET_PARAM_DESCRIPTION` used by every tool's `spreadsheet` param.
- **`tools/`** — one file per tool, each exporting a `ToolDefinition` (`tools/shared/types.ts`): `{ name, config: { title, description, inputSchema (Zod), annotations }, handler }`. Shared, non-tool helpers live under `tools/shared/` (`types.ts`, `sanitize.ts`, `result.ts`); the top level of `tools/` holds only tool files plus the `index.ts` registry.

### Adding or renaming a tool

A tool name lives in **two places that must stay in sync**, or the tool silently won't register / the `TOOLS` filter rejects it:
1. `tools/index.ts` — import the `ToolDefinition` and add it to the `allTools` array.
2. `config.ts` — add the exact name string to `ALL_TOOL_NAMES` (used to validate the `TOOLS` env allowlist).

The `TOOLS` env var filters which tools register (blank = all). `registerAllTools` skips any tool not in the enabled set.

### Auth scope is derived from enabled tools

`auth/scopes.ts` `resolveScope()` requests the read-only Sheets scope **unless** a write tool (`create_sheet`, `rename_sheet`, `add_rows`, `add_columns`, `update_row`, `delete_rows`) is enabled, in which case it requests the read/write scope. If you add a new write-capable tool, add its name to the `WRITE_TOOLS` array or it will fail with a permission error under a read-only `TOOLS` config. In OAuth mode, widening the scope (e.g. enabling a write tool after a read-only consent) invalidates the token cache and triggers a one-time re-consent.

### Tool handler conventions

- Handlers are `async (args, sheetsClient, config) => CallToolResult`. Wrap the body in try/catch and on error return `{ content: [{ type: 'text', text: 'Error: ...' }], isError: true }` rather than throwing — the same shape all tools use.
- Every tool schema includes `spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION)`. Handlers call `parseSpreadsheetRef(args.spreadsheet)` inside the try/catch (so bad refs return the standard error shape) and pass the ID as the first argument to every `SheetsClient` method — including secondary calls (see the ONE_OF_RANGE resolution in `get-sheet-schema.ts`).
- Success returns JSON stringified into a single text content block.
- All cell writes pass through `sanitizeCell` (`tools/shared/sanitize.ts`), which prefixes formula-triggering strings (`=`, `+`, `-`, `@`) with `'` to prevent CSV/formula injection. Any new write tool must sanitize user-supplied cell values.
- `add_rows` appends `config.userName` as a trailing column when `USER_NAME` is set (audit trail).
- Sheet names with special characters must be quoted for A1 notation — `sheets-client.ts` has `quoteSheetName()` for this.

### ESM import rule

`tsconfig.json` uses `module: Node16`, so **relative imports must include the `.js` extension** (e.g. `import { loadConfig } from './config.js'`) even though the source files are `.ts`. Omitting it breaks the build/runtime.

### google-auth-library version pin

`package.json` pins `google-auth-library` to exactly `10.5.0` — the version `googleapis-common` pins internally. Without the top-level pin, npm installs a second (newer) copy under `googleapis`, and the two copies' types are incompatible (`tsc` fails with "separate declarations of a private property"). If you bump `googleapis`, check `googleapis-common`'s pinned `google-auth-library` version and keep the top-level pin in sync. (Import auth types via `googleapis`'s `Auth` namespace or `google.auth.*` where possible.)

## Docs

Feature specs live under `docs/features/<feature>/` (`prd.md`, `plan.md`, `technical-spec.md`, and phased `implementation-notes/`). `get-sheet-shema` and `project-basement` are the existing feature docs. Consult these for intent behind a feature before large changes. Note: they predate the OAuth/per-call-spreadsheet migration (branch `feat/per-user-oauth`) — `config.ts` and this file are authoritative for current behavior.
