import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createIcons, Download, RotateCcw, Scan, Trees} from 'lucide';
import {treePlacements, buildAerialTrees, disposeAerialTrees} from './aerial-objects.js';
import {regionPlacements, buildAerialRegions} from './aerial-regions.js';
import './aerial-review.css';

document.querySelector('#aerial-app').innerHTML = `
  <header><a href="/">Zipview</a><h1>항공사진 객체 실험</h1><span id="status">데이터 로딩 중</span></header>
  <div class="controls">
    <label>차량 모델 <select id="detector"><option value="aerial-yolo">YOLO-OBB</option><option value="aerial-regions">Grounding DINO</option></select></label>
    <label>객체 점수 <input id="threshold" type="range" min="0.22" max="0.95" step="0.01" value="0.35"><output id="score">0.35</output></label>
    <label>가정 축척 <input id="scale" type="number" min="0.01" max="10" step="0.01" value="0.3">m/px</label>
    <label>수목 표현 <select id="canopy-mode"><option value="grove">나무 군락</option><option value="volume">영역 덩어리</option></select></label>
    <label>밀도 <input id="density" type="range" min="0.6" max="1.6" step="0.2" value="1"></label>
    <label>높이 배율 <input id="height-scale" type="range" min="0.5" max="2" step="0.1" value="1"></label>
    <label><input id="trees" type="checkbox" checked>수목 영역</label>
    <label><input id="facilities" type="checkbox" checked>차량·시설 후보</label>
    <label><input id="photo" type="checkbox" checked>원본 사진</label>
    <button id="reset" title="시점 초기화" aria-label="시점 초기화"><i data-lucide="rotate-ccw"></i></button>
    <button id="top" title="수직 시점" aria-label="수직 시점"><i data-lucide="scan"></i></button>
    <button id="grove-focus" title="수목 군락 가까이 보기" aria-label="수목 군락 가까이 보기"><i data-lucide="trees"></i></button>
    <button id="export" title="영역 모델 GLB 다운로드" aria-label="영역 모델 GLB 다운로드"><i data-lucide="download"></i></button>
  </div>
  <main class="views"><section class="view"><h2>원본 / 자동 검출 후보</h2><div class="surface"><canvas id="source"></canvas></div></section>
  <section class="view"><h2>3D 군락 / 추정 배치</h2><div class="surface" id="scene"></div></section></main>
  <footer>수목 영역 내부의 나무 위치·수형·높이는 추정 표현입니다. 노랑: 차량 후보 · 분홍: 놀이시설 후보. 축척은 가정값이며 지형·건물은 복원되지 않았습니다.</footer>
  <p id="error" role="alert"></p>`;
createIcons({icons: {Download, RotateCcw, Scan, Trees}});
const $ = id => document.getElementById(id);

