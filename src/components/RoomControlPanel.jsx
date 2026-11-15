import { Link } from 'react-router-dom';
import { useRoomControl } from '../lib/useRoomControl.js';

export default function RoomControlPanel() {
  const room = useRoomControl();
  return <>
    <div className="dash2-panel-head"><Link className="dash2-panel-title dash2-link" to="/room">Room Control</Link><span className="dash2-count">{room.online ? 'Connected' : 'Offline'}</span></div>
    <p className="dash2-panel-note">{room.loading ? 'Checking desktop…' : room.error || (room.online ? `${room.controller.devices.length} lights ready for a command.` : 'Wake your Windows desktop to control your lights.')}</p>
    <div className="dash2-panel-actions"><button className="btn btn--sm btn--accent" disabled={!room.online || room.busy} onClick={() => room.send('all', { power: true })}>All on</button><button className="btn btn--sm" disabled={!room.online || room.busy} onClick={() => room.send('all', { power: false })}>All off</button><Link className="btn btn--sm" to="/room">Open controls</Link></div>
    {room.commands?.[0] && <p className="dash2-panel-note" role="status">Latest command: {room.commands[0].status}. Open controls for per-light results.</p>}
  </>;
}
