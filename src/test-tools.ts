/**
 * Manual test script — run with: npx tsx src/test-tools.ts
 * Tests all 6 tool handlers directly against a real Google Sheet.
 * Requires valid credentials in .env
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { SheetsClient } from "./sheets-client.js";
import { getSpreadsheetInfo } from "./tools/get-spreadsheet-info.js";
import { getSheetData } from "./tools/get-sheet-data.js";
import { createSheet } from "./tools/create-sheet.js";
import { renameSheet } from "./tools/rename-sheet.js";
import { addRows } from "./tools/add-rows.js";
import { updateRow } from "./tools/update-row.js";
import { getSheetSchema } from "./tools/get-sheet-schema.js";

const config = loadConfig();
const client = new SheetsClient(config);

function log(label: string, result: CallToolResult) {
  const status = result.isError ? "FAIL" : "OK";
  console.error(`\n[${status}] ${label}`);
  const first = result.content[0];
  console.error(
    "type" in first && first.type === "text"
      ? first.text
      : JSON.stringify(first),
  );
}

async function main() {
  // 1. get_spreadsheet_info
  log(
    "get_spreadsheet_info",
    await getSpreadsheetInfo.handler({}, client, config),
  );

  // 2. get_sheet_data — read first sheet
  log(
    "get_sheet_data (Sheet1)",
    await getSheetData.handler({ range: "Sheet1" }, client, config),
  );

  // 3. get_sheet_data — error path (non-existent sheet)
  log(
    "get_sheet_data (NoSuchSheet) — expect error",
    await getSheetData.handler({ range: "NoSuchSheet" }, client, config),
  );

  // 4. create_sheet
  const testTab = `TestTab_${Date.now()}`;
  log(
    `create_sheet ("${testTab}")`,
    await createSheet.handler({ title: testTab }, client, config),
  );

  // 5. rename_sheet by old_title
  const renamedTab = `${testTab}_Renamed`;
  log(
    `rename_sheet (old_title → "${renamedTab}")`,
    await renameSheet.handler(
      { old_title: testTab, new_title: renamedTab },
      client,
      config,
    ),
  );

  // 6. add_rows
  log(
    `add_rows to "${renamedTab}"`,
    await addRows.handler(
      {
        sheet_name: renamedTab,
        values: [
          ["Alice", 30, "Hanoi"],
          ["Bob", 25, "HCMC"],
        ],
      },
      client,
      config,
    ),
  );

  // 7. add_rows — empty array (expect validation error)
  log(
    "add_rows empty — expect error",
    await addRows.handler(
      {
        sheet_name: renamedTab,
        values: [],
      },
      client,
      config,
    ),
  );

  // 8. update_row — update row 1
  log(
    `update_row row 1 in "${renamedTab}"`,
    await updateRow.handler(
      {
        sheet_name: renamedTab,
        row_index: 1,
        values: ["Name", "Age", "City"],
      },
      client,
      config,
    ),
  );

  // 9. Verify the data we wrote
  log(
    `get_sheet_data ("${renamedTab}") — verify writes`,
    await getSheetData.handler({ range: renamedTab }, client, config),
  );

  // ─── get_sheet_schema tests ───

  // 10. get_sheet_schema — basic (default header_row=1, data_row=2)
  log(
    "get_sheet_schema (Sheet1)",
    await getSheetSchema.handler(
      { sheet_name: "Sheet1", header_row: 1 },
      client,
      config,
    ),
  );

  // 11. get_sheet_schema — custom header_row and data_row
  log(
    "get_sheet_schema (Sheet1, header_row=1, data_row=2)",
    await getSheetSchema.handler(
      { sheet_name: "Sheet1", header_row: 1, data_row: 2 },
      client,
      config,
    ),
  );

  // 12. get_sheet_schema — data_row < header_row (expect error)
  log(
    "get_sheet_schema (data_row < header_row) — expect error",
    await getSheetSchema.handler(
      { sheet_name: "Sheet1", header_row: 5, data_row: 3 },
      client,
      config,
    ),
  );

  // 13. get_sheet_schema — non-existent sheet (expect error)
  log(
    "get_sheet_schema (NoSuchSheet) — expect error",
    await getSheetSchema.handler(
      { sheet_name: "NoSuchSheet", header_row: 1 },
      client,
      config,
    ),
  );

  // 14. get_sheet_schema — empty sheet (expect error about empty headers)
  log(
    `get_sheet_schema ("${renamedTab}", row 999) — expect empty header error`,
    await getSheetSchema.handler(
      { sheet_name: renamedTab, header_row: 999 },
      client,
      config,
    ),
  );

  console.error(
    "\n--- All tests done. Check your Google Sheet to confirm. ---",
  );
}

main().catch((err) => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
