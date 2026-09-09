import * as THREE from 'three';

// The local boundary must coincide with coarse grid edges to avoid overlaps/gaps.
export function terrainGeometries(data) {
  const grids = data.local ? [data, data.local] : [data];
  return grids.map((grid, level) => {
    const geometry = new THREE.PlaneGeometry(grid.extent * 2, grid.extent * 2, grid.size - 1, grid.size - 1);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    grid.heights.forEach((h, i) => positions.setY(i, h));
    if (level === 0 && data.local) {
      const step = data.extent * 2 / (data.size - 1);
      if (Math.abs(data.local.extent / step - Math.round(data.local.extent / step)) > 1e-8) throw new Error('Local terrain boundary must align with coarse grid');
      const indices = [], source = geometry.index.array;
      for (let i = 0; i < source.length; i += 3) {
        const triangle = [source[i], source[i + 1], source[i + 2]];
        const x = triangle.reduce((s, n) => s + positions.getX(n), 0) / 3;
        const z = triangle.reduce((s, n) => s + positions.getZ(n), 0) / 3;
        if (Math.abs(x) < data.local.extent && Math.abs(z) < data.local.extent) continue;
        indices.push(...triangle);
      }
      geometry.setIndex(indices);
    }
    geometry.computeVertexNormals();
    return geometry;
  });
}
