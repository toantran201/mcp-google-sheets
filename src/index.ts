import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { AuthManager } from './auth/auth-manager.js';
import { loadTokens } from './auth/token-store.js';
import { SheetsClient } from './sheets-client.js';
import { registerAllTools } from './tools/index.js';

async function main() {
  const config = loadConfig();

  const authManager = new AuthManager(config);
  const sheetsClient = new SheetsClient(authManager);

  const server = new McpServer({
    name: 'mcp-google-sheets',
    version: '1.0.0',
  });

  registerAllTools(server, sheetsClient, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (config.auth.mode === 'oauth') {
    const hasCache = loadTokens() !== null;
    console.error(
      `MCP Google Sheets server running on stdio (auth: OAuth, ` +
        `${hasCache ? 'cached sign-in found' : 'browser sign-in will trigger on first tool call'})`,
    );
  } else {
    console.error('MCP Google Sheets server running on stdio (auth: service account)');
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : 'Unknown error';
  console.error('Fatal error:', message);
  process.exit(1);
});
