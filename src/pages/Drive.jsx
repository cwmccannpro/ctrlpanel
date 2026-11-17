import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider.jsx';
import DayPlanHero from '../components/DayPlanHero.jsx';
import DriveAccessNotice from '../components/DriveAccessNotice.jsx';
import DriveDirections from '../components/DriveDirections.jsx';
import Glyph from '../components/DriveGlyph.jsx';
import DriveGreeting from '../components/DriveGreeting.jsx';
import DriveMacroRings from '../components/DriveMacroRings.jsx';
import DriveMap from '../components/DriveMap.jsx';
import DriveNowPlaying from '../components/DriveNowPlaying.jsx';
import { drivePreferences, driveThemeStyle, driveSummary, driveImage, driveAccess, driveAccessNotice, DRIVE_FACES, FACE_LABELS, DRIVE_PAGES, DRIVE_SECTIONS, DRIVE_THEMES, sendDriveCommand, sendDriveRequest, swipePage } from '../lib/drive.js';
import { ACCENT_OPTIONS } from '../lib/helpers.js';
import { currentDriveLocation } from '../lib/driveMap.js';
import { useDriveData } from '../lib/useDriveData.js';
import { useDriveLocation } from '../lib/useDriveLocation.js';
import { useDriveToday } from '../lib/useDriveToday.js';
import '../styles/drive.css';

const PAGE_ICONS = { Dashboard: 'dashboard', 'All sections': 'list', Map: 'maps', Music: 'music' };

function Clock({ now, face }) {
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: false });
  if (face === 'analog') return <svg className="drive-clock" viewBox="0 0 240 240" role="img" aria-label={time}>
    {Array.from({ length: 60 }, (_, i) => <line key={i} x1="120" y1="13" x2="120" y2={i % 5 ? '17' : '25'} transform={`rotate(${i * 6} 120 120)`} stroke="currentColor" opacity={i % 5 ? '.25' : '.8'} strokeWidth={i % 5 ? '1' : '2'} />)}
    <line x1="120" y1="120" x2="120" y2="64" transform={`rotate(${now.getHours() * 30 + now.getMinutes() / 2} 120 120)`} stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    <line x1="120" y1="120" x2="120" y2="36" transform={`rotate(${now.getMinutes() * 6} 120 120)`} stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
    <circle cx="120" cy="120" r="6" fill="var(--accent)" />
  </svg>;
  if (face === 'date') return <><span className="drive-eyebrow">{now.toLocaleDateString([], { month: 'long' })}</span><strong className="drive-number">{now.getDate()}</strong><span>{now.toLocaleDateString([], { weekday: 'long' })}</span><span>{time}</span></>;
  if (face === 'split') return <><span className="drive-eyebrow">{now.toLocaleDateString([], { weekday: 'short' })}</span><strong className="drive-split-clock">{String(now.getHours()).padStart(2, '0')}<span>{String(now.getMinutes()).padStart(2, '0')}</span></strong></>;
  return <><span className="drive-eyebrow">{face === 'minimal' ? 'LOCAL TIME' : now.toLocaleDateString([], { weekday: 'long' })}</span>{face === 'orbit' && <svg className="drive-orbit" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="none" stroke="var(--border-bright)" strokeWidth="1" /><circle cx="50" cy="4" r="3" fill="var(--accent)" transform={`rotate(${now.getMinutes() * 6} 50 50)`} /></svg>}<strong className={`drive-time ${face === 'minimal' ? 'drive-time--minimal' : ''}`}>{time}</strong><span>{now.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></>;
}

function VoiceDialog({ voice, setVoice, speak }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  const maps = voice.kind === 'maps';
  return <dialog ref={dialog} className="drive-voice-dialog" onCancel={() => setVoice(null)} aria-labelledby="drive-voice-title">
    <form onSubmit={e => { e.preventDefault(); if (sendDriveRequest(maps ? 'navigate' : 'musicSearch', voice.query)) setVoice(null); }}>
      <h2 id="drive-voice-title">{maps ? 'Where would you like to go?' : 'What would you like to hear?'}</h2>
      <p>{voice.error || 'Say a name, then confirm your choice. You can also type while parked.'}</p>
      <label>{maps ? 'Destination' : 'Song, artist or playlist'}<input autoFocus value={voice.query} maxLength={200} onChange={e => setVoice({ ...voice, query: e.target.value })} /></label>
      <div className="drive-settings-actions"><button type="button" onClick={() => speak(voice.kind)}><Glyph name="mic" /> Speak again</button><button type="submit" disabled={!voice.query.trim()}>{maps ? 'Start Google Maps' : 'Send to Spotify'}</button><button type="button" onClick={() => setVoice(null)}>Cancel</button></div>
      <p className="drive-note">{maps ? 'Google Maps starts the route. Return to Drive for your map and directions.' : 'Spotify handles the play request. If unsupported, its search results open instead.'}</p>
    </form>
  </dialog>;
}

