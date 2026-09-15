import * as THREE from 'three';
import {buildGrove} from './aerial-grove.js';

export function regionPlacements(data, {scale = data.scale?.metersPerPixel, threshold = 0.22} = {}) {
  const {width, height} = data.source ?? {};
  if (data.schemaVersion !== 2 || data.coordinateSystem !== 'image-pixels'
      || ![width, height, scale].every(v => Number.isFinite(v) && v > 0)
      || !Number.isFinite(threshold) || threshold < 0 || threshold > 1
      || !Array.isArray(data.regions) || !Array.isArray(data.objects)) throw new Error('Invalid region document');
  const ids = new Set();
  function identity(item) {
    if (typeof item.id !== 'string' || ids.has(item.id)) throw new Error('Duplicate or missing region id');
    ids.add(item.id);
  }
  function ring(points) {
    if (!Array.isArray(points) || points.length < 3 || points.some(p => !Array.isArray(p) || p.length !== 2
        || !p.every(Number.isFinite) || p[0] < 0 || p[0] > width || p[1] < 0 || p[1] > height)) throw new Error('Invalid region ring');
    return points.map(([x, y]) => [(x - width / 2) * scale, (y - height / 2) * scale]);
  }
  const regions = data.regions.map(item => {
    identity(item);
    if (item.kind !== 'vegetation-region' || !Number.isFinite(item.heightMeters)
        || item.heightMeters <= 0 || item.heightMeters > 50 || !Array.isArray(item.holes)) throw new Error('Invalid region height/holes');
    return {...item, ring: ring(item.ring), holes: item.holes.map(ring), heightStatus: 'assumed'};
  });
  const objects = data.objects.map(item => {
    identity(item);
    const b = item.box;
    if (!['vehicle', 'playground'].includes(item.kind) || !Array.isArray(b) || b.length !== 4
        || !b.every(Number.isFinite) || b[0] < 0 || b[1] < 0 || b[2] > width || b[3] > height
        || b[2] <= b[0] || b[3] <= b[1] || !Number.isFinite(item.score) || item.score < 0 || item.score > 1) throw new Error('Invalid facility candidate');
    let footprint = null;
    if (item.quad !== undefined) {
      if (!Array.isArray(item.quad) || item.quad.length !== 4) throw new Error('Invalid OBB corners');
      footprint = ring(item.quad);
      const edges = footprint.map((p, i) => {
        const q = footprint[(i + 1) % 4]; return [q[0] - p[0], q[1] - p[1]];
      });
      const crosses = edges.map((e, i) => e[0] * edges[(i + 1) % 4][1] - e[1] * edges[(i + 1) % 4][0]);
      if (!crosses.every(v => v > 1e-8) && !crosses.every(v => v < -1e-8)) throw new Error('Invalid OBB polygon');
    }
    return {...item, footprint, x: ((b[0] + b[2]) / 2 - width / 2) * scale,
      z: ((b[1] + b[3]) / 2 - height / 2) * scale,
      width: (b[2] - b[0]) * scale, depth: (b[3] - b[1]) * scale, heightStatus: 'assumed'};
  }).filter(item => item.score >= threshold);
  return {regions, objects};
}

export function buildAerialRegions({regions, objects}, {vegetationMode = 'grove', density = 1, heightScale = 1} = {}) {
  if (!['grove', 'volume'].includes(vegetationMode)) throw new Error('Invalid vegetation mode');
  const group = new THREE.Group();
  group.name = 'aerial-regions-and-facilities';
  const vegetation = vegetationMode === 'grove' ? buildGrove(regions, {density, heightScale}) : new THREE.Group(), facilities = new THREE.Group();
  vegetation.name = 'vegetation'; facilities.name = 'facilities';
  group.add(vegetation, facilities);
  const path = points => points.map(([x, z]) => new THREE.Vector2(x, -z));
  for (const region of vegetationMode === 'volume' ? regions : []) {
    const shape = new THREE.Shape(path(region.ring));
    shape.holes = region.holes.map(hole => new THREE.Path(path(hole)));
    const geometry = new THREE.ExtrudeGeometry(shape, {depth: region.heightMeters, bevelEnabled: false});
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: 0x427d52, roughness: 1}));
    mesh.userData = {id: region.id, kind: region.kind, heightStatus: 'assumed'};
    vegetation.add(mesh);
  }
  for (const item of objects) {
    // Boxes are candidate envelopes, not reconstructed car bodies or playground equipment.
    const height = item.kind === 'vehicle' ? 1.5 : 0.3;
    const geometry = item.footprint
      ? new THREE.ExtrudeGeometry(new THREE.Shape(path(item.footprint)), {depth: height, bevelEnabled: false}).rotateX(-Math.PI / 2)
      : new THREE.BoxGeometry(item.width, height, item.depth);
    const mesh = new THREE.Mesh(geometry,
      new THREE.MeshStandardMaterial({color: item.kind === 'vehicle' ? 0xecc74c : 0xcc69b9, roughness: 0.8}));
    if (!item.footprint) mesh.position.set(item.x, height / 2, item.z);
    mesh.userData = {id: item.id, kind: item.kind, status: 'unverified', heightStatus: 'assumed', orientationStatus: item.orientationStatus ?? 'unknown'};
    facilities.add(mesh);
  }
  return group;
}
