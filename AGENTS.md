# CTRLpanel — Antigravity 2.0 Project Context

## Identity
- App name: CTRLpanel
- Tagline: by cwmccann.pro
- Owner: Cameron McCann
- Local dev URL: http://localhost:5173
- Production URL (future): https://ctrlpanel.cwmccann.pro
- Purpose: Personal Life OS — one app to manage all of Cameron's life

---

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| Database | Supabase (Postgres) |
| AI | Anthropic Claude API (claude-sonnet-4-6) |
| Styling | Plain CSS + CSS custom properties (NO Tailwind, NO component libs) |
| Icons | Tabler Icons (CDN, outline only) |
| Routing | React Router v6 |
| Drag & Drop | @dnd-kit/core (Kanban boards) |
| Charts | Recharts |
| Markdown | react-markdown |

---

## Project Structure
```
ctrlpanel/
├── AGENTS.md                    ← you are here
├── .env                         ← API keys (never commit)
├── vite.config.js
├── package.json
├── index.html
├── backend/
│   ├── server.js                ← Express entry point
│   ├── claude.js                ← All Claude API calls
│   ├── calendar.js              ← Google Calendar OAuth
│   ├── finance.js               ← yFinance + CoinGecko price fetching
│   └── routes/
│       ├── ai.js
│       ├── calendar.js
│       └── finance.js
├── src/
│   ├── main.jsx
│   ├── App.jsx                  ← Router + layout
│   ├── styles/
│   │   ├── globals.css          ← CSS variables + reset
│   │   └── components.css       ← shared component styles
│   ├── lib/
│   │   ├── supabase.js          ← Supabase client (ALL db calls go here)
│   │   ├── api.js               ← fetch helpers for backend routes
│   │   └── helpers.js           ← date, number, string utils
│   ├── components/
│   │   ├── Sidebar.jsx
│   │   ├── MasterController.jsx ← Claude chat panel (global)
│   │   ├── QuickAdd.jsx
│   │   └── shared/
│   │       ├── Card.jsx
│   │       ├── Badge.jsx
│   │       ├── Modal.jsx
│   │       └── Spinner.jsx
│   └── pages/
│       ├── Dashboard.jsx
│       ├── Calendar.jsx
│       ├── ToDo.jsx
│       ├── Agents.jsx
│       ├── Projects.jsx
│       ├── CRM.jsx
│       ├── health/
│       │   ├── Nutrition.jsx
│       │   ├── Supplements.jsx
│       │   └── Fitness.jsx
│       ├── finance/
│       │   ├── NetWorth.jsx
│       │   ├── Budget.jsx
│       │   └── Investing.jsx
│       └── Settings.jsx
```

---

## Design System — FOLLOW EXACTLY

### Color Tokens (CSS variables in globals.css)
```css
:root {
  --bg-base: #0a0808;
  --bg-surface: #141010;
  --bg-elevated: #1a1414;
  --border: #1e1818;
  --border-bright: #2a2020;
  --accent: #e11d48;          /* DEFAULT RED — swappable by user in Settings */
  --accent-dim: rgba(225, 29, 72, 0.12);
  --accent-glow: rgba(225, 29, 72, 0.25);
  --text-primary: #f0e8e8;
  --text-secondary: #8a7070;
  --text-muted: #3d2e2e;
  --font: 'Inter', sans-serif;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --transition: 150ms ease;
}
```

### Accent Color Options (Settings page)
When user picks a color, update `--accent` and `--accent-dim` and `--accent-glow` in :root and save to localStorage.
```
Red (default): #e11d48
Blue:          #3b82f6
Green:         #10b981
Purple:        #8b5cf6
Gold:          #f59e0b
Teal:          #14b8a6
Orange:        #f97316
Pink:          #ec4899
```

### Glass-morphism Cards
```css
.card {
  background: rgba(20, 16, 16, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 0.5px solid var(--border-bright);
  border-radius: var(--radius-lg);
  transition: border-color var(--transition), transform var(--transition);
}
.card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}
```

### Active Nav Item
```css
.nav-item.active {
  color: var(--accent);
  background: var(--accent-dim);
  border-right: 2px solid var(--accent);
}
```

### Master Controller Chat Bar
Animated gradient border pulse on the chat input:
```css
@keyframes pulse-border {
  0%, 100% { border-color: var(--accent); box-shadow: 0 0 0 0 var(--accent-glow); }
  50% { border-color: var(--accent); box-shadow: 0 0 12px 2px var(--accent-glow); }
}
.master-controller-input {
  animation: pulse-border 3s ease-in-out infinite;
}
```

