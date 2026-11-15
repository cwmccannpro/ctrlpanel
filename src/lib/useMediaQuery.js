import { useEffect, useState } from 'react';

/** Live `matchMedia` result for a CSS media query (false when unsupported, e.g. SSR/tests). */
export function useMediaQuery(query) {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Below this width the sidebar becomes an off-canvas drawer (keep in sync with styles/mobile.css). */
export const MOBILE_QUERY = '(max-width: 760px)';
