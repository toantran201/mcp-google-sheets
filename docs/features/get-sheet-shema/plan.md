# Implementation Plan: `get_sheet_schema`

**Feature:** Advanced Sheet Schema Extraction
**References:** [PRD](./prd.md) | [Technical Spec](./technical-spec.md)
**Last Updated:** 2026-04-15

---

## Phase 1: Add `getSheetSchema` Method to SheetsClient

Add the new `getSheetSchema()` method to `src/sheets-client.ts`. This method calls `spreadsheets.get()` with a strict `fields` mask to fetch cell metadata (data validation, notes, number format, formula values) for the header and data rows.

**Files to modify:**

- `src/sheets-client.ts`

**Steps:**

1. Add the `getSheetSchema` method to the `SheetsClient` class.
2. Use full-row range notation (`SheetName!{headerRow}:{dataRow}`) to cover all columns, including those beyond column Z.
3. Use the `fields` mask: `sheets(data(rowData(values(formattedValue,note,dataValidation,effectiveFormat.numberFormat,userEnteredValue.formulaValue))))`.
4. Accept an optional `spreadsheetId` parameter, falling back to `this.spreadsheetId`.
5. Reuse the existing `quoteSheetName` utility for safe sheet name quoting.

### Verification Checklist

- [ ] `npm run build` compiles with zero errors
- [ ] **Method exists:** `SheetsClient` has a `getSheetSchema(sheetName, headerRow, dataRow, spreadsheetId?)` method
- [ ] **Return type:** Method returns `Promise<sheets_v4.Schema$Sheet | undefined>`
- [ ] **Fields mask:** Verify the API call includes the exact `fields` mask — no extra data fetched
- [ ] **Full-row range:** Range uses `SheetName!1:2` notation, NOT `A1:Z2`
- [ ] **Sheet name quoting:** Sheet names with spaces or special chars are wrapped in single quotes (e.g. `'My Sheet'!1:2`)
- [ ] **Optional spreadsheetId:** Omitting the parameter uses `this.spreadsheetId`; passing a value overrides it
- [ ] **Scope unchanged:** `get_sheet_schema` is NOT added to `WRITE_TOOLS` — read-only scope still works when only read tools are enabled

---

## Phase 2: Create Tool Definition File

Create `src/tools/get-sheet-schema.ts` with the Zod input schema, tool config, helper types, `buildColumnSchema` function, and the handler logic.

**Files to create:**

- `src/tools/get-sheet-schema.ts`

**Steps:**

1. Define the Zod input schema with `sheet_name` (required), `header_row` (optional, default 1), `data_row` (optional, computed default), and `spreadsheet_id` (optional).
2. Define the `ColumnSchema` interface: `type`, `allowed_values?`, `is_formula`, `note?`.
3. Implement `buildColumnSchema(headerCell, dataCell, resolvedRanges)` following the type priority algorithm: data validation → number format → text default.
4. Implement the handler:
   - Compute `dataRow` fallback (`header_row + 1`).
   - Validate `dataRow >= headerRow`.
   - Call `sheetsClient.getSheetSchema()`.
   - Check for empty header row.
   - Collect `ONE_OF_RANGE` references into a `Set`.
   - Batch-resolve all ranges via `sheetsClient.getSheetData()` with graceful fallback.
   - Build and return the schema JSON.
5. Export the tool as a `ToolDefinition`.

### Verification Checklist

- [ ] `npm run build` compiles with zero errors
- [ ] File exports a valid `ToolDefinition` with `name: 'get_sheet_schema'`, `config`, and `handler`
- [ ] **Input schema — happy path:** `{ sheet_name: 'Sheet1' }` passes Zod validation; `header_row` defaults to `1`
- [ ] **Input schema — custom rows:** `{ sheet_name: 'Sheet1', header_row: 3, data_row: 5 }` passes validation
- [ ] **Input schema — missing sheet_name:** `{}` fails Zod validation
- [ ] **Input schema — invalid header_row:** `{ sheet_name: 'Sheet1', header_row: 0 }` fails Zod validation (min 1)
- [ ] **Input schema — spreadsheet_id:** `{ sheet_name: 'Sheet1', spreadsheet_id: 'abc123' }` passes validation
- [ ] **data_row default:** When `header_row: 3` and `data_row` omitted, handler uses `dataRow = 4`
- [ ] **data_row < header_row:** `{ sheet_name: 'Sheet1', header_row: 5, data_row: 3 }` returns `{ isError: true }` with descriptive message
- [ ] **Annotations:** Tool config has `readOnlyHint: true`
- [ ] **Type priority — dropdown (ONE_OF_LIST):** Cell with `ONE_OF_LIST` validation returns `type: "dropdown"` with `allowed_values`
- [ ] **Type priority — dropdown (ONE_OF_RANGE):** Cell with `ONE_OF_RANGE` resolves values and returns `type: "dropdown"`
- [ ] **Type priority — checkbox:** Cell with `BOOLEAN` validation returns `type: "checkbox"`
- [ ] **Type priority — date:** Cell with `DATE` or `DATE_TIME` number format returns `type: "date"`
- [ ] **Type priority — currency:** Cell with `CURRENCY` number format returns `type: "currency"`
- [ ] **Type priority — number:** Cell with `NUMBER` or `PERCENT` number format returns `type: "number"`
- [ ] **Type priority — text:** Cell with no validation or special format returns `type: "text"`
- [ ] **Formula detection:** Cell with `formulaValue` in data row returns `is_formula: true`
- [ ] **Notes extraction:** Header cell with a note returns `note` field in the schema
- [ ] **ONE_OF_RANGE failure:** If referenced range cannot be resolved, `allowed_values` contains `["<unresolved: ...>"]` — tool does NOT fail
- [ ] **ONE_OF_RANGE deduplication:** Multiple columns referencing the same range trigger only one `getSheetData` call
- [ ] **Empty header row:** All cells empty → returns `{ isError: true }` with message advising `get_sheet_data`
- [ ] **Columns with no header:** Skipped in the output (no empty-key entries)
- [ ] **Error path:** Simulated Google API error → handler returns `{ isError: true }`, does not throw

