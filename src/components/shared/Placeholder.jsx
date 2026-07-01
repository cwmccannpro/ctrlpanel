// Styled "coming soon" page for routes not yet built out.
// Keeps every nav destination visually complete (AGENTS.md rule #8)
// while pages are built in the AGENTS.md build order.
export default function Placeholder({ icon, title, description }) {
  return (
    <div className="placeholder fade-in">
      <i className={`ti ${icon}`} />
      <h2>{title}</h2>
      <p>{description}</p>
      <span className="badge badge--accent">Next in the build order</span>
    </div>
  );
}
