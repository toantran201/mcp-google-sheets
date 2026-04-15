import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import { CellValue, sanitizeCell } from './sanitize.js';

export const addRows: ToolDefinition = {
  name: 'add_rows',
  config: {
    title: 'Add Rows',
    description: 'Appends rows to the bottom of a sheet tab.',
    inputSchema: z.object({
      sheet_name: z.string().describe('Target sheet tab name'),
      values: z.array(z.array(CellValue)).min(1).describe('2D array of rows to append'),
    }),
  },
  handler: async (
    args: { sheet_name: string; values: Array<Array<string | number | boolean | null>> },
    sheetsClient,
    config,
  ) => {
    try {
      const sanitizedValues = args.values.map((row) => row.map(sanitizeCell));

      const processedValues = config.userName
        ? sanitizedValues.map((row) => [...row, config.userName])
        : sanitizedValues;

      const updates = await sheetsClient.addRows(args.sheet_name, processedValues);

      const result = {
        success: true,
        updatedRange: updates?.updatedRange,
        updatedRows: updates?.updatedRows,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
};
