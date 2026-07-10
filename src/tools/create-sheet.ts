import { z } from 'zod';
import type { ToolDefinition } from './shared/types.js';
import { toErrorResult, toJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

export const createSheet: ToolDefinition = {
  name: 'create_sheet',
  config: {
    title: 'Create Sheet',
    description: 'Creates a new sheet tab in the spreadsheet.',
    inputSchema: z.object({
      spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
      title: z.string().min(1).max(100).describe('Name for the new sheet tab'),
    }),
  },
  handler: async (args: { spreadsheet: string; title: string }, sheetsClient) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);
      const properties = await sheetsClient.createSheet(spreadsheetId, args.title);

      return toJsonResult({
        success: true,
        sheetId: properties?.sheetId,
        title: properties?.title,
      });
    } catch (error) {
      return toErrorResult(error);
    }
  },
};
