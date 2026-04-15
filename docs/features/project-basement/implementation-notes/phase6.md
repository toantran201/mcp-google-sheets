# Phase 6: Tool Registry & TOOLS Filter — Implementation Notes

**Date:** 2026-04-15

---

## What Was Done

- Created `src/tools/index.ts` with `registerAllTools(server, sheetsClient, config)`
- Imports all 6 tool definitions, iterates them, skips any not in `config.tools` (unless `null` = all enabled)
- Logs registered tool names and count to `stderr`

## Design Decisions

### 1. TOOLS validation stays in `config.ts`, not in the registry

Unknown tool name warnings and the "zero valid tools" exit already happen at config load time (`parseTools()` in `config.ts`). The registry simply trusts `config.tools` and filters accordingly. This avoids duplicating validation logic and fails fast at startup.

### 2. Callback wrapping

`registerTool` expects `(args, extra) => CallToolResult`, but our `ToolDefinition.handler` takes `(args, sheetsClient, config)`. The registry bridges this with `async (args: any) => tool.handler(args, sheetsClient, config)`, capturing `sheetsClient` and `config` in the closure.

## Issues Encountered

None.

## Verification Results

- [x] **All tools enabled:** `TOOLS=""` → `Registered tools (6): get_spreadsheet_info, create_sheet, rename_sheet, get_sheet_data, add_rows, update_row`
- [x] **Subset enabled:** `TOOLS=get_sheet_data,add_rows` → `Registered tools (2): get_sheet_data, add_rows`
- [x] **Single tool:** `TOOLS=get_spreadsheet_info` → `Registered tools (1): get_spreadsheet_info`
- [x] **Unknown tool name:** `TOOLS=get_sheet_data,fake_tool` → warns about `fake_tool`, registers only `get_sheet_data`
- [x] **All names invalid:** `TOOLS=fake1,fake2` → exits with error at config level (before registry runs)
- [x] `npm run build` compiles with zero errors

## Files Created

```
 new: src/tools/index.ts
```