---

## Phase 3: Register the Tool

Wire `get_sheet_schema` into the tool registry and config so it's discoverable by the MCP server and respects the `TOOLS` filter.

**Files to modify:**

- `src/config.ts`
- `src/tools/index.ts`

**Steps:**

1. Add `'get_sheet_schema'` to `ALL_TOOL_NAMES` in `src/config.ts`, placed after `'get_spreadsheet_info'`.
2. Import `getSheetSchema` in `src/tools/index.ts`.
3. Add `getSheetSchema` to the `allTools` array, placed after `getSpreadsheetInfo`.

### Verification Checklist

- [ ] `npm run build` compiles with zero errors
- [ ] **Tool registered:** `npm run dev` (with valid `.env`) → stderr log shows `get_sheet_schema` in the list of registered tools
- [ ] **ALL_TOOL_NAMES updated:** `config.ts` contains `'get_sheet_schema'` in the tuple — total 7 tool names
- [ ] **TOOLS=get_sheet_schema:** Set `TOOLS=get_sheet_schema` → only this tool is registered, server starts
- [ ] **TOOLS subset:** Set `TOOLS=get_sheet_data,get_sheet_schema` → both tools registered
- [ ] **TOOLS without get_sheet_schema:** Set `TOOLS=get_sheet_data,add_rows` → `get_sheet_schema` is NOT registered
- [ ] **All tools enabled:** Set `TOOLS=""` → all 7 tools registered (including `get_sheet_schema`)
- [ ] **Tool order in allTools:** `getSheetSchema` appears after `getSpreadsheetInfo` in the array

---

## Phase 4: Integration Testing

Test the tool end-to-end against a real Google Sheet with various column types.

**Prerequisites:**

- A Google Sheet shared with the Service Account (Editor or Viewer role)
- The sheet should have columns with: plain text, dropdowns (`ONE_OF_LIST`), dropdowns (`ONE_OF_RANGE`), checkboxes, dates, numbers, currency, formulas, and header notes

**Steps:**

1. Build the project: `npm run build`.
2. Test via MCP Inspector or Claude Code.
3. Verify each column type is detected correctly.
4. Test edge cases: custom header/data rows, empty headers, missing sheets, wide sheets.

### Verification Checklist

**Server connectivity:**

- [ ] Server starts with no errors, `get_sheet_schema` appears in the tool list

**Basic schema extraction:**

- [ ] Call with `{ sheet_name: 'Sheet1' }` → returns JSON with all columns from row 1 as keys
- [ ] Each column has `type`, `is_formula` fields at minimum

**Column type detection:**

- [ ] Column with `ONE_OF_LIST` validation → `type: "dropdown"`, `allowed_values` lists the options
- [ ] Column with `ONE_OF_RANGE` validation → `type: "dropdown"`, `allowed_values` contains resolved values from the referenced range
- [ ] Column configured as checkbox → `type: "checkbox"`
- [ ] Column formatted as date → `type: "date"`
- [ ] Column formatted as currency → `type: "currency"`
- [ ] Column formatted as number → `type: "number"`
- [ ] Column with plain text → `type: "text"`

**Formula & notes:**

- [ ] Column with formula in data row → `is_formula: true`
- [ ] Column without formula → `is_formula: false`
- [ ] Header cell with a note → `note` field present in the output
- [ ] Header cell without a note → no `note` field in the output

**Custom rows:**

- [ ] `{ sheet_name: 'Sheet1', header_row: 3 }` → reads row 3 as headers, row 4 as data
- [ ] `{ sheet_name: 'Sheet1', header_row: 3, data_row: 10 }` → reads row 3 as headers, row 10 as data

**Edge cases:**

- [ ] Non-existent sheet → returns error, server stays alive
- [ ] Empty header row → returns descriptive error about using `get_sheet_data` first
- [ ] `data_row` < `header_row` → returns validation error
- [ ] Wide sheet (>26 columns) → columns beyond Z are included in the schema
- [ ] Columns with empty headers (gaps) → skipped cleanly, no empty keys
- [ ] `ONE_OF_RANGE` pointing to a deleted sheet → `allowed_values` contains `["<unresolved: ...>"]`, tool does not fail
- [ ] `spreadsheet_id` override → passing a different spreadsheet ID works (with valid auth)

**TOOLS filtering:**

- [ ] `TOOLS=get_sheet_schema` → only this tool available; other tools not accessible
- [ ] `TOOLS=get_sheet_data,add_rows` → `get_sheet_schema` not available

**Error resilience:**

- [ ] Unshare the sheet from the service account → tool returns permission error, server stays alive
- [ ] Re-share the sheet → next call succeeds without server restart
