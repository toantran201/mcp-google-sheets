# Technical Specification: `get_sheet_schema`

**Feature:** Advanced Sheet Schema Extraction
**Based on:** [PRD v1](./prd.md)
**Parent Spec:** [MCP Google Sheets Technical Spec](../project-basement/technical-spec.md)
**Language:** TypeScript
**Runtime:** Node.js v18+
**Last Updated:** 2026-04-15

---

## 1. Overview

The `get_sheet_schema` tool provides the AI Agent with a structural "map" of a specific Google Sheet tab. It inspects the underlying rules of the spreadsheet — data validation (dropdowns, checkboxes), data types (date, number, currency), formula-protected fields, and instructional notes — so the Agent can format its input correctly and avoid errors before write operations.

This requires:
1. A new method on `SheetsClient` (`getSheetSchema`)
2. A new tool file (`src/tools/get-sheet-schema.ts`)
3. Registration in `src/tools/index.ts` and `src/config.ts`

---

## 2. Files to Create or Modify

| File | Action | Purpose |
| --- | --- | --- |
| `src/sheets-client.ts` | **Modify** | Add `getSheetSchema()` method |
| `src/tools/get-sheet-schema.ts` | **Create** | New tool definition file |
| `src/tools/index.ts` | **Modify** | Import and register the new tool |
| `src/config.ts` | **Modify** | Add `'get_sheet_schema'` to `ALL_TOOL_NAMES` |

---

## 3. SheetsClient Changes (`src/sheets-client.ts`)

### 3.1. New Method: `getSheetSchema`

This method uses `spreadsheets.get()` (NOT `spreadsheets.values.get()`), because cell metadata — dataValidation, notes, numberFormat, formulaValue — is only available through the full spreadsheet resource, not the values-only endpoint.

```typescript
async getSheetSchema(
  sheetName: string,
  headerRow: number,
  dataRow: number,
  spreadsheetId?: string,
): Promise<sheets_v4.Schema$Sheet | undefined> {
  const range = `${quoteSheetName(sheetName)}!${headerRow}:${dataRow}`;
  const res = await this.sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId ?? this.spreadsheetId,
    ranges: [range],
    fields:
      'sheets(data(rowData(values(formattedValue,note,dataValidation,effectiveFormat.numberFormat,userEnteredValue.formulaValue))))',
  });

  return res.data.sheets?.[0];
}
```

### 3.2. Key Design Decisions

**Range format — full-row notation:**

Uses `SheetName!{headerRow}:{dataRow}` (e.g. `Tasks!1:2`) rather than the PRD-suggested `A{headerRow}:Z{dataRow}`. Full-row notation covers ALL columns in the sheet, including those beyond column Z (column 26). Google Sheets supports up to 18,278 columns — using `A:Z` would silently miss any columns past the 26th.

The `fields` mask ensures only the needed metadata is returned. The Google Sheets API omits trailing empty cells from `rowData.values`, so full-row notation does not inflate the payload.

**Optional `spreadsheetId`:**

The method accepts an optional `spreadsheetId` parameter. When omitted, falls back to `this.spreadsheetId` (the `.env` default). This follows the approach noted in the parent spec section 12 ("Future Considerations"): "spreadsheetId is centralized in Config — can be extended to accept overrides per tool call."

**Fields mask:**

```
sheets(data(rowData(values(formattedValue,note,dataValidation,effectiveFormat.numberFormat,userEnteredValue.formulaValue))))
```

Requests exactly the metadata the PRD requires and nothing more. This is critical because `spreadsheets.get()` can return enormous payloads if fields are not restricted.

### 3.3. ONE_OF_RANGE Value Resolution

When data validation uses `ONE_OF_RANGE`, the allowed values live in another range. The existing `getSheetData(range)` method already fetches cell values via `spreadsheets.values.get()` with `UNFORMATTED_VALUE`. We reuse it directly — no new SheetsClient method needed.

### 3.4. Scope & WRITE_TOOLS

