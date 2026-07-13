// ============================================================
// CTRLpanel — Email Triage (multi-account Gmail)
//
// Connect N Gmail accounts per user (each labeled with a short alias),
// scan unread mail from the last 24h, categorize via Claude
// (backend/claude.js → triageCategorize), and persist one brief per run
// (triage_runs + triage_items). Suggested replies are stored as text;
// "Approve → create draft" makes a native Gmail draft — CTRLpanel NEVER
// sends mail (no send scope is ever requested).
//
// Same app-level Google OAuth client as Calendar (GOOGLE_CLIENT_ID/SECRET)
// with its own redirect URI. Tokens live in gmail_accounts (service-role
// only; the browser never sees them). Plain REST fetch throughout so the
// module runs in local Express dev AND the Cloudflare Worker (AGENTS.md
// rule 6). Every Gmail API call is scoped to one account row, so accounts
// never bleed into each other.
// ============================================================
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { triageCategorize } from './claude.js';

const OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const OAUTH_REVOKE = 'https://oauth2.googleapis.com/revoke';
const USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Read + label/mark + create drafts. Deliberately NO gmail.send.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const MAX_MESSAGES_PER_ACCOUNT = 50;

// Lazily created so process.env is read at call time (Workers populate it on
// first request via the nodejs_compat flag).
let _admin = null;
function admin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) _admin = createClient(url, key, { auth: { persistSession: false } });
  return _admin;
}

// Own redirect URI (defaults to the Calendar one with /calendar/ → /gmail/,
// so one extra Authorized redirect URI on the same Google OAuth client).
function redirectUri() {
  if (process.env.GMAIL_REDIRECT_URI) return process.env.GMAIL_REDIRECT_URI;
  return (process.env.GOOGLE_REDIRECT_URI || '').replace('/api/calendar/callback', '/api/gmail/callback');
}

export function gmailReady() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && redirectUri() && admin());
}

/* ---- Stateless signed OAuth state (carries user id + alias round-trip) ---- */
const stateSecret = () => process.env.GOOGLE_CLIENT_SECRET || 'ctrlpanel-state';