### Agent Status Dots
```css
@keyframes breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}
.status-dot.running { background: var(--accent); animation: breathe 2s ease-in-out infinite; }
.status-dot.stopped { background: var(--text-muted); }
```

### Typography
- Font: Inter (import from Google Fonts in index.html)
- Page titles: 20px, weight 500, color var(--text-primary)
- Section labels: 11px, weight 500, uppercase, letter-spacing 0.08em, color var(--text-muted)
- Body: 13px, weight 400, color var(--text-secondary)
- Values/numbers: 18-24px, weight 500, color var(--text-primary)

---

## Sidebar (Sidebar.jsx) — EXACT STRUCTURE
Width: 148px fixed. Always visible. Never collapses unless Settings toggle.

```
CTRLpanel          ← 13px bold, color var(--text-primary)
by cwmccann.pro    ← 9px, color var(--text-muted)
─────────────────
Dashboard          (ti-layout-dashboard)
Calendar           (ti-calendar)
To Do              (ti-check)
─── FOLDERS ───
▼ Agents           (ti-robot)
    Outreach
    Financial
    Social Media
▼ Projects         (ti-folder)
    ViridianAI
    CTRLpanel
    ContentFactory
▼ Health           (ti-heart)
    Nutrition
    Supplements
    Fitness
▼ Finance          (ti-coin)
    Net Worth
    Budget
    Investing
CRM                (ti-users)
─────────────────
Settings           (ti-settings)  ← pinned to bottom
```

---

## Pages — Full Specifications

### 1. Dashboard (Dashboard.jsx)
- Live clock + greeting ("Good morning/afternoon/evening, Cameron")
- Today's date
- Stats grid (2x2): Net Worth | Open Tasks | Calories Today | Active Agents
- Calendar strip: next 3 events from Google Calendar (placeholder data ok)
- Priority tasks: top 3 tasks due soonest across all boards
- Quick Add bar: [+ Task] [Log Meal] [Log Expense] [Add Event] buttons → open modal
- Master Controller chat bar: full width, bottom of page, glowing border animation
- All cards use glass-morphism

### 2. Calendar (Calendar.jsx)
- Google Calendar OAuth (read + write)
- Views: Month | Week | Day (toggle buttons)
- Create/edit/delete events via modal
- Events color coded by calendar
- Placeholder mock events until OAuth connected
- Backend route: GET /api/calendar/events, POST /api/calendar/events

### 3. To Do / Kanban (ToDo.jsx)
- Board selector dropdown (Global + one per project)
- Columns: Backlog | In Progress | Review | Done
- Drag and drop cards using @dnd-kit/core
- Card: title, description, priority badge (Low/Medium/High/Urgent), due date, project tag, labels
- Click card → detail modal (edit everything)
- Add card button per column
- Add board button
- Supabase tables: tasks, boards

### 4. Agents (Agents.jsx)
- List of agent cards
- Each card: name, description, status dot (running/stopped), toggle on/off, last run timestamp
- Toggle fires POST to agent's webhook_url (stored in Supabase)
- "Add Agent" button → modal with name, description, webhook URL fields
- Agents in Supabase: Outreach Agent, Financial Agent, Social Media Agent
- NOTE: Webhook calls are placeholder — just toggle status in DB for now

### 5. Projects (Projects.jsx)
- Left panel: project list with status badge
- Right panel tabs per project: Overview | Board | Notes | Files | Contacts
- Overview: name, status (Active/Paused/Complete), description, goal, color picker
- Board: embedded Kanban filtered to this project
- Notes: markdown editor (react-markdown + textarea toggle)
- Files: list of external links (title + URL, no actual upload)
- Contacts: linked CRM contacts for this project
- "Add Project" button
- Supabase table: projects

### 6. CRM (CRM.jsx)
COLUMNS (in order):
Business Name | Phone | Email | Business Type | Service | Lead Temp | Rating | Total Reviews | Opening Hours | Search Location | Times Called | Last Touch | Left Voicemail | Notes

SERVICE options (dropdown): Web Design | AI Receptionist | SEO | Social Media Management | Automation | Consulting | Other

LEAD TEMP: Cold (blue) | Warm (amber) | Hot (red) — colored badge

