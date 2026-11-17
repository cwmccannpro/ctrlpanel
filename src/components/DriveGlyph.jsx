const PATHS = {
  mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V5ZM5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8',
  maps: 'M12 3l8 18-8-5-8 5 8-18Z',
  music: 'M9 18V5l11-2v13M9 7l11-2M9 18c0 3-6 4-6 1s6-4 6-1Zm11-2c0 3-6 4-6 1s6-4 6-1Z',
  next: 'm5 4 10 8-10 8V4Zm13 0v16',
  previous: 'm19 4-10 8 10 8V4ZM6 4v16',
  play: 'm8 4 12 8-12 8V4Z',
  pause: 'M8 4v16M16 4v16',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  dashboard: 'M4 4h7v9H4V4Zm9 0h7v5h-7V4Zm0 7h7v9h-7v-9ZM4 15h7v5H4v-5Z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
};

/** Line icons for the Drive screen. */
export default function DriveGlyph({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name] || PATHS.grid} /></svg>;
}
