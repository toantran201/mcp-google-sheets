import { z } from 'zod';
import { defineTool } from './shared/types.js';
import { CellValue } from './shared/sanitize.js';
import { toErrorResult, toJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

export const updateRow = defineTool({
  name: 'update_row',
  config: {
    title: 'Update Row',
    description:
      'Overwrites cells in a single row, left to right, starting at `start_column` (default ' +
      'column A). Only the cells covered by `values` are written — cells outside that span are ' +
      'left untouched, so you can update specific columns without rewriting the whole row. ' +
      'To write a Smart Chip (e.g. a person/dropdown column backed by People chips), pass an ' +
      'object instead of a string: `{ "chip": { "person": "user@example.com" } }` for a person ' +
      'chip, or `{ "chip": { "driveFile": "https://drive.google.com/…" } }` for a Drive-file chip. ' +
      'Call get_sheet_schema first — columns typed `person_chip`/`link_chip` require this form, and ' +
      'plain text there fails dropdown validation. ' +
      'To write a hyperlink (text that opens a URL), pass ' +
      '`{ "richText": [{ "text": "DRM-5313", "url": "https://…" }] }`; for several links in one ' +
      'cell add more segments, with url-less segments as the plain text between them, e.g. ' +
      '`[{ "text": "PR", "url": "…" }, { "text": ", " }, { "text": "PR", "url": "…" }]`.',
    inputSchema: z.object({
      spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
      sheet_name: z.string().describe('Target sheet tab name'),
      row_index: z.number().int().min(1).describe('1-based row number in the sheet'),
      start_column: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe('1-based column to start writing at (e.g. 3 = column C). Default 1 (column A)'),
      values: z
        .array(CellValue)
        .min(1)
        .max(256)
        .describe(
          'Values written left-to-right starting at `start_column`. Each element is a scalar ' +
            '(string/number/boolean/null), a Smart Chip object `{ chip: { person } | { driveFile } }`, ' +
            'or a hyperlink object `{ richText: [{ text, url? }] }`.',
        ),
    }),
  },
  handler: async (args, sheetsClient) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);
      const data = await sheetsClient.updateRow(
        spreadsheetId,
        args.sheet_name,
        args.row_index,
        args.values,
        args.start_column,
      );

      return toJsonResult({
        success: true,
        updatedRange: data.updatedRange,
        updatedCells: data.updatedCells,
      });
    } catch (error) {
      return toErrorResult(error);
    }
  },
});