export function signGmailState(userId, alias) {
  const payload = Buffer.from(JSON.stringify({ u: userId, a: alias, e: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  const sig = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyGmailState(state) {
  const [payload, sig] = String(state || '').split('.');
  const expect = createHmac('sha256', stateSecret()).update(payload || '').digest('base64url');
  if (!sig || sig !== expect) throw new Error('bad state');
  const { u, a, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (Date.now() > Number(e)) throw new Error('state expired');
  return { userId: u, alias: a };
}

export function gmailAuthUrl(state) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent select_account', // always mint a refresh token + let the user pick which Gmail account
    state,
  });
  return `${OAUTH_AUTH}?${q.toString()}`;
}

/* ---- Account + token storage (all service-role, per account row) ---- */
async function accountRow(userId, accountId) {
  const { data } = await admin()
    .from('gmail_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle();
  return data || null;
}

async function saveAccountTokens(accountId, tokens) {
  const patch = { updated_at: new Date().toISOString() };
  if (tokens.access_token) patch.access_token = tokens.access_token;
  if (tokens.refresh_token) patch.refresh_token = tokens.refresh_token; // absent on refresh — keep existing
  if (tokens.scope) patch.scope = tokens.scope;
  if (tokens.token_type) patch.token_type = tokens.token_type;
  if (tokens.expires_in) patch.expiry_date = Date.now() + Number(tokens.expires_in) * 1000;
  await admin().from('gmail_accounts').update(patch).eq('id', accountId);
}

export async function exchangeGmailCode(userId, alias, code) {
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${(await res.text()).slice(0, 200)}`);
  const tokens = await res.json();

  let email = null;
  try {
    const me = await fetch(USERINFO, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (me.ok) email = (await me.json()).email;
  } catch { /* email optional */ }

  const row = {
    user_id: userId,
    alias,
    email,
    access_token: tokens.access_token || null,
    refresh_token: tokens.refresh_token || null,
    scope: tokens.scope || null,
    token_type: tokens.token_type || null,
    expiry_date: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : null,
    updated_at: new Date().toISOString(),
  };
  // Re-connecting the same alias replaces its tokens (fresh consent).
  const { error } = await admin().from('gmail_accounts').upsert(row, { onConflict: 'user_id,alias' });
  if (error) throw new Error(`saving account failed: ${error.message}`);
  return email;
}

async function refreshAccessToken(account) {
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null; // e.g. invalid_grant after revocation
  const tokens = await res.json();
  await saveAccountTokens(account.id, tokens);
  return tokens.access_token;
}

async function accessTokenFor(account, force = false) {
  if (!account?.refresh_token) return null;
  const fresh = !force && account.access_token && Number(account.expiry_date || 0) - Date.now() > 60000;
  if (fresh) return account.access_token;
  return refreshAccessToken(account);
}

// Authenticated Gmail API call for ONE account, with a single retry on 401.
async function gmailApi(account, path, init = {}) {
  let token = await accessTokenFor(account);
  if (!token) throw new Error(`Gmail account "${account.alias}" is not connected (token expired or revoked).`);
  let res = await fetch(`${GMAIL_API}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = await accessTokenFor(account, true);
    if (!token) throw new Error(`Gmail account "${account.alias}" is not connected (token expired or revoked).`);
    res = await fetch(`${GMAIL_API}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gmail API ${res.status} (${account.alias}): ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

/* ---- Account management (what the Settings panel talks to) ---- */
export async function listGmailAccounts(userId) {
  if (!admin()) return [];
  const { data } = await admin()
    .from('gmail_accounts')
    .select('id, alias, email, refresh_token, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  return (data || []).map((a) => ({
    id: a.id,
    alias: a.alias,
    email: a.email,
    connected: Boolean(a.refresh_token),
    created_at: a.created_at,
  }));
}

export async function disconnectGmailAccount(userId, accountId) {
  const account = await accountRow(userId, accountId);
  if (!account) throw new Error('Account not found.');
  try {
    const tok = account.refresh_token || account.access_token;
    if (tok) await fetch(`${OAUTH_REVOKE}?token=${encodeURIComponent(tok)}`, { method: 'POST' });
  } catch { /* best-effort revoke */ }
  await admin().from('gmail_accounts').delete().eq('id', accountId).eq('user_id', userId);
  return { ok: true };
}

/* ---- Unread scan (per account) ---- */
function parseFrom(header) {
  const m = String(header || '').match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { name: (m[1] || '').trim(), email: m[2].trim() };
  return { name: '', email: String(header || '').trim() };
}

async function fetchUnread(account) {
  const q = encodeURIComponent('is:unread newer_than:1d in:inbox');
  const list = await gmailApi(account, `/messages?q=${q}&maxResults=${MAX_MESSAGES_PER_ACCOUNT}`);
  const ids = (list.messages || []).map((m) => m.id);
  const messages = [];
  for (const id of ids) {
    try {
      const msg = await gmailApi(
        account,
        `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
      );
      const headers = Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
      const from = parseFrom(headers.from);
      messages.push({
        gmail_message_id: msg.id,
        gmail_thread_id: msg.threadId,
        from_name: from.name,
        from_email: from.email,
        subject: headers.subject || '(no subject)',
        snippet: msg.snippet || '',
        received_at: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
      });
    } catch { /* skip a message that fails to load; keep the rest */ }
  }
  return messages;
}

/* ---- Per-user context for headless runs ---- */
async function userContext(userId) {
  const [{ data: profile }, { data: settings }] = await Promise.all([
    admin().from('profiles').select('full_name, email').eq('id', userId).maybeSingle(),
    admin().from('user_settings').select('connectors').eq('user_id', userId).maybeSingle(),
  ]);
  const anth = (settings?.connectors || []).find?.((c) => c?.type === 'anthropic' && c.enabled);
  return {
    userName: profile?.full_name || profile?.email || 'the user',
    apiKey: anth?.config?.key || undefined, // per-user key wins; else env key
  };
}

/* ---- The triage job: one run = one brief ---- */
export async function runTriage(userId, source = 'manual') {
  if (!gmailReady()) throw new Error('Gmail triage is not configured on the server (.env / Worker secrets).');
  const accounts = (await listGmailAccounts(userId)).filter((a) => a.connected);
  if (!accounts.length) throw new Error('No Gmail accounts connected. Add one in Settings → Gmail Accounts.');

  const { data: run, error: runErr } = await admin()
    .from('triage_runs')
    .insert({ user_id: userId, source, status: 'running', accounts_scanned: accounts.length })
    .select()
    .single();
  if (runErr) throw new Error(`could not start run: ${runErr.message}`);

  const { userName, apiKey } = await userContext(userId);
  const items = [];
  const errors = [];

  for (const acct of accounts) {
    try {
      const full = await accountRow(userId, acct.id);
      const messages = await fetchUnread(full);
      if (!messages.length) continue;
      const verdicts = await triageCategorize({ alias: acct.alias, email: acct.email, messages, userName, apiKey });
      for (const m of messages) {
        const v = verdicts[m.gmail_message_id] || {};
        items.push({
          user_id: userId,
          run_id: run.id,
          account_id: acct.id,
          account_alias: acct.alias,
          account_email: acct.email,
          ...m,
          category: v.category || 'ignore',
          summary: v.summary || m.subject,
          suggested_reply: v.category === 'needs_reply' ? v.suggested_reply || null : null,
        });
      }
    } catch (e) {
      errors.push(`${acct.alias}: ${e.message}`);
    }
  }

  if (items.length) {
    const { error } = await admin().from('triage_items').insert(items);
    if (error) errors.push(`saving items: ${error.message}`);
  }

  const status = errors.length && !items.length ? 'error' : 'complete';
  await admin()
    .from('triage_runs')
    .update({ status, emails_scanned: items.length, error: errors.length ? errors.join(' · ') : null })
    .eq('id', run.id);

  // Reflect the run on the Email Triage agent card (+ its run history).
  const needsReply = items.filter((i) => i.category === 'needs_reply').length;
  try {
    const { data: agent } = await admin()
      .from('agents')
      .select('id')
      .eq('user_id', userId)
      .eq('config->>type', 'email_triage')
      .maybeSingle();
    if (agent) {
      await admin().from('agents').update({ last_run: new Date().toISOString() }).eq('id', agent.id);
      await admin().from('agent_runs').insert({
        user_id: userId,
        agent_id: agent.id,
        action: 'triage_run',
        subject: `Triage (${source}): ${items.length} emails across ${accounts.length} account${accounts.length === 1 ? '' : 's'} · ${needsReply} need a reply`,
      });
    }
  } catch { /* run log is best-effort */ }

  return {
    run_id: run.id,
    status,
    accounts_scanned: accounts.length,
    emails_scanned: items.length,
    needs_reply: needsReply,
    errors,
  };
}

/* ---- Scheduler: run due triage jobs for every armed user ----
   Called every ~15 min (setInterval in Express dev, cron trigger in the
   Worker). An "Email Triage" agent toggled ON arms the schedule; config:
   { type: 'email_triage', schedule_hour: 13 }  — hour is UTC, default 13
   (≈ morning US). One scheduled run per user per UTC day. */
export async function runDueTriage(now = new Date()) {
  if (!gmailReady()) return { ran: 0 };
  const { data: agents } = await admin()
    .from('agents')
    .select('id, user_id, config')
    .eq('status', 'running')
    .eq('config->>type', 'email_triage');
  if (!agents?.length) return { ran: 0 };

  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  let ran = 0;

  for (const agent of agents) {
    try {
      const hour = Number(agent.config?.schedule_hour ?? 13);
      if (now.getUTCHours() < hour) continue;

      // Skip if a scheduled run already happened today, or ANY run in the
      // last hour (e.g. the user just pressed "Run now").
      const { data: recent } = await admin()
        .from('triage_runs')
        .select('id, run_at, source')
        .eq('user_id', agent.user_id)
        .gte('run_at', dayStart)
        .order('run_at', { ascending: false })
        .limit(10);
      const scheduledToday = (recent || []).some((r) => r.source === 'scheduled');
      const justRan = (recent || []).some((r) => Date.now() - new Date(r.run_at).getTime() < 60 * 60 * 1000);
      if (scheduledToday || justRan) continue;

      await runTriage(agent.user_id, 'scheduled');
      ran++;
    } catch (e) {
      console.error(`triage schedule (${agent.user_id}):`, e.message);
    }
  }
  return { ran };
}

/* ---- Approve → create a native Gmail draft (never sends) ---- */
function base64url(str) {
  return Buffer.from(str, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createDraftForItem(userId, itemId) {
  const { data: item } = await admin()
    .from('triage_items')
    .select('*')
    .eq('id', itemId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!item) throw new Error('Triage item not found.');
  if (!item.suggested_reply) throw new Error('This item has no suggested reply.');
  if (item.draft_id) return { ok: true, draft_id: item.draft_id, already: true };
  if (!item.account_id) throw new Error('The source account for this item was disconnected.');

  const account = await accountRow(userId, item.account_id);
  if (!account) throw new Error('The source account for this item was disconnected.');

  const to = item.from_name ? `"${item.from_name.replace(/"/g, '')}" <${item.from_email}>` : item.from_email;
  const subject = /^re:/i.test(item.subject || '') ? item.subject : `Re: ${item.subject || ''}`.trim();
  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    item.suggested_reply,
  ].join('\r\n');

  const draft = await gmailApi(account, '/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // threadId keeps the draft attached to the original conversation.
    body: JSON.stringify({ message: { raw: base64url(mime), threadId: item.gmail_thread_id || undefined } }),
  });

  await admin()
    .from('triage_items')
    .update({ draft_id: draft.id, draft_created_at: new Date().toISOString() })
    .eq('id', itemId);

  return { ok: true, draft_id: draft.id };
}
