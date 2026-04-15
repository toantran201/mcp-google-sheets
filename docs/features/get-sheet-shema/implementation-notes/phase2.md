# Phase 2: Create Tool Definition File

**Status:** Complete
**File created:** `src/tools/get-sheet-schema.ts`

---

## What Was Done

Created the full `get_sheet_schema` tool definition file following the technical spec. The file contains:

### 1. Zod Input Schema

```typescript
z.object({
  sheet_name: z.string(),
  header_row: z.number().int().min(1).optional().default(1),
  data_row: z.number().int().min(1).optional(), // computed default in handler
  spreadsheet_id: z.string().optional(),
});
```

- `header_row` defaults to `1` via Zod `.default()`
- `data_row` cannot use `.default()` because it depends on `header_row` at runtime — handler computes: `args.data_row ?? headerRow + 1`

### 2. `ColumnSchema` Interface

```typescript
interface ColumnSchema {
  type: "dropdown" | "checkbox" | "date" | "currency" | "number" | "text";
  allowed_values?: string[]; // only for dropdowns
  is_formula: boolean;
  note?: string; // only when header cell has a note
}
```

Properties are conditionally included to keep responses compact.

### 3. `buildColumnSchema` Function

Determines column type using priority order (first match wins):

| Priority | Condition                          | Result                               |
| -------- | ---------------------------------- | ------------------------------------ |
| 1a       | `ONE_OF_LIST` validation           | `type: "dropdown"` + inline values   |
| 1b       | `ONE_OF_RANGE` validation          | `type: "dropdown"` + resolved values |
| 1c       | `BOOLEAN` validation               | `type: "checkbox"`                   |
| 2a       | `DATE` / `DATE_TIME` number format | `type: "date"`                       |
| 2b       | `CURRENCY` number format           | `type: "currency"`                   |
| 2c       | `NUMBER` / `PERCENT` number format | `type: "number"`                     |
| 3        | Default                            | `type: "text"`                       |

Data validation is checked on the **data cell first**, falling back to the **header cell**. Formula detection comes from `dataCell.userEnteredValue.formulaValue`. Notes come from `headerCell.note`.

### 4. Handler Logic

1. Compute `dataRow` fallback
2. Validate `dataRow >= headerRow`
3. Call `sheetsClient.getSheetSchema()`
4. Check for empty rows / empty headers
5. Collect unique `ONE_OF_RANGE` references into a `Set`
6. Batch-resolve all references via `sheetsClient.getSheetData()` with graceful fallback (`<unresolved: ...>`)
7. Build schema object, skipping columns with no header
8. Return JSON; errors return `{ isError: true }`

### 5. Tool Config

- `name: 'get_sheet_schema'`
- `readOnlyHint: true`
- Description explains the tool's purpose for the AI Agent

---

## Verification Checklist

- [x] `npm run build` compiles with zero errors
- [x] No TypeScript errors in the file
- [x] File exports a valid `ToolDefinition` with `name`, `config`, and `handler`
- [x] Input schema: `sheet_name` required, `header_row` defaults to 1, `data_row` optional, `spreadsheet_id` optional
- [x] `header_row` has `.int().min(1)` validation
- [x] `data_row` has `.int().min(1)` validation (no `.default()` — computed in handler)
- [x] `readOnlyHint: true` annotation set
- [x] `buildColumnSchema` follows the type priority algorithm from the spec
- [x] `ONE_OF_RANGE` resolution uses `Set` for deduplication
- [x] `ONE_OF_RANGE` failure produces `["<unresolved: ...>"]` marker instead of throwing
- [x] Handler validates `data_row >= header_row` before API call
- [x] Empty header row returns `{ isError: true }` with descriptive message
- [x] All errors caught and returned as `{ isError: true }` — handler never throws

---

## Note

The tool file is created but **not yet registered**. It won't appear in the MCP server tool list until Phase 3 wires it into `src/tools/index.ts` and `src/config.ts`.
