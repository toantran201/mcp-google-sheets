import { z } from 'zod';
import type { sheets_v4 } from 'googleapis';
import type { ToolDefinition } from './shared/types.js';
import { toErrorResult, toUntrustedJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

interface ColumnSchema {
  type: 'dropdown' | 'checkbox' | 'date' | 'currency' | 'number' | 'text';
  allowed_values?: string[];
  constraint?: string;
  input_message?: string;
  is_formula: boolean;
  note?: string;
}

/**
 * Turns a data-validation BooleanCondition into a short human-readable
 * constraint string (e.g. "> 0", "between 1 and 10", "valid email").
 * Returns undefined when the condition carries no useful description.
 */
function describeCondition(
  condition: sheets_v4.Schema$BooleanCondition | undefined,
): string | undefined {
  const type = condition?.type ?? '';
  const vals = (condition?.values ?? []).map((v) => v.userEnteredValue ?? '').filter(Boolean);
  const [v0, v1] = vals;
  switch (type) {
    case 'NUMBER_GREATER':
      return `> ${v0}`;
    case 'NUMBER_GREATER_THAN_EQ':
      return `>= ${v0}`;
    case 'NUMBER_LESS':
      return `< ${v0}`;
    case 'NUMBER_LESS_THAN_EQ':
      return `<= ${v0}`;
    case 'NUMBER_EQ':
      return `= ${v0}`;
    case 'NUMBER_NOT_EQ':
      return `!= ${v0}`;
    case 'NUMBER_BETWEEN':
      return `between ${v0} and ${v1}`;
    case 'NUMBER_NOT_BETWEEN':
      return `not between ${v0} and ${v1}`;
    case 'DATE_BEFORE':
      return `before ${v0}`;
    case 'DATE_AFTER':
      return `after ${v0}`;
    case 'DATE_ON_OR_BEFORE':
      return `on or before ${v0}`;
    case 'DATE_ON_OR_AFTER':
      return `on or after ${v0}`;
    case 'DATE_BETWEEN':
      return `between ${v0} and ${v1}`;
    case 'DATE_NOT_BETWEEN':
      return `not between ${v0} and ${v1}`;
    case 'DATE_EQ':
      return `= ${v0}`;
    case 'DATE_IS_VALID':
      return 'valid date';
    case 'TEXT_CONTAINS':
      return `contains "${v0}"`;
    case 'TEXT_NOT_CONTAINS':
      return `does not contain "${v0}"`;
    case 'TEXT_STARTS_WITH':
      return `starts with "${v0}"`;
    case 'TEXT_ENDS_WITH':
      return `ends with "${v0}"`;
    case 'TEXT_EQ':
      return `= "${v0}"`;
    case 'TEXT_IS_EMAIL':
      return 'valid email';
    case 'TEXT_IS_URL':
      return 'valid URL';
    default:
      return undefined;
  }
}

const inputSchema = z.object({
  spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
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
});

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

  // Fields shared by every validation-derived branch: the human-facing input
  // message ("Chỉ nhập số") and the header note.
  const inputMessage = dv?.inputMessage ?? undefined;
  const dvExtras = {
    ...(inputMessage && { input_message: inputMessage }),
    ...(note && { note }),
  };

  // Priority 1a: ONE_OF_LIST dropdown
  if (conditionType === 'ONE_OF_LIST') {
    const allowedValues = (dv!.condition!.values ?? [])
      .map((v) => v.userEnteredValue ?? '')
      .filter(Boolean);
    return {
      type: 'dropdown',
      allowed_values: allowedValues,
      is_formula: isFormula,
      ...dvExtras,
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
      ...dvExtras,
    };
  }

  // Priority 1c: BOOLEAN checkbox
  if (conditionType === 'BOOLEAN') {
    return { type: 'checkbox', is_formula: isFormula, ...dvExtras };
  }

  // Priority 1d: NUMBER_* validation (e.g. "only allow numbers", ">= 0")
  if (conditionType?.startsWith('NUMBER_')) {
    const constraint = describeCondition(dv!.condition!);
    return {
      type: 'number',
      is_formula: isFormula,
      ...(constraint && { constraint }),
      ...dvExtras,
    };
  }

  // Priority 1e: DATE_* validation
  if (conditionType?.startsWith('DATE_')) {
    const constraint = describeCondition(dv!.condition!);
    return {
      type: 'date',
      is_formula: isFormula,
      ...(constraint && { constraint }),
      ...dvExtras,
    };
  }

  // Priority 1f: TEXT_* validation (stays text, but surface the constraint)
  if (conditionType?.startsWith('TEXT_')) {
    const constraint = describeCondition(dv!.condition!);
    return {
      type: 'text',
      is_formula: isFormula,
      ...(constraint && { constraint }),
      ...dvExtras,
    };
  }

  // Priority 1g: CUSTOM_FORMULA validation. Sheets implements "only allow
  // numbers"/"only allow dates" as a custom formula (e.g. =ISNUMBER(C2)),
  // so infer the type from the formula; otherwise keep text and surface it.
  if (conditionType === 'CUSTOM_FORMULA') {
    const formula = dv!.condition!.values?.[0]?.userEnteredValue ?? '';
    const inferredType = /\bISNUMBER\s*\(/i.test(formula)
      ? 'number'
      : /\bISDATE\s*\(/i.test(formula)
        ? 'date'
        : 'text';
    return {
      type: inferredType,
      is_formula: isFormula,
      ...(formula && { constraint: `custom formula: ${formula}` }),
      ...dvExtras,
    };
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
  handler: async (
    args: {
      spreadsheet: string;
      sheet_name: string;
      header_row: number;
      data_row?: number;
    },
    sheetsClient,
    _config,
  ) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);
      const headerRow = args.header_row; // default applied by Zod
      const dataRow = args.data_row ?? headerRow + 1;

      // 1. Validate: dataRow must be >= headerRow
      if (dataRow < headerRow) {
        return toErrorResult(new Error('data_row must be >= header_row'));
      }

      // 2. Fetch sheet metadata via spreadsheets.get()
      const sheet = await sheetsClient.getSheetSchema(
        spreadsheetId,
        args.sheet_name,
        headerRow,
        dataRow,
      );

      const rows = sheet?.data?.[0]?.rowData;
      if (!rows || rows.length === 0) {
        return toErrorResult(
          new Error(
            'header_row is empty. Use get_sheet_data to inspect the sheet structure first.',
          ),
        );
      }

      // 3. Extract header and data row cells
      const headerCells = rows[0]?.values ?? [];
      const dataCells = rows.length > 1 ? (rows[rows.length - 1]?.values ?? []) : [];

      // 4. Check if all headers are empty
      const hasAnyHeader = headerCells.some((c) => c.formattedValue);
      if (!hasAnyHeader) {
        return toErrorResult(
          new Error(
            'header_row is empty. Use get_sheet_data to inspect the sheet structure first.',
          ),
        );
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
          const data = await sheetsClient.getSheetData(spreadsheetId, ref);
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
        if (!columnName) continue; // skip columns with no header

        schema[columnName] = buildColumnSchema(headerCell, dataCell, resolvedRanges);
      }

      return toUntrustedJsonResult(schema);
    } catch (error) {
      return toErrorResult(error);
    }
  },
};
