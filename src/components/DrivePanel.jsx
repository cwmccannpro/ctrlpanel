import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider.jsx';
export default function DrivePanel() {
  const navigate = useNavigate();
  const { settings } = useAuth();
  return <div><div className="dash2-panel-title">CTRLpanel Drive</div><p className="dash2-empty">Landscape displays for navigation, music and your day. Center display: {settings?.ui_preferences?.drive?.face || 'digital'}.</p><button className="btn btn--accent" onClick={() => navigate('/drive')}>Open Drive</button></div>;
}
