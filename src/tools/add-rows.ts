import { z } from 'zod';
import type { ToolDefinition } from './shared/types.js';
import { CellValue, sanitizeCell } from './shared/sanitize.js';
import { toErrorResult, toJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

export const addRows: ToolDefinition = {
  name: 'add_rows',
  config: {
    title: 'Add Rows',
    description: 'Appends rows to the bottom of a sheet tab.',
    inputSchema: z.object({
      spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
      sheet_name: z.string().describe('Target sheet tab name'),
      values: z
        .array(z.array(CellValue).max(256))
        .min(1)
        .max(1000)
        .describe('2D array of rows to append'),
    }),
  },
  handler: async (
    args: {
      spreadsheet: string;
      sheet_name: string;
      values: Array<Array<string | number | boolean | null>>;
    },
    sheetsClient,
    config,
  ) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);
      const sanitizedValues = args.values.map((row) => row.map(sanitizeCell));

      // When stamping an audit column, pad every row to the same width first so the
      // userName always lands in the same column even if input rows differ in length.
      let processedValues = sanitizedValues;
      if (config.userName) {
        const width = Math.max(...sanitizedValues.map((row) => row.length));
        const userName = sanitizeCell(config.userName);
        processedValues = sanitizedValues.map((row) => {
          const padded = [...row];
          while (padded.length < width) padded.push(null);
          padded.push(userName);
          return padded;
        });
      }

      const updates = await sheetsClient.addRows(spreadsheetId, args.sheet_name, processedValues);

      return toJsonResult({
        success: true,
        updatedRange: updates?.updatedRange,
        updatedRows: updates?.updatedRows,
      });
    } catch (error) {
      return toErrorResult(error);
    }
  },
};
