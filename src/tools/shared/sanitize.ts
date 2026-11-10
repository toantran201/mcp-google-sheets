import { z } from 'zod';

/**
 * A Smart Chip cell value. The Sheets API can only *write* two kinds of chip:
 *   - a person chip, addressed by email     → { chip: { person: 'a@x.io' } }
 *   - a Drive-file rich link, by URI         → { chip: { driveFile: 'https://drive…' } }
 * Every other chip type (Maps/Place, Calendar, YouTube, Finance, Rating…) is read-only
 * on Google's side, so it is intentionally absent here. Drive-file writes additionally
 * require a Drive OAuth scope; person chips need only the Sheets scope.
 */
export const ChipCellValue = z
  .object({
    chip: z.union([
      z.object({ person: z.string().min(1).max(2000) }).strict(),
      z.object({ driveFile: z.string().min(1).max(2000) }).strict(),
    ]),
  })
  .strict();
export type ChipCellValue = z.infer<typeof ChipCellValue>;

/**
 * A text cell carrying hyperlinks (Insert → Link), as ordered segments. A segment with `url`
 * is a clickable link showing `text`; one without is plain text between links:
 *   - whole-cell link   → { richText: [{ text: 'DRM-5313', url: 'https://…' }] }
 *   - several links     → { richText: [{ text: 'PR', url: 'https://…/1' }, { text: ', ' },
 *                                      { text: 'PR', url: 'https://…/2' }] }
 */
export const RichTextCellValue = z
  .object({
    richText: z
      .array(
        z
          .object({
            text: z.string().min(1).max(50_000),
            url: z.string().min(1).max(2000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200)
      .refine((segments) => segments.reduce((n, s) => n + s.text.length, 0) <= 50_000, {
        message: 'Combined segment text exceeds the 50,000-character cell limit',
      }),
  })
  .strict();
export type RichTextCellValue = z.infer<typeof RichTextCellValue>;

/**
 * Zod schema for a single Google Sheets cell value: a scalar (strings capped at the 50k
 * Sheets cell limit), a Smart Chip object, or a hyperlinked rich-text object. The object form
 * is the generic escape hatch for any structured cell content — new writable kinds are added
 * here, never as a new tool.
 */
export const CellValue = z.union([
  z.string().max(50_000),
  z.number(),
  z.boolean(),
  z.null(),
  ChipCellValue,
  RichTextCellValue,
]);
export type CellValue = z.infer<typeof CellValue>;

/** True when a cell value is a Smart Chip object rather than a scalar. */
export function isChipCell(value: CellValue): value is ChipCellValue {
  return typeof value === 'object' && value !== null && 'chip' in value;
}

/** True when a cell value is a hyperlinked rich-text object. */
export function isRichTextCell(value: CellValue): value is RichTextCellValue {
  return typeof value === 'object' && value !== null && 'richText' in value;
}

/**
 * True when a cell value is structured (chip or rich text) and so cannot go through the
 * values API — it must be written via the updateCells/appendCells grid path.
 */
export function isStructuredCell(value: CellValue): value is ChipCellValue | RichTextCellValue {
  return typeof value === 'object' && value !== null;
}

/**
 * Prefixes that Google Sheets (and Excel) interpret as formula starters.
 * Tab and CR count: clients strip the leading control char and evaluate what follows.
 * See: https://owasp.org/www-community/attacks/CSV_Injection
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Neutralises formula injection by prefixing dangerous strings with `'`. Only relevant on
 * the values-API path (USER_ENTERED), where a leading `=`/`+`/… is evaluated as a formula.
 * Chip objects, numbers, booleans and null pass through unchanged; so do scalar strings on
 * the chip write path, which are written as literal `stringValue` (never evaluated).
 */
export function sanitizeCell(value: CellValue): CellValue {
  if (typeof value === 'string' && FORMULA_PREFIXES.some((p) => value.startsWith(p))) {
    return "'" + value;
  }
  return value;
}
