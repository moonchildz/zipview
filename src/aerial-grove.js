import * as THREE from 'three';
import {insideFootprint} from './outlook-math.js';

function randomFor(key) {
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {seed = Math.imul(seed ^ seed >>> 15, 2246822519); seed ^= seed >>> 13; return (seed >>> 0) / 4294967296;};
}

export function crownClearance(point, region) {
  if (!insideFootprint(point, region.ring) || region.holes.some(h => insideFootprint(point, h))) return 0;
  let closest = Infinity;
  for (const ring of [region.ring, ...region.holes]) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    closest = Math.min(closest, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz));
  }
  return closest;
}

export function sampleGrove(regions, {density = 1, heightScale = 1} = {}) {
  if (!Number.isFinite(density) || density < 0.5 || density > 2 || !Number.isFinite(heightScale)
      || heightScale < 0.5 || heightScale > 2) throw new Error('Invalid grove settings');
  const trees = [];
  const totalBoxArea = regions.reduce((sum, region) => {
    const xs = region.ring.map(p => p[0]), zs = region.ring.map(p => p[1]);
    return sum + (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
  }, 0);
  const minimumSpacing = Math.max(2.4 / Math.sqrt(density), Math.sqrt(totalBoxArea / 5000));
  for (const region of regions) {
    const xs = region.ring.map(p => p[0]), zs = region.ring.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    // Bound work for large or highly elongated polygons; the pilot's normal spacing is 2.4 m.
    const spacing = Math.max(minimumSpacing, Math.sqrt((maxX - minX) * (maxZ - minZ) / 2500), (maxX - minX) / 2500, (maxZ - minZ) / 2500);
    const rand = randomFor(region.id);
    const add = (x, z) => {
      const clearance = crownClearance([x, z], region);
      if (clearance < 0.25) return;
      const radius = Math.min(clearance * 0.97, spacing * (0.85 + rand() * 0.3));
      const height = Math.min(region.heightMeters * heightScale * (0.75 + rand() * 0.5), radius * 3.4);
      trees.push({regionId: region.id, x, z, radius, height, seed: rand(), heightStatus: 'assumed'});
    };
    const before = trees.length;
    for (let z = minZ + spacing * 0.45; z < maxZ; z += spacing) {
      for (let x = minX + spacing * 0.45; x < maxX; x += spacing) {
        add(x + (rand() - 0.5) * spacing * 0.45, z + (rand() - 0.5) * spacing * 0.45);
      }
    }
    if (before === trees.length) {
      const contour = region.ring.map(p => new THREE.Vector2(...p));
      const holes = region.holes.map(r => r.map(p => new THREE.Vector2(...p)));
      const vertices = [...contour, ...holes.flat()];
      const candidates = THREE.ShapeUtils.triangulateShape(contour, holes).map(face => {
        const points = face.map(i => vertices[i]);
        return [points.reduce((s, p) => s + p.x, 0) / 3, points.reduce((s, p) => s + p.y, 0) / 3];
      });
      candidates.sort((a, b) => crownClearance(b, region) - crownClearance(a, region));
      if (candidates[0]) add(...candidates[0]);
    }
  }
  return trees;
}

function foliageGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const positions = geometry.attributes.position, colors = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const noise = Math.sin(x * 19 + y * 13) * Math.sin(z * 17 - y * 11);
    const radius = 0.86 + 0.12 * noise;
    positions.setXYZ(i, x * radius, y * radius, z * radius);
    const light = 0.74 + 0.2 * (y + 1) / 2 + 0.06 * noise;
    colors.push(light, light, light);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildGrove(regions, options = {}) {
  const trees = sampleGrove(regions, options), group = new THREE.Group();
  group.name = 'vegetation';
  group.userData = {representation: 'procedural-grove', treeCount: trees.length,
    placementStatus: 'inferred-within-mask', heightStatus: 'assumed', ...options};
  if (!trees.length) return group;
  const crowns = new THREE.InstancedMesh(foliageGeometry(), new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, flatShading: true}), trees.length * 13);
  const wood = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 1, 1, 6),
    new THREE.MeshStandardMaterial({color: 0x756853, roughness: 1}), trees.length * 4);
  crowns.name = 'foliage-clusters'; wood.name = 'trunks-and-branches';
  const transform = new THREE.Object3D(), color = new THREE.Color(), axis = new THREE.Vector3(0, 1, 0);
  let leafIndex = 0, woodIndex = 0;
  const branch = (start, end, radius) => {
    transform.position.copy(start).add(end).multiplyScalar(0.5);
    const direction = end.clone().sub(start);
    transform.quaternion.setFromUnitVectors(axis, direction.clone().normalize());
    transform.scale.set(radius, direction.length(), radius); transform.updateMatrix();
    wood.setMatrixAt(woodIndex++, transform.matrix);
  };
  for (const tree of trees) {
    const rand = randomFor(`${tree.regionId}:${tree.seed}`), {x, z, height: h, radius: r} = tree;
    branch(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, h * 0.7, z), Math.min(0.16, r * 0.085));
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3 + rand();
      branch(new THREE.Vector3(x, h * 0.35, z), new THREE.Vector3(x + Math.cos(angle) * r * 0.48, h * 0.73, z + Math.sin(angle) * r * 0.48), Math.min(0.07, r * 0.04));
    }
    for (let i = 0; i < 13; i++) {
      const angle = i * 2.39996 + rand() * 0.35, shell = i === 0 ? 0 : r * (0.35 + rand() * 0.2);
      const radius = i === 0 ? r * 0.77 : r * (0.32 + rand() * 0.12);
      transform.position.set(x + Math.cos(angle) * shell, h * (i === 0 ? 0.65 : 0.55 + rand() * 0.27), z + Math.sin(angle) * shell);
      transform.rotation.set(0, rand() * Math.PI * 2, 0);
      transform.scale.set(radius, h * (i === 0 ? 0.31 : 0.16 + rand() * 0.09), radius);
      transform.updateMatrix(); crowns.setMatrixAt(leafIndex, transform.matrix);
      color.setHSL(0.25 + rand() * 0.08, 0.28 + rand() * 0.18, 0.22 + rand() * 0.09);
      crowns.setColorAt(leafIndex++, color);
    }
  }
  crowns.computeBoundingSphere(); wood.computeBoundingSphere();
  group.add(wood, crowns);
  return group;
}
