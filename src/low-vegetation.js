import * as THREE from 'three';
export function buildLowVegetation(patches,groundAt,{height=.4}={}){
 const geometry=new THREE.SphereGeometry(1,6,4),material=new THREE.MeshStandardMaterial({color:0x80964e,roughness:1,flatShading:true});
 const mesh=new THREE.InstancedMesh(geometry,material,patches.length),o=new THREE.Object3D(),color=new THREE.Color();
 mesh.name='low-vegetation-3d';mesh.userData={heightMeters:height,heightStatus:'assumed',representation:'low vegetation candidate patches, not identified shrubs'};
 patches.forEach(([x,z,r],i)=>{o.position.set(x,groundAt(x,z)+height/2,z);o.scale.set(r,height/2,r);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);color.setHSL(.21+(i%7)*.004,.25+(i%5)*.02,.30+(i%11)*.009);mesh.setColorAt(i,color)});mesh.computeBoundingSphere();return mesh;
}
