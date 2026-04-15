import { loadConfig } from './config.js';
import { SheetsClient } from './sheets-client.js';

async function main() {
  const config = loadConfig();

  console.error('Config loaded successfully:');
  console.error(JSON.stringify({
    ...config,
    googlePrivateKey: config.googlePrivateKey.substring(0, 27) + '...[REDACTED]',
  }, null, 2));

  const sheetsClient = new SheetsClient(config);

  console.error('\nSmoke test — calling getSpreadsheetInfo()...');
  const info = await sheetsClient.getSpreadsheetInfo();
  console.error('Spreadsheet title:', info.properties?.title);
  console.error('Sheets:', info.sheets?.map((s) => ({
    sheetId: s.properties?.sheetId,
    title: s.properties?.title,
    rowCount: s.properties?.gridProperties?.rowCount,
    columnCount: s.properties?.gridProperties?.columnCount,
  })));
}

main().catch((err) => {
  console.error('Fatal error:', err.message ?? err);
  process.exit(1);
});
