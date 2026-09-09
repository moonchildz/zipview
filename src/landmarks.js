import * as THREE from 'three';

export function buildLandmarks(data, scene) {
  return data.map(item => {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: item.color ?? '#bdc9cc', roughness: .65, metalness: .12 });
    if (item.kind === 'footprint') {
      const shape = new THREE.Shape(item.points.map(([x, z]) => new THREE.Vector2(x - item.point[0], -(z - item.point[1]))));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: item.height, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      group.add(new THREE.Mesh(geometry, material));
    } else {
      // Recognizable silhouettes, not measured facade/BIM reconstructions.
      const profile = item.kind === 'observation-tower'
        ? [[8,0],[6,105],[8,112],[18,117],[18,131],[12,136],[3,145],[2,195],[.5,item.height]]
        : [[34,0],[33,100],[28,250],[21,400],[12,490],[5,535],[.5,item.height]];
      group.add(new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r,h]) => new THREE.Vector2(r,h)), 24), material));
      if (item.kind === 'observation-tower') {
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(18.1,18.1,10,24), new THREE.MeshStandardMaterial({ color:'#506c7b',roughness:.5 }));
        deck.position.y = 124; group.add(deck);
      }
    }
    group.position.set(item.point[0], item.base, item.point[1]);
    scene.add(group);
    return { ...item, group, anchor: new THREE.Vector3(item.point[0], item.base + item.height, item.point[1]) };
  });
}

export function landmarkSight(camera, landmark, blockers) {
  camera.updateMatrixWorld();
  const projected = landmark.anchor.clone().project(camera);
  const inFrame = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < .97 && Math.abs(projected.y) < .94;
  if (!inFrame) return { inFrame, clear: false, projected };
  const direction = landmark.anchor.clone().sub(camera.position);
  const ray = new THREE.Raycaster(camera.position, direction.clone().normalize(), .3, direction.length() - 1);
  // This only tests the loaded geometry to the top point, not real-world visibility.
  const clear = ray.intersectObjects(blockers.filter(o => o.visible), true).length === 0;
  return { inFrame, clear, projected };
}
