# Phase 4: Tool Definitions (Read-Only Tools) — Implementation Notes

**Date:** 2026-04-15

---

## What Was Done

- Created `src/tools/types.ts` with the shared `ToolDefinition` interface
- Created `src/tools/get-spreadsheet-info.ts` — no input, returns spreadsheet metadata (title, sheets array)
- Created `src/tools/get-sheet-data.ts` — takes `range` (A1 notation), returns 2D array of values
- Created `src/tools/create-sheet.ts` — takes `title`, returns new sheet metadata

All three tools follow the error handling pattern from the technical spec (section 8.3): try/catch with `isError: true` on failure.

## Design Decisions

### 1. `inputSchema` type: `z.ZodObject<any>`

The MCP SDK's `registerTool` accepts either a raw shape (`Record<string, AnySchema>`) or a full Zod schema (`AnySchema`). We use `z.object(...)` — a full Zod schema — for clarity and to keep validation logic co-located with the schema definition. For `get_spreadsheet_info` which has no input, we use `z.object({})`.

### 2. Handler args typing

Each handler uses an explicit type annotation on `args` (e.g. `args: { range: string }`) for internal type safety. The `ToolDefinition` interface uses `any` for `args` to allow the generic interface to hold tools with different schemas.

### 3. `get_spreadsheet_info` response shaping

Rather than returning the raw Google API response, the handler maps `sheets.properties` into a clean `{ sheetId, title, rowCount, columnCount }` structure. This keeps the LLM response focused and avoids leaking internal Google API fields.

## Issues Encountered

None. All three tools compiled and matched the spec on the first pass.

## Verification Results

- [x] Each tool file exports a valid `ToolDefinition` with `name`, `config`, and `handler`
- [x] **get_spreadsheet_info:** `inputSchema` is `z.object({})`, `annotations.readOnlyHint: true`
- [x] **get_sheet_data:** `inputSchema` has `range: z.string()`, `annotations.readOnlyHint: true`
- [x] **create_sheet:** `inputSchema` has `title: z.string()`, no readOnlyHint
- [x] **Error pattern:** All three handlers wrap logic in try/catch, return `{ isError: true }` on failure
- [x] `npm run build` compiles with zero errors

### Live handler tests (will be testable after Phase 6–7 wiring)

- [ ] **get_spreadsheet_info handler:** Returns JSON with `title` and `sheets` array
- [ ] **get_sheet_data handler:** Returns JSON with `range` and `values`
- [ ] **create_sheet handler:** Returns JSON with `success`, `sheetId`, `title`
- [ ] **Error path:** Google API error → `{ isError: true }` with message, no throw

## Files Created

```
 new: src/tools/types.ts
 new: src/tools/get-spreadsheet-info.ts
 new: src/tools/get-sheet-data.ts
 new: src/tools/create-sheet.ts
```
