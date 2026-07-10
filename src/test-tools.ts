/**
 * Manual test script — run with: npx tsx src/test-tools.ts <spreadsheet-url-or-id>
 * Tests all 10 tool handlers directly against a real Google Sheet.
 * Requires valid credentials in .env (OAuth or Service Account).
 * The target spreadsheet can also be set via the TEST_SPREADSHEET env var.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { AuthManager } from './auth/auth-manager.js';
import { SheetsClient } from './sheets-client.js';
import { getSpreadsheetInfo } from './tools/get-spreadsheet-info.js';
import { getSheetData } from './tools/get-sheet-data.js';
import { createSheet } from './tools/create-sheet.js';
import { renameSheet } from './tools/rename-sheet.js';
import { addRows } from './tools/add-rows.js';
import { addColumns } from './tools/add-columns.js';
import { updateRow } from './tools/update-row.js';
import { deleteRows } from './tools/delete-rows.js';
import { findRows } from './tools/find-rows.js';
import { getSheetSchema } from './tools/get-sheet-schema.js';

const spreadsheet = process.argv[2] ?? process.env.TEST_SPREADSHEET;
if (!spreadsheet) {
  console.error(
    'Usage: npx tsx src/test-tools.ts <spreadsheet-url-or-id>\n' +
      '(or set the TEST_SPREADSHEET env var)',
  );
  process.exit(1);
}

const config = loadConfig();
const client = new SheetsClient(new AuthManager(config));

function log(label: string, result: CallToolResult) {
  const status = result.isError ? 'FAIL' : 'OK';
  console.error(`\n[${status}] ${label}`);
  const first = result.content[0];
  console.error('type' in first && first.type === 'text' ? first.text : JSON.stringify(first));
}

async function main() {
  // 1. get_spreadsheet_info
  log('get_spreadsheet_info', await getSpreadsheetInfo.handler({ spreadsheet }, client, config));

  // 2. get_sheet_data — read first sheet
  log(
    'get_sheet_data (Sheet1)',
    await getSheetData.handler({ spreadsheet, range: 'Sheet1' }, client, config),
  );

  // 3. get_sheet_data — error path (non-existent sheet)
  log(
    'get_sheet_data (NoSuchSheet) — expect error',
    await getSheetData.handler({ spreadsheet, range: 'NoSuchSheet' }, client, config),
  );

  // 4. invalid spreadsheet reference (expect error)
  log(
    'get_spreadsheet_info (invalid ref) — expect error',
    await getSpreadsheetInfo.handler({ spreadsheet: 'not a valid ref!' }, client, config),
  );

  // 5. create_sheet
  const testTab = `TestTab_${Date.now()}`;
  log(
    `create_sheet ("${testTab}")`,
    await createSheet.handler({ spreadsheet, title: testTab }, client, config),
  );

  // 6. rename_sheet by old_title
  const renamedTab = `${testTab}_Renamed`;
  log(
    `rename_sheet (old_title → "${renamedTab}")`,
    await renameSheet.handler(
      { spreadsheet, old_title: testTab, new_title: renamedTab },
      client,
      config,
    ),
  );

  // 7. add_rows
  log(
    `add_rows to "${renamedTab}"`,
    await addRows.handler(
      {
        spreadsheet,
        sheet_name: renamedTab,
        values: [
          ['Alice', 30, 'Hanoi'],
          ['Bob', 25, 'HCMC'],
        ],
      },
      client,
      config,
    ),
  );

  // 8. add_rows — empty array (expect validation error)
  log(
    'add_rows empty — expect error',
    await addRows.handler(
      {
        spreadsheet,
        sheet_name: renamedTab,
        values: [],
      },
      client,
      config,
    ),
  );

  // 9. update_row — overwrite the whole of row 1 from column A (default start_column)
  log(
    `update_row row 1 in "${renamedTab}"`,
    await updateRow.handler(
      {
        spreadsheet,
        sheet_name: renamedTab,
        row_index: 1,
        values: ['Name', 'Age', 'City'],
      },
      client,
      config,
    ),
  );

  // 9b. update_row — partial write from column B (row 2 col A "Alice" must survive)
  log(
    `update_row row 2 from column B in "${renamedTab}" (start_column=2)`,
    await updateRow.handler(
      {
        spreadsheet,
        sheet_name: renamedTab,
        row_index: 2,
        start_column: 2,
        values: [31, 'Da Nang'],
      },
      client,
      config,
    ),
  );

  // 10. add_columns — insert 1 column before column B
  log(
    `add_columns (insert 1 before column B) in "${renamedTab}"`,
    await addColumns.handler(
      { spreadsheet, sheet_name: renamedTab, count: 1, start_column: 2 },
      client,
      config,
    ),
  );

  // 11. add_columns — append 2 columns at the right edge (no start_column)
  log(
    `add_columns (append 2 at right edge) in "${renamedTab}"`,
    await addColumns.handler({ spreadsheet, sheet_name: renamedTab, count: 2 }, client, config),
  );

  // 12. add_columns — non-existent sheet (expect error)
  log(
    'add_columns (NoSuchSheet) — expect error',
    await addColumns.handler({ spreadsheet, sheet_name: 'NoSuchSheet', count: 1 }, client, config),
  );

  // 12b. delete_rows — delete row 2 (rows below shift up)
  log(
    `delete_rows (row 2, count 1) in "${renamedTab}"`,
    await deleteRows.handler(
      { spreadsheet, sheet_name: renamedTab, start_row: 2, count: 1 },
      client,
      config,
    ),
  );

  // 12c. delete_rows — non-existent sheet (expect error)
  log(
    'delete_rows (NoSuchSheet) — expect error',
    await deleteRows.handler(
      { spreadsheet, sheet_name: 'NoSuchSheet', start_row: 1 },
      client,
      config,
    ),
  );

  // 13. Verify the data we wrote (old column B data should now sit in column C)
  log(
    `get_sheet_data ("${renamedTab}") — verify writes`,
    await getSheetData.handler({ spreadsheet, range: renamedTab }, client, config),
  );

  // ─── get_sheet_schema tests ───

  // 14. get_sheet_schema — basic (default header_row=1, data_row=2)
  log(
    'get_sheet_schema (Sheet1)',
    await getSheetSchema.handler(
      { spreadsheet, sheet_name: 'Sheet1', header_row: 1 },
      client,
      config,
    ),
  );

  // 15. get_sheet_schema — custom header_row and data_row
  log(
    'get_sheet_schema (Sheet1, header_row=1, data_row=2)',
    await getSheetSchema.handler(
      { spreadsheet, sheet_name: 'Sheet1', header_row: 1, data_row: 2 },
      client,
      config,
    ),
  );

  // 16. get_sheet_schema — data_row < header_row (expect error)
  log(
    'get_sheet_schema (data_row < header_row) — expect error',
    await getSheetSchema.handler(
      { spreadsheet, sheet_name: 'Sheet1', header_row: 5, data_row: 3 },
      client,
      config,
    ),
  );

  // 17. get_sheet_schema — non-existent sheet (expect error)
  log(
    'get_sheet_schema (NoSuchSheet) — expect error',
    await getSheetSchema.handler(
      { spreadsheet, sheet_name: 'NoSuchSheet', header_row: 1 },
      client,
      config,
    ),
  );

  // 18. get_sheet_schema — empty sheet (expect error about empty headers)
  log(
    `get_sheet_schema ("${renamedTab}", row 999) — expect empty header error`,
    await getSheetSchema.handler(
      { spreadsheet, sheet_name: renamedTab, header_row: 999 },
      client,
      config,
    ),
  );

  // ─── find_rows tests ───

  // 19. find_rows — search all columns (contains, case-insensitive)
  log(
    `find_rows (all columns, contains "a") in "${renamedTab}"`,
    await findRows.handler(
      { spreadsheet, sheet_name: renamedTab, query: 'a', match: 'contains' },
      client,
      config,
    ),
  );

  // 20. find_rows — by column_header, no match expected (count 0)
  log(
    `find_rows (column_header="Name", no match) in "${renamedTab}"`,
    await findRows.handler(
      { spreadsheet, sheet_name: renamedTab, column_header: 'Name', query: '__no_such_value__' },
      client,
      config,
    ),
  );

  // 21. find_rows — both column and column_header (expect error)
  log(
    'find_rows (column + column_header) — expect error',
    await findRows.handler(
      { spreadsheet, sheet_name: renamedTab, query: 'x', column: 1, column_header: 'Name' },
      client,
      config,
    ),
  );

  // 22. find_rows — non-existent column_header (expect error)
  log(
    'find_rows (unknown column_header) — expect error',
    await findRows.handler(
      { spreadsheet, sheet_name: renamedTab, query: 'x', column_header: 'NoSuchHeader' },
      client,
      config,
    ),
  );

  console.error('\n--- All tests done. Check your Google Sheet to confirm. ---');
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