FEATURES:
- Inline cell editing: click any cell to edit, blur to save
- Column visibility toggle (show/hide columns)
- Column reorder (drag column headers)
- Filter bar: filter by any field
- Search: real-time search across all fields
- Sortable column headers (click to sort asc/desc)
- "Add Contact" button → modal
- "Import CSV" button → parse CSV, map columns, insert to Supabase
- Row selection checkboxes → bulk delete
- Supabase table: crm_contacts

### 7. Nutrition (health/Nutrition.jsx)
- Date picker (default today)
- Macro rings (SVG animated circles): Calories | Protein | Carbs | Fat
  - Show current vs goal, percentage filled, color coded
- Micronutrients panel: grid of pills for Vitamin D, B12, C, Iron, Zinc, Magnesium, Omega-3, Potassium
- Meal log: list of meals with time, name, macro summary, photo thumbnail placeholder
- Time chart (Recharts LineChart): toggle 7D / 30D / 90D / Custom
  - Lines: Calories, Protein, Carbs, Fat
- Weight section:
  - Manual weight input (lbs) + date → saves to weight_logs
  - Weight trend line overlaid on calorie chart
- Supabase tables: nutrition_logs, weight_logs
- Goals stored in: user_goals table (calories, protein, carbs, fat targets)

### 8. Supplements (health/Supplements.jsx)
- Stack list: name, dose, timing badge (Morning/Afternoon/Evening/Night), toggle on/off, units remaining
- Low stock warning: red badge when units_remaining < 7
- Daily checklist sidebar: today's supplements by timing slot, checkbox to mark taken
- Streak counter per supplement (consecutive days taken)
- "Add Supplement" button → modal
- AI Stack Evaluator section:
  - Button: "Analyze My Stack" → sends all enabled supplements to Claude API
  - Claude returns: interactions, redundancies, timing optimizations, insights
  - Display response in styled card with sections
- Quick Interaction Checker:
  - Two autocomplete inputs (search supplement/drug name)
  - "Check Interaction" button → sends to Claude API
  - Returns interaction analysis in styled card
- Backend route: POST /api/ai/supplement-analyze, POST /api/ai/interaction-check
- Supabase tables: supplements, supplement_logs

### 9. Fitness (health/Fitness.jsx)
- Weekly schedule grid: Mon-Sun columns, click day to assign workout type
  - Types: Push | Pull | Legs | Upper | Lower | Cardio | Rest | Custom
  - Color coded by type
- Log workout modal: date, workout type, exercises (add rows: exercise name, sets, reps, weight, notes)
- GitHub heatmap: past 52 weeks, green squares = worked out, empty = rest
  - Use SVG grid, color intensity = workout volume
- Consistency stats: current streak, longest streak, workouts this month
- Claude suggestion: "Based on your last 7 days, consider a rest day tomorrow" (manual trigger button)
- Supabase tables: fitness_schedule, workout_logs

### 10. Net Worth (finance/NetWorth.jsx)
- Account list: name | type | balance | last updated
  - Types: Checking | Savings | Investment | Crypto | Real Estate | Vehicle | Liability
  - Assets vs Liabilities separated
- "Add Account" button → modal
- Inline balance editing
- Net worth = sum(assets) - sum(liabilities) → displayed large at top
- Historical snapshots:
  - "Save Snapshot" button → saves current net worth + date to net_worth_snapshots
  - Recharts AreaChart of net worth over time
- Breakdown: Recharts PieChart by account type
- Supabase tables: accounts, net_worth_snapshots

### 11. Budget (finance/Budget.jsx)
- Month selector (prev/next arrows)
- Income section: sources list with name, amount, frequency, type
  - Total monthly income calculated
- Expense categories table:
  - Category name | Type (Fixed/Variable) | Budgeted | Spent | Remaining | Progress bar
  - Color: green (<70% spent) | amber (70-90%) | red (>90%)
- Transaction log: date | amount | category | note | recurring toggle
  - "Add Transaction" button → modal
  - Recurring transactions auto-appear each month
- Summary: Total Income | Total Budgeted | Total Spent | Remaining
- Supabase tables: income_sources, expense_categories, transactions

### 12. Investing (finance/Investing.jsx)
- Holdings table:
  Ticker | Name | Asset Class | Shares | Avg Cost | Current Price | Current Value | Gain/Loss $ | Gain/Loss % | Day Change
