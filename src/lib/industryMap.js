// ============================================================
// CTRLpanel — Industry map (pure; no React, no browser or Node APIs)
// The Industry Problems Agent returns an industry's value chain as
//   { stages: [{ name, summary, steps: [{ name, pain, problem_key }] }] }
// (stored in industry_runs.summary.map). This module normalizes that shape
// (shared with the backend), turns it into a left-to-right tree, lays the
// tree out for the SVG <MindMap>, and exports it as Markdown that Markmap
// and similar tools can render.
// ============================================================

export const MAX_STAGES = 8;
export const MAX_STEPS = 6;

const str = (v, max = 400) => {
  const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/**
 * Validate and bound the agent's map. `validKeys` (a Set or array of problem
 * keys that survived the run) nulls any step.problem_key that points at
 * nothing; pass null to skip that check. Stages with no named steps are dropped.
 */
export function normalizeMap(raw, validKeys = null) {
  const keys = validKeys ? new Set(validKeys) : null;
  const stages = Array.isArray(raw?.stages) ? raw.stages : [];
  const out = [];
  for (const s of stages) {
    const name = str(s?.name, 80);
    if (!name) continue;
    const steps = [];
    for (const st of Array.isArray(s?.steps) ? s.steps : []) {
      const stepName = str(st?.name, 100);
      if (!stepName) continue;
      const pain = str(st?.pain, 220) || null;
      const key = str(st?.problem_key, 60) || null;
      steps.push({ name: stepName, pain, problem_key: pain && key && (!keys || keys.has(key)) ? key : null });
      if (steps.length >= MAX_STEPS) break;
    }
    if (steps.length) out.push({ name, summary: str(s?.summary, 200), steps });
    if (out.length >= MAX_STAGES) break;
  }
  return { stages: out };
}

/** Every problem_key referenced by the map. */
export const mapProblemKeys = (map) =>
  (map?.stages || []).flatMap((s) => s.steps.map((st) => st.problem_key).filter(Boolean));

/* ---------------- tree ---------------- */

/**
 * industry → stages → steps → (a pain leaf when the step has one).
 * Node ids are stable for a given map: 'root', 's0', 's0-1', 's0-1-p'.
 */
export function buildTree(industry, map) {
  return {
    id: 'root',
    kind: 'root',
    label: str(industry, 120) || 'Industry',
    children: (map?.stages || []).map((s, i) => ({
      id: `s${i}`,
      kind: 'stage',
      label: s.name,
      note: s.summary || '',
      children: s.steps.map((st, j) => {
        const id = `s${i}-${j}`;
        return {
          id,
          kind: 'step',
          label: st.name,
          hot: Boolean(st.pain),
          children: st.pain
            ? [{ id: `${id}-p`, kind: 'pain', label: st.pain, problemKey: st.problem_key || null, children: [] }]
            : [],
        };
      }),
    })),
  };
}

/* ---------------- layout ---------------- */

// width, characters per line and max lines for each depth of the tree.
const COLUMNS = {
  root: { w: 150, chars: 17, lines: 4 },
  stage: { w: 170, chars: 20, lines: 3 },
  step: { w: 190, chars: 22, lines: 3 },
  pain: { w: 244, chars: 31, lines: 4 },
};
const KIND_DEPTH = ['root', 'stage', 'step', 'pain'];
const LINE_H = 15;
const PAD_Y = 10;
const COL_GAP = 46;
const ROW_GAP = 10;
const MARGIN = 12;

/** Greedy word wrap to `maxChars` per line, ending with an ellipsis if it needs more than `maxLines`. */
export function wrapLabel(text, maxChars, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    while (w.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines.length ? lines : [''];
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = `${last.length >= maxChars ? last.slice(0, maxChars - 1) : last}…`;
  return kept;
}

/**
 * Left-to-right tidy tree. Leaves take consecutive rows, parents sit centred on
 * their children, and a stage in `collapsed` hides its descendants.
 * Returns { nodes, links, width, height } — nodes carry x/y/w/h, wrapped
 * `lines`, and whether they have (or hide) children.
 */
export function layoutTree(tree, { collapsed = new Set() } = {}) {
  const xs = [];
  let x = MARGIN;
  for (const kind of KIND_DEPTH) {
    xs.push(x);
    x += COLUMNS[kind].w + COL_GAP;
  }

  const nodes = [];
  const byId = new Map();
  let cursor = MARGIN;

  const place = (n, depth) => {
    const col = COLUMNS[n.kind] || COLUMNS.step;
    const lines = wrapLabel(n.label, col.chars, col.lines);
    const h = lines.length * LINE_H + PAD_Y * 2;
    const hidden = collapsed.has(n.id);
    const kids = hidden ? [] : n.children;
    const node = {
      id: n.id,
      kind: n.kind,
      label: n.label,
      note: n.note || '',
      hot: Boolean(n.hot),
      problemKey: n.problemKey || null,
      lines,
      x: xs[depth] ?? xs[xs.length - 1],
      w: col.w,
      h,
      hasChildren: n.children.length > 0,
      collapsed: hidden && n.children.length > 0,
      parent: null,
      y: 0,
    };

    if (!kids.length) {
      node.y = cursor;
      cursor += h + ROW_GAP;
      nodes.push(node);
      byId.set(node.id, node);
      return node;
    }

    const start = cursor;
    const subtreeFrom = nodes.length;
    const placed = kids.map((k) => place(k, depth + 1));
    for (const k of placed) k.parent = node.id;
    const first = placed[0];
    const last = placed[placed.length - 1];
    node.y = (first.y + first.h / 2 + last.y + last.h / 2) / 2 - h / 2;
    if (node.y < start) {
      // A parent taller than its children's span would poke above the rows already used.
      const dy = start - node.y;
      for (let i = subtreeFrom; i < nodes.length; i++) nodes[i].y += dy;
      node.y += dy;
      cursor += dy;
    }
    cursor = Math.max(cursor, node.y + h + ROW_GAP);
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };

  place(tree, 0);

  const links = [];
  for (const n of nodes) {
    if (!n.parent) continue;
    const p = byId.get(n.parent);
    const x1 = p.x + p.w;
    const y1 = p.y + p.h / 2;
    const x2 = n.x;
    const y2 = n.y + n.h / 2;
    const mid = (x1 + x2) / 2;
    links.push({ id: `${p.id}>${n.id}`, hot: n.kind === 'pain', d: `M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}` });
  }

  const width = Math.max(...nodes.map((n) => n.x + n.w)) + MARGIN;
  const height = Math.max(...nodes.map((n) => n.y + n.h)) + MARGIN;
  return { nodes, links, width, height };
}

/* ---------------- Markdown export ---------------- */

const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * Indented-list Markdown of the map — paste it into markmap.js.org (or any
 * Markdown mind-map tool) for a pannable, collapsible map. Pains are marked ⚠.
 */
export function mapToMarkdown(industry, map) {
  const out = [`# ${oneLine(industry) || 'Industry'}`];
  for (const s of map?.stages || []) {
    out.push('', `## ${oneLine(s.name)}`);
    for (const st of s.steps) {
      out.push(`- ${oneLine(st.name)}`);
      if (st.pain) out.push(`  - ⚠ ${oneLine(st.pain)}`);
    }
  }
  return `${out.join('\n')}\n`;
}
