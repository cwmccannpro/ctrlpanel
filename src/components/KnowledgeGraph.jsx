import { useMemo, useState } from 'react';
import { graphEdges } from '../lib/knowledge.js';

export default function KnowledgeGraph({ notes, allNotes = notes, selected, onSelect }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const edges = useMemo(() => {
    const ids = new Set(notes.map(n => n.id));
    return graphEdges(allNotes).filter(e => ids.has(e.source) && ids.has(e.target));
  }, [notes, allNotes]);
  const points = useMemo(() => {
    const count = notes.length;
    return Object.fromEntries(notes.map((n, i) => {
      const angle = i * 2.3999632297;
      const radius = count <= 1 ? 0 : 225 * Math.sqrt((i + 1) / count);
      return [n.id, { x: 400 + Math.cos(angle) * radius * 1.4, y: 290 + Math.sin(angle) * radius }];
    }));
  }, [notes]);
  if (!notes.length) return <div className="kb-empty"><i className="ti ti-topology-star" /><h2>Your network starts with a note</h2><p>Create notes and connect them with [[Note title]] links.</p></div>;
  return <div className="kb-graph">
    <div className="kb-graph-tools"><span>{notes.length} notes · {edges.length} links</span><button className="btn btn--sm" aria-label="Zoom out" onClick={() => setZoom(z => Math.max(.4, z / 1.3))}>−</button><button className="btn btn--sm" aria-label="Zoom in" onClick={() => setZoom(z => Math.min(4, z * 1.3))}>+</button><button className="btn btn--sm" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset view</button></div>
    <svg viewBox="0 0 800 580" aria-label="Knowledge network. Select a note to open it." onPointerDown={e => {
      if (e.target.closest('[data-node]')) return;
      const svg = e.currentTarget; svg.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, ...{ px: pan.x, py: pan.y } };
      const scale = 800 / svg.getBoundingClientRect().width;
      svg.onpointermove = ev => setPan({ x: start.px + (ev.clientX - start.x) * scale, y: start.py + (ev.clientY - start.y) * scale });
      svg.onpointerup = svg.onpointercancel = () => { svg.onpointermove = null; };
    }}>
      <g transform={`translate(${pan.x + 400 * (1 - zoom)} ${pan.y + 290 * (1 - zoom)}) scale(${zoom})`}>
        {edges.map(e => <line key={`${e.source}-${e.target}`} x1={points[e.source].x} y1={points[e.source].y} x2={points[e.target].x} y2={points[e.target].y} className={e.source === selected || e.target === selected ? 'active' : ''} />)}
        {notes.map(n => <g key={n.id} data-node="true" role="button" tabIndex={0} aria-label={`Open ${n.title}`} className={selected === n.id ? 'selected' : ''} transform={`translate(${points[n.id].x} ${points[n.id].y})`} onClick={() => onSelect(n)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n); } }}><title>{n.title}</title><circle r={selected === n.id ? 8 : 5} /><text y="22" textAnchor="middle">{n.title.length > 28 ? `${n.title.slice(0, 28)}…` : n.title}</text></g>)}
      </g>
    </svg><p className="kb-graph-hint">Drag to pan · Use + / − to zoom · Select a note to edit</p>
  </div>;
}
