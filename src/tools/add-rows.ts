import { z } from 'zod';
import { defineTool } from './shared/types.js';
import { CellValue } from './shared/sanitize.js';
import { toErrorResult, toJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

export const addRows = defineTool({
  name: 'add_rows',
  config: {
    title: 'Add Rows',
    description:
      'Appends rows to the bottom of a sheet tab. A cell may be a scalar or a Smart Chip object — ' +
      '`{ "chip": { "person": "user@example.com" } }` (person chip) or ' +
      '`{ "chip": { "driveFile": "https://drive.google.com/…" } }` (Drive-file chip) — for ' +
      'columns typed `person_chip`/`link_chip` in get_sheet_schema, where plain text fails validation. ' +
      'A cell may also be a hyperlink: `{ "richText": [{ "text": "DRM-5313", "url": "https://…" }] }` ' +
      '(add more segments for several links in one cell; a segment without `url` is plain text).',
    inputSchema: z.object({
      spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
      sheet_name: z.string().describe('Target sheet tab name'),
      values: z
        .array(z.array(CellValue).max(256))
        .min(1)
        .max(1000)
        .describe(
          '2D array of rows to append. Each cell is a scalar, a Smart Chip object ' +
            '`{ chip: { person } | { driveFile } }`, or a hyperlink object `{ richText: [{ text, url? }] }`.',
        ),
    }),
  },
  handler: async (args, sheetsClient, config) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);

      // When stamping an audit column, pad every row to the same width first so the userName
      // always lands in the same column even if input rows differ in length. Cell values are
      // sanitised inside the client (per write path), so pass them through raw here.
      let processedValues: CellValue[][] = args.values;
      if (config.userName) {
        const width = Math.max(...args.values.map((row) => row.length));
        const userName = config.userName;
        processedValues = args.values.map((row) => {
          const padded: CellValue[] = [...row];
          while (padded.length < width) padded.push(null);
          padded.push(userName);
          return padded;
        });
      }

      const updates = await sheetsClient.addRows(spreadsheetId, args.sheet_name, processedValues);

      return toJsonResult({
        success: true,
        updatedRange: updates?.updatedRange,
        updatedRows: updates?.updatedRows,
      });
    } catch (error) {
      return toErrorResult(error);
    }
  },
});
