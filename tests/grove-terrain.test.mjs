import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {terrainHeight,terrainGeometry} from '../src/grove-terrain.js';
import {buildGrove} from '../src/aerial-grove.js';
test('terrain sampling follows mesh triangles, north direction and reference height',()=>{
 const t={size:2,widthMeters:2,depthMeters:2,heights:[10,12,14,20],referenceElevation:10};
 assert.equal(terrainHeight(t,-1,-1),0);assert.equal(terrainHeight(t,1,1),10);
 assert.equal(terrainHeight(t,0,0),3);assert.equal(terrainHeight(t,.5,.5),6.5);
 const g=terrainGeometry(t);assert.equal(g.attributes.position.getY(3),10);assert.equal(g.attributes.uv.getY(0),1);assert.ok(g.attributes.normal.getY(0)>0);
 const flat=terrainGeometry(t,false);for(let i=0;i<4;i++)assert.equal(flat.attributes.position.getY(i),0);
});
test('ground elevation translates tree instances without changing their shape or horizontal location',()=>{
 const regions=[{id:'a',ring:[[0,0],[12,0],[12,12],[0,12]],holes:[],heightMeters:8}];
 const a=buildGrove(regions),b=buildGrove(regions,{groundAt:()=>37});
 for(let j=0;j<a.children.length;j++){const x=a.children[j],y=b.children[j];assert.equal(x.count,y.count);for(let i=0;i<x.count;i++){const m=new THREE.Matrix4(),n=new THREE.Matrix4();x.getMatrixAt(i,m);y.getMatrixAt(i,n);for(let k=0;k<16;k++)assert.ok(Math.abs(n.elements[k]-m.elements[k]-(k===13?37:0))<1e-5)}}
});
