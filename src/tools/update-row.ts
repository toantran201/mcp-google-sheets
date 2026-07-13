import { z } from 'zod';
import { defineTool } from './shared/types.js';
import { CellValue, sanitizeCell } from './shared/sanitize.js';
import { toErrorResult, toJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

export const updateRow = defineTool({
  name: 'update_row',
  config: {
    title: 'Update Row',
    description:
      'Overwrites cells in a single row, left to right, starting at `start_column` (default ' +
      'column A). Only the cells covered by `values` are written — cells outside that span are ' +
      'left untouched, so you can update specific columns without rewriting the whole row.',
    inputSchema: z.object({
      spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
      sheet_name: z.string().describe('Target sheet tab name'),
      row_index: z.number().int().min(1).describe('1-based row number in the sheet'),
      start_column: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe('1-based column to start writing at (e.g. 3 = column C). Default 1 (column A)'),
      values: z
        .array(CellValue)
        .min(1)
        .max(256)
        .describe('1D array of values written left-to-right starting at `start_column`'),
    }),
  },
  handler: async (args, sheetsClient) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);
      const sanitizedValues = args.values.map(sanitizeCell);
      const data = await sheetsClient.updateRow(
        spreadsheetId,
        args.sheet_name,
        args.row_index,
        sanitizedValues,
        args.start_column,
      );

      return toJsonResult({
        success: true,
        updatedRange: data.updatedRange,
        updatedCells: data.updatedCells,
      });
    } catch (error) {
      return toErrorResult(error);
    }
  },
});
