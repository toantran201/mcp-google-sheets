import { z } from 'zod';
import type { ToolDefinition } from './types.js';

export const addRows: ToolDefinition = {
  name: 'add_rows',
  config: {
    title: 'Add Rows',
    description: 'Appends rows to the bottom of a sheet tab.',
    inputSchema: z.object({
      sheet_name: z.string().describe('Target sheet tab name'),
      values: z.array(z.array(z.any())).describe('2D array of rows to append'),
    }),
  },
  handler: async (args: { sheet_name: string; values: unknown[][] }, sheetsClient, config) => {
    try {
      if (args.values.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: values array must not be empty' }],
          isError: true,
        };
      }

      const processedValues = config.userName
        ? args.values.map((row) => [...row, config.userName])
        : args.values;

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