export default function Drive() {
  const navigate = useNavigate();
  const { user, displayName, settings, updateUiPreferences, refreshSettings, signOut } = useAuth();
  const { data, error, updated, partial, refresh } = useDriveData(user?.id);
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(new Date());
  const [native, setNative] = useState({ available: false, access: false, music: null, maps: null });
  const [config, setConfig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [voice, setVoice] = useState(null);
  const lastVoice = useRef(null);
  const start = useRef(null);
  const scroller = useRef(null);
  const preferences = drivePreferences(settings?.ui_preferences?.drive);
  const { face } = preferences;
  const location = useDriveLocation(native);
  const fix = currentDriveLocation(location.location);
  const summary = useMemo(() => driveSummary(data, now), [data, now]);
  const today = useDriveToday(now);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) setNow(new Date()); }, 10000);
    const bridge = window.CTRLDrive;
    if (bridge) {
      bridge.onmessage = e => { try { const value = JSON.parse(e.data); if (value.music) value.music.at = Date.now(); setNative(previous => ({ ...previous, ...value, available: true })); } catch { /* malformed native response */ } };
      sendDriveCommand('state');
    }
    const resume = () => { if (!document.hidden) { sendDriveCommand('state'); refreshSettings(); setNow(new Date()); } };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('ctrlpanel:resume', resume);
    return () => { clearInterval(timer); if (bridge) bridge.onmessage = null; document.removeEventListener('visibilitychange', resume); window.removeEventListener('ctrlpanel:resume', resume); };
  }, [refreshSettings]);
  useEffect(() => {
    if (native.voice && native.voice.id !== lastVoice.current) {
      lastVoice.current = native.voice.id;
      setVoice({ kind: native.voice.kind, query: native.voice.text || '', error: native.voice.error || '' });
    }
  }, [native.voice]);
  const speak = kind => {
    setVoice({ kind, query: '', error: window.CTRLDrive ? '' : 'Voice capture is available in the Android app. You can type here.' });
    sendDriveCommand(kind === 'maps' ? 'voiceMaps' : 'voiceMusic');
  };
  const changePage = next => { setPage(next); if (scroller.current) scroller.current.scrollTop = 0; };
  const save = async patch => {
    setSaving(true); setSaveError('');
    try { await updateUiPreferences('drive', patch); }
    catch { setSaveError('Could not save. Check your connection and try again.'); }
    finally { setSaving(false); }
  };
  const music = native.music, maps = native.maps;
  // Album art arrives once per track (with its id); later messages carry only the id.
  const [art, setArt] = useState({ id: null, src: null });
  useEffect(() => { if (music && Object.hasOwn(music, 'art')) setArt({ id: music.artId ?? null, src: driveImage(music.art) }); }, [music]);
  const cover = music && art.id != null && music.artId === art.id ? art.src : null;
  const navigating = Boolean(maps?.title || maps?.text);
  const access = driveAccess(native);
  // An empty card says why when Android notification access is off or reconnecting.
  const mapsBlocked = !navigating && driveAccessNotice(access, 'maps'), musicBlocked = !music && driveAccessNotice(access, 'music');
  const map = (compact, full = false) => <DriveMap location={location.location} message={location.message} onEnable={location.enable} compact={compact} full={full} light={preferences.theme === 'light'} />;
  const mapActions = <div className="drive-panel-actions"><button onClick={() => speak('maps')}><Glyph name="mic" /> Destination</button><button onClick={() => sendDriveCommand('maps')} aria-label="Open Google Maps">↗</button></div>;
  // Next-turn directions only; the map itself lives in the centre circle (Live map face) and on the Map page.
  // Small mic + open-app buttons in a box's bottom-right corner.
  const corner = (kind, app, appLabel) => <div className="drive-corner"><button onClick={() => speak(kind)} aria-label={kind === 'maps' ? 'Speak a destination' : 'Choose music by voice'}><Glyph name="mic" /></button><button onClick={() => sendDriveCommand(app)} aria-label={appLabel}><Glyph name="external" /></button></div>;
  const mapPanel = <section className="drive-panel drive-map"><div className="drive-panel-label"><Glyph name="maps" /><span>NEXT TURN</span></div><div className="drive-turn-box">{mapsBlocked ? <DriveAccessNotice state={access} kind="maps" /> : <DriveDirections maps={maps} />}{corner('maps', 'maps', 'Open Google Maps')}</div></section>;
  // Mirrors the directions panel: label, a box the same size (CarPlay-style now playing), then the action row.
  const musicPanel = <section className="drive-panel drive-music"><div className="drive-panel-label"><Glyph name="music" /><span>SPOTIFY</span></div><div className="drive-music-box">{musicBlocked ? <DriveAccessNotice state={access} kind="music" /> : <DriveNowPlaying music={music} cover={cover} />}{corner('music', 'spotify', 'Open Spotify')}</div></section>;
  const tasks = <><span className="drive-eyebrow">DUE TODAY + OVERDUE</span><strong className="drive-number">{updated ? summary.due.length : '—'}</strong><span>{summary.due[0]?.title || (updated ? 'Nothing due. Room to breathe.' : 'Waiting for CTRLpanel')}</span></>;
  const habits = <><span className="drive-eyebrow">TODAY’S HABITS</span><strong className="drive-number">{updated ? `${summary.completed}/${summary.habits.length}` : '—'}</strong><span>{summary.habits.length ? 'Completed today' : 'No habits yet'}</span></>;
  let center;
  if (['digital', 'analog', 'minimal', 'split', 'date', 'orbit'].includes(face)) center = <Clock now={now} face={face} />;
  else if (face === 'tasks') center = tasks;
  else if (face === 'habits') center = habits;
  else if (face === 'maps') center = map(true);
  else if (face === 'speed') center = <><span className="drive-eyebrow">SPEED ESTIMATE</span><strong className="drive-number">{Number.isFinite(fix?.speed) ? Math.round(fix.speed * 2.236936) : '—'}</strong><span>mph · shared location</span></>;
  else if (face === 'compass') center = <><span className="drive-eyebrow">TRAVEL HEADING</span><div className="drive-heading" style={{ transform: `rotate(${Number.isFinite(fix?.bearing) ? fix.bearing : 0}deg)` }}>↑</div><strong>{Number.isFinite(fix?.bearing) ? `${Math.round(fix.bearing)}°` : '—'}</strong><span>{Number.isFinite(fix?.bearing) ? 'Degrees from north' : 'Available while moving'}</span></>;
  else center = <><Glyph name={face === 'directions' ? 'maps' : 'music'} /><span className="drive-eyebrow">{face === 'directions' ? 'DIRECTIONS' : 'NOW PLAYING'}</span><strong>{face === 'directions' ? maps?.title || 'No active route' : music?.title || 'Spotify is ready'}</strong><span>{face === 'directions' ? maps?.text || 'Say a destination to start' : music?.artist || 'Say a song or artist'}</span><button onClick={() => speak(face === 'directions' ? 'maps' : 'music')}><Glyph name="mic" /></button></>;
  return <div className="drive-shell" style={driveThemeStyle(preferences)}>
    <header className="drive-header"><div className="drive-brand">CTRL<span>panel<small>DRIVE</small></span></div><DriveGreeting name={displayName} /><div className="drive-sync" role="status">{error ? 'Sync paused' : !updated ? 'Connecting…' : `Updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</div><button aria-label="Display settings" aria-expanded={config} onClick={() => setConfig(v => !v)}><Glyph name="settings" /></button></header>
    <main ref={scroller} className="drive-display" onTouchStart={e => { start.current = null; if (e.touches.length === 1 && !e.target.closest('button,select,input,a,[data-no-swipe]')) start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }} onTouchCancel={() => { start.current = null; }} onTouchEnd={e => { if (start.current && e.changedTouches.length) { changePage(swipePage(page, e.changedTouches[0].clientX - start.current.x, e.changedTouches[0].clientY - start.current.y)); start.current = null; } }}>
      {config ? <section className="drive-config"><h1>Make it your dashboard</h1><p>Set your display while parked. Choices save to CTRLpanel.</p>
        <h2>Center circle</h2><div className="drive-face-options">{DRIVE_FACES.map(f => <button key={f} aria-pressed={face === f} disabled={saving} onClick={() => save({ face: f })}>{FACE_LABELS[f]}</button>)}</div>
        <h2>Theme</h2><div className="drive-face-options">{DRIVE_THEMES.map(t => <button key={t.id} aria-pressed={preferences.theme === t.id} disabled={saving} onClick={() => save({ theme: t.id })}><span className="drive-swatch" style={{ background: t.preview.base, borderColor: t.preview.text }} />{t.label}</button>)}</div>
        <h2>Accent</h2><div className="drive-face-options">{ACCENT_OPTIONS.map(a => <button key={a.value} aria-pressed={preferences.accent === a.value} disabled={saving} onClick={() => save({ accent: a.value })}><span className="drive-swatch" style={{ background: a.value }} />{a.name}</button>)}</div>
        {saveError && <p role="alert">{saveError}</p>}<div className="drive-settings-actions">{native.available && <button onClick={() => sendDriveCommand('permissions')}>{native.access ? 'Manage' : 'Enable'} app access</button>}<button onClick={location.enable}>Enable live location</button><button onClick={() => { refresh(); refreshSettings(); }}>Refresh CTRLpanel</button><button onClick={() => navigate('/')}>Open full CTRLpanel</button><button onClick={signOut}>Sign out</button><button onClick={() => setConfig(false)}>Done</button></div><p className="drive-note">Location comes from Android, including your phone’s shared location. Street maps come from OpenFreeMap (OpenStreetMap data) and reveal the viewed area to that map server. Google Maps supplies turn instructions. Voice uses your Android speech service; Drive does not store recordings or upload location to CTRLpanel.</p>
      </section> : <><h1 className="drive-sr-only">{DRIVE_PAGES[page]}</h1>{page === 0 ? <div className="drive-cockpit"><DayPlanHero className="drive-up-next" plan={today.plan} now={now} free={today.plan.free} hint="" />{mapPanel}<section className={`drive-dial ${face === 'maps' ? 'drive-dial--map' : ''}`} aria-label="Center display">{center}</section>{musicPanel}<div className="drive-glance"><span>ON YOUR RADAR</span><strong>{summary.due[0]?.title || (updated ? 'No tasks due today' : 'Waiting for sync')}</strong></div><div className="drive-glance drive-glance--right drive-glance--bare"><DriveMacroRings {...today.macros} /></div></div>
        : page === 1 ? <section className="drive-sections"><div className="drive-sections-heading"><div><span className="drive-eyebrow">YOUR LIFE OS</span><h2>All of CTRLpanel</h2></div><p>Open a section while parked.</p></div><div className="drive-section-grid">{DRIVE_SECTIONS.map((section, i) => <button key={section.to} onClick={() => navigate(section.to)}><span className="drive-section-number">{String(i + 1).padStart(2, '0')}</span><strong>{section.label}</strong><span aria-hidden="true">↗</span></button>)}</div></section>
          : page === 2 ? <section className="drive-map-page">{map(false, true)}{navigating && <div className="drive-map-route"><DriveDirections maps={maps} /></div>}<div className="drive-map-page-actions">{mapActions}</div></section>
          : <div className="drive-listening">{cover ? <img className="drive-cover" src={cover} alt={music?.album ? `${music.album} album art` : 'Album art'} draggable="false" /> : <div className="drive-record" aria-hidden="true"><Glyph name="music" /></div>}{musicPanel}</div>}</>}
    </main>
    {partial && <div className="drive-error" role="status">Partial view: counts cover up to 500 records per source.</div>}
    {error && <div className="drive-error" role="alert">{error}<button onClick={refresh}>Retry sync</button></div>}
    <footer className="drive-footer"><button onClick={() => speak('maps')} aria-label="Speak a destination"><Glyph name="mic" /></button><nav aria-label="Display pages">{DRIVE_PAGES.map((name, i) => <button key={name} aria-current={page === i && !config ? 'page' : undefined} onClick={() => { setConfig(false); changePage(i); }}><Glyph name={PAGE_ICONS[name]} /><span>{name}</span></button>)}</nav><button onClick={() => speak('music')} aria-label="Speak a song choice"><Glyph name="music" /></button></footer>
    {voice && <VoiceDialog voice={voice} setVoice={setVoice} speak={speak} />}
  </div>;
}
