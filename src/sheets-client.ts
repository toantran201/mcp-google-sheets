import { google, type sheets_v4 } from 'googleapis';
import type { AuthManager } from './auth/auth-manager.js';

/** Quotes a sheet name for A1 notation when it contains special characters. */
function quoteSheetName(name: string): string {
  if (/[^A-Za-z0-9_]/.test(name)) {
    return `'${name.replace(/'/g, "''")}'`;
  }
  return name;
}

/** Converts a 1-based column index to its A1 column label (1 → "A", 27 → "AA"). */
function columnLabel(index: number): string {
  let label = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  }
  return label;
}

function isInvalidGrant(error: unknown): boolean {
  const err = error as {
    message?: string;
    response?: { data?: { error?: string } };
  };
  return (
    err?.response?.data?.error === 'invalid_grant' ||
    (typeof err?.message === 'string' && err.message.includes('invalid_grant'))
  );
}

export class SheetsClient {
  private sheetsApi: sheets_v4.Sheets | null = null;

  constructor(private readonly authManager: AuthManager) {}

  private async api(): Promise<sheets_v4.Sheets> {
    if (!this.sheetsApi) {
      const auth = await this.authManager.getClient();
      this.sheetsApi = google.sheets({ version: 'v4', auth });
    }
    return this.sheetsApi;
  }

  /** Retries once after re-authenticating when the cached refresh token is revoked/expired. */
  private async withAuthRetry<T>(fn: (api: sheets_v4.Sheets) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.api());
    } catch (error) {
      if (!isInvalidGrant(error)) throw error;
      console.error(
        '[google-sheets-mcp] Cached Google credentials are no longer valid — re-authenticating.',
      );
      const auth = await this.authManager.reset();
      this.sheetsApi = google.sheets({ version: 'v4', auth });
      return fn(this.sheetsApi);
    }
  }

  async getSpreadsheetInfo(spreadsheetId: string) {
    return this.withAuthRetry(async (api) => {
      const res = await api.spreadsheets.get({
        spreadsheetId,
        fields: 'properties,sheets.properties',
      });
      return res.data;
    });
  }

  async createSheet(spreadsheetId: string, title: string) {
    return this.withAuthRetry(async (api) => {
      const res = await api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title },
              },
            },
          ],
        },
      });
      return res.data.replies?.[0]?.addSheet?.properties;
    });
  }

  /** Resolves a sheet title to its properties; throws if the sheet is not found. */
  private async getSheetPropertiesByTitle(
    spreadsheetId: string,
    title: string,
  ): Promise<sheets_v4.Schema$SheetProperties> {
    const info = await this.getSpreadsheetInfo(spreadsheetId);
    const sheet = info.sheets?.find((s) => s.properties?.title === title);
    if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
      throw new Error(`Sheet with title "${title}" not found`);
    }
    return sheet.properties;
  }

  async renameSheet(
    spreadsheetId: string,
    identifier: { sheetId: number } | { oldTitle: string },
    newTitle: string,
  ): Promise<number> {
    const sheetId =
      'sheetId' in identifier
        ? identifier.sheetId
        : (await this.getSheetPropertiesByTitle(spreadsheetId, identifier.oldTitle)).sheetId!;

    await this.withAuthRetry((api) =>
      api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId, title: newTitle },
                fields: 'title',
              },
            },
          ],
        },
      }),
    );

    return sheetId;
  }

  async getSheetData(spreadsheetId: string, range: string) {
    return this.withAuthRetry(async (api) => {
      const res = await api.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      return res.data;
    });
  }

  /** Reads all values of a tab by name, quoting the name for A1 notation. */
  async getSheetValues(spreadsheetId: string, sheetName: string) {
    return this.getSheetData(spreadsheetId, quoteSheetName(sheetName));
  }

  async addRows(spreadsheetId: string, sheetName: string, values: unknown[][]) {
    return this.withAuthRetry(async (api) => {
      const res = await api.spreadsheets.values.append({
        spreadsheetId,
        range: quoteSheetName(sheetName),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      });
      return res.data.updates;
    });
  }

  /** Inserts empty columns. startIndex is 0-based; undefined appends at the right edge. */
  async addColumns(spreadsheetId: string, sheetName: string, count: number, startIndex?: number) {
    const props = await this.getSheetPropertiesByTitle(spreadsheetId, sheetName);
    const sheetId = props.sheetId!;

    await this.withAuthRetry((api) =>
      api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            startIndex === undefined
              ? { appendDimension: { sheetId, dimension: 'COLUMNS', length: count } }
              : {
                  insertDimension: {
                    range: {
                      sheetId,
                      dimension: 'COLUMNS',
                      startIndex,
                      endIndex: startIndex + count,
                    },
                    inheritFromBefore: startIndex > 0,
                  },
                },
          ],
        },
      }),
    );

    return { sheetId, previousColumnCount: props.gridProperties?.columnCount ?? null };
  }

  /**
   * Overwrites a horizontal slice of one row. `startColumn` is 1-based (1 = column A); only the
   * cells spanned by `values` are written, leaving the rest of the row untouched.
   */
  async updateRow(
    spreadsheetId: string,
    sheetName: string,
    rowIndex: number,
    values: unknown[],
    startColumn = 1,
  ) {
    return this.withAuthRetry(async (api) => {
      const range = `${quoteSheetName(sheetName)}!${columnLabel(startColumn)}${rowIndex}`;
      const res = await api.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [values] },
      });
      return res.data;
    });
  }

  /**
   * Deletes `count` rows starting at 1-based `startRow`, shifting rows below upward.
   * Validates against the sheet's current row count so an out-of-range or delete-all
   * request fails with a clear message instead of a raw Google API 400.
   */
  async deleteRows(spreadsheetId: string, sheetName: string, startRow: number, count: number) {
    const props = await this.getSheetPropertiesByTitle(spreadsheetId, sheetName);
    const sheetId = props.sheetId!;
    const rowCount = props.gridProperties?.rowCount ?? 0;

    const startIndex = startRow - 1; // 0-based inclusive
    const endIndex = startIndex + count; // 0-based exclusive

    if (startIndex >= rowCount) {
      throw new Error(`start_row ${startRow} is beyond the sheet's ${rowCount} row(s).`);
    }
    if (endIndex > rowCount) {
      throw new Error(
        `Cannot delete ${count} row(s) from row ${startRow}: only ${rowCount - startIndex} row(s) exist below it.`,
      );
    }
    if (startIndex === 0 && endIndex >= rowCount) {
      throw new Error('Refusing to delete every row — a sheet must keep at least one row.');
    }

    await this.withAuthRetry((api) =>
      api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            { deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex, endIndex } } },
          ],
        },
      }),
    );

    return { sheetId, deletedCount: count, remainingRowCount: rowCount - count };
  }

  async getSheetSchema(
    spreadsheetId: string,
    sheetName: string,
    headerRow: number,
    dataRow: number,
  ): Promise<sheets_v4.Schema$Sheet | undefined> {
    return this.withAuthRetry(async (api) => {
      const range = `${quoteSheetName(sheetName)}!${headerRow}:${dataRow}`;
      const res = await api.spreadsheets.get({
        spreadsheetId,
        ranges: [range],
        fields:
          'sheets(data(rowData(values(formattedValue,note,dataValidation,effectiveFormat.numberFormat,userEnteredValue.formulaValue))))',
      });
      return res.data.sheets?.[0];
    });
  }
}
