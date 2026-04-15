import { z } from 'zod';
import type { ToolDefinition } from './types.js';

export const renameSheet: ToolDefinition = {
  name: 'rename_sheet',
  config: {
    title: 'Rename Sheet',
    description: 'Renames a sheet tab. Identify the sheet by sheet_id or old_title.',
    inputSchema: z.object({
      sheet_id: z.number().optional().describe('Numeric sheet ID'),
      old_title: z.string().optional().describe('Current sheet title (used if sheet_id is not provided)'),
      new_title: z.string().describe('New name for the sheet tab'),
    }).refine(
      (data) => data.sheet_id !== undefined || data.old_title !== undefined,
      { message: 'Either sheet_id or old_title must be provided' },
    ),
  },
  handler: async (args: { sheet_id?: number; old_title?: string; new_title: string }, sheetsClient) => {
    try {
      const identifier = args.sheet_id !== undefined
        ? { sheetId: args.sheet_id }
        : { oldTitle: args.old_title! };

      await sheetsClient.renameSheet(identifier, args.new_title);

      const result = {
        success: true,
        sheetId: args.sheet_id ?? null,
        newTitle: args.new_title,
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
