import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { SheetsClient } from './sheets-client.js';
import { registerAllTools } from './tools/index.js';

async function main() {
  const config = loadConfig();

  const sheetsClient = new SheetsClient(config);

  const server = new McpServer({
    name: 'mcp-google-sheets',
    version: '1.0.0',
  });

  registerAllTools(server, sheetsClient, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MCP Google Sheets server running on stdio');
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : 'Unknown error';
  console.error('Fatal error:', message);
  process.exit(1);
});