- Asset classes: Stocks | ETFs | Crypto | Real Estate | Other
- Live prices:
  - Stocks/ETFs: fetch from backend GET /api/finance/prices?tickers=AAPL,MSFT,...
    Backend uses yfinance Python script called via child_process OR use Alpha Vantage free API
  - Crypto: fetch from CoinGecko API (free, no key needed)
  - Auto-refresh every 10 seconds via setInterval
- Portfolio allocation: Recharts PieChart (by asset class + by holding toggle)
- Performance chart: manual portfolio value snapshots over time (AreaChart)
- Dividends table: holding | amount | date | yield
- "Add Holding" button → modal
- "Add Dividend" button → modal
- Supabase tables: holdings, portfolio_snapshots, dividends

### 13. Settings (Settings.jsx)
- Color Scheme section:
  - 8 color swatches in a grid
  - Click swatch → updates --accent, --accent-dim, --accent-glow on :root
  - Saves to localStorage key 'ctrlpanel-accent'
  - Label under active swatch
- Display section:
  - Sidebar: Full / Collapsed toggle
  - Font size: Small / Medium / Large
- API Connections section:
  - Anthropic API Key: password input + save button
  - Google Calendar: "Connect Google Calendar" OAuth button
  - Supabase URL + Anon Key: inputs + save
- Data section:
  - Export All Data (JSON) button
  - Import Data button
  - Danger zone: Reset All Data (red, confirm modal)

---

## Master Controller (MasterController.jsx)

### UI
- Slide-in panel from right side (toggle button in header)
- Also embedded at bottom of Dashboard
- Voice input: Web Speech API (Chrome) — mic button toggles listening
- Text input with Enter to send
- Streamed response (token by token)
- Message history shown in chat bubbles
- Clear history button

### Claude API System Prompt (sent with every message)
See MASTER_CONTROLLER_PROMPT.md for the full system prompt.

### Tool Definitions (function calling)
Claude has these tools available:
```json
[
  { "name": "navigate_to", "description": "Navigate to a page", "params": { "page": "string" } },
  { "name": "create_task", "description": "Create a new task", "params": { "title": "string", "board": "string", "priority": "string", "due_date": "string", "project": "string" } },
  { "name": "move_task", "description": "Move task to different column", "params": { "task_id": "string", "column": "string" } },
  { "name": "log_expense", "description": "Log a financial transaction", "params": { "amount": "number", "category": "string", "note": "string", "date": "string" } },
  { "name": "log_weight", "description": "Log a weight entry", "params": { "weight": "number", "date": "string" } },
  { "name": "add_crm_contact", "description": "Add a CRM contact", "params": { "business_name": "string", "phone": "string", "email": "string", "service": "string", "lead_temp": "string" } },
  { "name": "get_summary", "description": "Get summary of a module's data", "params": { "module": "string" } },
  { "name": "toggle_agent", "description": "Toggle an agent on or off", "params": { "agent_name": "string", "status": "string" } }
]
```

---

## Supabase Schema — Create ALL These Tables

