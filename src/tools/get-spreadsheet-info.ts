import { z } from 'zod';
import type { ToolDefinition } from './types.js';

export const getSpreadsheetInfo: ToolDefinition = {
  name: 'get_spreadsheet_info',
  config: {
    title: 'Get Spreadsheet Info',
    description: 'Returns metadata about the spreadsheet: title, sheet names, IDs, and dimensions.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
    },
  },
  handler: async (_args, sheetsClient) => {
    try {
      const data = await sheetsClient.getSpreadsheetInfo();

      const result = {
        title: data.properties?.title,
        sheets: data.sheets?.map((s) => ({
          sheetId: s.properties?.sheetId,
          title: s.properties?.title,
          rowCount: s.properties?.gridProperties?.rowCount,
          columnCount: s.properties?.gridProperties?.columnCount,
        })),
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
