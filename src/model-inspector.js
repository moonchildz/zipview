import * as THREE from 'three';
import { geographicPoint } from './outlook-math.js';
import { centerPoint, mapLinks, nearestOnRoad, reviewKml } from './map-review.js';
import { terrainHeight, ribbonVertices } from './road-data.js';

const $ = s => document.querySelector(s);

export class ModelInspector {
  constructor(outlook) {
    this.outlook = outlook;
    this.ray = new THREE.Raycaster();
    this.layers = [0,1].map(() => {
      const layer = document.createElement('div'); layer.className = 'building-labels'; outlook.host.append(layer); return layer;
    });
    this.buttons = this.layers.map(layer => Array.from({length:6}, () => {
      const button = document.createElement('button'); button.className = 'building-label'; button.hidden = true;
      button.addEventListener('click', () => this.selectBuilding(button.building)); layer.append(button); return button;
    }));
    $('#building-labels-visible').addEventListener('change', () => outlook.render());
    $('#review-kml').addEventListener('click', () => {
      const blob = new Blob([reviewKml(outlook.data,outlook.cameras,outlook.state)],{type:'application/vnd.google-earth.kml+xml'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${outlook.target.name}-model-review.kml`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    });
    const origin = [outlook.cameras[0].position.x,outlook.cameras[0].position.z];
    this.roads = outlook.data.roads.filter(r => !r.profile?.walk && r.points.length > 1)
      .map(road => ({...road,...nearestOnRoad(road.points,origin)})).filter(r => r.distance < 450).sort((a,b) => a.distance-b.distance);
    const select = $('#review-road'); select.replaceChildren();
    for (const road of this.roads) select.add(new Option(`${road.name || '이름 없는 도로'} · ${Math.round(road.distance)}m · #${road.id}`,road.id));
    select.addEventListener('change', () => this.selectRoad(Number(select.value)));
    $('#review-road-focus').addEventListener('click', () => this.focusRoad());
    $('#review-building-focus').addEventListener('click', () => {
      if (!this.selected) return;
      const point = centerPoint(this.selected.points);
      this.lookAt(point,this.selected.base+this.selected.height*.6);
    });
    this.buildMap();
    const yaw = outlook.state.bearing * Math.PI / 180;
    const forward = this.roads.find(r => ((r.point[0]-origin[0])*Math.sin(yaw)-(r.point[1]-origin[1])*Math.cos(yaw))/Math.max(1,r.distance)>.8) ?? this.roads[0];
    if (forward) {select.value=forward.id;this.selectRoad(forward.id);}
    this.selectBuilding(outlook.target);
  }

  hit(camera, x, y) {
    this.ray.setFromCamera(new THREE.Vector2(x,y),camera);
    const meshes = this.outlook.pickables.filter(m => m.userData.building.heightSource !== 'assumed' || this.outlook.estimated?.visible !== false);
    return this.ray.intersectObjects(meshes,false)[0];
  }

  render(camera, viewport, index) {
    if (this.road) {
      const destination = new THREE.Vector3(this.road.point[0],terrainHeight(this.outlook.data.terrain,...this.road.point)+.4,this.road.point[1]);
      const direction = destination.clone().sub(camera.position);
      const ray = new THREE.Raycaster(camera.position,direction.clone().normalize(),.15,Math.max(.15,direction.length()-.6));
      const hits = ray.intersectObjects(this.outlook.pickables.filter(m=>m.userData.building.heightSource!=='assumed'||this.outlook.estimated?.visible!==false));
      const block = hits[0]?.object.userData.building;
      const terrain = ray.intersectObjects(this.outlook.terrainMeshes)[0];
      const description = terrain && (!hits[0] || terrain.distance<hits[0].distance) ? '지형에 가림' : block ? `${block.label}에 가림` : '가림 없음';
      this.roadVisibility ??= [];
      this.roadVisibility[index] = `${this.outlook.state.floors[index]}층: ${description}`;
      $('#review-road-visibility').textContent = `${this.roadVisibility.join(' · ')} (최근접 도로점 / 현재 모델)`;
    }
    this.buttons[index].forEach(b => { b.hidden = true; });
    if (!$('#building-labels-visible').checked) { this.outlook.host.dataset.visibleBuildingLabels = '0'; return; }
    const candidates = new Map();
    for (const y of [.24,-.08,-.4,-.68]) for (const x of [-.76,-.44,-.12,.2,.52,.8]) {
      const hit = this.hit(camera,x,y);
      if (!hit || candidates.has(hit.object.userData.building.id)) continue;
      candidates.set(hit.object.userData.building.id, {hit,x,y});
    }
    const occupied = [];
    let indexInPool = 0;
    for (const {hit,x,y} of candidates.values()) {
      if (indexInPool >= 6) break;
      const building = hit.object.userData.building;
      const direction = hit.point.clone().sub(camera.position);
      const terrainRay = new THREE.Raycaster(camera.position,direction.clone().normalize(),.15,Math.max(.15,direction.length()-.5));
      if (terrainRay.intersectObject(this.outlook.terrainMesh).length) continue;
      const labelWidth = Math.min(150,viewport.w-24);
      const left = Math.max(viewport.x+8,Math.min(viewport.x+viewport.w-labelWidth-8,viewport.x+(x+1)/2*viewport.w-labelWidth/2));
      const top = viewport.top+(1-y)/2*viewport.h;
      if (top < viewport.top+88 || top+42 > viewport.top+viewport.h-8) continue;
      if (occupied.some(r => left < r.left+labelWidth+6 && left+labelWidth+6 > r.left && top < r.top+48 && top+48 > r.top)) continue;
      const button = this.buttons[index][indexInPool++]; button.building = building;
      button.dataset.buildingId = building.id;
      button.textContent = building.label;
      button.title = `${building.label} · ${typeof building.id==='number'?'OSM':'수치지도'} #${building.id} · 높이 ${building.height}m (${building.heightSource})`;
      button.style.cssText = `left:${left}px;top:${top}px;width:${labelWidth}px`;
      button.hidden = false; occupied.push({left,top});
    }
    this.outlook.host.dataset.visibleBuildingLabels = this.buttons.flat().filter(b => !b.hidden).length;
  }

  pick(clientX, clientY) {
    const o = this.outlook, rect = o.renderer.domElement.getBoundingClientRect();
    const stacked = rect.width < 650;
    const index = stacked ? Number(clientY-rect.top >= rect.height/2) : Number(clientX-rect.left >= rect.width/2);
    const w = stacked ? rect.width : rect.width/2, h = stacked ? rect.height/2 : rect.height;
    const x = (clientX-rect.left-(stacked ? 0 : index*w))/w*2-1;
    const y = 1-(clientY-rect.top-(stacked ? index*h : 0))/h*2;
    const hit = this.hit(o.cameras[index],x,y);
    if (hit) {
      this.ray.far = hit.distance-.2;
      const blocked = this.ray.intersectObject(o.terrainMesh).length;
      this.ray.far = Infinity;
      if (!blocked) this.selectBuilding(hit.object.userData.building);
    }
  }

  selectBuilding(building) {
    if (!building) return;
    this.selected = building;
    const o = this.outlook;
    $('#review-building-name').textContent = building.label;
    $('#review-building-facts').textContent = `${typeof building.id==='number'?'OSM':'수치지도'} #${building.id} · 높이 ${building.height}m (${building.heightSource === 'official-building-register' ? '건축HUB 건축물대장' : building.heightSource === 'osm-height' ? '지도 높이 태그' : building.heightSource === 'assumed' ? '용도별 가정' : '층수 환산'}) · ${building.nameSource === 'missing' ? '이름 자료 없음' : building.nameSource === 'osm-name-and-site-containment' ? '단지명은 부지 포함으로 추정' : '원자료 동 명칭'}`;
    if (building.baseSource) $('#review-building-facts').textContent += ` · 지반 ${building.base.toFixed(1)}m (수치지도 보간, 1층 표고 미검증)`;
    if (building.geometrySource) $('#review-building-facts').textContent += building.geometryStatus==='source-reviewed-estimate'?' · 배치도 대조 외곽 보정 · 준공 외곽 검증 전':' · 외곽선: 2025 수치지도';
    if (building.facadeEvidence) $('#review-building-facts').textContent += ` · 창 외관: ${building.facadeEvidence.description}`;
    $('#review-building-source').href = building.source;
    const [x,z] = centerPoint(building.points), geo = geographicPoint(x,z,o.data.center), links = mapLinks(geo.lon,geo.lat,o.state.bearing);
    $('#review-building-map').href = links.satellite;
    $('#review-earth').href = links.earth;
    if (this.outline) {
      o.scene.remove(this.outline);
      this.outline.traverse(child=>{child.geometry?.dispose();child.material?.dispose();});
    }
    const sources = o.pickables.filter(m => m.userData.building.id === building.id);
    if (sources.length) {
      this.outline = new THREE.Group();
      for(const source of sources)this.outline.add(new THREE.LineSegments(new THREE.EdgesGeometry(source.geometry),new THREE.LineBasicMaterial({color:'#ed952e'})));
      o.scene.add(this.outline);
    }
    document.querySelectorAll('#review-map [data-building-id]').forEach(el => el.classList.toggle('selected',el.dataset.buildingId===String(building.id)));
    o.render();
  }

  selectRoad(id) {
    const road = this.roads.find(r => r.id === id);
    if (!road) return;
    this.road = road;
    this.roadVisibility = [];
    const o = this.outlook, geo = geographicPoint(...road.point,o.data.center), links = mapLinks(geo.lon,geo.lat,o.state.bearing);
    $('#review-road-source').href = `https://www.openstreetmap.org/way/${road.id}`;
    $('#review-street').href = links.street; $('#review-road-map').href = links.satellite;
    $('#review-road-facts').textContent = road.profile ? `폭 ${road.profile.width}m 추정 · ${road.profile.widthSource === 'lanes-assumption' ? '차로 수 환산' : '도로 종류별 가정'} · 주황 표시` : '교량/터널 등 미구현 구간 · 주황 표시는 지도 경로뿐';
    if (this.roadHighlight) {o.scene.remove(this.roadHighlight);this.roadHighlight.geometry.dispose();this.roadHighlight.material.dispose();}
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(ribbonVertices(road.points,.7,(x,z)=>terrainHeight(o.data.terrain,x,z),.35),3));
    this.roadHighlight = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:'#e59a32',side:THREE.DoubleSide}));
    this.roadHighlight.visible = false;
    o.scene.add(this.roadHighlight);
    document.querySelectorAll('#review-map [data-road-id]').forEach(el=>el.classList.toggle('selected',Number(el.dataset.roadId)===id));
    o.render();
  }

