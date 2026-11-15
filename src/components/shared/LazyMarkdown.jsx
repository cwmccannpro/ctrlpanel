import { lazy, Suspense } from 'react';

// react-markdown (+ its remark/micromark tree) is a big slice of the old main bundle and is
// only needed once there is text to render, so it loads on demand.
const ReactMarkdown = lazy(() => import('react-markdown'));

export default function LazyMarkdown({ children }) {
  return (
    <Suspense fallback={<span className="spinner" />}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </Suspense>
  );
}
