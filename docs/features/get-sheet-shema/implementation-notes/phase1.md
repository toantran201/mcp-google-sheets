# Phase 1: Add `getSheetSchema` Method to SheetsClient

**Status:** Complete
**File modified:** `src/sheets-client.ts`

---

## What Was Done

Added the `getSheetSchema` method to the `SheetsClient` class at the end of the class body (after `updateRow`).

### Method Signature

```typescript
async getSheetSchema(
  sheetName: string,
  headerRow: number,
  dataRow: number,
  spreadsheetId?: string,
): Promise<sheets_v4.Schema$Sheet | undefined>
```

### Key Implementation Details

1. **Full-row range notation:** Uses `SheetName!{headerRow}:{dataRow}` (e.g. `Tasks!1:2`) — covers all columns including those beyond column Z (up to 18,278 columns).

2. **Fields mask:** Requests exactly:

   ```
   sheets(data(rowData(values(formattedValue,note,dataValidation,effectiveFormat.numberFormat,userEnteredValue.formulaValue))))
   ```

   This fetches only the metadata needed for schema extraction — no cell values, no grid properties, no extra payload.

3. **Sheet name quoting:** Reuses the existing `quoteSheetName()` utility — sheet names with spaces or special characters are safely quoted (e.g. `'My Sheet'!1:2`).

4. **Optional `spreadsheetId`:** Falls back to `this.spreadsheetId` when omitted, following the pattern noted in the parent spec for future per-call overrides.

5. **Read-only scope:** NOT added to `WRITE_TOOLS` array — when only read tools are enabled, the `spreadsheets.readonly` scope is correctly selected.

### API Used

- `spreadsheets.get()` (NOT `spreadsheets.values.get()`) — cell metadata (dataValidation, notes, numberFormat, formulaValue) is only available through the full spreadsheet resource.

---

## Verification Checklist

- [x] `npm run build` compiles with zero errors
- [x] Method exists with correct signature: `getSheetSchema(sheetName, headerRow, dataRow, spreadsheetId?)`
- [x] Return type: `Promise<sheets_v4.Schema$Sheet | undefined>`
- [x] Fields mask matches the spec exactly
- [x] Full-row range notation (`SheetName!1:2`), not column-bounded (`A1:Z2`)
- [x] Sheet name quoting via `quoteSheetName()`
- [x] Optional `spreadsheetId` with fallback to `this.spreadsheetId`
- [x] `get_sheet_schema` NOT in `WRITE_TOOLS` — read-only scope preserved
