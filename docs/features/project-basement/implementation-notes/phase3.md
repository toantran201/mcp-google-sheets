# Phase 3: Google Sheets Client — Implementation Notes

**Date:** 2026-04-15

---

## What Was Done

- Created `src/sheets-client.ts` with the `SheetsClient` class
- Implements JWT Service Account authentication via `google.auth.JWT`
- All 6 methods implemented as thin async wrappers around Google Sheets API v4 calls:
  - `getSpreadsheetInfo()` — fetches metadata with `fields: 'properties,sheets.properties'` (no gridData)
  - `createSheet(title)` — batchUpdate with addSheet request
  - `renameSheet(identifier, newTitle)` — accepts `{ sheetId }` or `{ oldTitle }`, resolves title → sheetId internally
  - `getSheetData(range)` — values.get with `UNFORMATTED_VALUE`
  - `addRows(sheetName, values)` — values.append with `USER_ENTERED`
  - `updateRow(sheetName, rowIndex, values)` — values.update with `USER_ENTERED`
- Updated `src/index.ts` to instantiate `SheetsClient` and call `getSpreadsheetInfo()` as a smoke test
- Updated `docs/technical-spec.md` to fix the JWT constructor pattern

## Issues Encountered

### 1. JWT constructor API changed — positional args → options object

**Error:** `TS2554: Expected 0-1 arguments, but got 4.`

**Root cause:** The technical spec had the old `google.auth.JWT(email, keyFile, key, scopes)` positional argument pattern. The current `google-auth-library` version uses a single `JWTOptions` object:

```typescript
// Old (broken)
new google.auth.JWT(email, undefined, key, scopes);

// New (correct)
new google.auth.JWT({ email, key, scopes });
```

**Fix:** Updated `sheets-client.ts` to use the options-object constructor. Also updated `docs/technical-spec.md` section 4.1 to match.

## Verification Results

> **Note:** Full live API testing (happy path for all 6 methods) requires real Google Service Account credentials and a shared spreadsheet. The checklist below covers what can be verified without credentials.

- [x] `npm run build` compiles with zero errors
- [x] **Auth failure — bad credentials:** Server exits cleanly with an error message, does not crash
- [x] **Code review:** `getSpreadsheetInfo()` uses `fields: 'properties,sheets.properties'` — no gridData in response
- [x] **Code review:** `getSheetData()` uses `valueRenderOption: 'UNFORMATTED_VALUE'`
- [x] **Code review:** `addRows()` and `updateRow()` use `valueInputOption: 'USER_ENTERED'`
- [x] **Code review:** `renameSheet()` handles both `{ sheetId }` and `{ oldTitle }` identifier forms, with title → sheetId lookup fallback
- [x] **Code review:** `spreadsheetId` is encapsulated in the class — tools never pass it

### Live API tests (require real `.env` credentials)

- [ ] **Auth success:** `npm run dev` prints spreadsheet metadata (title, sheet names)
- [ ] **Permission failure:** Spreadsheet not shared with service account → clear error
- [ ] **getSheetData:** Returns correct 2D array matching spreadsheet content
- [ ] **createSheet:** New tab appears in Google Sheets UI
- [ ] **renameSheet by ID:** Title changes in Google Sheets UI
- [ ] **renameSheet by title:** Resolves correctly and renames
- [ ] **addRows:** Rows appear at the bottom in Google Sheets UI
- [ ] **updateRow:** Data changes, other rows untouched

## Files Created/Modified

```
 new: src/sheets-client.ts
 mod: src/index.ts  (replaced Phase 2 placeholder with SheetsClient smoke test)
 mod: docs/technical-spec.md  (fixed JWT constructor in section 4.1)
```
