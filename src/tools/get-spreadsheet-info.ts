import { z } from 'zod';
import type { ToolDefinition } from './shared/types.js';
import { toErrorResult, toUntrustedJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

export const getSpreadsheetInfo: ToolDefinition = {
  name: 'get_spreadsheet_info',
  config: {
    title: 'Get Spreadsheet Info',
    description: 'Returns metadata about a spreadsheet: title, sheet names, IDs, and dimensions.',
    inputSchema: z.object({
      spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
    }),
    annotations: {
      readOnlyHint: true,
    },
  },
  handler: async (args: { spreadsheet: string }, sheetsClient) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);
      const data = await sheetsClient.getSpreadsheetInfo(spreadsheetId);

      return toUntrustedJsonResult({
        title: data.properties?.title,
        sheets: data.sheets?.map((s) => ({
          sheetId: s.properties?.sheetId,
          title: s.properties?.title,
          rowCount: s.properties?.gridProperties?.rowCount,
          columnCount: s.properties?.gridProperties?.columnCount,
        })),
      });
    } catch (error) {
      return toErrorResult(error);
    }
  },
};
