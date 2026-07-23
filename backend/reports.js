// ============================================================
// CTRLpanel — inbound PDF report ingestion
//
// POST /api/reports/ingest authenticated by a per-source API token generated
// in the Reports section. External tools (e.g. a Claude routine doing email
// triage) send a PDF here and it lands as a report the user can read in-app.
//
// Auth: a per-source token (Authorization: Bearer ctpr_… or X-API-Key). Only
// the SHA-256 hash is stored (report_sources.key_hash); the plaintext is shown
// once when the source is created. The token maps to a report_source row,
// which carries the owning user_id — so one token = one inbound channel.
//
// Storage: the raw PDF bytes go to the private Supabase Storage bucket
// `reports` at `{user_id}/{source_id}/{uuid}.pdf`; a `reports` row records the
// metadata. The browser reads its own files back via short-lived signed URLs
// (storage RLS scopes objects to the owning user's folder).
//
// Workers-compatible: node:crypto + the fetch-based Supabase SDK only.
// ============================================================
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'reports';
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per report

let _admin = null;
function admin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) _admin = createClient(url, key, { auth: { persistSession: false } });
  if (!_admin) throw new Error('Supabase service role is not configured on the server.');
  return _admin;
}

const hashKey = (raw) => createHash('sha256').update(String(raw)).digest('hex');

// Header extraction shared by Express (req.headers object) and Worker (Headers).
export function reportKeyFromHeaders(get) {
  const auth = get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return get('x-api-key') || '';
}

/** Resolve a report-source token (ctpr_…) to { user_id, source_id, name }. */
export async function reportSourceForKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key.startsWith('ctpr_')) return null;
  const { data } = await admin()
    .from('report_sources')
    .select('id, user_id, name')
    .eq('key_hash', hashKey(key))
    .maybeSingle();
  if (!data) return null;
  return { user_id: data.user_id, source_id: data.id, name: data.name };
}

// A well-formed PDF starts with the "%PDF-" magic bytes.
function looksLikePdf(bytes) {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

const cleanTitle = (raw, fallback) => {
  const t = String(raw || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 200);
  return t || fallback;
};

/**
 * Store one uploaded PDF for the resolved source. `body` is an ArrayBuffer,
 * Uint8Array, or Node Buffer. Returns the created report row's id + title.
 */
export async function ingestReport(source, body, { title } = {}) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body || []);
  if (!bytes.length) throw new Error('Empty request body — send the PDF as the raw request body.');
  if (bytes.length > MAX_BYTES) throw new Error(`Report is too large (max ${MAX_BYTES / 1024 / 1024} MB).`);
  if (!looksLikePdf(bytes)) throw new Error('Body is not a PDF (missing %PDF header). Send Content-Type: application/pdf.');

  const now = new Date();
  const finalTitle = cleanTitle(title, `${source.name} — ${now.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
  const path = `${source.user_id}/${source.source_id}/${randomUUID()}.pdf`;

  const { error: upErr } = await admin().storage.from(BUCKET).upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const row = {
    user_id: source.user_id,
    source_id: source.source_id,
    title: finalTitle,
    file_path: path,
    file_size: bytes.length,
    received_at: now.toISOString(),
  };
  const { data: entry, error } = await admin().from('reports').insert(row).select().single();
  if (error) {
    // Best-effort cleanup so we don't leave an orphan object behind.
    admin().storage.from(BUCKET).remove([path]).then(() => {}, () => {});
    throw new Error(error.message);
  }

  // Stamp the source so the UI can show "last received".
  admin().from('report_sources').update({ last_received_at: row.received_at }).eq('id', source.source_id).then(() => {}, () => {});

  return { ok: true, id: entry.id, title: entry.title, received_at: entry.received_at };
}
