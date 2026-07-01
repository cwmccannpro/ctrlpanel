export default function Spinner({ large = false }) {
  return <span className={`spinner ${large ? 'spinner--lg' : ''}`} aria-label="Loading" />;
}
