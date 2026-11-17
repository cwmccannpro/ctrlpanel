import { driveAccessNotice, sendDriveCommand } from '../lib/drive.js';

/** Why a Drive card is empty when Android notification access is missing; null when access is fine. */
export default function DriveAccessNotice({ state, kind }) {
  const notice = driveAccessNotice(state, kind);
  if (!notice) return null;
  return (
    <div className="drive-access" role="status">
      <p>{notice.text}</p>
      {notice.action && <button onClick={() => sendDriveCommand('permissions')}>Allow access</button>}
    </div>
  );
}
