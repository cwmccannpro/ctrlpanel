// Stable force layout without a runtime graph dependency.
export function layoutGraph(notes, edges) {
  const ordered = [...notes].sort((a, b) => a.id.localeCompare(b.id));
  const adjacency = Object.fromEntries(ordered.map(n => [n.id, new Set()]));
  const degree = Object.fromEntries(ordered.map(n => [n.id, 0]));
  const seen = new Set(), unique = [];
  for (const e of edges) {
    if (!adjacency[e.source] || !adjacency[e.target] || e.source === e.target) continue;
    const key = JSON.stringify([e.source, e.target].sort());
    if (seen.has(key)) continue;
    seen.add(key); unique.push(e);
    adjacency[e.source].add(e.target); adjacency[e.target].add(e.source);
    degree[e.source]++; degree[e.target]++;
  }
  const nodes = ordered.map((n, i) => ({
    id: n.id,
    x: 400 + Math.cos(i * 2.399963) * 35 * Math.sqrt(i),
    y: 290 + Math.sin(i * 2.399963) * 35 * Math.sqrt(i),
    z: Math.sin((i + 1) * 1.618033) * .5 + .5,
  }));
  const index = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const stride = Math.max(1, Math.ceil(nodes.length / 160));
  for (let step = 0; step < 220; step++) {
    const forces = nodes.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1 + step % stride; j < nodes.length; j += stride) {
      const dx = nodes[i].x - nodes[j].x || .01, dy = nodes[i].y - nodes[j].y || .01;
      const force = 1800 * stride / Math.max(100, dx * dx + dy * dy);
      forces[i].x += dx * force; forces[i].y += dy * force;
      forces[j].x -= dx * force; forces[j].y -= dy * force;
    }
    for (const e of unique) {
      const a = index[e.source], b = index[e.target];
      const dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y;
      const d = Math.hypot(dx, dy) || 1, pull = (d - 85) * .025 / d;
      forces[a].x += dx * pull; forces[a].y += dy * pull;
      forces[b].x -= dx * pull; forces[b].y -= dy * pull;
    }
    nodes.forEach((n, i) => {
      const fx = forces[i].x + (400 - n.x) * .012, fy = forces[i].y + (290 - n.y) * .012;
      const limit = Math.min(1, 8 / (Math.hypot(fx, fy) || 1)) * (1 - step / 260);
      n.x += fx * limit; n.y += fy * limit;
    });
  }
  return { points: Object.fromEntries(nodes.map(n => [n.id, n])), degree, adjacency, edges: unique };
}
export function fitGraph(points) {
  const values = Object.values(points);
  if (!values.length) return { zoom: 1, x: 0, y: 0 };
  const xs = values.map(p => p.x), ys = values.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const zoom = Math.max(.15, Math.min(1.7, 640 / Math.max(100, maxX - minX), 410 / Math.max(100, maxY - minY)));
  return { zoom, x: 400 - (minX + maxX) / 2 * zoom, y: 290 - (minY + maxY) / 2 * zoom };
}
