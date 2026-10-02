import { shouldPrefetch } from './errors.js';

/**
 * Warm every page's code one at a time while the browser is idle, so navigating is
 * instant and (via the service worker's runtime cache) the pages work offline too.
 * Skipped on data-saver / 2G. Returns a cancel function.
 */
export function prefetchPages(loaders) {
  if (typeof window === 'undefined' || !shouldPrefetch(navigator.connection)) return () => {};
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 600));
  let cancelled = false;
  let i = 0;
  const next = () => {
    if (cancelled || i >= loaders.length) return;
    Promise.resolve()
      .then(loaders[i++])
      .catch(() => {})
      .finally(() => idle(next));
  };
  idle(next);
  return () => { cancelled = true; };
}
