# Phase 2: Configuration Module — Implementation Notes

**Date:** 2026-04-15

---

## What Was Done

- Created `src/config.ts` with the `Config` interface and `loadConfig()` function
- Validates 3 required env vars: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID`
- Parses `GOOGLE_PRIVATE_KEY` — replaces literal `\n` with real newlines, validates PEM header
- Parses `TOOLS` — splits by comma, trims whitespace, validates against known tool names, returns `null` if empty
- Parses `USER_NAME` — returns `null` if empty/unset
- Returns a frozen `Config` object
- Updated `src/index.ts` to call `loadConfig()` and log the config with the private key redacted

## Design Decisions

### 1. TOOLS validation at config level

The `ALL_TOOL_NAMES` list is duplicated in `config.ts` (also needed later in `tools/index.ts`). This was intentional — validating at config load time gives an early, clear error if `.env` has a typo, rather than silently ignoring it later during tool registration. The list will be the single source of truth in `tools/index.ts` at Phase 6; for now `config.ts` carries its own copy.

### 2. Plain validation, not Zod

Per the technical spec (section 3.2), config validation uses plain checks, not Zod. Zod is reserved for MCP tool input schemas (Standard Schema requirement). Config is internal and doesn't benefit from the overhead.

### 3. `process.exit(1)` on config failure

Config errors are fatal — there's no point starting a server with missing credentials. Each failure path logs a specific error message naming the problem before exiting.

## Issues Encountered

None. Implementation was straightforward.

## Verification Results

- [x] **Happy path:** All 3 required vars set → config loads, key redacted, `tools: null`, `userName: null`
- [x] **Missing required var:** Removed `SPREADSHEET_ID` → exits with `Missing required environment variable: SPREADSHEET_ID`
- [x] **Bad private key:** Set to `"not-a-key"` → exits with `Invalid GOOGLE_PRIVATE_KEY: must start with "-----BEGIN PRIVATE KEY-----"`
- [x] **Private key parsing:** Key with `\n` literals → first line is `-----BEGIN PRIVATE KEY-----`, real newlines present
- [x] **TOOLS parsing:** `TOOLS=get_sheet_data, add_rows` (with space) → `['get_sheet_data', 'add_rows']` (trimmed)
- [x] **TOOLS empty:** Left blank → `null`
- [x] **TOOLS all invalid:** `TOOLS=fake1,fake2` → warns about each, exits with error listing available tools
- [x] **USER_NAME optional:** Blank → `null`; set to `"Toan"` → `"Toan"`
- [x] `npm run build` compiles with zero errors

## Files Created/Modified

```
 new: src/config.ts
 mod: src/index.ts  (replaced placeholder with loadConfig() + redacted log)
```
