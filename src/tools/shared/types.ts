import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SheetsClient } from '../../sheets-client.js';
import type { Config } from '../../config.js';
import type { z } from 'zod';

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: S;
    annotations?: {
      readOnlyHint?: boolean;
      idempotentHint?: boolean;
    };
  };
  handler: (
    args: z.infer<S>,
    sheetsClient: SheetsClient,
    config: Config,
  ) => Promise<CallToolResult>;
}

/**
 * Identity helper that captures the input schema's type so each tool's `handler`
 * receives `args` typed as `z.infer<inputSchema>` — no hand-written arg type and no
 * re-declaring Zod defaults. The MCP SDK validates raw arguments against inputSchema
 * (applying defaults) before invoking the handler, so the parsed shape the handler
 * sees is exactly `z.infer<inputSchema>`.
 */
export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): ToolDefinition<S> {
  return def;
}
