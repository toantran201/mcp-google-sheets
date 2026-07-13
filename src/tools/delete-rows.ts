import { z } from 'zod';
import { defineTool } from './shared/types.js';
import { toErrorResult, toJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

export const deleteRows = defineTool({
  name: 'delete_rows',
  config: {
    title: 'Delete Rows',
    description:
      'Permanently deletes a contiguous block of rows from a sheet tab, shifting the rows ' +
      'below upward. Deletes `count` rows (default 1) starting at the 1-based `start_row`. ' +
      'Destructive — cannot be undone via the API.',
    inputSchema: z.object({
      spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
      sheet_name: z.string().describe('Target sheet tab name'),
      start_row: z.number().int().min(1).describe('1-based index of the first row to delete'),
      count: z
        .number()
        .int()
        .min(1)
        .max(10000)
        .default(1)
        .describe('Number of consecutive rows to delete, starting at start_row (default 1)'),
    }),
  },
  handler: async (args, sheetsClient) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);
      const { sheetId, deletedCount, remainingRowCount } = await sheetsClient.deleteRows(
        spreadsheetId,
        args.sheet_name,
        args.start_row,
        args.count,
      );
      return toJsonResult({
        success: true,
        sheetId,
        deletedCount,
        startRow: args.start_row,
        remainingRowCount,
      });
    } catch (error) {
      return toErrorResult(error);
    }
  },
});
