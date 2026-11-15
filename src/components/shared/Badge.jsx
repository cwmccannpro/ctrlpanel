// Colored pill badge. `variant` maps to a CSS modifier (cold/warm/hot,
// low/medium/high/urgent, accent, green). Falls back to neutral.
export default function Badge({ variant, children, className = '' }) {
  const mod = variant ? `badge--${String(variant).toLowerCase()}` : '';
  return <span className={`badge ${mod} ${className}`}>{children}</span>;
}
