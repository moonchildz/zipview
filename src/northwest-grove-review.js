import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildGrove} from './aerial-grove.js';
import {terrainHeight,terrainGeometry} from './grove-terrain.js';
import {buildLowVegetation} from './low-vegetation.js';
const requestedSite=new URLSearchParams(location.search).get('site');
const site=['xi','yangjae','han'].includes(requestedSite)?requestedSite:'northwest';
const $=id=>document.getElementById(id),base=`/verification/${site}-grove/`;
async function main(){
 const response=await fetch(base+'scene.json');if(!response.ok)throw new Error('구역 데이터 없음');const data=await response.json();
 const filtered=await (await fetch(base+'road-filtered-vegetation.json')).json();data.regions=filtered.regions;
 if(filtered.osm){const p=document.createElement('p');p.textContent='OSM 내부 길도 식생에서 제외했습니다. 길 폭은 기존 추정값이며 실제 폭과 다를 수 있습니다. ';const a=document.createElement('a');a.href=base+'osm-path-comparison.jpg';a.target='_blank';a.textContent='내부 길 비교(분홍색)';p.append(a);document.querySelector('header').append(p);}
 if(site==='xi'){document.querySelector('h1').textContent='경희궁자이 · 지형과 나무·숲';document.querySelector('header p').textContent='2025-04-06 촬영 · 경희궁자이 주변 약 1 km · 드래그로 회전, 휠로 확대';for(const a of document.querySelectorAll('header a'))a.href=a.href.replace('/verification/northwest-grove/',base)}
 if(['yangjae','han'].includes(site)){document.querySelector('h1').textContent=(site==='han'?'한강 · 반포 일대':'양재천 · 도곡 일대')+' · 지형·식생·물';document.querySelector('header p').textContent='2024-06-11 촬영 · 약 1 km 시험 구역 · 물은 검출 후보이며 수심·수위는 미측정';for(const a of document.querySelectorAll('header a'))a.href=a.href.replace('/verification/northwest-grove/',base);}
 const groundAt=(x,z)=>$('terrain').checked?terrainHeight(data.terrain,x,z):0;
 const scene=new THREE.Scene();scene.background=new THREE.Color('#b9cad6');
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));$('view').append(renderer.domElement);
 const camera=new THREE.PerspectiveCamera(45,1,1,6000),controls=new OrbitControls(camera,renderer.domElement);controls.maxPolarAngle=Math.PI*.49;controls.target.set(0,0,0);
 scene.add(new THREE.HemisphereLight(0xffffff,0x77756b,2));const sun=new THREE.DirectionalLight(0xffffff,2.4);sun.position.set(-400,900,300);scene.add(sun);
 const texture=await new THREE.TextureLoader().loadAsync(base+'source.jpg');texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
 const material=new THREE.MeshStandardMaterial({map:texture,roughness:1});const plane=new THREE.Mesh(terrainGeometry(data.terrain),material);scene.add(plane);
 let waterMesh;
 if(['yangjae','han'].includes(site)){const waterTexture=await new THREE.TextureLoader().loadAsync(base+'water-layer.png');waterTexture.colorSpace=THREE.SRGBColorSpace;waterTexture.magFilter=THREE.NearestFilter;
 waterMesh=new THREE.Mesh(terrainGeometry(data.terrain),new THREE.MeshBasicMaterial({map:waterTexture,transparent:true,alphaTest:.01,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));waterMesh.name='water-candidates';waterMesh.position.y=.1;scene.add(waterMesh);$('water').onchange=()=>waterMesh.visible=$('water').checked;
 const info=await(await fetch(base+'water.json')).json();$('waterInfo').textContent=`물 후보 ${info.coveragePercent}% · 확률 0.5 이상 · 지형 위 표시, 수심·수위 미복원`;const link=document.createElement('a');link.href=base+'water-review.jpg';link.textContent='물 검출 원본 비교';link.target='_blank';document.querySelector('header').append(link);
 }else{$('waterControl').hidden=true;}
 const lowTextures=await Promise.all(['035','050'].map(k=>new THREE.TextureLoader().loadAsync(base+`low-vegetation-road-${k}.png`)));
 for(const t of lowTextures){t.colorSpace=THREE.SRGBColorSpace;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.NearestFilter;}
 const low=new THREE.Mesh(terrainGeometry(data.terrain),new THREE.MeshBasicMaterial({map:lowTextures[0],transparent:true,depthWrite:false,alphaTest:.01,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
 low.name='low-vegetation-candidates';low.position.y=.15;scene.add(low);
 let lowModel;
 function updateLow(){const key=$('lowThreshold').value;low.visible=$('low').checked&&$('lowMode').value==='mask';low.material.map=lowTextures[key==='035'?0:1];low.material.needsUpdate=true;
 if(lowModel){scene.remove(lowModel);lowModel.geometry.dispose();lowModel.material.dispose()}lowModel=buildLowVegetation(filtered.low[key].patches,groundAt);lowModel.visible=$('low').checked&&$('lowMode').value==='3d';scene.add(lowModel);
 $('lowStatus').textContent=`도로 제외 후 낮은 식생 ${(filtered.low[key].retainedPixels/data.sizePixels**2*100).toFixed(2)}% · 높이 0.4m는 표현용 가정입니다. 잔디·관목·꽃은 구분하지 않습니다. 도로와 겹친 수관 ${filtered.canopyRemovedPixels.toLocaleString()}픽셀, 낮은 식생 ${filtered.low[key].removedPixels.toLocaleString()}픽셀 제외.`}
 $('low').onchange=updateLow;$('lowThreshold').onchange=updateLow;$('lowMode').onchange=updateLow;updateLow();
 const lines=new THREE.Group();scene.add(lines);
 function rebuildLines(){for(const o of [...lines.children]){o.geometry.dispose();o.material.dispose();lines.remove(o)}const positions=[];for(const b of data.buildings)for(const ring of b.rings)for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/3));for(let j=0;j<steps;j++){const x=a[0]+(b[0]-a[0])*j/steps,z=a[1]+(b[1]-a[1])*j/steps,xx=a[0]+(b[0]-a[0])*(j+1)/steps,zz=a[1]+(b[1]-a[1])*(j+1)/steps;if(Math.abs(x)>data.widthMeters/2||Math.abs(z)>data.depthMeters/2||Math.abs(xx)>data.widthMeters/2||Math.abs(zz)>data.depthMeters/2)continue;positions.push(x,groundAt(x,z)+.4,z,xx,groundAt(xx,zz)+.4,zz)}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));lines.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xff5577})));}rebuildLines();
 let grove;function rebuild(){if(grove){scene.remove(grove);grove.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose()})}grove=buildGrove(data.regions,{heightScale:Number($('height').value),groundAt});grove.visible=$('trees').checked;scene.add(grove);$('status').textContent=`표고 ${data.terrain.min.toFixed(1)}–${data.terrain.max.toFixed(1)}m · 수관 ${data.regions.length}영역 · 건물 외곽 ${data.buildings.length}개 · 수목 배치 ${grove.userData.treeCount}개(실측 수량 아님)`;}
 $('terrain').onchange=()=>{plane.geometry.dispose();plane.geometry=terrainGeometry(data.terrain,$('terrain').checked);low.geometry.dispose();low.geometry=terrainGeometry(data.terrain,$('terrain').checked);if(waterMesh){waterMesh.geometry.dispose();waterMesh.geometry=terrainGeometry(data.terrain,$('terrain').checked)}updateLow();rebuildLines();rebuild()};
 rebuild();$('height').onchange=rebuild;$('trees').onchange=()=>grove.visible=$('trees').checked;$('maps').onchange=()=>lines.visible=$('maps').checked;$('photo').onchange=()=>{material.map=$('photo').checked?texture:null;material.color.set($('photo').checked?0xffffff:0x9da98f);material.needsUpdate=true};
 $('top').onclick=()=>{camera.position.set(0,1350,.01);controls.target.set(0,0,0);controls.update()};$('oblique').onclick=()=>{camera.position.set(420,360,500);controls.target.set(0,0,0);controls.update()};$('oblique').click();
 function resize(){const r=$('view').getBoundingClientRect();renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix()}new ResizeObserver(resize).observe($('view'));resize();
 renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)});window.northwestReview={data,scene,renderer,camera,controls};
}main().catch(e=>{$('status').textContent=e.message;console.error(e)});
