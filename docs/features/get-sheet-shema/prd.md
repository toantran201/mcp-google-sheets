# Feature Specification: Advanced Sheet Schema Extraction (`get_sheet_schema`)

## 1. Feature Overview

The `get_sheet_schema` tool provides the AI Agent with a structural "map" of a specific Google Sheet tab. Unlike a simple data read, this tool inspects the underlying rules of the spreadsheet, such as data validation (dropdowns), data types, checkboxes, formula-protected fields, and instructional notes. This enables the Agent to format its input correctly and avoid errors before attempting any write operations.

## 2. User Story

**As a user**, I want the AI Agent to understand the specific rules and constraints of my spreadsheet—even if the table is not at the top of the sheet—so it can intelligently fill in dropdowns, respect date formats, and avoid overwriting my calculated formulas.

## 3. Input Parameters

- `sheet_name` (String, Required): The exact name of the tab/sheet to analyze.
- `header_row` (Number, Optional): The row index where the column headers are located. Defaults to `1`.
- `data_row` (Number, Optional): The row index containing sample data or validation rules. Defaults to `header_row + 1`.
- `spreadsheet_id` (String, Optional): The target Spreadsheet ID. If omitted, falls back to the default ID in `.env`.

## 4. Functional Requirements & Logic

### 4.1. Dynamic Range Inspection

- The tool must fetch data specifically from the `header_row` and `data_row` to support "Free-style" layouts where the actual table might start further down the page.
- Recommended internal range: `${sheet_name}!A${header_row}:Z${data_row}`.

### 4.2. Metadata Extraction Scope

The tool must extract and return the following attributes for each detected column:

1.  **Column Name:** The string value found at the `header_row`.
2.  **Dropdown Options:** Allowed values from Data Validation (Condition type: `ONE_OF_LIST` or `ONE_OF_RANGE`).
3.  **Checkboxes:** Detect if the column is configured as a `BOOLEAN` (checkbox) type.
4.  **Data Type Intelligence:** Detect if the column is formatted specifically as a `DATE`, `NUMBER`, or `CURRENCY`.
5.  **Formula Protection (Read-Only):** Identify if a cell in the `data_row` contains a formula (`userEnteredValue.formulaValue`).
6.  **Instructional Notes:** Extract any "Notes" (yellow pop-up comments) attached to the header cell.

### 4.3. Payload Optimization

- The implementation must use a strict `fields` mask to ensure the response remains lightweight and does not consume excessive LLM tokens.
- Required fields: `sheets(data(rowData(values(formattedValue,note,dataValidation,effectiveFormat.numberFormat,userEnteredValue.formulaValue))))`.

## 5. Expected Output Format

The tool returns a JSON object where each key is a column header, containing its specific constraints.

**Example Response:**

```json
{
  "Developer": {
    "type": "dropdown",
    "allowed_values": ["Hai Dang Hoang", "Hau Nguyen Cong", "Duc Le"],
    "note": "Select the lead dev for this task",
    "is_formula": false
  },
  "Status": {
    "type": "dropdown",
    "allowed_values": ["Open", "In Progress", "Fixed", "Closed"],
    "is_formula": false
  },
  "Is Verified": {
    "type": "checkbox",
    "is_formula": false
  },
  "Due Date": {
    "type": "date",
    "is_formula": false
  },
  "Subtotal": {
    "type": "number",
    "is_formula": true,
    "note": "Automatically calculated, do not edit"
  }
}
```

## 6. Error Handling
- Missing Sheet: Return a clear message if sheet_name is not found.
- Empty Headers: If the header_row is empty, advise the Agent to check the sheet structure first using get_sheet_data.
- Permission Denied: Return a 403 error message if the Service Account lacks "Editor" or "Viewer" access.