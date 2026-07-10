import { z } from 'zod';
import type { ToolDefinition } from './shared/types.js';
import { toErrorResult, toJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

export const renameSheet: ToolDefinition = {
  name: 'rename_sheet',
  config: {
    title: 'Rename Sheet',
    description: 'Renames a sheet tab. Identify the sheet by sheet_id or old_title.',
    inputSchema: z
      .object({
        spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
        sheet_id: z.number().int().min(0).optional().describe('Numeric sheet ID'),
        old_title: z
          .string()
          .optional()
          .describe('Current sheet title (used if sheet_id is not provided)'),
        new_title: z.string().min(1).max(100).describe('New name for the sheet tab'),
      })
      .refine((data) => data.sheet_id !== undefined || data.old_title !== undefined, {
        message: 'Either sheet_id or old_title must be provided',
      }),
  },
  handler: async (
    args: { spreadsheet: string; sheet_id?: number; old_title?: string; new_title: string },
    sheetsClient,
  ) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);
      const identifier =
        args.sheet_id !== undefined ? { sheetId: args.sheet_id } : { oldTitle: args.old_title! };

      const sheetId = await sheetsClient.renameSheet(spreadsheetId, identifier, args.new_title);

      return toJsonResult({
        success: true,
        sheetId,
        newTitle: args.new_title,
      });
    } catch (error) {
      return toErrorResult(error);
    }
  },
};
