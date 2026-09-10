import * as THREE from 'three';

// These repeated details are visual assumptions, not surveyed window locations.
export function buildFacades(building) {
  const group = new THREE.Group();
  const batches = { recess: [], frame: [], glass: [], plinth: [] };
  const points = building.points;
  const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0);
  const floors = Math.max(1, Math.min(45, building.levels ?? Math.round(building.height / 3)));
  const floorHeight = building.height / floors;
  // Explicit openings replace the procedural grid, including an empty list.
  if (building.facadeOpenings) for (const opening of building.facadeOpenings) {
    const [a,b]=opening.endpoints, width=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const yaw=opening.bearing*Math.PI/180, nx=Math.sin(yaw), nz=-Math.cos(yaw);
    const quad=(batch,start,end,bottom,top,offset)=>{
      const vertex=(t,h)=>[a[0]+(b[0]-a[0])*t+nx*offset,building.base+h,a[1]+(b[1]-a[1])*t+nz*offset];
      const p=vertex(start,bottom),q=vertex(end,bottom),r=vertex(start,top),s=vertex(end,top);
      batches[batch].push(...p,...q,...r,...q,...s,...r);
    };
    for(let floor=0;floor<floors;floor++) {
      const bottom=floor*(building.facadeFloorHeight??floorHeight)+opening.sillMeters;
      const top=bottom+opening.heightMeters;
      if(bottom<.07||top+.07>building.height) continue;
      if(opening.recess)quad('recess',-.12/width,1+.12/width,Math.max(0,bottom-opening.sillMeters),Math.min(building.height,bottom-opening.sillMeters+(building.facadeFloorHeight??floorHeight)),.035);
      quad('frame',-.07/width,1+.07/width,bottom-.07,top+.07,.05);
      quad('glass',0,1,bottom,top,.065);
      const mullions=opening.mullions??1;
      for(let i=1;i<=mullions;i++)quad('frame',i/(mullions+1)-.025/width,i/(mullions+1)+.025/width,bottom,top,.08);
    }
  }
  else for (let i = 1; i < points.length; i++) {
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
    group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: building.facadePalette?.[kind]??{ glass: '#557c88', frame: '#d6dad8', plinth: '#74777a',recess:'#6c797c' }[kind], roughness: kind === 'glass' ? .3 : .85, metalness: kind === 'glass' ? .2 : 0, side: THREE.DoubleSide })));
  }
  return group;
}
