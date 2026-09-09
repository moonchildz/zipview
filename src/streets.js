import * as THREE from 'three';
import { ribbonVertices, terrainHeight } from './road-data.js';

export function buildStreets(data) {
  const group = new THREE.Group();
  const batches = { asphalt: [], walk: [], center: [], crossing: [] };
  const sample = (x, z) => terrainHeight(data.terrain, x, z);
  let count = 0;
  for (const road of data.roads) {
    if (!road.profile) continue;
    const p = road.profile;
    count++;
    if (!p.crossing) batches[p.walk ? 'walk' : 'asphalt'].push(...ribbonVertices(road.points, p.width, sample, p.walk ? .22 : .15));
    if (p.centerLine) batches.center.push(...ribbonVertices(road.points, .12, sample, .25));
    if (p.crossing) {
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 0; d + .45 < length; d += .95) {
          const point = t => [a[0] + (b[0] - a[0]) * t / length, a[1] + (b[1] - a[1]) * t / length];
          batches.crossing.push(...ribbonVertices([point(d), point(d + .45)], p.width, sample, .3));
        }
      }
    }
  }
  for (const [kind, vertices] of Object.entries(batches)) {
    if (!vertices.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: { asphalt: '#505759', walk: '#a9a49b', center: '#e2be58', crossing: '#e6e7de' }[kind], side: THREE.DoubleSide, roughness: .95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    group.add(mesh);
  }
  group.userData.roadCount = count;
  return group;
}
