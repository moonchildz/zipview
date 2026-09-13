import * as THREE from 'three';
import { groundUV } from './imagery-coordinates.js';
import { geographicPoint } from './outlook-math.js';

export function imageryMaterial(texture) {
  const material = new THREE.MeshBasicMaterial({map:texture, toneMapped:false});
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      float covered = step(0.0,vMapUv.x)*step(vMapUv.x,1.0)*step(0.0,vMapUv.y)*step(vMapUv.y,1.0);
      vec4 photograph = texture2D(map, vMapUv);
      diffuseColor *= mix(vec4(0.223,0.305,0.205,1.0),photograph,covered);
    `);
  };
  material.customProgramCacheKey = () => 'zipview-ground-imagery-v1';
  return material;
}

export function bindGroundImagery(outlook) {
  const button = document.querySelector('#imagery-load');
  const toggle = document.querySelector('#imagery-visible');
  const status = document.querySelector('#imagery-status');
  const credits = document.querySelector('#imagery-credits');
  const roads = document.querySelector('#roads-visible');
  // Use the selected building, including future complexes, not a pilot-site alias.
  const ring=outlook.target.points;
  const points=ring.length>1&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1]?ring.slice(0,-1):ring;
  const center=geographicPoint(points.reduce((n,p)=>n+p[0],0)/points.length,points.reduce((n,p)=>n+p[1],0)/points.length,outlook.data.center);
  const originals = outlook.terrainMeshes.map(mesh => mesh.material);
  let material, controller, loading = false;
  const zoom = 18;
  const params=new URLSearchParams({lon:center.lon.toFixed(8),lat:center.lat.toFixed(8),zoom:String(zoom)});
  outlook.host.dataset.imagery = 'idle';
  const setVisible = visible => {
    if (!material) return;
    outlook.terrainMeshes.forEach((mesh,i) => {mesh.material = visible ? material : originals[i];});
    outlook.streets.visible = roads.checked;
    credits.hidden = !visible;
    outlook.host.dataset.imagery = visible ? 'visible' : 'hidden';
    outlook.render();
  };
  toggle.addEventListener('change', () => setVisible(toggle.checked));
  const read = async path => {
    const response = await fetch(`/api/imagery/static/${path}?${params}`, {headers:{'X-Zipview-Imagery':'1'}, signal:controller.signal, cache:'no-store'});
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw Object.assign(new Error(data.error || `위성사진 연결 오류 (${response.status})`),{status:response.status});
    }
    return response;
  };
  const load = async () => {
    if (loading || material) return;
    loading = true;
    button.disabled = true;controller = new AbortController();
    status.textContent = '위성사진 출처와 지원 범위 확인 중…';
    outlook.host.dataset.imagery = 'loading';
    try {
      const metadata = await (await read('metadata')).json();
      const {grid,width,height} = metadata;
      if(metadata.provider!=='google-static'||width!==1280||height!==1280||grid?.zoom!==zoom)throw new Error('위성사진 범위 정보가 올바르지 않습니다.');
      const canvas = document.createElement('canvas');
      canvas.width = width;canvas.height = height;
      const context = canvas.getContext('2d');
      status.textContent='고해상도 위성사진 불러오는 중…';
      const blob=await(await read('image')).blob();
      const bitmap=await createImageBitmap(blob);
      if(bitmap.width!==width||bitmap.height!==height){bitmap.close();throw new Error('위성사진 크기가 일치하지 않습니다.');}
      // Preserve the complete image, including Google's embedded attribution.
      context.drawImage(bitmap,0,0);bitmap.close();
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(16,outlook.renderer.capabilities.getMaxAnisotropy());
      material = imageryMaterial(texture);
      for (const mesh of outlook.terrainMeshes) {
        const position = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
        for (let i=0;i<position.count;i++) uv.setXY(i,...groundUV(position.getX(i),position.getZ(i),outlook.data.center,grid));
        uv.needsUpdate = true;
      }
      credits.replaceChildren();
      const name = document.createElement('strong');name.textContent = 'Google Maps';
      const attribution = document.createElement('a');attribution.textContent = '원본 영상·제공자 출처 보기';
      attribution.href=URL.createObjectURL(blob);attribution.target='_blank';attribution.rel='noopener';
      const overlay = document.createElement('span');overlay.textContent = '건물: OSM 기반 추정 · 지형: 별도 표고 모델';
      credits.append(name,attribution,overlay);
      toggle.disabled = false;toggle.checked = true;button.hidden = true;
      status.textContent = '고해상도 위성사진 · 선택 건물 주변 약 300m · 촬영 시점·건물 정합 미검증';
      outlook.host.dataset.imageryProvider='google-static';
      outlook.host.dataset.imageryZoom = String(grid.zoom);
      setVisible(true);
    } catch (error) {
      controller.abort();
      status.textContent = error.message;outlook.host.dataset.imagery = 'error';button.disabled = false;
      button.textContent='위성사진 다시 불러오기';
      status.textContent += ' 기본 지면 유지 · 자동 재시도 없음';
    } finally {
      loading = false;
    }
  };
  button.addEventListener('click', load);
  void load();
}
