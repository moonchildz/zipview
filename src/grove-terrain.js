import * as THREE from 'three';
export function terrainHeight(t,x,z){
 const n=t.size,gx=Math.max(0,Math.min(n-1,(x/t.widthMeters+.5)*(n-1))),gz=Math.max(0,Math.min(n-1,(z/t.depthMeters+.5)*(n-1)));
 const c=Math.min(n-2,Math.floor(gx)),r=Math.min(n-2,Math.floor(gz)),u=gx-c,v=gz-r,i=r*n+c,h=t.heights;
 return (u+v<=1?h[i]+(h[i+1]-h[i])*u+(h[i+n]-h[i])*v:h[i+n+1]+(h[i+n]-h[i+n+1])*(1-u)+(h[i+1]-h[i+n+1])*(1-v))-t.referenceElevation;
}
export function terrainGeometry(t,enabled=true){
 const n=t.size,p=[],uv=[],indices=[];
 for(let r=0;r<n;r++)for(let c=0;c<n;c++){p.push((c/(n-1)-.5)*t.widthMeters,enabled?t.heights[r*n+c]-t.referenceElevation:0,(r/(n-1)-.5)*t.depthMeters);uv.push(c/(n-1),1-r/(n-1));if(r<n-1&&c<n-1){const a=r*n+c;indices.push(a,a+n,a+1,a+1,a+n,a+n+1)}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
