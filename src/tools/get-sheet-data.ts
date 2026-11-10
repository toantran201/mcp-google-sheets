import { z } from 'zod';
import { defineTool } from './shared/types.js';
import { toErrorResult, toUntrustedJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

export const getSheetData = defineTool({
  name: 'get_sheet_data',
  config: {
    title: 'Get Sheet Data',
    description:
      "Reads cell values from a range in A1 notation (e.g. 'Sheet1!A1:D10' or 'Sheet1' for the " +
      'entire tab). Smart Chips are surfaced automatically: a person chip reads back as ' +
      '`{ "chip": { "person": "user@example.com" } }` and any other rich link as ' +
      '`{ "chip": { "link": "<uri>" } }`; plain cells read back as scalars. A cell with ' +
      'hyperlinked text reads back as `{ "richText": [{ "text": "DRM-5313", "url": "https://…" }] }` ' +
      '(one segment per link, url-less segments for the text between). Person chips and ' +
      'richText round-trip: pass the same object to update_row/add_rows to write it.',
    inputSchema: z.object({
      spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
      range: z
        .string()
        .describe("A1 notation range, e.g. 'Sheet1!A1:D10' or 'Sheet1' for the entire tab"),
    }),
    annotations: {
      readOnlyHint: true,
    },
  },
  handler: async (args, sheetsClient) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);
      const data = await sheetsClient.readCells(spreadsheetId, args.range);

      return toUntrustedJsonResult({
        range: data.range,
        values: data.values,
      });
    } catch (error) {
      return toErrorResult(error);
    }
  },
});
