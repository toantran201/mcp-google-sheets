import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SheetsClient } from '../sheets-client.js';
import type { Config } from '../config.js';
import type { ToolDefinition } from './shared/types.js';
import { getSpreadsheetInfo } from './get-spreadsheet-info.js';
import { getSheetSchema } from './get-sheet-schema.js';
import { createSheet } from './create-sheet.js';
import { renameSheet } from './rename-sheet.js';
import { getSheetData } from './get-sheet-data.js';
import { findRows } from './find-rows.js';
import { addRows } from './add-rows.js';
import { addColumns } from './add-columns.js';
import { updateRow } from './update-row.js';
import { deleteRows } from './delete-rows.js';

const allTools: ToolDefinition[] = [
  getSpreadsheetInfo,
  getSheetSchema,
  createSheet,
  renameSheet,
  getSheetData,
  findRows,
  addRows,
  addColumns,
  updateRow,
  deleteRows,
];

export function registerAllTools(
  server: McpServer,
  sheetsClient: SheetsClient,
  config: Config,
): void {
  const enabled = config.tools;
  const registered: string[] = [];

  for (const tool of allTools) {
    if (enabled !== null && !enabled.includes(tool.name)) {
      continue;
    }

    server.registerTool(tool.name, tool.config, async (args: any) =>
      tool.handler(args, sheetsClient, config),
    );
    registered.push(tool.name);
  }

  console.error(`Registered tools (${registered.length}): ${registered.join(', ')}`);
}
