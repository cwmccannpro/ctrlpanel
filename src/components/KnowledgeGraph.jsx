import { useEffect, useMemo, useRef, useState } from 'react';
import { graphEdges } from '../lib/knowledge.js';
import { fitCamera, projectStar, starPosition } from '../lib/knowledgeGraph.js';
import ContextSky from './ContextSky.jsx';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
function Control({ icon, label, onClick, pressed, disabled }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><i className={'ti ti-' + icon} /></button>;
}

export default function KnowledgeGraph({ notes, allNotes = notes, selected, onSelect, onCreate, loading, error }) {
  const stage = useRef(null), gesture = useRef(null), touches = useRef(new Map());
  const [size, setSize] = useState({ width: 800, height: 600 });
  const stars = useMemo(() => notes.map(note => ({ note, point: starPosition(note) })), [notes]);
  const edges = useMemo(() => {
    const visible = new Set(notes.map(n => n.id)), seen = new Set();
    return graphEdges(allNotes).filter(({ source, target }) => {
      const key = [source, target].sort().join(':');
      if (seen.has(key) || !visible.has(source) || !visible.has(target)) return false;
      seen.add(key); return true;
    });
  }, [notes, allNotes]);
  const fitted = useMemo(() => fitCamera(stars.map(s => s.point)), [stars]);
  const [custom, setCamera] = useState(null);
  const camera = custom || fitted;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const clusters = useMemo(() => {
    const groups = new Map();
    for (const { note, point } of stars) {
      if (!note.folder) continue;
      const group = groups.get(note.folder) || { sum: [0, 0, 0], count: 0 };
      point.forEach((value, i) => { group.sum[i] += value; });
      group.count++; groups.set(note.folder, group);
    }
    return [...groups].map(([name, group]) => ({ name, point: group.sum.map(v => v / group.count) }));
  }, [stars]);
  const [labels, setLabels] = useState(true), [local, setLocal] = useState(false);
  const [help, setHelp] = useState(false);
  const neighbours = new Set([selected]);
  for (const edge of edges) {
    if (edge.source === selected) neighbours.add(edge.target);
    if (edge.target === selected) neighbours.add(edge.source);
  }
  const screen = new Map();
  for (const star of stars) {
    if (local && selected && !neighbours.has(star.note.id)) continue;
    const point = projectStar(star.point, camera, size.width, size.height);
    if (point) screen.set(star.note.id, { ...star, ...point });
  }
  const fly = factor => setCamera(c => {
    const prev = c || cameraRef.current;
    return { ...prev, distance: clamp(prev.distance * factor, 10, 6000) };
  });
  useEffect(() => {
    const element = stage.current;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    observer.observe(element);
    const wheel = e => { e.preventDefault(); fly(Math.exp(clamp(e.deltaY, -160, 160) * 0.002)); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
  }, []);
  function pointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return;
    const id = e.target.closest('[data-star]')?.dataset.star;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { x: e.clientX, y: e.clientY, camera, id, moved: touches.current.size > 1, pan: e.shiftKey || e.button === 1 };
  }
  function pointerMove(e) {
    const g = gesture.current, fingers = touches.current;
    if (!g || !fingers.has(e.pointerId)) return;
    const old = fingers.get(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size > 1) {
      const other = [...fingers.entries()].find(([id]) => id !== e.pointerId)[1];
      const distance = Math.hypot(e.clientX-other.x, e.clientY-other.y);
      if (distance > 2) fly(Math.hypot(old.x-other.x, old.y-other.y) / distance);
      g.moved = true; return;
    }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) < 4 && !g.moved) return;
    g.moved = true;
    const c = g.camera;
    if (g.pan) {
      const k = c.distance / (Math.min(size.width, size.height) * 0.91);
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), sp = Math.sin(c.pitch), cp = Math.cos(c.pitch);
      const delta = [dx*cy-dy*sp*sy, dy*cp, -dx*sy-dy*sp*cy];
      setCamera({ ...c, target: c.target.map((v, i) => v - delta[i]*k) });
    } else setCamera({ ...c, yaw: c.yaw + dx * .007, pitch: clamp(c.pitch - dy * .007, -1.5, 1.5) });
  }
  function pointerEnd(e) {
    const g = gesture.current;
    touches.current.delete(e.pointerId);
    if (e.type === 'pointerup' && !g?.moved && g?.id) onSelect(screen.get(g.id).note);
    gesture.current = null;
  }
  function keys(e) {
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      setCamera({ ...camera, yaw: camera.yaw + (e.key === 'ArrowRight' ? .12 : e.key === 'ArrowLeft' ? -.12 : 0),
        pitch: clamp(camera.pitch + (e.key === 'ArrowUp' ? .12 : e.key === 'ArrowDown' ? -.12 : 0), -1.5, 1.5) });
    } else if (['+', '=', '-'].includes(e.key)) { e.preventDefault(); fly(e.key === '-' ? 1.2 : 1/1.2); }
    else if (e.key === 'Home') { e.preventDefault(); setCamera(null); }
  }
  const target = stars.find(s => s.note.id === selected);
  return <section className="ctx-universe" aria-label="Constellation network">
    <ContextSky />
    <div className="ctx-map-heading"><span className="ctx-live-dot" />Network <span className="ctx-map-count">{notes.length} {notes.length === 1 ? 'note' : 'notes'} · {edges.length} {edges.length === 1 ? 'link' : 'links'}</span></div>
    <svg ref={stage} className="ctx-map" tabIndex={0} aria-label="3D star map. Arrow keys orbit, plus and minus fly, Home fits all." onKeyDown={keys}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
      {labels && !(local && selected) && clusters.map(group => {
        const p = projectStar(group.point, camera, size.width, size.height);
        return p && <text key={group.name} className="ctx-cluster-label" x={p.x} y={p.y - 26} textAnchor="middle">{group.name}</text>;
      })}
      {edges.map(({ source, target }) => {
        const a = screen.get(source), b = screen.get(target);
        return a && b && <line key={source+target} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={selected === source || selected === target ? 'active' : ''} />;
      })}
      {[...screen.values()].sort((a,b) => b.depth-a.depth).map(({ note, x, y, scale }) => {
        const active = note.id === selected, radius = clamp(3.8 * Math.sqrt(scale), 3, 11);
        return <g key={note.id} data-star={note.id} transform={'translate(' + x + ' ' + y + ')'} className={active ? 'selected' : selected && !neighbours.has(note.id) ? 'ctx-distant' : ''} tabIndex={0} role="button" aria-label={'Preview ' + note.title}
          onKeyDown={e => { if (['Enter',' '].includes(e.key)) { e.preventDefault(); onSelect(note); } }}>
          <title>{note.title}</title><circle r={Math.max(15,radius*2)} fill="transparent" />
          <circle r={radius * 2.7} className="ctx-star-halo" /><circle r={radius} className="ctx-star" />
          {active && <circle r={radius + 8} className="ctx-star-ring" />}
          {(labels || active) && <text x={radius + 11} y="4">{note.title}</text>}
        </g>;
      })}
    </svg>
    {!notes.length && <div className="ctx-first"><i className="ti ti-sparkles ctx-first-icon" />
      <h2>{loading ? 'Opening your constellation' : error ? 'Network unavailable' : 'Your constellation'}</h2>
      {!loading && !error && <><p>Each note is a star. Link notes to connect them.</p><button className="btn btn--accent" onClick={onCreate}><i className="ti ti-plus" /> Create your first note</button></>}
    </div>}
    <div className="ctx-flight"><Control icon="minus" label="Fly out" onClick={() => fly(1.24)} /><Control icon="plus" label="Fly in" onClick={() => fly(1/1.24)} />
      <Control icon="maximize" label="Fit all" onClick={() => { setCamera(null); setLocal(false); }} />
      {target && <Control icon="focus-2" label="Fly to selected star" onClick={() => setCamera({ ...camera, target: target.point, distance: 150 })} />}
      <Control icon="tag" label="Star labels" pressed={labels} onClick={() => setLabels(!labels)} />
      {target && <Control icon="topology-star" label="Direct connections only" pressed={local} onClick={() => setLocal(!local)} />}
      <Control icon="help" label="Navigation help" pressed={help} onClick={() => setHelp(!help)} />
    </div>
    {help && <p className="ctx-flight-help">Drag to orbit · Shift-drag to pan · Scroll or pinch to fly · Home to fit all</p>}
  </section>;
}
