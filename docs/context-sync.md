# Context sync

Say **“Save all context to CTRLpanel in Prompts”** to a chat with the CTRLpanel tools connected. It reads existing notes, saves useful context as Markdown, and reports which notes saved. To resume elsewhere, say **“Read my CTRLpanel context in Prompts.”**

## Activate

1. Use the original project `azlhgjjofnlvfgjrxrct`. For this existing database, run `migrations/20260910-knowledge-context-sync.sql`, the additive Knowledge Base and Context Sync excerpt from the authoritative `supabase-schema.sql`. It creates API keys, stable note identities, server-assigned versions, and Realtime publication without removing existing tables or records.
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

- `GET /api/knowledge/notes?folder=Prompts` returns up to 100 notes and `next_cursor`. Pass that value as `after` for the next page. Omit folder to read the whole library; `external_key` finds a particular external note.
- `POST /api/knowledge/notes` creates or conditionally updates one note:

```json
{
  "external_key": "research/project-a/decisions",
  "folder": "Projects/Project A",
  "title": "Decisions",
  "content": "# Decisions\n\nThe relevant context…",
  "expected_updated_at": "COPY THE EXACT updated_at FROM THE LAST READ"
}
```

Omit `expected_updated_at` for a new note. Reusing the same key and identical content is idempotent. A changed existing note requires its current timestamp; HTTP 409 means read and merge first. Renames/moves retain the stable key. Updates preserve tags, pins, and project assignments. Save multiple notes with separate calls and report partial failures. Never infer the owner from a body field: the server resolves ownership exclusively from the API key.

## Synchronization behavior

- Editor changes autosave after one second of inactivity; typing remains available during requests.
- Realtime refreshes the library and project graphs. A 20-second fallback plus focus/online refresh catches missed events.
- Unsaved drafts are retained in this browser, keyed by account and project scope. They are not available on another device until the server save succeeds.
- A remote update never replaces a dirty editor buffer. Conflicts retain your work; export or copy it before reloading the latest saved version and merging.
- This captures user-requested chat context. It does not monitor every chat, watch arbitrary filesystem folders, or retrieve inaccessible conversation histories.

## Verification

Run `node --test tests/context-sync.test.mjs tests/knowledge.test.mjs` and `npm run build`. Live activation additionally requires verifying two authenticated browsers and the deployed API against the migrated project.
