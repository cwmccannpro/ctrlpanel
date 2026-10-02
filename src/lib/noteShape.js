// A Knowledge note as the UI expects it. The database guarantees `tags`/`aliases`
// (not null, default '{}'), but rows can arrive partial — a select that skipped
// columns, an older sync client, a cached copy — and one missing array used to
// crash the whole page. Normalize at the boundary so the UI can rely on the shape.
export function normalizeNote(note) {
  const n = note || {};
  return {
    ...n,
    title: n.title ?? '',
    content: n.content ?? '',
    folder: n.folder ?? '',
    tags: Array.isArray(n.tags) ? n.tags : [],
    aliases: Array.isArray(n.aliases) ? n.aliases : [],
    pinned: Boolean(n.pinned),
    updated_at: n.updated_at ?? n.created_at ?? '',
  };
}
