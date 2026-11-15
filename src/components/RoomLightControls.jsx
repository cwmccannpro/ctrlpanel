import { useEffect, useId, useState } from 'react';

export default function RoomLightControls({ title, subtitle, target, cct = false, state = {}, disabled, send, room = false }) {
  const id = useId();
  const [brightness, setBrightness] = useState(state.brightness ?? 50);
  const [color, setColor] = useState(state.color ?? '#ffb66e');
  const [temperature, setTemperature] = useState(state.temperature ?? 3500);
  useEffect(() => { if (state.brightness != null) setBrightness(state.brightness); }, [state.brightness]);
  useEffect(() => { if (state.color) setColor(state.color); }, [state.color]);
  useEffect(() => { if (state.temperature != null) setTemperature(state.temperature); }, [state.temperature]);
  return <section className={`room-light ${room ? 'room-light--whole' : ''}`} aria-labelledby={`${id}-title`}>
    <header className="room-light-head">
      <div className="room-light-icon"><i className={`ti ${room ? 'ti-home' : cct ? 'ti-bulb' : 'ti-lamp'}`} aria-hidden="true" /></div>
      <div><h2 id={`${id}-title`}>{title}</h2><p>{subtitle}</p></div>
      {!room && <span className="badge">{state.power === true ? 'Last sent: on' : state.power === false ? 'Last sent: off' : 'State unknown'}</span>}
    </header>
    <fieldset disabled={disabled} className="room-fields">
      <legend className="sr-only">{title} controls</legend>
      <div className="room-control"><span className="room-control-label">Power</span><div className="room-power">
        <button className="btn btn--accent" onClick={() => send(target, { power: true })}><i className="ti ti-power" aria-hidden="true" />{room ? 'All on' : 'On'}</button>
        <button className="btn" onClick={() => send(target, { power: false })}>{room ? 'All off' : 'Off'}</button>
      </div></div>
      <div className="room-control"><label htmlFor={`${id}-brightness`}>Brightness <output>{brightness}%</output></label>
        <div className="room-control-input"><input id={`${id}-brightness`} type="range" min="1" max="100" value={brightness} onChange={e => setBrightness(Number(e.target.value))} />
          <button className="btn btn--sm" aria-label={`Apply ${title} brightness`} onClick={() => send(target, { brightness })}>Apply</button></div>
      </div>
      <div className="room-control"><label htmlFor={`${id}-color`}>Color</label><div className="room-control-input">
        <input id={`${id}-color`} type="color" value={color} onChange={e => setColor(e.target.value)} /><span className="room-color-value">{color.toUpperCase()}</span>
        <button className="btn btn--sm" aria-label={`Apply ${title} color`} onClick={() => send(target, { color })}>Apply</button>
      </div></div>
      {cct && <div className="room-control"><label htmlFor={`${id}-temperature`}>White temperature <output>{temperature.toLocaleString()} K</output></label>
        <div className="room-control-input"><input id={`${id}-temperature`} type="range" min="2700" max="6500" step="100" value={temperature} onChange={e => setTemperature(Number(e.target.value))} />
          <button className="btn btn--sm" aria-label={`Apply ${title} white temperature`} onClick={() => send(target, { temperature })}>Apply</button></div>
        <div className="room-range-ends"><span>Warm</span><span>Cool{room ? ' · bulbs only' : ''}</span></div>
      </div>}
    </fieldset>
    {!room && <p className="room-sent">{state.sent_at ? `Last sent ${new Date(state.sent_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${state.mode ? ` · ${state.mode === 'white' ? 'white' : 'color'} mode` : ''}` : 'No settings sent yet'}</p>}
  </section>;
}
