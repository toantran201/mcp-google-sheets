import { google, type sheets_v4 } from "googleapis";
import type { Config } from "./config.js";

const WRITE_TOOLS = ["create_sheet", "rename_sheet", "add_rows", "update_row"];

function resolveScope(enabledTools: readonly string[] | null): string {
  const needsWrite =
    enabledTools === null || enabledTools.some((t) => WRITE_TOOLS.includes(t));
  return needsWrite
    ? "https://www.googleapis.com/auth/spreadsheets"
    : "https://www.googleapis.com/auth/spreadsheets.readonly";
}

/** Quotes a sheet name for A1 notation when it contains special characters. */
function quoteSheetName(name: string): string {
  if (/[^A-Za-z0-9_]/.test(name)) {
    return `'${name.replace(/'/g, "''")}'`;
  }
  return name;
}

export class SheetsClient {
  private sheets: sheets_v4.Sheets;
  private spreadsheetId: string;

  constructor(config: Config) {
    const auth = new google.auth.JWT({
      email: config.googleServiceAccountEmail,
      key: config.googlePrivateKey,
      scopes: [resolveScope(config.tools)],
    });

    this.sheets = google.sheets({ version: "v4", auth });
    this.spreadsheetId = config.spreadsheetId;
  }

  async getSpreadsheetInfo() {
    const res = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: "properties,sheets.properties",
    });

    return res.data;
  }

  async createSheet(title: string) {
    const res = await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
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
  }

  async renameSheet(
    identifier: { sheetId: number } | { oldTitle: string },
    newTitle: string,
  ): Promise<void> {
    let sheetId: number;

    if ("sheetId" in identifier) {
      sheetId = identifier.sheetId;
    } else {
      const info = await this.getSpreadsheetInfo();
      const sheet = info.sheets?.find(
        (s) => s.properties?.title === identifier.oldTitle,
      );
      if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
        throw new Error(`Sheet with title "${identifier.oldTitle}" not found`);
      }
      sheetId = sheet.properties.sheetId;
    }

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, title: newTitle },
              fields: "title",
            },
          },
        ],
      },
    });
  }

  async getSheetData(range: string) {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    return res.data;
  }

  async addRows(sheetName: string, values: unknown[][]) {
    const res = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: quoteSheetName(sheetName),
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    return res.data.updates;
  }

  async updateRow(sheetName: string, rowIndex: number, values: unknown[]) {
    const range = `${quoteSheetName(sheetName)}!A${rowIndex}`;
    const res = await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });

    return res.data;
  }

  async getSheetSchema(
    sheetName: string,
    headerRow: number,
    dataRow: number,
    spreadsheetId?: string,
  ): Promise<sheets_v4.Schema$Sheet | undefined> {
    const range = `${quoteSheetName(sheetName)}!${headerRow}:${dataRow}`;
    const res = await this.sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId ?? this.spreadsheetId,
      ranges: [range],
      fields:
        "sheets(data(rowData(values(formattedValue,note,dataValidation,effectiveFormat.numberFormat,userEnteredValue.formulaValue))))",
    });

    return res.data.sheets?.[0];
  }
}