`get_sheet_schema` is read-only. It must NOT be added to the `WRITE_TOOLS` array (line 4 of `sheets-client.ts`). The scope resolution logic already handles this: if only read tools are enabled, the `spreadsheets.readonly` scope is selected.

---

## 4. Tool Definition (`src/tools/get-sheet-schema.ts`)

### 4.1. Input Schema

```typescript
import { z } from 'zod';

const inputSchema = z.object({
  sheet_name: z.string().describe('Exact name of the sheet tab to analyze'),
  header_row: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe('1-based row index where headers are located (default: 1)'),
  data_row: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      '1-based row index containing sample data or validation rules (default: header_row + 1)',
    ),
  spreadsheet_id: z
    .string()
    .optional()
    .describe('Target Spreadsheet ID. Falls back to .env default if omitted'),
});
```

> **Note:** `data_row` cannot use `.default()` because its default depends on the runtime value of `header_row`. The handler computes the fallback: `const dataRow = args.data_row ?? args.header_row + 1;`

### 4.2. Tool Config

```typescript
export const getSheetSchema: ToolDefinition = {
  name: 'get_sheet_schema',
  config: {
    title: 'Get Sheet Schema',
    description:
      'Returns the structural schema of a sheet tab: column names, dropdown options, ' +
      'checkboxes, data types (date/number/currency), formula-protected fields, and ' +
      'instructional notes. Use this before write operations to understand column constraints.',
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  handler: async (args, sheetsClient, _config) => { /* see 4.3 */ },
};
```

### 4.3. Handler Logic

```typescript
handler: async (
  args: {
    sheet_name: string;
    header_row: number;
    data_row?: number;
    spreadsheet_id?: string;
  },
  sheetsClient,
  _config,
) => {
  try {
    const headerRow = args.header_row;  // default applied by Zod
    const dataRow = args.data_row ?? headerRow + 1;

    // 1. Validate: dataRow must be >= headerRow
    if (dataRow < headerRow) {
      return {
        content: [{ type: 'text', text: 'Error: data_row must be >= header_row' }],
        isError: true,
      };
    }

    // 2. Fetch sheet metadata via spreadsheets.get()
    const sheet = await sheetsClient.getSheetSchema(
      args.sheet_name,
      headerRow,
      dataRow,
      args.spreadsheet_id,
    );

    const rows = sheet?.data?.[0]?.rowData;
    if (!rows || rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'Error: header_row is empty. Use get_sheet_data to inspect the sheet structure first.',
        }],
        isError: true,
      };
    }

    // 3. Extract header and data row cells
    const headerCells = rows[0]?.values ?? [];
    const dataCells = rows.length > 1
      ? (rows[rows.length - 1]?.values ?? [])
      : [];

    // 4. Check if all headers are empty
    const hasAnyHeader = headerCells.some((c) => c.formattedValue);
    if (!hasAnyHeader) {
      return {
        content: [{
          type: 'text',
          text: 'Error: header_row is empty. Use get_sheet_data to inspect the sheet structure first.',
        }],
        isError: true,
      };
    }

    // 5. Collect ONE_OF_RANGE references that need resolution
    const rangeRefs = new Set<string>();
    for (const cell of [...headerCells, ...dataCells]) {
      const dv = cell.dataValidation;
      if (dv?.condition?.type === 'ONE_OF_RANGE') {
        const ref = dv.condition.values?.[0]?.userEnteredValue;
        if (ref) rangeRefs.add(ref);
      }
    }

    // 6. Batch-resolve all ONE_OF_RANGE references
    const resolvedRanges = new Map<string, string[]>();
    for (const ref of rangeRefs) {
      try {
        const data = await sheetsClient.getSheetData(ref);
        const values = (data.values ?? [])
          .flat()
          .filter((v): v is string | number => v !== null && v !== undefined && v !== '')
          .map(String);
        resolvedRanges.set(ref, values);
      } catch {
        resolvedRanges.set(ref, [`<unresolved: ${ref}>`]);
      }
    }

    // 7. Build the schema object
    const schema: Record<string, ColumnSchema> = {};
    const maxCols = Math.max(headerCells.length, dataCells.length);

    for (let i = 0; i < maxCols; i++) {
      const headerCell = headerCells[i];
      const dataCell = dataCells[i];
      const columnName = headerCell?.formattedValue;
      if (!columnName) continue;  // skip columns with no header

      schema[columnName] = buildColumnSchema(headerCell, dataCell, resolvedRanges);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }],
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

## 5. Type Determination Algorithm

The `buildColumnSchema` function determines column type using the following priority order. **The first match wins:**

```
Priority 1: Data Validation (from dataCell, fallback to headerCell)
  ├── condition.type === 'ONE_OF_LIST'   -->  type: "dropdown"
  ├── condition.type === 'ONE_OF_RANGE'  -->  type: "dropdown"
  └── condition.type === 'BOOLEAN'       -->  type: "checkbox"