  focusRoad() {
    if (!this.road) return;
    const o = this.outlook;
    this.roadHighlight.visible = true;
    this.lookAt(this.road.point,terrainHeight(o.data.terrain,...this.road.point));
  }

  lookAt(point,height) {
    const o = this.outlook, camera = o.cameras[0];
    const dx = point[0]-camera.position.x,dz=point[1]-camera.position.z;
    o.state.bearing = (Math.atan2(dx,-dz)*180/Math.PI+360)%360;
    o.state.pitch = Math.max(-80,Math.min(65,Math.atan2(height-camera.position.y,Math.hypot(dx,dz))*180/Math.PI));
    o.update();
  }

  buildMap() {
    const svg = $('#review-map'), ns = 'http://www.w3.org/2000/svg';
    svg.replaceChildren();
    const add = (tag,attrs,text) => {const el=document.createElementNS(ns,tag); for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);if(text)el.textContent=text;svg.append(el);return el;};
    for(const r of this.outlook.data.roads.filter(r=>r.points.some(p=>Math.hypot(...p)<350))) {
      const line=add('polyline',{points:r.points.map(p=>p.join(',')).join(' '),fill:'none',stroke:r.profile?.walk?'#c8c0b3':'#778581','stroke-width':r.profile?.width??3,'data-road-id':r.id});
      const title=document.createElementNS(ns,'title');title.textContent=`${r.name||r.kind} #${r.id}`;line.append(title);
      if(this.roads.some(road=>road.id===r.id))line.addEventListener('click',()=>{$('#review-road').value=r.id;this.selectRoad(r.id);});
    }
    for(const b of this.outlook.data.buildings.filter(b=>b.points.some(p=>Math.hypot(...p)<350))) {
      for(const part of b.parts??[b]){
      const polygon=add('polygon',{points:part.points.map(p=>p.join(',')).join(' '),'data-building-id':b.id,fill:'#dce4df',stroke:'#7d9587','stroke-width':.8});
      const title=document.createElementNS(ns,'title');title.textContent=b.label;polygon.append(title);polygon.addEventListener('click',()=>this.selectBuilding(b));
      }
    }
    add('path',{id:'review-camera-arrow',fill:'none',stroke:'#166e60','stroke-width':3});
    add('text',{x:-235,y:-224,'font-size':14,fill:'#176957'},'N ↑');
  }

  updateMap() {
    const o=this.outlook,c=o.cameras[0],yaw=o.state.bearing*Math.PI/180;
    $('#review-camera-arrow').setAttribute('d',`M${c.position.x},${c.position.z} l${Math.sin(yaw)*45},${-Math.cos(yaw)*45}`);
  }
}
