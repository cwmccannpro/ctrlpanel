# Context sync

Say **“Save all context to CTRLpanel in Prompts”** to a chat with the CTRLpanel tools connected. It reads existing notes, saves useful context as Markdown, and reports which notes saved. To resume elsewhere, say **“Read my CTRLpanel context in Prompts.”**

## Activate

1. Use the original project `azlhgjjofnlvfgjrxrct`. For this existing database, run `migrations/20260910-knowledge-context-sync.sql`, then `migrations/20261005-project-knowledge-vault-sync.sql`. They create API keys, stable note identities, project-aware writes, the legacy project-note copy, server-assigned versions, and Realtime publication without removing existing records.
2. Set that project's URL and public anon key in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Keep its matching `SUPABASE_SERVICE_ROLE_KEY` on the backend only. Never put the service-role key in a VITE variable or a chat-tool configuration.
3. Deploy with the project's Cloudflare workflow and use its HTTPS address on both computers. `localhost:5173` is suitable only for same-computer development.
4. In Knowledge Base → Context sync, create one key per device/client. Store the key in the client's configuration. It can read and update your entire Knowledge Base. Revoke individual keys from that panel.
5. Click **Initialize Prompts folder**, or ask the connected assistant to run `initialize_prompts`. This adds the requested prompt once and preserves subsequent edits.

## Claude Desktop and other local MCP clients

The bridge is `tools/ctrlpanel-mcp.mjs`. Install Node 20+ on each device and copy the project files (including `src/lib/contextPrompt.js`), or point to a local checkout. Merge the following server into the client's MCP configuration; preserve other servers:

```json
{
  "mcpServers": {
    "ctrlpanel": {
      "command": "node",
      "args": ["C:/path/to/Ctrlpanel/tools/ctrlpanel-mcp.mjs"],
      "env": {
        "CTRLPANEL_URL": "https://YOUR-DEPLOYED-CTRLPANEL",
        "CTRLPANEL_CONTEXT_KEY": "ctpk_YOUR_CLIENT_KEY"
      }
    }
  }
}
```

