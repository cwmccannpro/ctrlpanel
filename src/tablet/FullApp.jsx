import { Routes, Route, Link } from 'react-router-dom';
import App from '../App.jsx';
import { appChildren } from '../routes.jsx';
import '../styles/mobile.css';

export default function FullApp() {
  return <><Link className="tablet-return" to="/drive">← Back to Drive</Link><Routes><Route element={<App />}>{appChildren.map((route, i) => <Route key={route.path || i} {...route} />)}</Route></Routes></>;
}
