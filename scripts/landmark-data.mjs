import { readFile } from 'node:fs/promises';

export async function landmarkData(local, heightAt) {
  const directory = 'research/sinchon-prugio/outlook';
  const candidates = JSON.parse(await readFile(`${directory}/landmarks/candidates.json`, 'utf8'));
  const selected = [
    ['way/64989671', '63빌딩', 250, '#b7a277', 'https://english.seoul.go.kr/seoul-63-square/'],
    ['way/874639189', '파크원 타워1', 322, '#997d80', 'https://www.skyscrapercenter.com/building/parc1-tower-i/366'],
    ['way/874639190', '파크원 타워2', null, '#997d80'],
    ['way/621752526', 'IFC 1', null, '#8ba4b1'],
    ['way/621752527', 'IFC 2', null, '#8ba4b1'],
    ['way/621752528', 'IFC 3', 284, '#8ba4b1', 'https://www.ifcseoul.com/en/NE_02_01.asp?list_num=8&num=130'],
    ['way/500362301', '콘래드 서울', null, '#a29b92'],
    ['way/216477743', '서울스퀘어', null, '#ac8e7c'],
  ];
  const centerOf = points => {
    const unique = [...new Map(points.map(p => [`${p.lon},${p.lat}`, p])).values()];
    return unique.reduce((c, p) => ({ lon: c.lon + p.lon / unique.length, lat: c.lat + p.lat / unique.length }), { lon: 0, lat: 0 });
  };
  const result = selected.map(([id, name, override, color, heightSource]) => {
    const source = candidates.find(c => c.id === id);
    if (!source) throw new Error(`Missing landmark ${id}`);
    const position = centerOf(source.points);
    return { id, name, ...position, point: local(position), points: source.points.map(local), height: override ?? Number(source.tags.height), base: heightAt(position.lon, position.lat), color, kind: 'footprint', source: `https://www.openstreetmap.org/${id}`, heightSource: heightSource ?? `https://www.openstreetmap.org/${id}`, osmHeight: source.tags.height, geometryStatus: 'OSM footprint extrusion; facade simplified' };
  });
  for (const [file, relationId, wayId, name, kind, height, heightSource] of [
    ['n-seoul-tower-osm.json', 16474080, 1214950317, '남산타워', 'observation-tower', 236.7, 'https://www.50plus.or.kr/life/detail.do?id=10453144'],
    ['landmarks/lotte.json', 8824257, 635073462, '롯데월드타워', 'tapered-tower', 555, 'https://www.lottecm.com/en/build/lotte-world-tower.html'],
  ]) {
    const raw = JSON.parse(await readFile(`${directory}/${file}`, 'utf8'));
    const nodes = new Map(raw.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
    const way = raw.elements.find(e => e.type === 'way' && e.id === wayId);
    if (!way) throw new Error(`Missing footprint ${name}`);
    const position = centerOf(way.nodes.map(id => nodes.get(id)));
    result.push({ id: `relation/${relationId}`, name, ...position, point: local(position), height, base: heightAt(position.lon, position.lat), kind, source: `https://www.openstreetmap.org/relation/${relationId}`, heightSource, geometryStatus: 'schematic silhouette; radii and observation deck levels approximate' });
  }
  if (result.some(l => !Number.isFinite(l.height) || l.height <= 0)) throw new Error('Invalid landmark height');
  return result;
}
