const WRITE_TOOLS = [
  'create_sheet',
  'rename_sheet',
  'add_rows',
  'add_columns',
  'update_row',
  'delete_rows',
];

export function resolveScope(enabledTools: readonly string[] | null): string {
  const needsWrite = enabledTools === null || enabledTools.some((t) => WRITE_TOOLS.includes(t));
  return needsWrite
    ? 'https://www.googleapis.com/auth/spreadsheets'
    : 'https://www.googleapis.com/auth/spreadsheets.readonly';
}
