import { useEffect, useState } from 'react';
import DriveGlyph from './DriveGlyph.jsx';
import { sendDriveCommand, sendDriveSeek, trackProgress, trackTime } from '../lib/drive.js';

/**
 * CarPlay-style now playing: album art, title and artist, a progress bar with
 * elapsed / remaining time, and previous · play/pause · next. Tapping the art
 * opens Spotify. `cover` is a validated data: URL or null.
 */
export default function DriveNowPlaying({ music, cover }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!music?.playing) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [music?.playing]);
  // While dragging, the bar follows the finger; letting go seeks Spotify. The scrub
  // position stays on screen until the next update from Android arrives.
  const [scrub, setScrub] = useState(null); // { ms, sentAt? }
  useEffect(() => { setScrub((s) => (s?.sentAt && music?.at > s.sentAt ? null : s)); }, [music?.at]);
  const progress = trackProgress(music, Math.max(now, music?.at || 0));
  const shown = progress && scrub ? { ...progress, elapsed: scrub.ms, remaining: progress.duration - scrub.ms, fraction: scrub.ms / progress.duration } : progress;
  const commit = () => { if (scrub && !scrub.sentAt) { sendDriveSeek(scrub.ms); setScrub({ ms: scrub.ms, sentAt: Date.now() }); } };
  const has = Boolean(music?.title);
  return (
    <div className={`drive-np ${has ? '' : 'drive-np--idle'}`}>
      <button className="drive-np-art" onClick={() => sendDriveCommand('spotify')} aria-label="Open Spotify">
        {cover ? <img src={cover} alt="" draggable="false" /> : <DriveGlyph name="music" />}
      </button>
      <div className="drive-np-info">
        {has && <div className="drive-np-meta"><strong>{music.title}</strong>{music.artist && <span>{music.artist}</span>}</div>}
        {shown && <div className="drive-np-progress" data-no-swipe>
          <input className="drive-np-seek" type="range" min={0} max={Math.round(shown.duration)} step={1000} value={Math.round(shown.elapsed)}
            aria-label="Track position" aria-valuetext={`${trackTime(shown.elapsed)} of ${trackTime(shown.duration)}`}
            style={{ '--fill': `${shown.fraction * 100}%` }}
            onChange={(e) => setScrub({ ms: Number(e.target.value) })} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
          <div className="drive-np-times"><span>{trackTime(shown.elapsed)}</span><span>-{trackTime(shown.remaining)}</span></div>
        </div>}
      </div>
      <div className="drive-transport">
          <button disabled={!music} aria-label="Previous track" onClick={() => sendDriveCommand('previous')}><DriveGlyph name="previous" /></button>
          <button disabled={!music} aria-label={music?.playing ? 'Pause' : 'Play'} onClick={() => sendDriveCommand('playPause')}><DriveGlyph name={music?.playing ? 'pause' : 'play'} /></button>
          <button disabled={!music} aria-label="Next track" onClick={() => sendDriveCommand('next')}><DriveGlyph name="next" /></button>
      </div>
    </div>
  );
}
