import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import { CellValue, sanitizeCell } from './sanitize.js';

export const updateRow: ToolDefinition = {
  name: 'update_row',
  config: {
    title: 'Update Row',
    description: 'Overwrites a single row in a sheet tab by 1-based row index.',
    inputSchema: z.object({
      sheet_name: z.string().describe('Target sheet tab name'),
      row_index: z.number().int().min(1).describe('1-based row number in the sheet'),
      values: z.array(CellValue).min(1).describe('1D array of values for the row'),
    }),
  },
  handler: async (args: { sheet_name: string; row_index: number; values: Array<string | number | boolean | null> }, sheetsClient) => {
    try {
      const sanitizedValues = args.values.map(sanitizeCell);
      const data = await sheetsClient.updateRow(args.sheet_name, args.row_index, sanitizedValues);

      const result = {
        success: true,
        updatedRange: data.updatedRange,
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
