import { z } from 'zod';
import type { ToolDefinition } from './shared/types.js';
import { toErrorResult, toJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

export const addColumns: ToolDefinition = {
  name: 'add_columns',
  config: {
    title: 'Add Columns',
    description:
      'Inserts empty columns into a sheet tab at a position, or appends them at the right edge.',
    inputSchema: z.object({
      spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
      sheet_name: z.string().describe('Target sheet tab name'),
      count: z.number().int().min(1).max(100).describe('Number of empty columns to insert'),
      start_column: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          '1-based column index to insert BEFORE (e.g. 3 inserts before column C). ' +
            'Omit to append at the right edge of the sheet',
        ),
    }),
  },
  handler: async (
    args: { spreadsheet: string; sheet_name: string; count: number; start_column?: number },
    sheetsClient,
  ) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);
      const startIndex = args.start_column === undefined ? undefined : args.start_column - 1;

      const { sheetId, previousColumnCount } = await sheetsClient.addColumns(
        spreadsheetId,
        args.sheet_name,
        args.count,
        startIndex,
      );

      return toJsonResult({
        success: true,
        sheetId,
        count: args.count,
        position: args.start_column ?? 'end',
        newColumnCount: previousColumnCount === null ? undefined : previousColumnCount + args.count,
      });
    } catch (error) {
      return toErrorResult(error);
    }
  },
};
