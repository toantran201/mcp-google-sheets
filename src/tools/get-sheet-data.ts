import { z } from 'zod';
import type { ToolDefinition } from './types.js';

export const getSheetData: ToolDefinition = {
  name: 'get_sheet_data',
  config: {
    title: 'Get Sheet Data',
    description: "Reads cell values from a range in A1 notation (e.g. 'Sheet1!A1:D10' or 'Sheet1' for the entire tab).",
    inputSchema: z.object({
      range: z.string().describe("A1 notation range, e.g. 'Sheet1!A1:D10' or 'Sheet1' for the entire tab"),
    }),
    annotations: {
      readOnlyHint: true,
    },
  },
  handler: async (args: { range: string }, sheetsClient) => {
    try {
      const data = await sheetsClient.getSheetData(args.range);

      const result = {
        range: data.range,
        values: data.values ?? [],
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
