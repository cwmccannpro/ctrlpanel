import Spinner from './shared/Spinner.jsx';
import '../styles/overlays.css';

/** Suspense fallback while a page's code loads. Fades in late so fast loads never flash. */
export default function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-label="Loading page">
      <Spinner large />
    </div>
  );
}