Enable the tools in the client and restart it if required. This is a local **stdio** MCP bridge, not a remote MCP connector URL. Claude web/Cowork remote connectors require a separately hosted MCP transport; the REST URL is not a remote MCP endpoint. [Claude connector guidance](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## REST contract

Every request uses `Authorization: Bearer ctpk_…`. Keys are SHA-256 hashed in the database; raw keys are shown only at creation.

- `GET /api/knowledge/notes?folder=Prompts` returns up to 100 notes and `next_cursor`. Pass that value as `after` for the next page. Omit folder to read the whole library; `external_key` finds a particular external note. Add `include_projects=1` to receive the owner's `{id,name,status}` project index for vault mapping.
- `POST /api/knowledge/notes` creates or conditionally updates one note:

```json
{
  "external_key": "research/project-a/decisions",
  "folder": "Projects/Project A",
  "title": "Decisions",
  "content": "# Decisions\n\nThe relevant context…",
  "project_id": "THE-OWNED-PROJECT-UUID",
  "expected_updated_at": "COPY THE EXACT updated_at FROM THE LAST READ"
}
```

Omit `expected_updated_at` for a new note. Reusing the same key and identical content is idempotent. A changed existing note requires its current timestamp; HTTP 409 means read and merge first. Renames/moves retain the stable key. Updates preserve tags and pins. Save multiple notes with separate calls and report partial failures. Never infer the owner from a body field: the server resolves ownership exclusively from the API key.

`project_id` is optional. When present, it must be an owned project UUID or `null`; ownership is checked inside the same database transaction as the note write. Omitting it preserves an existing assignment.

## Synchronization behavior

- Editor changes autosave after one second of inactivity; typing remains available during requests.
- Realtime refreshes the library and project graphs. A 20-second fallback plus focus/online refresh catches missed events.
- Unsaved drafts are retained in this browser, keyed by account and project scope. They are not available on another device until the server save succeeds.
- A remote update never replaces a dirty editor buffer. Conflicts retain your work; export or copy it before reloading the latest saved version and merging.
- This captures user-requested chat context. It does not monitor every chat, watch arbitrary filesystem folders, or retrieve inaccessible conversation histories.

## Verification

Run `node --test tests/context-sync.test.mjs tests/knowledge.test.mjs` and `npm run build`. Live activation additionally requires verifying two authenticated browsers and the deployed API against the migrated project.

## Two-way Markdown vault

The local bridge in `tools/ctrlpanel-vault-sync.mjs` synchronizes Markdown in both
directions without giving the browser filesystem access. Configure these values in the
ignored `.env.local` file on the computer that owns the vault:

```dotenv
CTRLPANEL_URL=https://YOUR-DEPLOYED-CTRLPANEL
CTRLPANEL_VAULT_KEY=ctpk_KEY_CREATED_IN_CONTEXT_SYNC
CTRLPANEL_VAULT_ROOT=C:\path\to\your\vault
CTRLPANEL_VAULT_PROJECTS_DIR=Projects
```

Run `npm run vault:sync` for one pass or `npm run vault:watch` for continuous sync.
The watcher also pulls once per minute so browser edits arrive even when no local file
changes. It skips `.obsidian`, `.git`, `.trash`, `node_modules`, non-Markdown files, and
files over 750 KB.

On Windows, run `powershell -ExecutionPolicy Bypass -File tools/install-vault-sync-task.ps1`
once after `.env.local` is configured. It installs and starts the per-user hidden task
**CTRLpanel Markdown Vault Sync**, which launches at sign-in and runs only while that user
is logged in. Disable or delete that task to pause automatic syncing.

On first sync, each file receives preserved YAML frontmatter containing a stable
`ctrlpanel_key`, its remote version, and project metadata. A note under
`Projects/<exact CTRLpanel project name>/...` is attached to that project automatically.
You can alternatively set `ctrlpanel_project` or `ctrlpanel_project_id` in frontmatter.
Project ownership is verified by the API and database before the assignment is saved.

The bridge uses version checks in both directions. If the local and CTRLpanel copies
changed from the same baseline, neither is overwritten: the remote version is written
beside the local file as `*.ctrlpanel-conflict-<timestamp>.md` for manual merging.
Deleting a file or note is deliberately not propagated; the surviving copy is restored
on the next pass. Status and baselines are stored in ignored
`.vault-sync-status.local` and `.vault-sync-state.local` files in this checkout.

## Linked project context files

`tools/ctrlpanel-file-sync.mjs` pushes curated, shallow Markdown context files from
several local projects into the Knowledge Base. It is one-way (local file ->
CTRLpanel) and config-driven: the projects live in the ignored local file
`tools/context-projects.json` (see `tools/context-projects.example.json`). Each entry has:

- `name` and `key` - display name and stable key slug (never change `key` once synced;
  note keys are `files/<key>/<relative path>` and `files/<key>/index`).
- `root` and `folder` - the local project folder and the Knowledge folder
  (`Projects/Content Engine/<channel>`, `Projects/ONYX/<subproject>`, `Projects/Ctrlpanel`, ...).
- `project` - optional CTRLpanel project name; notes are attached via `project_id` when an
  owned project with that exact (case-insensitive) name exists. A manual reassignment
  in CTRLpanel is never overridden.
- `files` - relative paths or single-segment `*` globs, at most three levels deep
  (for example `docs/*.md`). Omit it to use the default list (`CLAUDE.md`, `AGENTS.md`,
  `AGENT.md`, `GEMINI.md`, `README.md`, `CHANNEL.md`, `EDITORIAL.md`, `STYLE.md`,
  `LEARNINGS.md`, `AUTOMATION.md`, `LONGFORM.md`, `*CONTEXT*.md`,
  `MASTER_CONTROLLER_PROMPT.md`, `SETUP_INSTRUCTIONS.md`).
- Optional `exclude`, `labels` (per-file title overrides), `kind`, `scope`, `enabled`.

`globalExclude` keeps `ONYX_CONTEXT.md` out: that file has its own live two-way sync
(see Onyx Lead Finder `Context Sync.md`). Only Markdown is read. Wildcards never enter
dot-folders, `node_modules`, `.git`, `dist`, `.wrangler`, or virtual environments; `.env*`
files are never read. Canonical Obsidian symlink targets are followed. Empty files and
files over 750 KB are skipped, and a file that looks like it contains credentials is
skipped (recorded in the status file) instead of being uploaded.

Each project gets an index note (titled with the project name) linking its context notes;
real filename references between files become wiki links.

Commands (run from this checkout):

- Add a project: `node tools/ctrlpanel-file-sync.mjs --add --name "My Project" --root "C:\path\to\My Project" --folder "Projects/My Project" --match "My Project"`
  (optional `--files "README.md,docs/*.md"`, `--exclude "X.md"`, `--key my-project`, `--kind Channel`).
- Preview: `node tools/ctrlpanel-file-sync.mjs --dry-run [--project "My Project"]`
  (read-only API checks; `--offline` skips the network entirely).
- Synchronize now: `node tools/ctrlpanel-file-sync.mjs [--project "My Project"]`.
- Results: `.context-sync-status.local` (per-project notes, statuses, skipped files and reasons).

Local `.env.local` contains `CTRLPANEL_URL` and a revocable `CTRLPANEL_CONTEXT_KEY` created
for this bridge (`CTRLPANEL_CONTEXT_ROOT` is only a legacy fallback when no config exists).
The key is never printed, committed, or sent to the frontend.

On this computer, Windows Task Scheduler runs **CTRLpanel Context Sync** daily at 8:17 AM
for the signed-in user (hidden window, runs on battery, starts when available after a
missed run). It replaced the old two-minute **CTRLpanel Confuzed Guy Context Sync** task.
The computer must be on and online; local filesystem access cannot run inside the
deployed Cloudflare Worker. Pause it by disabling the task.

Project attachment requires `migrations/20261005-project-knowledge-vault-sync.sql` on the
deployed database (`save_context_note_v2`). Until then notes are saved unassigned and the
status file says so; once the migration is applied the next run attaches them.

Source files are authoritative. If a Knowledge note's content, title, or folder
changes outside this bridge, the bridge marks a conflict and leaves both copies
intact. Reconcile the edit into the source and make the Knowledge note match the
next generated content to resume. It never deletes notes when a source disappears or a
project is removed from the config, never overwrites browser edits blindly, and never
writes changes back to local files. Local hashes are saved in `.context-sync-state.local`;
a lost state causes changed existing notes to pause rather than overwrite them. These
`.local` files are ignored.