```sql
-- Tasks & Boards
create table boards (id uuid primary key default gen_random_uuid(), name text, project_id uuid, columns jsonb default '["Backlog","In Progress","Review","Done"]', created_at timestamptz default now());
create table tasks (id uuid primary key default gen_random_uuid(), title text, description text, board_id uuid references boards(id), column_name text default 'Backlog', priority text default 'Medium', due_date date, labels jsonb, project_id uuid, created_at timestamptz default now());

-- Projects
create table projects (id uuid primary key default gen_random_uuid(), name text, status text default 'Active', description text, goal text, color text default '#e11d48', created_at timestamptz default now());

-- CRM
create table crm_contacts (id uuid primary key default gen_random_uuid(), business_name text, phone text, email text, business_type text, service text, lead_temp text default 'Cold', rating numeric, total_reviews integer, opening_hours text, search_location text, times_called integer default 0, last_touch date, left_voicemail boolean default false, notes text, created_at timestamptz default now());

-- Health: Nutrition
create table nutrition_logs (id uuid primary key default gen_random_uuid(), meal_name text, calories numeric, protein numeric, carbs numeric, fat numeric, micros jsonb, photo_url text, logged_at timestamptz default now());
create table weight_logs (id uuid primary key default gen_random_uuid(), weight numeric, logged_at timestamptz default now());
create table user_goals (id uuid primary key default gen_random_uuid(), calories numeric default 2400, protein numeric default 180, carbs numeric default 250, fat numeric default 80, updated_at timestamptz default now());

-- Health: Supplements
create table supplements (id uuid primary key default gen_random_uuid(), name text, dose text, timing text, enabled boolean default true, units_remaining integer, notes text, created_at timestamptz default now());
create table supplement_logs (id uuid primary key default gen_random_uuid(), supplement_id uuid references supplements(id), taken_at timestamptz default now());

-- Health: Fitness
create table fitness_schedule (id uuid primary key default gen_random_uuid(), day_of_week text, workout_type text, notes text);
create table workout_logs (id uuid primary key default gen_random_uuid(), workout_type text, completed_at timestamptz default now(), exercises jsonb, notes text);

-- Finance: Net Worth
create table accounts (id uuid primary key default gen_random_uuid(), name text, type text, balance numeric default 0, updated_at timestamptz default now());
create table net_worth_snapshots (id uuid primary key default gen_random_uuid(), total numeric, snapshot_date date default current_date);

-- Finance: Budget
create table income_sources (id uuid primary key default gen_random_uuid(), name text, amount numeric, frequency text, type text, created_at timestamptz default now());
create table expense_categories (id uuid primary key default gen_random_uuid(), name text, type text default 'Variable', budgeted numeric default 0, created_at timestamptz default now());
create table transactions (id uuid primary key default gen_random_uuid(), amount numeric, category_id uuid references expense_categories(id), note text, date date default current_date, recurring boolean default false, created_at timestamptz default now());

-- Finance: Investing
create table holdings (id uuid primary key default gen_random_uuid(), ticker text, name text, asset_class text, shares numeric, avg_cost numeric, manual_price numeric, created_at timestamptz default now());
create table portfolio_snapshots (id uuid primary key default gen_random_uuid(), total_value numeric, snapshot_date date default current_date);
create table dividends (id uuid primary key default gen_random_uuid(), holding_id uuid references holdings(id), amount numeric, paid_date date, created_at timestamptz default now());

-- Agents
create table agents (id uuid primary key default gen_random_uuid(), name text, description text, webhook_url text, status text default 'stopped', last_run timestamptz, created_at timestamptz default now());

-- Settings
create table settings (id uuid primary key default gen_random_uuid(), accent_color text default '#e11d48', sidebar_collapsed boolean default false, font_size text default 'medium', updated_at timestamptz default now());
```

---

## Environment Variables (.env)
```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
ANTHROPIC_API_KEY=your_anthropic_api_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
PORT=3001
```

---

## Build Order (follow this sequence)
1. Scaffold Vite + React project + Express backend
2. Install all dependencies
3. Create globals.css with full design system
4. Build Sidebar.jsx with React Router navigation
5. Build App.jsx layout (sidebar + main content area + MasterController slide-in)
6. Dashboard.jsx (with mock data)
7. ToDo.jsx (Kanban with dnd-kit)
8. CRM.jsx (full table)
9. Projects.jsx
10. Agents.jsx
11. Nutrition.jsx
12. Supplements.jsx
13. Fitness.jsx
14. NetWorth.jsx
15. Budget.jsx
16. Investing.jsx (with live price polling)
17. Calendar.jsx (Google OAuth)
18. Settings.jsx
19. MasterController.jsx (Claude API streaming)
20. Wire all Supabase connections
21. Wire backend routes (Claude AI, Calendar, Finance prices)

---

## Dependencies to Install
```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.20.0",
    "@dnd-kit/core": "^6.0.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@supabase/supabase-js": "^2.39.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "react-markdown": "^9.0.0",
    "recharts": "^2.10.0",
    "cors": "^2.8.5",
    "dotenv": "^16.0.0",
    "express": "^4.18.0",
    "node-fetch": "^3.3.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.0.0"
  }
}
```

---

## Rules — Agent Must Follow
1. Read this file at the start of EVERY session before writing any code
2. Never use Tailwind, Bootstrap, or any CSS framework
3. Never use MUI, Chakra, ShadCN, or any component library
4. Pure CSS with CSS custom properties only
5. All Supabase calls go through /src/lib/supabase.js — never call Supabase directly in a component
6. All Claude API calls go through /backend/claude.js — never expose API key to frontend
7. One component per file, one page per file
8. Use mock/placeholder data if real API not connected — never leave a page blank
9. Every page must be visually complete and styled before moving to the next
10. Apply glass-morphism, animations, and full design system on every page
11. Check what already exists before writing new files to avoid overwriting
