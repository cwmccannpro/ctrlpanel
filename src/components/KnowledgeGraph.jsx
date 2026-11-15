import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { graphEdges } from '../lib/knowledge.js';
import { fitGraph, layoutGraph } from '../lib/knowledgeGraph.js';

export default function KnowledgeGraph({ notes, allNotes = notes, selected, onSelect, onClose, compact = false }) {
  const svgRef = useRef(null), gesture = useRef(null), lastHit = useRef(null);
  const filterId = useId().replace(/:/g, '');
  const [focus, setFocus] = useState(selected || null), [hover, setHover] = useState(null);
  const [local, setLocal] = useState(false), [labels, setLabels] = useState(true);
  const [overrides, setOverrides] = useState({});
  const [displayScale, setDisplayScale] = useState(1);
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 });
  const graph = useMemo(() => {
    const ids = new Set(notes.map(note => note.id));
    return layoutGraph(notes, graphEdges(allNotes).filter(edge => ids.has(edge.source) && ids.has(edge.target)));
  }, [notes, allNotes]);
  const stars = useMemo(() => Array.from({ length: 26 }, (_, index) => ({
    x: (index * 197 + 43) % 800,
    y: (index * 113 + 71) % 580,
    r: index % 7 === 0 ? 1.2 : .55,
    opacity: .15 + (index % 5) * .07,
  })), []);
  const points = { ...graph.points, ...overrides };
  const active = graph.adjacency[hover] ? hover : graph.adjacency[focus] ? focus : null;
  const neighbours = graph.adjacency[active] || new Set();
  const shown = local && graph.adjacency[focus] ? notes.filter(note => note.id === focus || graph.adjacency[focus]?.has(note.id)) : notes;
  const ids = new Set(shown.map(note => note.id));
  const edges = graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const focusedNote = notes.find(note => note.id === focus);
  const folders = [...new Set(notes.map(note => note.folder || 'Personal'))].sort();
  const hubs = [...notes].filter(note => graph.degree[note.id] > 0).sort((a, b) => graph.degree[b.id] - graph.degree[a.id] || a.title.localeCompare(b.title)).slice(0, compact ? 3 : 5);
  const orderedNodes = [...shown].sort((a, b) => (points[a.id]?.z || 0) - (points[b.id]?.z || 0));
  const labelFor = note => {
    const group = note.folder?.split('/').pop();
    const label = group && note.title.startsWith(`${group} - `) ? note.title.slice(group.length + 3) : note.title;
    return label.length > 30 ? `${label.slice(0, 30)}…` : label;
  };
  const graphVersion = JSON.stringify([Object.keys(graph.points).sort(), graph.edges.map(edge => [edge.source, edge.target].sort().join(':')).sort()]);
  const reset = () => setCamera(fitGraph(Object.fromEntries(shown.map(note => [note.id, points[note.id]]))));
  useEffect(() => {
    setOverrides({}); setCamera(fitGraph(graph.points));
    if (focus && !graph.adjacency[focus]) { setFocus(null); setLocal(false); }
  }, [graphVersion]);
  useEffect(() => { if (selected && graph.adjacency[selected]) setFocus(selected); }, [selected, graphVersion]);
  useEffect(() => { if (local) reset(); }, [local, focus]);
  const clientPoint = event => {
    const matrix = svgRef.current?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : { x: 400, y: 290 };
  };
  const zoomAt = (factor, point = { x: 400, y: 290 }) => setCamera(current => {
    const zoom = Math.max(.15, Math.min(5, current.zoom * factor)), ratio = zoom / current.zoom;
    return { zoom, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio };
  });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => { const box = svg.getBoundingClientRect(); setDisplayScale(Math.max(.1, Math.min(box.width / 800, box.height / 580))); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    const wheel = event => { event.preventDefault(); zoomAt(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .004), clientPoint(event)); };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => { svg.removeEventListener('wheel', wheel); observer.disconnect(); };
  }, [notes.length]);

  if (!notes.length) return <div className="kb-graph kb-graph--empty"><div className="kb-graph-top"><div><span className="kb-eyebrow">Constellation</span><strong>Knowledge network</strong></div>{onClose && <button className="btn btn--icon btn--ghost" onClick={onClose} aria-label="Close network"><i className="ti ti-x" aria-hidden="true" /></button>}</div><div className="kb-empty"><div className="kb-empty-orbit"><i className="ti ti-topology-star" aria-hidden="true" /></div><h2>Your network starts with a note</h2><p>Create notes and connect them with <code>[[Note title]]</code>.</p></div></div>;
  return <div className={`kb-graph ${compact ? 'kb-graph--compact' : ''}`}>
    <div className="kb-graph-top"><div className="kb-graph-heading"><span className="kb-eyebrow">Live constellation</span><strong>Knowledge network</strong><span>{notes.length} notes · {graph.edges.length} links</span></div><div className="kb-graph-top-actions"><button className={`btn btn--icon btn--ghost ${labels ? 'is-active' : ''}`} aria-label="Toggle node labels" aria-pressed={labels} title="Toggle labels" onClick={() => setLabels(value => !value)}><i className="ti ti-tag" aria-hidden="true" /></button>{onClose && <button className="btn btn--icon btn--ghost" onClick={onClose} aria-label="Close network" title="Close network"><i className="ti ti-x" aria-hidden="true" /></button>}</div></div>
    {hubs.length > 0 && <div className="kb-graph-hubs"><span><i className="ti ti-antenna-bars-5" aria-hidden="true" /> Hubs</span><div>{hubs.map(note => <button key={note.id} className={focus === note.id ? 'is-active' : ''} onClick={() => setFocus(note.id)} title={`${note.title}: ${graph.degree[note.id]} connections`}><i className="ti ti-sparkles" aria-hidden="true" />{note.title}<small>{graph.degree[note.id]}</small></button>)}</div></div>}
    <div className="kb-graph-stage">
      <div className="kb-graph-depth" aria-hidden="true"><span /><span /><span /></div>
      <svg ref={svgRef} viewBox="0 0 800 580" aria-label={`Interactive knowledge network with ${notes.length} notes and ${graph.edges.length} links. Use Tab to reach nodes, drag to move them, or drag empty space to pan.`} onDoubleClick={() => { const note = notes.find(item => item.id === lastHit.current); if (note) onSelect(note); }} onPointerDown={event => {
        if (event.button !== 0 && event.button !== 1) return;
        event.preventDefault();
        const id = event.target.closest('[data-node]')?.getAttribute('data-node');
        gesture.current = { id, point: clientPoint(event), camera, node: id ? points[id] : null, moved: false, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const point = clientPoint(event), dx = point.x - current.point.x, dy = point.y - current.point.y;
        if (Math.hypot(dx, dy) > 4) current.moved = true;
        if (!current.moved) return;
        if (current.id) setOverrides(value => ({ ...value, [current.id]: { ...current.node, x: current.node.x + dx / current.camera.zoom, y: current.node.y + dy / current.camera.zoom } }));
        else setCamera({ ...current.camera, x: current.camera.x + dx, y: current.camera.y + dy });
      }} onPointerUp={event => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        lastHit.current = current.moved ? null : current.id;
        if (!current.moved) { setFocus(current.id || null); if (!current.id) setLocal(false); }
        gesture.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => { gesture.current = null; }}>
        <defs><filter id={`${filterId}-glow`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter><linearGradient id={`${filterId}-edge`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".14" /><stop offset=".5" stopColor="var(--text-secondary)" stopOpacity=".45" /><stop offset="1" stopColor="var(--accent)" stopOpacity=".14" /></linearGradient></defs>
        <g className="kb-stars" aria-hidden="true">{stars.map((star, index) => <circle key={index} cx={star.x} cy={star.y} r={star.r} opacity={star.opacity} />)}</g>
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
          {edges.map(edge => {
            const connected = edge.source === active || edge.target === active;
            const depth = ((points[edge.source]?.z || 0) + (points[edge.target]?.z || 0)) / 2;
            return <line key={`${edge.source}-${edge.target}`} x1={points[edge.source].x} y1={points[edge.source].y} x2={points[edge.target].x} y2={points[edge.target].y} className={active ? connected ? 'active' : 'dimmed' : ''} style={{ '--edge-depth': .25 + depth * .65, stroke: connected ? 'var(--accent)' : `url(#${filterId}-edge)` }} />;
          })}
          {orderedNodes.map(note => {
            const near = note.id === active || neighbours.has(note.id), depth = points[note.id]?.z || .5;
            const hub = graph.degree[note.id] >= Math.max(2, (graph.degree[hubs[0]?.id] || 0) * .55);
            const radius = (4.5 + Math.min(9, Math.sqrt(graph.degree[note.id]) * 2)) * (.82 + depth * .28);
            return <g key={note.id} data-node={note.id} role="button" tabIndex={0} aria-label={`${note.title}, ${graph.degree[note.id]} connections`} aria-pressed={focus === note.id}
              style={{ '--node-color': `var(--graph-group-${folders.indexOf(note.folder || 'Personal') % 5})`, '--node-depth': depth }}
              className={`${focus === note.id ? 'selected' : ''} ${hub ? 'is-hub' : ''} ${active && !near ? 'dimmed' : ''}`}
              transform={`translate(${points[note.id].x} ${points[note.id].y}) scale(${.82 + depth * .28})`} onMouseEnter={() => setHover(note.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(note.id)} onBlur={() => setHover(null)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onSelect(note); } if (event.key === ' ') { event.preventDefault(); setFocus(note.id); } }}>
              <title>{`${note.title} · ${graph.degree[note.id]} connections · ${note.folder || 'Personal'}`}</title>
              {hub && <><circle className="kb-node-orbit kb-node-orbit--outer" r={radius + 14} /><circle className="kb-node-orbit" r={radius + 8} /></>}
              <circle className="kb-node-halo" r={radius + 12} filter={`url(#${filterId}-glow)`} /><circle className="kb-node-dot" r={radius} /><circle className="kb-node-shine" cx={-radius * .28} cy={-radius * .3} r={Math.max(1.2, radius * .22)} /><circle className="kb-node-hit" r={Math.max(22 / (camera.zoom * displayScale), radius + 12)} />
              {(labels || near) && <text y={radius + 18 / (camera.zoom * displayScale)} textAnchor="middle" style={{ fontSize: `${Math.min(38, 11 / (camera.zoom * displayScale))}px` }}>{labelFor(note)}</text>}
            </g>;
          })}
        </g>
      </svg>
      <div className="kb-graph-controls"><button aria-label="Zoom out" title="Zoom out" onClick={() => zoomAt(1 / 1.25)}><i className="ti ti-minus" aria-hidden="true" /></button><button aria-label="Fit network" title="Fit network" onClick={reset}><i className="ti ti-focus-centered" aria-hidden="true" /></button><button aria-label="Zoom in" title="Zoom in" onClick={() => zoomAt(1.25)}><i className="ti ti-plus" aria-hidden="true" /></button></div>
      <div className="kb-graph-zoom" aria-label={`Zoom ${Math.round(camera.zoom * 100)} percent`}>{Math.round(camera.zoom * 100)}%</div>
    </div>
    {focusedNote ? <div className="kb-graph-inspector"><div className="kb-graph-inspector-mark"><i className="ti ti-sparkles" aria-hidden="true" /></div><div><small>{focusedNote.folder || 'Personal'} · {graph.degree[focus]} connections</small><strong>{focusedNote.title}</strong></div><button className="btn btn--sm btn--accent" onClick={() => onSelect(focusedNote)}>Open</button></div> : <div className="kb-graph-prompt"><i className="ti ti-hand-grab" aria-hidden="true" /><span>Grab a node to shape the map. Select one to reveal its orbit.</span></div>}
    <div className="kb-graph-footer"><button className={`kb-local-toggle ${local ? 'is-active' : ''}`} aria-pressed={local} disabled={!focusedNote} onClick={() => setLocal(value => !value)}><i className="ti ti-target-arrow" aria-hidden="true" />Focus orbit</button><span>Drag · pan · scroll to zoom</span></div>
  </div>;
}
