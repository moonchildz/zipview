export function roadProfile(tags) {
  if (tags.area === 'yes' || (tags.tunnel && tags.tunnel !== 'no') || (tags.bridge && tags.bridge !== 'no')) return null;
  const kind = tags.highway;
  const walk = ['footway', 'path', 'pedestrian', 'steps', 'cycleway'].includes(kind);
  const widths = { motorway: 14, trunk: 12, primary: 12, secondary: 10, tertiary: 8, residential: 6, unclassified: 6, service: 4, living_street: 4, footway: 1.8, path: 1.5, pedestrian: 3, steps: 1.8, cycleway: 2 };
  const baseKind = kind?.replace(/_link$/, '');
  if (!widths[baseKind]) return null;
  const explicit = /^\d+(\.\d+)?\s*(m)?$/.test(tags.width ?? '') ? Number.parseFloat(tags.width) : NaN;
  const lanes = /^\d+$/.test(tags.lanes ?? '') ? Number(tags.lanes) : null;
  const width = Number.isFinite(explicit) && explicit > 0 ? explicit : lanes ? lanes * 3 + .5 : widths[baseKind] * (tags.oneway === 'yes' && ['primary', 'secondary', 'trunk'].includes(baseKind) ? .55 : 1);
  return { width: Math.min(width, 35), widthSource: Number.isFinite(explicit) && explicit > 0 ? 'osm-width' : lanes ? 'lanes-assumption' : 'class-assumption', walk, crossing: tags.footway === 'crossing' && tags.crossing === 'marked', centerLine: !walk && tags.lane_markings === 'yes' && lanes >= 2 && tags.oneway !== 'yes' };
}

// Match the rendered PlaneGeometry triangles, not the nearest DEM sample.
export function terrainHeight(terrain, x, z) {
  if (terrain.local && Math.abs(x) <= terrain.local.extent && Math.abs(z) <= terrain.local.extent) {
    return terrainHeight(terrain.local, x, z);
  }
  const { size, extent, heights } = terrain;
  const gx = Math.max(0, Math.min(size - 1, (x + extent) / (extent * 2) * (size - 1)));
  const gz = Math.max(0, Math.min(size - 1, (z + extent) / (extent * 2) * (size - 1)));
  const col = Math.min(size - 2, Math.floor(gx)), row = Math.min(size - 2, Math.floor(gz));
  const u = gx - col, v = gz - row, i = row * size + col;
  const a = heights[i], b = heights[i + 1], c = heights[i + size], d = heights[i + size + 1];
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

export function ribbonVertices(points, width, sample, lift = .15) {
  const dense = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < .01) continue;
    const steps = Math.ceil(length / 3);
    for (let j = 0; j < steps; j++) dense.push([a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps]);
  }
  if (!dense.length) return [];
  dense.push(points.at(-1));
  const edges = dense.map((p, i) => {
    const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / length, nz = (b[0] - a[0]) / length;
    return [-1, 1].map(sign => {
      const x = p[0] + sign * nx * width / 2, z = p[1] + sign * nz * width / 2;
      return [x, sample(x, z) + lift, z];
    });
  });
  const result = [];
  for (let i = 1; i < edges.length; i++) {
    const [a, b] = edges[i - 1], [c, d] = edges[i];
    result.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  return result;
}
