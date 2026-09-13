import { geographicPoint } from './outlook-math.js';

export function centerPoint(points) {
  const p = points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1] ? points.slice(0, -1) : points;
  return p.reduce((sum, point) => [sum[0] + point[0] / p.length, sum[1] + point[1] / p.length], [0, 0]);
}

export function mapLinks(lon, lat, bearing = 0) {
  const position = `${lat.toFixed(7)},${lon.toFixed(7)}`;
  const satellite = new URL('https://www.google.com/maps/@');
  satellite.search = new URLSearchParams({api:'1',map_action:'map',center:position,zoom:'19',basemap:'satellite'});
  const street = new URL('https://www.google.com/maps/@');
  street.search = new URLSearchParams({api:'1',map_action:'pano',viewpoint:position,heading:String(bearing),pitch:'0'});
  return {satellite:satellite.href, street:street.href, earth:`https://earth.google.com/web/search/${encodeURIComponent(position)}`};
}

export function nearestOnRoad(points, origin) {
  let best = {distance:Infinity, point:points[0]};
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1], b = points[i], dx = b[0]-a[0], dz = b[1]-a[1];
    const t = Math.max(0, Math.min(1, ((origin[0]-a[0])*dx+(origin[1]-a[1])*dz)/(dx*dx+dz*dz || 1)));
    const point = [a[0]+t*dx, a[1]+t*dz], distance = Math.hypot(point[0]-origin[0],point[1]-origin[1]);
    if (distance < best.distance) best = {point,distance};
  }
  return best;
}

export function reviewKml(data, cameras, state, dom = document) {
  const ns = 'http://www.opengis.net/kml/2.2';
  const xml = dom.implementation.createDocument(ns, 'kml');
  const add = (parent, tag, text) => {
    const node = xml.createElementNS(ns, tag);
    if (text !== undefined) node.textContent = String(text);
    parent.append(node); return node;
  };
  const root = add(xml.documentElement, 'Document');
  const targetLabel = data.targetLabel ?? '206동';
  add(root, 'name', `${targetLabel} 시점과 지리 모델 대조`);
  add(root, 'description', 'OSM contributors / ODbL. 수치지도 보정 모드에서는 국토지리정보원 2025 수치지도 외곽선/층수 및 보간 지형 포함. 형상/높이/시점 미검증. Google 영상 미포함. 지형 기준과 화각은 Earth와 다를 수 있음.');
  for (const [id, color] of [['buildings','ff57a817'],['roads','ff2467ed']]) {
    const style = add(root,'Style'); style.setAttribute('id',id);
    const line = add(style,'LineStyle'); add(line,'color',color); add(line,'width',2);
    if(id === 'buildings') {const poly = add(style,'PolyStyle');add(poly,'fill',0);}
  }
  cameras.forEach((camera, i) => {
    const geo = geographicPoint(camera.position.x, camera.position.z, data.center);
    const p = add(root,'Placemark'); add(p,'name',`${targetLabel} ${state.floors[i]}층 후보 시점`);
    const c = add(p,'Camera');
    for (const [key,value] of Object.entries({longitude:geo.lon,latitude:geo.lat,altitude:camera.position.y,heading:state.bearing,tilt:90+state.pitch,roll:0,altitudeMode:'absolute'})) add(c,key,value);
    const point = add(p,'Point'); add(point,'altitudeMode','absolute'); add(point,'coordinates',`${geo.lon},${geo.lat},${camera.position.y}`);
  });
  const coordinates = points => points.map(p => {const g = geographicPoint(...p,data.center); return `${g.lon},${g.lat},0`;}).join(' ');
  const nearby = points => points.some(p => Math.hypot(...p)<500);
  const buildings = add(root,'Folder'); add(buildings,'name','건물 외곽 · OSM / 적용된 수치지도 보정');
  for (const b of data.buildings.filter(b => nearby(b.points))) {
    const p = add(buildings,'Placemark'); add(p,'name',b.label); add(p,'description',`${b.source}\n높이 ${b.height}m (${b.heightSource})\n${b.siteSource ?? ''}\n수치지도 외곽선 UFID: ${b.geometrySource ?? '미적용'}\n지반: ${b.base}m (${b.baseSource ?? '기존 지형 추정'})`); add(p,'styleUrl','#buildings');
    const volumes=(b.parts??[b]).filter(v=>v.points.length>=3),container=volumes.length>1?add(p,'MultiGeometry'):p;
    for(const volume of volumes){
    const polygon = add(container,'Polygon'); add(polygon,'altitudeMode','clampToGround');
    const ring = add(add(polygon,'outerBoundaryIs'),'LinearRing');
    const points = volume.points[0].every((v,i) => v === volume.points.at(-1)[i]) ? volume.points : [...volume.points,volume.points[0]];
    add(ring,'coordinates',coordinates(points));
    }
  }
  const roads = add(root,'Folder'); add(roads,'name','도로 중심선 · OSM');
  for (const road of data.roads.filter(r => nearby(r.points))) {
    const p = add(roads,'Placemark'); add(p,'name',`${road.name || road.kind} #${road.id}`); add(p,'description',`https://www.openstreetmap.org/way/${road.id}\n폭 ${road.profile?.width ?? '?'}m / 추정치; 실측 도로 경계 아님`);add(p,'styleUrl','#roads');
    const line = add(p,'LineString');add(line,'tessellate',1);add(line,'altitudeMode','clampToGround');add(line,'coordinates',coordinates(road.points));
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(xml);
}
