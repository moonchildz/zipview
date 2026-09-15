import * as THREE from 'three';

export function treePlacements(document, {threshold = 0.35, scale = document.scale?.metersPerPixel} = {}) {
  const {width, height} = document.source ?? {};
  if (document.schemaVersion !== 1 || document.coordinateSystem !== 'image-pixels'
      || ![width, height, scale].every(v => Number.isFinite(v) && v > 0)
      || !Number.isFinite(threshold) || threshold < 0 || threshold > 1
      || !Array.isArray(document.objects)) throw new Error('Invalid aerial object document');
  const ids = new Set();
  return document.objects.map(tree => {
    const b = tree.box;
    if (typeof tree.id !== 'string' || ids.has(tree.id) || tree.kind !== 'tree-candidate'
        || !Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)
        || b[0] < 0 || b[1] < 0 || b[2] > width || b[3] > height || b[2] <= b[0] || b[3] <= b[1]
        || !Number.isFinite(tree.score) || tree.score < 0 || tree.score > 1) throw new Error('Invalid tree candidate');
    ids.add(tree.id);
    const crownWidth = (b[2] - b[0]) * scale, crownDepth = (b[3] - b[1]) * scale;
    return {id: tree.id, score: tree.score,
      x: ((b[0] + b[2]) / 2 - width / 2) * scale,
      z: ((b[1] + b[3]) / 2 - height / 2) * scale,
      crownWidth, crownDepth, height: Math.max(2, Math.min(18, Math.sqrt(crownWidth * crownDepth) * 1.5)),
      heightStatus: 'assumed'};
  }).filter(t => t.score >= threshold);
}

export function buildAerialTrees(placements) {
  const group = new THREE.Group();
  group.name = 'aerial-tree-candidates';
  if (!placements.length) return group;
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({color: 0x477650, roughness: 1}), placements.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6),
    new THREE.MeshStandardMaterial({color: 0x756c62, roughness: 1}), placements.length);
  const object = new THREE.Object3D();
  placements.forEach((t, i) => {
    object.position.set(t.x, t.height * 0.64, t.z);
    object.scale.set(t.crownWidth / 2, t.height * 0.36, t.crownDepth / 2);
    object.updateMatrix(); crowns.setMatrixAt(i, object.matrix);
    object.position.y = t.height * 0.25;
    const radius = Math.max(0.08, Math.min(t.crownWidth, t.crownDepth) * 0.035);
    object.scale.set(radius, t.height * 0.5, radius);
    object.updateMatrix(); trunks.setMatrixAt(i, object.matrix);
  });
  crowns.computeBoundingSphere(); trunks.computeBoundingSphere();
  group.add(crowns, trunks);
  return group;
}

export function disposeAerialTrees(group) {
  group.traverse(object => {object.geometry?.dispose(); object.material?.dispose();});
  group.removeFromParent();
}
