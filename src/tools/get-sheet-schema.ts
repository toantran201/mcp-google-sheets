import { z } from "zod";
import type { sheets_v4 } from "googleapis";
import type { ToolDefinition } from "./types.js";

interface ColumnSchema {
  type: "dropdown" | "checkbox" | "date" | "currency" | "number" | "text";
  allowed_values?: string[];
  is_formula: boolean;
  note?: string;
}

const inputSchema = z.object({
  sheet_name: z.string().describe("Exact name of the sheet tab to analyze"),
  header_row: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe("1-based row index where headers are located (default: 1)"),
  data_row: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "1-based row index containing sample data or validation rules (default: header_row + 1)",
    ),
  spreadsheet_id: z
    .string()
    .optional()
    .describe("Target Spreadsheet ID. Falls back to .env default if omitted"),
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

  // Priority 1a: ONE_OF_LIST dropdown
  if (conditionType === "ONE_OF_LIST") {
    const allowedValues = (dv!.condition!.values ?? [])
      .map((v) => v.userEnteredValue ?? "")
      .filter(Boolean);
    return {
      type: "dropdown",
      allowed_values: allowedValues,
      is_formula: isFormula,
      ...(note && { note }),
    };
  }

  // Priority 1b: ONE_OF_RANGE dropdown (resolved)
  if (conditionType === "ONE_OF_RANGE") {
    const rangeRef = dv!.condition!.values?.[0]?.userEnteredValue ?? "";
    const allowedValues = resolvedRanges.get(rangeRef) ?? [
      `<unresolved: ${rangeRef}>`,
    ];
    return {
      type: "dropdown",
      allowed_values: allowedValues,
      is_formula: isFormula,
      ...(note && { note }),
    };
  }

  // Priority 1c: BOOLEAN checkbox
  if (conditionType === "BOOLEAN") {
    return { type: "checkbox", is_formula: isFormula, ...(note && { note }) };
  }

  // Priority 2: Number format detection
  const numFmt = dataCell?.effectiveFormat?.numberFormat?.type;

  if (numFmt === "DATE" || numFmt === "DATE_TIME") {
    return { type: "date", is_formula: isFormula, ...(note && { note }) };
  }
  if (numFmt === "CURRENCY") {
    return { type: "currency", is_formula: isFormula, ...(note && { note }) };
  }
  if (numFmt === "NUMBER" || numFmt === "PERCENT") {
    return { type: "number", is_formula: isFormula, ...(note && { note }) };
  }

  // Priority 3: Default
  return { type: "text", is_formula: isFormula, ...(note && { note }) };
}

export const getSheetSchema: ToolDefinition = {
  name: "get_sheet_schema",
  config: {
    title: "Get Sheet Schema",
    description:
      "Returns the structural schema of a sheet tab: column names, dropdown options, " +
      "checkboxes, data types (date/number/currency), formula-protected fields, and " +
      "instructional notes. Use this before write operations to understand column constraints.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
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
      const headerRow = args.header_row; // default applied by Zod
      const dataRow = args.data_row ?? headerRow + 1;

      // 1. Validate: dataRow must be >= headerRow
      if (dataRow < headerRow) {
        return {
          content: [
            { type: "text", text: "Error: data_row must be >= header_row" },
          ],
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
          content: [
            {
              type: "text",
              text: "Error: header_row is empty. Use get_sheet_data to inspect the sheet structure first.",
            },
          ],
          isError: true,
        };
      }

      // 3. Extract header and data row cells
      const headerCells = rows[0]?.values ?? [];
      const dataCells =
        rows.length > 1 ? (rows[rows.length - 1]?.values ?? []) : [];

      // 4. Check if all headers are empty
      const hasAnyHeader = headerCells.some((c) => c.formattedValue);
      if (!hasAnyHeader) {
        return {
          content: [
            {
              type: "text",
              text: "Error: header_row is empty. Use get_sheet_data to inspect the sheet structure first.",
            },
          ],
          isError: true,
        };
      }

      // 5. Collect ONE_OF_RANGE references that need resolution
      const rangeRefs = new Set<string>();
      for (const cell of [...headerCells, ...dataCells]) {
        const dv = cell.dataValidation;
        if (dv?.condition?.type === "ONE_OF_RANGE") {
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
            .filter(
              (v): v is string | number =>
                v !== null && v !== undefined && v !== "",
            )
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

        schema[columnName] = buildColumnSchema(
          headerCell,
          dataCell,
          resolvedRanges,
        );
      }

      return {
        content: [{ type: "text", text: JSON.stringify(schema, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
};
