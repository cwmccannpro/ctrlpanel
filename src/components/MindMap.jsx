// ============================================================
// Industry map — a left-to-right mind map drawn as inline SVG:
// industry → value-chain stages → steps → the pain found at a step. Layout
// comes from the pure src/lib/industryMap.js. Click a stage to collapse it;
// click a pain that has a matching problem to jump to that problem. Hold the
// middle mouse button and drag to pan, like the dashboard canvas. Colours are
// theme tokens only (see .mm-* in agents.css).
// ============================================================
import { useMemo, useRef, useState } from 'react';
import { buildTree, layoutTree } from '../lib/industryMap.js';
import { useMiddleClickPan } from '../lib/useMiddleClickPan.js';

const LINE_H = 15;
const PAD_Y = 10;

export default function MindMap({ industry, map, linkedKeys, activeKey, onSelectProblem }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const scrollRef = useRef(null);
  useMiddleClickPan(scrollRef, () => ({ x: scrollRef.current, y: scrollRef.current }));

  const tree = useMemo(() => buildTree(industry, map), [industry, map]);
  const layout = useMemo(() => layoutTree(tree, { collapsed }), [tree, collapsed]);
  const stageIds = useMemo(() => tree.children.map((c) => c.id), [tree]);

  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allCollapsed = stageIds.length > 0 && stageIds.every((id) => collapsed.has(id));

  if (!stageIds.length) {
    return <div className="opp-empty">This run didn't return a map.</div>;
  }

  const press = (fn) => ({
    role: 'button',
    tabIndex: 0,
    onClick: fn,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fn();
      }
    },
  });

  return (
    <div className="mm">
      <div className="mm-toolbar">
        <span className="list-row-meta">
          Click a stage to collapse it · click a <span className="mm-key">pain</span> to open its problem · middle-drag to pan
        </span>
        <button className="btn btn--ghost btn--sm" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(stageIds))}>
          <i className={`ti ${allCollapsed ? 'ti-arrows-maximize' : 'ti-arrows-minimize'}`} />
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
      </div>

      <div className="mm-scroll" ref={scrollRef}>
        <svg className="mm-svg" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`${industry} industry map`}>
          {layout.links.map((l) => (
            <path key={l.id} d={l.d} className={`mm-link${l.hot ? ' mm-link--hot' : ''}`} />
          ))}
          {layout.nodes.map((n) => {
            const linked = n.kind === 'pain' && n.problemKey && linkedKeys?.has(n.problemKey);
            const isStage = n.kind === 'stage';
            const interactive = isStage && n.hasChildren ? press(() => toggle(n.id)) : linked ? press(() => onSelectProblem?.(n.problemKey)) : {};
            const cls = [
              'mm-node',
              `mm-node--${n.kind}`,
              n.hot && 'mm-node--hot',
              linked && 'mm-node--link',
              n.kind === 'pain' && n.problemKey && n.problemKey === activeKey && 'mm-node--active',
              interactive.role && 'mm-node--press',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <g key={n.id} className={cls} transform={`translate(${n.x} ${n.y})`} {...interactive} aria-expanded={isStage && n.hasChildren ? !n.collapsed : undefined}>
                <title>{n.note ? `${n.label} — ${n.note}` : n.label}</title>
                <rect width={n.w} height={n.h} rx={8} />
                {n.lines.map((line, i) => (
                  <text key={i} x={10} y={PAD_Y + LINE_H * (i + 1) - 4}>
                    {line}
                  </text>
                ))}
                {isStage && n.hasChildren && (
                  <text className="mm-toggle" x={n.w - 16} y={n.h / 2 + 4} textAnchor="middle">
                    {n.collapsed ? '+' : '–'}
                  </text>
                )}
                {linked && (
                  <text className="mm-toggle" x={n.w - 14} y={n.h / 2 + 4} textAnchor="middle">
                    →
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