Priority 2: Number Format (from dataCell.effectiveFormat.numberFormat)
  ├── numberFormat.type === 'DATE' or 'DATE_TIME'  -->  type: "date"
  ├── numberFormat.type === 'CURRENCY'              -->  type: "currency"
  └── numberFormat.type === 'NUMBER' or 'PERCENT'   -->  type: "number"

Priority 3: Default
  └── type: "text"
```

**Rationale:** Data validation is an explicit constraint set by the sheet author and directly affects what values the Agent can write. Number format is a display hint — a column formatted as DATE still accepts any value unless validation enforces it. Validation therefore takes precedence.

### 5.1. `buildColumnSchema` Implementation

```typescript
interface ColumnSchema {
  type: 'dropdown' | 'checkbox' | 'date' | 'currency' | 'number' | 'text';
  allowed_values?: string[];
  is_formula: boolean;
  note?: string;
}

function buildColumnSchema(
  headerCell: sheets_v4.Schema$CellData | undefined,
  dataCell: sheets_v4.Schema$CellData | undefined,
  resolvedRanges: Map<string, string[]>,
): ColumnSchema {
  // --- Formula detection (from data row) ---
  const isFormula = !!dataCell?.userEnteredValue?.formulaValue;

  // --- Note (from header cell) ---
  const note = headerCell?.note ?? undefined;

  // --- Data validation (prefer data row, fall back to header row) ---
  const dv = dataCell?.dataValidation ?? headerCell?.dataValidation;
  const conditionType = dv?.condition?.type;

  // Priority 1a: ONE_OF_LIST dropdown
  if (conditionType === 'ONE_OF_LIST') {
    const allowedValues = (dv!.condition!.values ?? [])
      .map((v) => v.userEnteredValue ?? '')
      .filter(Boolean);
    return {
      type: 'dropdown',
      allowed_values: allowedValues,
      is_formula: isFormula,
      ...(note && { note }),
    };
  }

  // Priority 1b: ONE_OF_RANGE dropdown (resolved)
  if (conditionType === 'ONE_OF_RANGE') {
    const rangeRef = dv!.condition!.values?.[0]?.userEnteredValue ?? '';
    const allowedValues = resolvedRanges.get(rangeRef) ?? [`<unresolved: ${rangeRef}>`];
    return {
      type: 'dropdown',
      allowed_values: allowedValues,
      is_formula: isFormula,
      ...(note && { note }),
    };
  }

  // Priority 1c: BOOLEAN checkbox
  if (conditionType === 'BOOLEAN') {
    return { type: 'checkbox', is_formula: isFormula, ...(note && { note }) };
  }

  // Priority 2: Number format detection
  const numFmt = dataCell?.effectiveFormat?.numberFormat?.type;

  if (numFmt === 'DATE' || numFmt === 'DATE_TIME') {
    return { type: 'date', is_formula: isFormula, ...(note && { note }) };
  }
  if (numFmt === 'CURRENCY') {
    return { type: 'currency', is_formula: isFormula, ...(note && { note }) };
  }
  if (numFmt === 'NUMBER' || numFmt === 'PERCENT') {
    return { type: 'number', is_formula: isFormula, ...(note && { note }) };
  }

  // Priority 3: Default
  return { type: 'text', is_formula: isFormula, ...(note && { note }) };
}
```

---

## 6. ONE_OF_RANGE Resolution Strategy

When a data validation rule uses `ONE_OF_RANGE` (e.g., dropdown values come from `=Lookups!A1:A50`), the condition stores only the range reference, not the actual values.

### 6.1. Approach: Eager Resolution with Graceful Fallback

1. **Collect:** During the first pass over all cells, collect all unique `ONE_OF_RANGE` reference strings into a `Set<string>`.
2. **Resolve:** After the first pass, iterate the set and call `sheetsClient.getSheetData(ref)` for each unique range. This reuses the existing method — no new SheetsClient method needed.
3. **Store:** Cache resolved values in a `Map<string, string[]>`.
4. **Fallback:** If resolution fails (e.g., referenced sheet was deleted), store a marker: `["<unresolved: SheetName!A1:A50>"]`. This tells the Agent the column is a dropdown but values could not be loaded. The tool does NOT fail.
5. **Use:** During schema construction, look up resolved values from the map.

### 6.2. Deduplication

Multiple columns may reference the same range (e.g., "Assignee" and "Reviewer" both pull from a people list). The `Set` ensures each range is fetched only once.

### 6.3. Rationale

The Agent needs actual allowed values to format inputs correctly. A reference like `=Lookups!A1:A50` is opaque. Resolving upfront is one extra API call per unique range — a small cost for significant usability.

---

## 7. Registration Changes

### 7.1. `src/config.ts`

Add `'get_sheet_schema'` to the `ALL_TOOL_NAMES` tuple:

```typescript
const ALL_TOOL_NAMES = [
  'get_spreadsheet_info',
  'get_sheet_schema',    // <-- NEW
  'create_sheet',
  'rename_sheet',
  'get_sheet_data',
  'add_rows',
  'update_row',
] as const;
```

Placed after `get_spreadsheet_info` — both are read-only metadata tools.

### 7.2. `src/tools/index.ts`

Add the import and include in the `allTools` array:

```typescript
import { getSheetSchema } from './get-sheet-schema.js';

