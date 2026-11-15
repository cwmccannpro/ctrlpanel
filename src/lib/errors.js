// Pure helpers for the error boundary (no React, no DOM), so they can be unit-tested.

// What browsers say when a lazily-loaded page's JS file can't be fetched: the device
// is offline, or CTRLpanel was redeployed and the old file name no longer exists.
const CHUNK_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chrome / Edge
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Loading chunk [\w-]+ failed/i, // webpack-style
  /Unable to preload CSS/i, // Vite
];

export const isChunkLoadError = (error) => CHUNK_PATTERNS.some((re) => re.test(String(error?.message || error || '')));

/** What to tell the user. `chunk` errors are not bugs: a reload (or going online) fixes them. */
export function describeError(error) {
  if (isChunkLoadError(error)) {
    return {
      chunk: true,
      title: 'This page couldn’t load',
      message: 'You may be offline, or CTRLpanel was just updated. Reloading usually fixes it.',
    };
  }
  return {
    chunk: false,
    title: 'This page ran into a problem',
    message: 'The rest of CTRLpanel is still working. Try again, or reload if it keeps happening.',
  };
}

const RELOAD_WINDOW_MS = 30000;

/**
 * After a deploy, open tabs ask for page files that no longer exist. Reloading once
 * heals that; this says whether a reload is allowed now (never twice within 30s, so a
 * truly broken file can't cause a reload loop).
 */
export function shouldAutoReload(now, lastReloadAt) {
  const last = Number(lastReloadAt);
  return !Number.isFinite(last) || last <= 0 || now - last > RELOAD_WINDOW_MS;
}

/** Idle-prefetch of page chunks is skipped on data-saver or very slow connections. */
export function shouldPrefetch(connection) {
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/(^|-)2g$/.test(String(connection.effectiveType || ''));
}
