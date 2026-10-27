import { useEffect, useState } from 'react';
import { colorHue, DEFAULT_LIGHT, hueColor } from '../../lib/room.js';

export default function LightControls({ initial, onSend, disabled, white = true, compact = false, onDraft }) {
  const [draft, setDraft] = useState({ ...DEFAULT_LIGHT, ...initial });
  const commandTime = initial?.time;
  useEffect(() => {
    if (commandTime) setDraft({ ...DEFAULT_LIGHT, ...initial });
  }, [commandTime]);
  // Parent keys reset on target changes; polling doesn't replace in-progress edits.
  useEffect(() => { onDraft?.(draft); }, [draft, onDraft]);
  function change(patch) { setDraft((current) => ({ ...current, ...patch })); }
  function send(patch = {}) { const next = { ...draft, ...patch }; setDraft(next); onSend(next); }
  const release = (e) => {
    if (e.type === 'keyup' && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) return;
    send({ [e.currentTarget.name]: Number(e.currentTarget.value), power: true });
  };
  return <fieldset className={`room-light-controls ${compact ? 'is-compact' : ''}`} disabled={disabled}>
    <div className="room-control-top">
      <div className="segmented" aria-label="Light mode">
        <button type="button" className={draft.mode === 'color' ? 'active' : ''} onClick={() => send({ mode: 'color', power: true })}>Color</button>
        <button type="button" className={draft.mode === 'white' ? 'active' : ''} onClick={() => send({ mode: 'white', power: true })}>White</button>
      </div>
      <div className="room-power-actions">
        <button type="button" className="btn btn--sm" onClick={() => send({ power: true })}><i aria-hidden="true" className="ti ti-sun" />{compact ? 'On' : 'All on'}</button>
        <button type="button" className="btn btn--sm" onClick={() => send({ power: false })}><i aria-hidden="true" className="ti ti-power" />{compact ? 'Off' : 'All off'}</button>
      </div>
    </div>
    {draft.mode === 'color' ? <><div className="room-color-control">
      <label className="room-color-swatch" style={{ background: draft.color }} title="Choose light color">
        <input type="color" aria-label="Light color" value={draft.color} onChange={(e) => change({ color: e.target.value })} />
      </label>
      <div><span className="room-label">Light color</span><strong>{draft.color.toUpperCase()}</strong></div>
      <button type="button" className="btn btn--sm" onClick={() => send({ mode: 'color', power: true })}>Apply color</button>
    </div><label className="room-slider room-hue"><span>Hue<output>{colorHue(draft.color)}°</output></span>
      <input type="range" aria-label="Hue" min="0" max="359" value={colorHue(draft.color)} onChange={(e) => change({ color: hueColor(e.target.value) })}
        onPointerUp={(e) => send({ color: hueColor(e.currentTarget.value), mode: 'color', power: true })}
        onKeyUp={(e) => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)) send({ color: hueColor(e.currentTarget.value), mode: 'color', power: true }); }} />
    </label></> : white ? <label className="room-slider room-temperature">
      <span>White temperature <output>{draft.kelvin.toLocaleString()} K</output></span>
      <input type="range" name="kelvin" min="2700" max="6500" step="100" value={draft.kelvin}
        onChange={(e) => change({ kelvin: Number(e.target.value) })} onPointerUp={release} onKeyUp={release} aria-label="White temperature" />
      <small><span>Warm</span><span>Cool</span></small>
    </label> : <p className="room-caption">White is approximated with RGB on this light.</p>}
    <label className="room-slider">
      <span>Brightness <output>{draft.brightness}%</output></span>
      <input type="range" name="brightness" min="0" max="100" value={draft.brightness}
        onChange={(e) => change({ brightness: Number(e.target.value) })} onPointerUp={release} onKeyUp={release} aria-label="Brightness" />
    </label>
  </fieldset>;
}
