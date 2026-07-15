import { google, type sheets_v4 } from 'googleapis';
import type { AuthManager } from './auth/auth-manager.js';
import { type CellValue, isChipCell, sanitizeCell } from './tools/shared/sanitize.js';

/**
 * A cell as read back from the sheet: a scalar, or a Smart Chip surfaced structurally.
 * Person chips round-trip exactly to {@link CellValue} on write; `link` chips (any
 * non-person rich link) are read-only, so they come back generically as a URI.
 */
export type CellReadValue =
  string | number | boolean | { chip: { person: string } } | { chip: { link: string } };

/** Builds a Sheets CellData for the updateCells/appendCells (chip) write path. */
function toCellData(value: CellValue): sheets_v4.Schema$CellData {
  if (isChipCell(value)) {
    const chip: sheets_v4.Schema$Chip =
      'person' in value.chip
        ? { personProperties: { email: value.chip.person } }
        : { richLinkProperties: { uri: value.chip.driveFile } };
    // A chip occupies a single "@" placeholder character in the cell's text.
    return { userEnteredValue: { stringValue: '@' }, chipRuns: [{ startIndex: 0, chip }] };
  }
  if (value === null) return { userEnteredValue: {} };
  if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  // A string here is written literally: stringValue is never evaluated as a formula, so it
  // needs no leading-apostrophe sanitisation (unlike the USER_ENTERED values-API path).
  return { userEnteredValue: { stringValue: value } };
}

/** Extracts a structured read value from a cell's grid data. */
function fromCellData(cell: sheets_v4.Schema$CellData | undefined): CellReadValue {
  const chip = cell?.chipRuns?.find((run) => run.chip)?.chip;
  if (chip?.personProperties?.email) return { chip: { person: chip.personProperties.email } };
  if (chip?.richLinkProperties?.uri) return { chip: { link: chip.richLinkProperties.uri } };

  const ev = cell?.effectiveValue;
  if (ev) {
    if (typeof ev.numberValue === 'number') return ev.numberValue;
    if (typeof ev.boolValue === 'boolean') return ev.boolValue;
    if (typeof ev.stringValue === 'string') return ev.stringValue;
  }
  return cell?.formattedValue ?? '';
}

