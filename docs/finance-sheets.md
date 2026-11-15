# Finance in Google Sheets

Google Sheets is the finance source of truth. Overview, Net Worth, Cashflow,
Investing, Debt, dashboard widgets, weekly review and the Master Controller's
finance reads use the same workbook. Historical Supabase finance rows are retained
and are not combined with the workbook. The Master Controller directs finance
edits to the dashboard rather than writing old database rows.

## Connect

1. Configure the existing Google Sheets service account credentials on both the
   local server and Cloudflare Worker (`GOOGLE_SERVICE_ACCOUNT_JSON`, or the
   email/key pair). Enable the Google Sheets API. No additional OAuth scopes.
2. Share the workbook with that service account as Editor for editing, or Viewer
   for reading. Finance → Source displays the account address.
3. Use the tabs and row-one headers below. The hidden `_CTRLpanel` tab contains
   `Key, Value` with `version=1`, `currency=USD`, and `owner_email` equal to the
   owner's CTRLpanel sign-in email. Unhide it in Sheets to change the owner email.
4. Open Finance → Connect Sheets, paste the workbook URL, and connect. This saves
   only the connection metadata to your RLS-protected
   `user_settings.ui_preferences.finance` using your session token. No migration.

| Tab | Row-one headers, in default order |
| --- | --- |
| Accounts | ID, Account, Type, Balance, Notes |
| Income | ID, Source, Amount, Frequency, Basis, Include in plan, Notes |
| Budget | ID, Category, Monthly budget, Type, Notes |
| Transactions | ID, Date, Description, Amount, Type, Category ID, Account ID, Notes |
| Holdings | ID, Holding, Ticker, Account ID, Shares, Average cost, Price, Notes |
| History | ID, Date, Net worth, Cash, Investments, Debt |
| Goals | ID, Goal, Target, Current, Notes |

Overview and Guide are optional presentation tabs; Original archive preserves
the previous layout. Keep source-tab names and headers. Entire rows and columns
can be reordered: headers identify fields and permanent IDs identify records.
Every populated source row needs a unique literal ID. The app creates IDs for new
records. Extra columns are preserved; app edits only the contract fields.

## Definitions

- **Cash** includes only Cash accounts. Investments, crypto, personal assets and
  expected funds do not count as cash reserves.
- **Net worth** is known assets (including Receivable balances) less Liability
  balances. Blank balances are unknown. Complete them before saving a snapshot.
- **Take-home plan** includes checked Net/Extra income, normalized from Monthly,
  Weekly, Biweekly or Annual cadence. Gross income, One-off and Unspecified
  cadence are excluded. Gross and unspecified sources cannot be checked into
  the plan in the app.
- **Budget** is recurring monthly planning. Actual spending/income comes only
  from the transaction log. Amounts are positive; Type distinguishes Expense,
  Income and Transfer. Transfers affect neither spending nor income totals.
- **Dates** are ISO text (`YYYY-MM-DD`). The source date columns use text format.
- **Holdings** describe positions within investment accounts. They are never
  added to account balances again. Price is a recorded price, not an automatic
  market quote. Tickers are user supplied. No historical returns are invented.
  Investing's Market context chart uses the existing Yahoo Finance API for live
  quotes and historical prices without writing back to Sheets. Its combined
  chart uses current share counts for the whole period; it is a reconstruction,
  not the user's actual historical portfolio returns.
- **Goals** have a target and optional current value. An unknown current value
  stays unknown.

## Edit and refresh behavior

Finance reads refresh every minute while visible, on focus, and on Refresh.
Widgets share one per-user in-memory read; private values are not stored in
localStorage or service-worker caches. A failed read displays an explicit error
and labels any last successful values as stale.

Editing uses a focused dialog and writes only after Save. The backend rereads the
tab, locates the record by ID, and checks its original field values. Stale saves
and removals return `409 conflict`. Formula cells cannot be replaced from the
app; change their inputs in Sheets. New text is written RAW and changed text uses
literal `stringValue` cells, so descriptions cannot turn into executable formulas.
Removal clears only contract cells without shifting other rows or references.

The pre-save check catches changes since the dialog opened. Google Sheets does
not provide an atomic compare-and-set for cells, so simultaneous external edits
in the brief interval between check and write remain a limitation. Use one editor
at a time for the same record.

Every finance request validates the workbook's owner email. Write targets come
from that user's saved connection; client-supplied spreadsheet targets are
ignored. The generic CRM Sheets routes enforce the same finance owner check and
refuse finance writes, preventing them from bypassing this contract.

## API

Finance always shows total assets and excludes liability accounts from its displayed
totals and account editor. Debt has no Settings toggle, navigation/search entry or
dashboard panel; old Debt links redirect to Finance Overview. Older saved debt
preferences are ignored. Historical asset totals are reconstructed as recorded net
worth plus recorded debt. Workbook records and saved snapshots keep their original
values. Monthly bills stay in the spending plan. No migration is needed.

Both Express and Cloudflare dispatch to `backend/financeSheets.js`:

- `GET /api/finance/sheets/status` — credential readiness and your saved connection
- `GET /api/finance/sheets/workbook` — typed rows and formula locks
- `POST /api/finance/sheets/connect` — `{spreadsheetId}`
- `POST /api/finance/sheets/disconnect` — unlink; never deletes the workbook
- `POST /api/finance/sheets/record` — `{table,recordId?,version?,values?,remove?}`
- `POST /api/finance/sheets/snapshot` — `{date}` using the browser's local day

Reads refuse incomplete schemas, duplicate IDs, bad numeric cells, formula
errors and records beyond the 5,000-row per-tab limit rather than silently
publishing partial financial totals. `tests/financeSheets.test.mjs` covers the
contract, calculations, safe writes, ownership and both API access paths.
