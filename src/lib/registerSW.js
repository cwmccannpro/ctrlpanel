/** Register the service worker in production builds only (dev servers must never be cached). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* unsupported / blocked: the app simply runs without an offline shell */
    });
  });
}