const allTools: ToolDefinition[] = [
  getSpreadsheetInfo,
  getSheetSchema,    // <-- NEW
  createSheet,
  renameSheet,
  getSheetData,
  addRows,
  updateRow,
];
```

No other changes needed. The existing `registerAllTools` function picks it up automatically, and the `TOOLS` filter works because the name was added to `ALL_TOOL_NAMES`.

---

## 8. Response Format

Matches PRD section 5. Properties are conditionally included — `allowed_values` only for dropdowns, `note` only when present — to keep the response compact.

```json
{
  "Developer": {
    "type": "dropdown",
    "allowed_values": ["Hai Dang Hoang", "Hau Nguyen Cong", "Duc Le"],
    "note": "Select the lead dev for this task",
    "is_formula": false
  },
  "Status": {
    "type": "dropdown",
    "allowed_values": ["Open", "In Progress", "Fixed", "Closed"],
    "is_formula": false
  },
  "Is Verified": {
    "type": "checkbox",
    "is_formula": false
  },
  "Due Date": {
    "type": "date",
    "is_formula": false
  },
  "Subtotal": {
    "type": "number",
    "is_formula": true,
    "note": "Automatically calculated, do not edit"
  },
  "Description": {
    "type": "text",
    "is_formula": false
  }
}
```

---

## 9. Error Handling

Follows the established handler pattern (try/catch returning `{ isError: true }`):

| Case | Detection | Response |
| --- | --- | --- |
| **Sheet not found** | Google API throws (HTTP 400 or "Unable to parse range") | `Error: ${message}` — Google's error message is descriptive |
| **Empty header row** | All cells in `rows[0]` have no `formattedValue` | `Error: header_row is empty. Use get_sheet_data to inspect the sheet structure first.` |
| **`data_row` < `header_row`** | Pre-flight validation | `Error: data_row must be >= header_row` |
| **`header_row` == `data_row`** | Legal — schema from headers alone | `dataCells` is empty; all columns get `is_formula: false`, type from header cell validation/format only |
| **Permission denied (403)** | Google API throws with 403 | `Error: ${message}` — passes through Google's "The caller does not have permission" message |
| **ONE_OF_RANGE resolution fails** | try/catch around `getSheetData` for the referenced range | Stores `["<unresolved: range>"]` as `allowed_values`; does not fail the tool |
| **Columns beyond Z** | Full-row range notation covers all columns | No special handling needed |
| **Gaps in headers** | Column has no `formattedValue` | Skipped in the output |
| **Duplicate header names** | Two columns share the same header text | Later column overwrites earlier in the output. Acceptable — duplicate headers are a data quality issue on the sheet side |
| **Very wide sheets** | Full-row notation + fields mask | API omits columns without content/formatting automatically |
| **`spreadsheet_id` override** | User passes a different spreadsheet ID | Passed through to `getSheetSchema()`. Auth must be valid for the target spreadsheet |

---

## 10. Data Flow

```
┌────────────┐                     ┌──────────────────────────────────────┐
│  AI Agent   │  get_sheet_schema   │  MCP Server                         │
│  (Claude)   │ ──────────────────► │                                      │
└────────────┘                     │  1. Validate inputs                   │
                                    │  2. sheetsClient.getSheetSchema()     │
                                    │     └─ spreadsheets.get() ──────────────► Google Sheets API
                                    │        (fields mask, full-row range)  │       │
                                    │        ◄──────────────────────────────────────┘
                                    │  3. Collect ONE_OF_RANGE refs         │
                                    │  4. sheetsClient.getSheetData(ref)    │
                                    │     └─ values.get() ────────────────────► Google Sheets API
                                    │        (per unique range)             │       │
                                    │        ◄──────────────────────────────────────┘
                                    │  5. Build schema (type priority)      │
                                    │  6. Return JSON                       │
