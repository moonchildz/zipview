import * as THREE from 'three';

// These repeated details are visual assumptions, not surveyed window locations.
export function buildFacades(building) {
  const group = new THREE.Group();
  const batches = { frame: [], glass: [], plinth: [] };
  const points = building.points;
  const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0);
  const floors = Math.max(1, Math.min(45, building.levels ?? Math.round(building.height / 3)));
  const floorHeight = building.height / floors;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 2.4) continue;
    const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length;
    const sign = area >= 0 ? 1 : -1, nx = uz * sign, nz = -ux * sign;
    const quad = (batch, start, end, bottom, top, offset) => {
      const vertex = (t, h) => [a[0] + ux * t + nx * offset, building.base + h, a[1] + uz * t + nz * offset];
      const p = vertex(start, bottom), q = vertex(end, bottom), r = vertex(start, top), s = vertex(end, top);
      batches[batch].push(...p, ...q, ...r, ...q, ...s, ...r);
    };
    quad('plinth', 0, length, 0, Math.min(4.5, building.height * .2), .025);
    const cols = Math.max(1, Math.floor(length / 3.5)), spacing = length / cols;
    for (let floor = 0; floor < floors; floor++) for (let col = 0; col < cols; col++) {
      const center = spacing * (col + .5), width = Math.min(2.1, spacing * .64);
      const bottom = floor * floorHeight + floorHeight * .27, top = floor * floorHeight + floorHeight * .88;
      quad('frame', center - width / 2 - .07, center + width / 2 + .07, bottom - .07, top + .07, .05);
      quad('glass', center - width / 2, center + width / 2, bottom, top, .065);
      quad('frame', center - .025, center + .025, bottom, top, .08);
      if (building.kind === 'apartments') quad('frame', center - width / 2, center + width / 2, bottom + .38, bottom + .43, .09);
    }
  }
  for (const [kind, vertices] of Object.entries(batches)) {
    if (!vertices.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: { glass: '#557c88', frame: '#d6dad8', plinth: '#74777a' }[kind], roughness: kind === 'glass' ? .3 : .85, metalness: kind === 'glass' ? .2 : 0, side: THREE.DoubleSide })));
  }
  return group;
}
