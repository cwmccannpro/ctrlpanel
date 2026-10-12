// ============================================================
// CTRLpanel — Socials platform registry
// One place that knows how each platform's sections are named, linked and
// described, so the overview, sidebar and command palette stay in step. Keep it
// import-free so `node --test` can load it.
// ============================================================

export const PLATFORMS = {
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    icon: 'ti-brand-youtube',
    noun: 'channel',
    path: (id) => `/socials/youtube/${id}`,
    requirement: 'Sign in with the Google account that owns the channel.',
    setup:
      'Set the Google OAuth env vars, enable the YouTube Data API v3 and YouTube Analytics API in Google Cloud, and add the YouTube read-only scopes to the consent screen (see .env.example).',
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    icon: 'ti-brand-instagram',
    noun: 'account',
    path: (id) => `/socials/instagram/${id}`,
    requirement: 'Works with Instagram Business or Creator accounts — personal accounts can’t share analytics.',
    setup:
      'Create a Meta app with the Instagram product (Instagram API with Instagram login), then set INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET and INSTAGRAM_REDIRECT_URI (see .env.example) and run the instagram_accounts migration.',
  },
  x: {
    id: 'x', name: 'X', icon: 'ti-brand-x', noun: 'account', path: id => `/socials/x/${id}`,
    requirement: 'Sign in with each X account you own. X API access requires developer credits.',
    setup: 'Enable OAuth 2.0 for a Web App in the X Developer Console, set X_CLIENT_ID, X_CLIENT_SECRET and X_REDIRECT_URI, and apply the social connections migration.',
  },
};

export const PLATFORM_LIST = [PLATFORMS.youtube, PLATFORMS.instagram, PLATFORMS.x];

/**
 * The user's own name for a section, else the platform's natural name:
 * a YouTube channel title or an Instagram @handle.
 */
export function accountLabel(platform, account) {
  const own = account?.label?.trim();
  if (own) return own;
  if (platform === 'instagram' || platform === 'x') {
    if (account?.username) return `@${account.username}`;
    return account?.name || PLATFORMS[platform].name;
  }
  return account?.title || 'Channel';
}

/**
 * Every connected section across platforms, in sidebar order (YouTube, then
 * Instagram), ready for navigation lists.
 */
export function socialSections(socials) {
  const out = [];
  for (const c of socials?.channels || []) {
    out.push({ key: `youtube:${c.id}`, platform: 'youtube', id: c.id, label: accountLabel('youtube', c), to: PLATFORMS.youtube.path(c.id) });
  }
  for (const a of socials?.instagram?.accounts || []) {
    out.push({ key: `instagram:${a.id}`, platform: 'instagram', id: a.id, label: accountLabel('instagram', a), to: PLATFORMS.instagram.path(a.id) });
  }
  for (const a of socials?.x?.accounts || []) {
    out.push({ key: `x:${a.id}`, platform: 'x', id: a.id, label: accountLabel('x', a), to: PLATFORMS.x.path(a.id) });
  }
  return out;
}

/** "Business" / "Creator" from Instagram's account_type enum. */
export function instagramAccountKind(type) {
  if (type === 'MEDIA_CREATOR' || type === 'CREATOR') return 'Creator';
  if (type === 'BUSINESS') return 'Business';
  return '';
}
