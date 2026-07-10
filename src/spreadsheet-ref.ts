export const SPREADSHEET_PARAM_DESCRIPTION =
  'Target spreadsheet: a full Google Sheets URL ' +
  '(https://docs.google.com/spreadsheets/d/<ID>/edit...) or a bare spreadsheet ID';

const URL_PATTERN = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;
const BARE_ID_PATTERN = /^[a-zA-Z0-9_-]{20,}$/;

/** Extracts the spreadsheet ID from a full URL, or validates a bare ID. Throws on unrecognized input. */
export function parseSpreadsheetRef(input: string): string {
  const trimmed = input.trim();

  const urlMatch = trimmed.match(URL_PATTERN);
  if (urlMatch) {
    return urlMatch[1];
  }

  if (BARE_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  throw new Error(
    'Invalid spreadsheet reference: expected a Google Sheets URL ' +
      '(https://docs.google.com/spreadsheets/d/<ID>/...) or a spreadsheet ID',
  );
}
