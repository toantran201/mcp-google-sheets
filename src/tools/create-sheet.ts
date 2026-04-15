import { z } from 'zod';
import type { ToolDefinition } from './types.js';

export const createSheet: ToolDefinition = {
  name: 'create_sheet',
  config: {
    title: 'Create Sheet',
    description: 'Creates a new sheet tab in the spreadsheet.',
    inputSchema: z.object({
      title: z.string().describe('Name for the new sheet tab'),
    }),
  },
  handler: async (args: { title: string }, sheetsClient) => {
    try {
      const properties = await sheetsClient.createSheet(args.title);

      const result = {
        success: true,
        sheetId: properties?.sheetId,
        title: properties?.title,
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