async function start() {
  const base = new URLSearchParams(location.search).get('data') || '/verification/aerial-yolo/detections.json';
  const url = new URL(base, location.href);
  if (url.origin !== location.origin) throw new Error('Local data only');
  const response = await fetch(url);
  if (!response.ok) throw new Error('검출 결과가 없습니다. 먼저 detect-aerial-trees.py를 실행해야 합니다.');
  const data = await response.json();
  const regionMode = data.schemaVersion === 2;
  $('detector').value = url.pathname.includes('/aerial-yolo/') ? 'aerial-yolo' : 'aerial-regions';
  $('detector').disabled = !regionMode;
  $('detector').addEventListener('change', () => {
    const next = new URL(location.href); next.searchParams.set('data', `/verification/${$('detector').value}/detections.json`); location.href = next.href;
  });
  const place = regionMode ? regionPlacements : treePlacements;
  const build = regionMode ? p => buildAerialRegions(p, {vegetationMode: $('canopy-mode').value,
    density: Number($('density').value), heightScale: Number($('height-scale').value)}) : buildAerialTrees;
  for (const id of ['canopy-mode', 'density', 'height-scale', 'grove-focus']) $(id).disabled = !regionMode;
  place(data);
  const image = new Image();
  image.src = new URL('source.png', url).href;
  await image.decode();
  if (image.naturalWidth !== data.source.width || image.naturalHeight !== data.source.height) throw new Error('Source image dimensions do not match');
  $('scale').value = data.scale.metersPerPixel;
  $('threshold').min = data.model.scoreThreshold;
  $('threshold').value = data.model.scoreThreshold;

  const host = $('scene'), scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd9e0e2);
  const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x727c72, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(-100, 200, 80); scene.add(sun);
  const texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({map: texture}));
  ground.position.y = -0.02; scene.add(ground);
  let treeGroup, placements;
  const reset = (top = false) => {
    controls.target.set(0, 0, 0);
    const v = THREE.MathUtils.degToRad(camera.fov), h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    const radius = Math.hypot(data.source.width, data.source.height) * Number($('scale').value) / 2;
    const distance = radius / Math.sin(Math.min(v, h) / 2) * 1.08;
    camera.position.set(0, top ? 1 : 0.8, top ? 0.0001 : 1).normalize().multiplyScalar(distance);
    controls.update();
  };
  function update() {
    const scale = Number($('scale').value), threshold = Number($('threshold').value);
    if (!Number.isFinite(scale) || scale < 0.01 || scale > 10) return;
    placements = place(data, {scale, threshold});
    if (treeGroup) disposeAerialTrees(treeGroup);
    treeGroup = build(placements); scene.add(treeGroup);
    if (regionMode) {
      treeGroup.getObjectByName('vegetation').visible = $('trees').checked;
      treeGroup.getObjectByName('facilities').visible = $('facilities').checked;
    } else treeGroup.visible = $('trees').checked;
    ground.scale.set(data.source.width * scale, 1, data.source.height * scale);
    $('score').value = threshold.toFixed(2);
    $('status').textContent = regionMode
      ? `수목 ${placements.regions.length}영역 · 차량 ${placements.objects.filter(o => o.kind === 'vehicle').length}후보 · 놀이시설 ${data.facilityCoverage?.playground === 'unsupported-class' ? '미지원' : placements.objects.filter(o => o.kind === 'playground').length + '후보'}`
      : `${data.source.fileName} · 나무 후보 ${placements.length}개 · 높이 미검증`;
    const canvas = $('source'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    ctx.lineWidth = 2;
    if (regionMode) {
      ctx.fillStyle = '#55ed6b66'; ctx.strokeStyle = '#77ff77';
      for (const region of data.regions) {
        ctx.beginPath();
        for (const ring of [region.ring, ...region.holes]) {
          ring.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
        }
        ctx.fill('evenodd'); ctx.stroke();
      }
    }
    for (const tree of data.objects.filter(t => t.score >= threshold)) {
      ctx.strokeStyle = tree.quad ? '#19ddff' : tree.kind === 'playground' ? '#fc79ed' : '#ffdd36';
      if (tree.quad) {
        ctx.beginPath(); tree.quad.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y)); ctx.closePath(); ctx.stroke();
      } else {
        const [x1, y1, x2, y2] = tree.box; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      }
    }
    ctx.strokeStyle = '#ff4060';
    for (const [x1, y1, x2, y2] of data.excludedBoxes) ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    renderer.domElement.dataset.treeCount = regionMode ? placements.regions.length : placements.length;
    renderer.domElement.dataset.facilityCount = regionMode ? placements.objects.length : 0;
    renderer.domElement.dataset.groveTreeCount = treeGroup.getObjectByName('vegetation')?.userData.treeCount ?? 0;
    renderer.domElement.dataset.canopyMode = regionMode ? $('canopy-mode').value : 'individual';
  }
  update(); reset();
  $('threshold').addEventListener('input', update);
  $('scale').addEventListener('change', () => {update(); reset();});
  for (const id of ['canopy-mode', 'density', 'height-scale']) $(id).addEventListener('change', update);
  $('trees').addEventListener('change', () => {(regionMode ? treeGroup.getObjectByName('vegetation') : treeGroup).visible = $('trees').checked;});
  $('facilities').addEventListener('change', () => {if (regionMode) treeGroup.getObjectByName('facilities').visible = $('facilities').checked;});
  $('photo').addEventListener('change', () => {ground.visible = $('photo').checked;});
  $('reset').addEventListener('click', () => reset());
  $('top').addEventListener('click', () => reset(true));
  $('grove-focus').addEventListener('click', () => {
    const region = [...placements.regions].sort((a, b) => b.areaPixels - a.areaPixels)[0];
    if (!region) return;
    const box = new THREE.Box3().setFromPoints(region.ring.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const target = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const span = Math.max(18, Math.min(45, Math.max(size.x, size.z) * 0.6));
    target.y = region.heightMeters * Number($('height-scale').value) * 0.55;
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3(span * 0.2, span * 0.42, span * 0.85));
    controls.update();
  });
  $('export').addEventListener('click', async () => {
    $('export').disabled = true;
    try {
      // Independent export keeps the shared viewing scene and visibility untouched.
      const exportGroup = build(placements);
      exportGroup.userData = {sourceSha256: data.source.sha256, scaleStatus: 'assumed', heightStatus: 'assumed'};
      try {
        const glb = await new GLTFExporter().parseAsync(exportGroup, {binary: true});
        const link = document.createElement('a'), blobUrl = URL.createObjectURL(new Blob([glb], {type: 'model/gltf-binary'}));
        link.href = blobUrl; link.download = 'aerial-regions-assumed-scale.glb'; link.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } finally {disposeAerialTrees(exportGroup);}
    } catch (error) {$('error').textContent = error.message;}
    finally {$('export').disabled = false;}
  });
  const observer = new ResizeObserver(() => {
    const {width, height} = host.getBoundingClientRect();
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); reset();
  });
  observer.observe(host);
  renderer.setAnimationLoop(() => {controls.update(); renderer.render(scene, camera);});
  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null); observer.disconnect(); controls.dispose();
    disposeAerialTrees(treeGroup); texture.dispose(); ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
  }, {once: true});
}
start().catch(error => {$('status').textContent = '실험 데이터 없음'; $('error').textContent = error.message;});
