# Phase 5: Tool Definitions (Write Tools) — Implementation Notes

**Date:** 2026-04-15

---

## What Was Done

- Created `src/tools/rename-sheet.ts` — accepts `sheet_id` OR `old_title` + `new_title`, uses `.refine()` for validation
- Created `src/tools/add-rows.ts` — accepts `sheet_name` + `values` (2D array), injects `USER_NAME` if configured
- Created `src/tools/update-row.ts` — accepts `sheet_name` + `row_index` (1-based) + `values` (1D array)

All three tools follow the same try/catch + `isError: true` error pattern as Phase 4.

## Design Decisions

### 1. `rename_sheet` uses `.refine()` on the Zod schema

The spec requires either `sheet_id` or `old_title` to be provided. Both fields are individually optional, but at least one is required. Zod's `.refine()` enforces this at schema level. Note: `.refine()` returns a `ZodEffects` type (not `ZodObject`), but this is still compatible with the SDK's `AnySchema` input.

### 2. `add_rows` validates empty array in the handler, not in Zod

The Zod schema allows `values: z.array(z.array(z.any()))` — an empty array is technically valid per the schema. The empty check happens in the handler with an early return of `isError: true`. This gives a clearer error message than a Zod `.min(1)` would.

### 3. `add_rows` USER_NAME injection

When `config.userName` is set, it is appended as the last element of **each** row. The original `args.values` is not mutated — a new array is created via `.map()`.

## Issues Encountered

None.

## Verification Results

- [x] Each tool file exports a valid `ToolDefinition` with `name`, `config`, and `handler`
- [x] **rename_sheet:** `inputSchema` uses `.refine()` to require `sheet_id` or `old_title`
- [x] **rename_sheet:** Handler bridges to `sheetsClient.renameSheet()` with `{ sheetId }` or `{ oldTitle }` identifier
- [x] **add_rows:** Handler validates `values.length === 0` → returns `isError: true` before calling API
- [x] **add_rows:** USER_NAME injection appends to each row when `config.userName` is set
- [x] **add_rows:** Rows written as-is when `config.userName` is null
- [x] **update_row:** `row_index` is passed directly to `sheetsClient.updateRow()` (which converts to A1 range internally)
- [x] **Error pattern:** All three handlers return `{ isError: true }` on caught exceptions
- [x] `npm run build` compiles with zero errors

### Live tests (testable after Phase 6–7 wiring)

- [ ] rename_sheet with sheet_id / old_title / missing both
- [ ] add_rows with/without USER_NAME, empty array
- [ ] update_row row updates correctly, other rows untouched

## Files Created

```
 new: src/tools/rename-sheet.ts
 new: src/tools/add-rows.ts
 new: src/tools/update-row.ts
```
