import { z } from 'zod';
import { defineTool } from './shared/types.js';
import { toErrorResult, toUntrustedJsonResult } from './shared/result.js';
import { SPREADSHEET_PARAM_DESCRIPTION, parseSpreadsheetRef } from '../spreadsheet-ref.js';

export const findRows = defineTool({
  name: 'find_rows',
  config: {
    title: 'Find Rows',
    description:
      'Searches a sheet tab for rows whose cell value matches `query` and returns each match with ' +
      'its 1-based sheet row index (feed straight into update_row / delete_rows). Restrict to one ' +
      'column by 1-based `column` index OR by `column_header` name (resolved via header_row); omit ' +
      'both to search every column. Matches the raw unformatted value (numbers/dates by their ' +
      'underlying value, not displayed text). The header_row is treated as headers and excluded ' +
      'from matches.',
    inputSchema: z.object({
      spreadsheet: z.string().min(1).describe(SPREADSHEET_PARAM_DESCRIPTION),
      sheet_name: z.string().describe('Target sheet tab name'),
      query: z.string().min(1).describe('Value to search for'),
      column: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          '1-based column index to restrict the search to (e.g. 3 = C). Mutually exclusive with column_header',
        ),
      column_header: z
        .string()
        .optional()
        .describe(
          'Header name to restrict the search to, matched in header_row. Mutually exclusive with column',
        ),
      header_row: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe(
          '1-based row holding headers; used to resolve column_header and excluded from matches (default 1)',
        ),
      match: z
        .enum(['exact', 'contains'])
        .default('exact')
        .describe(
          "'exact' = whole cell equals query; 'contains' = cell contains query as substring",
        ),
      case_sensitive: z.boolean().default(false).describe('Match case-sensitively (default false)'),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(50)
        .describe('Maximum number of matching rows to return (default 50)'),
    }),
    annotations: { readOnlyHint: true },
  },
  handler: async (args, sheetsClient) => {
    try {
      const spreadsheetId = parseSpreadsheetRef(args.spreadsheet);
      const headerRow = args.header_row;
      const match = args.match;
      const caseSensitive = args.case_sensitive;
      const maxResults = args.max_results;

      if (args.column !== undefined && args.column_header !== undefined) {
        throw new Error('Provide either column or column_header, not both.');
      }

      const data = await sheetsClient.getSheetValues(spreadsheetId, args.sheet_name);
      const rows = data.values ?? [];
      const headerCells = rows[headerRow - 1] ?? [];

      // Resolve target column (0-based) or null = search all columns.
      let targetCol: number | null = null;
      if (args.column !== undefined) {
        targetCol = args.column - 1;
      } else if (args.column_header !== undefined) {
        const wanted = args.column_header.trim().toLowerCase();
        const idx = headerCells.findIndex(
          (c) =>
            String(c ?? '')
              .trim()
              .toLowerCase() === wanted,
        );
        if (idx === -1) {
          throw new Error(
            `Column header "${args.column_header}" not found in row ${headerRow}. ` +
              'Use get_sheet_data or get_sheet_schema to inspect the available headers.',
          );
        }
        targetCol = idx;
      }

      const norm = (v: unknown) => {
        const s = String(v ?? '');
        return caseSensitive ? s : s.toLowerCase();
      };
      const q = norm(args.query);
      const cellMatches = (cell: unknown) =>
        match === 'exact' ? norm(cell) === q : norm(cell).includes(q);

      const matches: Array<{ row: number; values: unknown[] }> = [];
      let truncated = false;
      for (let i = 0; i < rows.length; i++) {
        if (i === headerRow - 1) continue; // skip header row
        const row = rows[i] ?? [];
        const hit =
          targetCol === null ? row.some((c) => cellMatches(c)) : cellMatches(row[targetCol]);
        if (!hit) continue;
        if (matches.length >= maxResults) {
          truncated = true;
          break;
        }
        matches.push({ row: i + 1, values: row });
      }

      return toUntrustedJsonResult({
        sheet_name: args.sheet_name,
        query: args.query,
        match,
        searchedColumn:
          targetCol === null
            ? 'all'
            : { index: targetCol + 1, header: headerCells[targetCol] ?? null },
        headers: headerCells,
        count: matches.length,
        truncated,
        matches,
      });
    } catch (error) {
      return toErrorResult(error);
    }
  },
});
