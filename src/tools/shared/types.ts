import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SheetsClient } from '../../sheets-client.js';
import type { Config } from '../../config.js';
import type { z } from 'zod';

export interface ToolDefinition {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodObject<any>;
    annotations?: {
      readOnlyHint?: boolean;
      idempotentHint?: boolean;
    };
  };
  handler: (args: any, sheetsClient: SheetsClient, config: Config) => Promise<CallToolResult>;
}