/** True when a read value carries no content (used to trim trailing empties like values.get). */
function isEmptyRead(value: CellReadValue): boolean {
  return value === '';
}

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

  /**
   * Reads all cells of a tab by name as structured, chip-aware values (see {@link readCells}).
   * Use this instead of {@link getSheetValues} when chip cells must match what get_sheet_data
   * returns — the values API renders a person chip as display-name text, not its email.
   */
  async readSheetCells(spreadsheetId: string, sheetName: string) {
    return this.readCells(spreadsheetId, quoteSheetName(sheetName));
  }

  async addRows(
    spreadsheetId: string,
    sheetName: string,
    values: CellValue[][],
  ): Promise<{ updatedRange?: string | null; updatedRows?: number | null }> {
    // Any chip in the batch forces the whole append onto appendCells (the values API cannot
    // write chips). A fully-scalar batch keeps the faster USER_ENTERED values.append path.
    if (values.some((row) => row.some(isChipCell))) {
      return this.addRowsRich(spreadsheetId, sheetName, values);
    }

    const sanitized = values.map((row) => row.map(sanitizeCell));
    return this.withAuthRetry(async (api) => {
      const res = await api.spreadsheets.values.append({
        spreadsheetId,
        range: quoteSheetName(sheetName),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: sanitized },
      });
      return {
        updatedRange: res.data.updates?.updatedRange,
        updatedRows: res.data.updates?.updatedRows,
      };
    });
  }

  /** Appends rows containing Smart Chips via appendCells. */
  private async addRowsRich(spreadsheetId: string, sheetName: string, values: CellValue[][]) {
    const props = await this.getSheetPropertiesByTitle(spreadsheetId, sheetName);
    const sheetId = props.sheetId!;
    const rows = values.map((row) => ({ values: row.map(toCellData) }));

    await this.withAuthRetry((api) =>
      api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ appendCells: { sheetId, rows, fields: 'userEnteredValue,chipRuns' } }],
        },
      }),
    );

    // appendCells returns no updated range; report the row count so the tool stays informative.
    return { updatedRange: null, updatedRows: values.length };
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
    values: CellValue[],
    startColumn = 1,
  ): Promise<{ updatedRange?: string | null; updatedCells?: number | null }> {
    // A chip anywhere in the row routes the whole slice through updateCells (the values API
    // cannot write chips). A fully-scalar row keeps the faster USER_ENTERED values.update path.
    if (values.some(isChipCell)) {
      return this.updateRowRich(spreadsheetId, sheetName, rowIndex, values, startColumn);
    }

    const sanitized = values.map(sanitizeCell);
    return this.withAuthRetry(async (api) => {
      const range = `${quoteSheetName(sheetName)}!${columnLabel(startColumn)}${rowIndex}`;
      const res = await api.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [sanitized] },
      });
      return { updatedRange: res.data.updatedRange, updatedCells: res.data.updatedCells };
    });
  }

  /** Overwrites a row slice containing Smart Chips via updateCells (leaves data validation intact). */
  private async updateRowRich(
    spreadsheetId: string,
    sheetName: string,
    rowIndex: number,
    values: CellValue[],
    startColumn: number,
  ) {
    const props = await this.getSheetPropertiesByTitle(spreadsheetId, sheetName);
    const sheetId = props.sheetId!;

    // Split the slice into contiguous runs of non-null cells. updateCells clears any cell it
    // covers (an empty userEnteredValue wipes the cell), so a null must be *excluded* from the
    // request to be left untouched — matching the values API, which skips nulls. Each run is a
    // separate updateCells anchored at its own column; `start` (not `range`) writes only the
    // cells we supply and the field mask omits dataValidation, preserving dropdown rules.
    const requests: sheets_v4.Schema$Request[] = [];
    for (let i = 0; i < values.length; ) {
      if (values[i] === null) {
        i++;
        continue;
      }
      const runStart = i;
      while (i < values.length && values[i] !== null) i++;
      requests.push({
        updateCells: {
          start: { sheetId, rowIndex: rowIndex - 1, columnIndex: startColumn - 1 + runStart },
          rows: [{ values: values.slice(runStart, i).map(toCellData) }],
          fields: 'userEnteredValue,chipRuns',
        },
      });
    }

    if (requests.length > 0) {
      await this.withAuthRetry((api) =>
        api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }),
      );
    }

    const firstCol = columnLabel(startColumn);
    const lastCol = columnLabel(startColumn + values.length - 1);
    return {
      updatedRange: `${quoteSheetName(sheetName)}!${firstCol}${rowIndex}:${lastCol}${rowIndex}`,
      updatedCells: values.filter((v) => v !== null).length,
    };
  }

  /**
   * Reads a range as structured values, auto-surfacing Smart Chips: person chips come back as
   * `{ chip: { person: email } }`, other rich links as `{ chip: { link: uri } }`, and plain
   * cells as scalars. Trailing empty cells/rows are trimmed to mirror `values.get` output.
   */
  async readCells(
    spreadsheetId: string,
    range: string,
  ): Promise<{ range: string; values: CellReadValue[][] }> {
    return this.withAuthRetry(async (api) => {
      // Bound the grid read to the used data extent. spreadsheets.get on an unbounded range
      // (a whole tab) buffers the entire grid — every trailing empty row, with both
      // effectiveValue and formattedValue per cell. values.get trims to the last non-empty
      // row/column and returns that as its normalized `range`, which we then use to scope the
      // grid read (the only way to surface chips) instead of pulling the whole allocated grid.
      const bounds = await api.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      const usedRange = bounds.data.range ?? range;
      if (!bounds.data.values?.length) {
        return { range: usedRange, values: [] };
      }

      const res = await api.spreadsheets.get({
        spreadsheetId,
        ranges: [usedRange],
        fields: 'sheets(data(rowData(values(effectiveValue,formattedValue,chipRuns))))',
      });

      const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
      const rows: CellReadValue[][] = rowData.map((row) => {
        const cells = (row.values ?? []).map(fromCellData);
        while (cells.length > 0 && isEmptyRead(cells[cells.length - 1]!)) cells.pop();
        return cells;
      });
      while (rows.length > 0 && rows[rows.length - 1]!.length === 0) rows.pop();

      return { range: usedRange, values: rows };
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
          'sheets(data(rowData(values(formattedValue,note,dataValidation,effectiveFormat.numberFormat,userEnteredValue.formulaValue,chipRuns))))',
      });
      return res.data.sheets?.[0];
    });
  }
}