┌────────────┐                     │                                      │
│  AI Agent   │ ◄────────────────── │                                      │
│  (Claude)   │   { schema JSON }   └──────────────────────────────────────┘
└────────────┘
```

---

## 11. Verification Checklist

- [ ] `npm run build` compiles with zero errors
- [ ] Tool appears in MCP tool list when server starts
- [ ] Basic schema: sheet with text headers returns all columns with `type: "text"`
- [ ] Dropdown (`ONE_OF_LIST`): returns `type: "dropdown"` with correct `allowed_values`
- [ ] Dropdown (`ONE_OF_RANGE`): resolves values from the referenced range
- [ ] `ONE_OF_RANGE` failure: referenced range deleted — returns `["<unresolved: ...>"]`, tool does not fail
- [ ] Checkbox: returns `type: "checkbox"`
- [ ] Date format: returns `type: "date"`
- [ ] Currency format: returns `type: "currency"`
- [ ] Number format: returns `type: "number"`
- [ ] Formula detection: cell with formula in `data_row` returns `is_formula: true`
- [ ] Notes: header cell with note returns `note` field
- [ ] Custom `header_row`: `header_row: 3` reads row 3 as headers, row 4 as data
- [ ] Custom `data_row`: `header_row: 3, data_row: 5` reads row 3 and row 5
- [ ] Empty header row: returns descriptive error message
- [ ] Missing sheet: returns Google API error message
- [ ] `spreadsheet_id` override: passing a different spreadsheet ID works
- [ ] `TOOLS` filter: `TOOLS=get_sheet_schema` registers only this tool
- [ ] Wide sheet (>26 columns): columns beyond Z are included
- [ ] Columns with gaps (empty headers): skipped cleanly
