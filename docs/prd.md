# Product Requirements Document (PRD)

**Project Name:** MCP Google Sheets (MVP)
**Platform:** Node.js
**Target Audience:** Users, Developers, Internal Team Members
**Current Phase:** MVP (Minimum Viable Product)

---

## 1. Project Overview

Create a Node.js-based Model Context Protocol (MCP) Server that allows AI Agents (like Claude Code) to interact directly with a specified Google Sheet. This server acts as an automated bridge, enabling the AI to read, write, and manage sheet structures internally without requiring manual user authentication (such as a browser pop-up).

## 2. Objectives

- **Simplicity:** Configuration is handled entirely through a single `.env` file. No need to manage external JSON credential files.
- **Full Automation:** Utilize Google Service Accounts so the AI can run continuously in the background (headless).
- **Security & Token Optimization:** Provide an `TOOLS` mechanism to restrict the Agent's capabilities. Exposing too many tools can consume thousands of tokens just for the system prompt.
- **Team-friendly:** Support basic audit trails for team members sharing the same Service Account.

## 3. Core User Stories

1.  **As a user**, I want to quickly configure the `.env` file by copying my Service Account Email and Private Key directly into it, so the MCP Server can connect without needing external files or browser logins.
2.  **As a user**, I want to set `TOOLS=get_spreadsheet_info,get_sheet_data` to ensure the Agent can only read and aggregate data without the risk of overwriting original data.
3.  **As a user**, I want to set `TOOLS=add_rows` so the Agent can run background tasks (like crawling data or checking logs) and automatically append each result row to the end of the sheet.
4.  **As a user**, I want to configure a `USER_NAME=My_Name` variable in the `.env` file, so that whenever my Agent adds a new row, it automatically appends my name to the data, helping the team track who executed that prompt.

## 4. Functional Requirements

### 4.1. System Configuration

The system must read and require the following environment variables from the `.env` file:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: The exact email address of the Service Account (e.g., `my-agent@project-id.iam.gserviceaccount.com`).
- `GOOGLE_PRIVATE_KEY`: The raw private key string. _(Requirement: Must support parsing the `\n` characters correctly. Users should be instructed to wrap the string in double quotes in the `.env` file)._
- `SPREADSHEET_ID`: The ID of the target Google Sheet (extracted from the Google Sheets URL).
- `TOOLS` (Optional): A comma-separated list of tools allowed to be exposed (e.g., `get_sheet_data,add_rows`). If left blank, **all tools are enabled by default**.
- `USER_NAME` (Optional): The identifier of the user running the MCP locally. Used to append to data when writing.

### 4.2. Tool Capabilities

The server will expose the following 6 standard tools via the MCP protocol.

_Crucial Performance Note:_ All read operations must strictly return "Values" only. Ignore `gridData`, formatting, and UI metadata to save LLM context window tokens.

1.  **`get_spreadsheet_info`**
    - _Input:_ None.
    - _Output:_ Returns JSON containing file metadata (list of sheets, sheet IDs, titles, row/column counts).
2.  **`create_sheet`**
    - _Input:_ `title` (string).
    - _Output:_ Success status & new sheet metadata.
3.  **`rename_sheet`**
    - _Input:_ `sheet_id` (number) or `old_title` (string), `new_title` (string).
    - _Output:_ Success status.
4.  **`get_sheet_data`**
    - _Input:_ `range` (string - e.g., 'Sheet1!A1:D10' or just 'Sheet1' for the whole tab).
    - _Output:_ A 2D array containing the raw cell values.
5.  **`add_rows`**
    - _Input:_ `sheet_name` (string), `values` (2D array).
    - _Secondary Logic:_ If `USER_NAME` is configured in `.env`, the system automatically appends this value to the last column of each row array before writing to Google Sheets.
    - _Output:_ Success status.
6.  **`update_row`**
    - _Input:_ `sheet_name` (string), `row_index` (number), `values` (1D array representing the new data for that specific row).
    - _Output:_ Success status.

## 5. Technical Specifications

- **Language/Runtime:** Node.js (v18+).
- **Core Libraries:**
  - `@modelcontextprotocol/sdk`: Used to initialize the MCP Server and handle stdio communication with Claude Code.
  - `googleapis`: The official Google SDK for calling the Google Sheets API v4.
  - `dotenv`: For environment variable management.
- **Error Handling:**
  - Catch Authentication errors (invalid key parsing, incorrect email) and log them clearly to the terminal.
  - Catch Google API errors (e.g., sheet not found, quota exceeded) and return clear explanatory text to Claude (do not throw exceptions that crash the server).
  - Validate input data for tools (e.g., ensure valid 2D arrays before pushing data to Google Sheets).

## 6. Out of Scope (MVP)

- Authentication via OAuth 2.0 flow (Reserved for V2).
- Google Drive operations (Creating new spreadsheet files, changing folder permissions).
- UI formatting (Cell background colors, bold text, borders).
- Chart and graph generation.
- Batch updating multiple discrete ranges in a single call (can be added later if latency becomes an issue).
