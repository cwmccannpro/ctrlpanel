// Folder and note identities determine world coordinates independently of result order.
export function fraction(key) {
  let value = 2166136261;
  for (const char of key) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  return ((value ^ (value >>> 13)) >>> 0) / 4294967296;
}

function direction(key) {
  const angle = fraction(key + ':angle') * Math.PI * 2;
  const z = fraction(key + ':depth') * 2 - 1;
  const ring = Math.sqrt(1 - z * z);
  return [ring * Math.cos(angle), ring * Math.sin(angle), z];
}

export function starPosition(note) {
  const cluster = direction(note.folder || '/');
  const offset = direction(note.id);
  const radius = 38 + fraction(note.id + ':radius') * 90;
  return cluster.map((coordinate, axis) => coordinate * 310 + offset[axis] * radius);
}

export function fitCamera(points) {
  const target = [0, 0, 0];
  for (const point of points) point.forEach((value, i) => { target[i] += value / points.length; });
  const radius = points.reduce((r, p) => Math.max(r, Math.hypot(...p.map((v, i) => v - target[i]))), 70);
  return { target, yaw: 0, pitch: 0, distance: radius * 2.65 };
}

export function projectStar(point, camera, width, height) {
  const [x, y, z] = point.map((value, i) => value - camera.target[i]);
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const rotatedZ = sy * x + cy * z;
  const depth = camera.distance - (sp * y + cp * rotatedZ);
  if (depth < 6) return null;
  const scale = Math.min(width, height) * 0.91 / depth;
  return { x: width / 2 + (cy * x - sy * z) * scale,
    y: height / 2 + (cp * y - sp * rotatedZ) * scale, scale, depth };
}
