# CTRLpanel — Complete Setup Instructions
# For Antigravity 2.0
# Cameron McCann | cwmccann.pro

==============================================
BEFORE YOU OPEN ANTIGRAVITY — DO THESE FIRST
==============================================

STEP 1: CREATE YOUR SUPABASE PROJECT
──────────────────────────────────────
1. Go to https://supabase.com and sign in
2. Click "New Project"
3. Name it: ctrlpanel
4. Choose a region close to you
5. Set a database password (save it somewhere)
6. Wait ~2 minutes for it to provision
7. Go to Settings → API
8. Copy your Project URL and anon public key — you'll need these

STEP 2: RUN THE DATABASE SCHEMA
──────────────────────────────────────
1. In your Supabase project, click "SQL Editor" in the left sidebar
2. Click "New Query"
3. Open the file: supabase-schema.sql (included in this folder)
4. Copy the entire contents and paste into the SQL Editor
5. Click "Run"
6. You should see "Success. No rows returned"
7. Click "Table Editor" to verify all tables were created

STEP 3: GET YOUR API KEYS
──────────────────────────────────────
Anthropic (Claude API):
1. Go to https://console.anthropic.com
2. Click API Keys → Create Key
3. Copy the key (starts with sk-ant-)

Google Calendar (optional, do later):
1. Go to https://console.cloud.google.com
2. Create a new project called "ctrlpanel"
3. Enable the Google Calendar API
4. Go to Credentials → Create OAuth 2.0 Client ID
5. Application type: Web application
6. Authorized redirect URI: http://localhost:3001/api/calendar/callback
7. Copy Client ID and Client Secret

STEP 4: CREATE YOUR PROJECT FOLDER
──────────────────────────────────────
1. Create a new folder on your computer: ~/Projects/ctrlpanel
2. Copy ALL files from this package into that folder:
   - AGENTS.md          → ctrlpanel/AGENTS.md
   - MASTER_CONTROLLER_PROMPT.md → ctrlpanel/MASTER_CONTROLLER_PROMPT.md
   - PROMPTS.md         → ctrlpanel/PROMPTS.md
   - supabase-schema.sql → ctrlpanel/supabase-schema.sql (already ran, keep for reference)
   - .env.example       → ctrlpanel/.env.example
   - .agents/skills/ctrlpanel.md → ctrlpanel/.agents/skills/ctrlpanel.md

3. Copy .env.example to .env:
   - On Mac/Linux: cp .env.example .env
   - On Windows: copy .env.example .env

4. Open .env and fill in your actual values:
   VITE_SUPABASE_URL=https://your-actual-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-actual-anon-key
   ANTHROPIC_API_KEY=sk-ant-your-actual-key
   (leave Google keys blank for now if you skipped Step 3)

STEP 5: CREATE A .gitignore
──────────────────────────────────────
Create a file called .gitignore in your ctrlpanel folder with:

   .env
   node_modules/
   dist/
   .DS_Store

==============================================
NOW OPEN ANTIGRAVITY 2.0
==============================================

STEP 6: OPEN YOUR PROJECT IN ANTIGRAVITY
──────────────────────────────────────
1. Launch Antigravity 2.0
2. File → Open Folder → select your ctrlpanel folder
3. Antigravity will scan the folder and read AGENTS.md automatically

STEP 7: PASTE THE INITIAL PROMPT
──────────────────────────────────────
Open PROMPTS.md and copy the INITIAL PROMPT section.
Paste it into the Antigravity agent chat and press Enter.

The agent will:
- Read AGENTS.md
- Scaffold the React + Vite project
- Set up the Express backend
- Install all dependencies
- Build the design system (globals.css)
- Build the Sidebar navigation
- Build the Dashboard
- Open it in the built-in browser

This will take several minutes. Let it run.

STEP 8: VERIFY IT WORKS
──────────────────────────────────────
When the agent finishes, you should see CTRLpanel running in the browser:
- Dark background (#0a0808)
- Red accent sidebar with CTRLpanel logo
- Dashboard with stats, calendar strip, tasks, and chat bar
- All nav items clickable

If something looks wrong, tell the agent specifically what's off.

==============================================
CONTINUING DEVELOPMENT
==============================================

EVERY NEW ANTIGRAVITY SESSION:
Open the chat and paste:
   "Read AGENTS.md, scan /src/pages/ to see what's built, 
    continue with the next page in the build order."

TO BUILD A SPECIFIC MODULE:
Find the module-specific prompt in PROMPTS.md and paste it.

TO FIX SOMETHING:
   "Read AGENTS.md. The [page name] page has [issue]. Fix it 
    without breaking anything else."

TO ADD A FEATURE:
   "Read AGENTS.md. On the [page name] page, add [feature]. 
    Match the existing design system exactly."

==============================================
FOLDER STRUCTURE AFTER BUILD
==============================================

ctrlpanel/
├── AGENTS.md                 ← Antigravity reads this every session
├── MASTER_CONTROLLER_PROMPT.md
├── PROMPTS.md
├── supabase-schema.sql
├── .env                      ← your keys (never commit)
├── .env.example              ← template (safe to commit)
├── .gitignore
├── .agents/
│   └── skills/
│       └── ctrlpanel.md     ← resume skill
├── package.json
├── vite.config.js
├── index.html
├── backend/
│   ├── server.js
│   ├── claude.js
│   ├── calendar.js
│   ├── finance.js
│   └── routes/
│       ├── ai.js
│       ├── calendar.js
│       └── finance.js
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── styles/
    │   ├── globals.css
    │   └── components.css
    ├── lib/
    │   ├── supabase.js
    │   ├── api.js
    │   └── helpers.js
    ├── components/
    │   ├── Sidebar.jsx
    │   ├── MasterController.jsx
    │   ├── QuickAdd.jsx
    │   └── shared/
    │       ├── Card.jsx
    │       ├── Badge.jsx
    │       ├── Modal.jsx
    │       └── Spinner.jsx
    └── pages/
        ├── Dashboard.jsx
        ├── Calendar.jsx
        ├── ToDo.jsx
        ├── Agents.jsx
        ├── Projects.jsx
        ├── CRM.jsx
        ├── health/
        │   ├── Nutrition.jsx
        │   ├── Supplements.jsx
        │   └── Fitness.jsx
        ├── finance/
        │   ├── NetWorth.jsx
        │   ├── Budget.jsx
        │   └── Investing.jsx
        └── Settings.jsx

==============================================
WHEN YOU'RE READY TO DEPLOY
==============================================

1. Push to GitHub:
   git init
   git add .
   git commit -m "initial ctrlpanel build"
   git remote add origin your-github-repo-url
   git push -u origin main

2. Deploy frontend to Vercel:
   - Go to vercel.com → New Project → Import your GitHub repo
   - Add all .env variables in Vercel's Environment Variables section
   - Deploy → your app will be live

3. Point ctrlpanel.cwmccann.pro to Vercel:
   - In Vercel → your project → Settings → Domains
   - Add: ctrlpanel.cwmccann.pro
   - Add a CNAME record in your DNS pointing to cname.vercel-dns.com

4. Deploy backend to Railway:
   - Go to railway.app → New Project → from GitHub
   - Select your repo, set root to /backend
   - Add environment variables
   - Deploy

==============================================
SUPPORT
==============================================
Built for Cameron McCann | cwmccann.pro
App: CTRLpanel | ctrlpanel.cwmccann.pro
