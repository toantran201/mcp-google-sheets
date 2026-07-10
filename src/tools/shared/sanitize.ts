import { z } from 'zod';

/** Zod schema for a single Google Sheets cell value. Strings are capped at the 50k Sheets cell limit. */
export const CellValue = z.union([z.string().max(50_000), z.number(), z.boolean(), z.null()]);

/**
 * Prefixes that Google Sheets (and Excel) interpret as formula starters.
 * Tab and CR count: clients strip the leading control char and evaluate what follows.
 * See: https://owasp.org/www-community/attacks/CSV_Injection
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/** Neutralises formula injection by prefixing dangerous strings with `'`. */
export function sanitizeCell(value: z.infer<typeof CellValue>): z.infer<typeof CellValue> {
  if (typeof value === 'string' && FORMULA_PREFIXES.some((p) => value.startsWith(p))) {
    return "'" + value;
  }
  return value;
}
