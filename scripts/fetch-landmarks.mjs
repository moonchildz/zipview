import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { load } from 'cheerio';

const directory = 'research/sinchon-prugio/outlook/landmarks';
await mkdir(directory, { recursive: true });
const regions = {
  yeouido: '126.919,37.516,126.943,37.531',
  center: '126.967,37.551,126.982,37.570',
  jamsil: '127.100,37.510,127.106,37.515',
};
const features = [];
for (const [name, bbox] of Object.entries(regions)) {
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`;
  const file = `${directory}/${name}.osm`;
  let xml;
  try { xml = await readFile(file, 'utf8'); }
  catch {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    xml = await response.text(); await writeFile(file, xml);
  }
  const $ = load(xml, { xmlMode: true });
  const nodes = new Map($('osm > node').toArray().map(n => [$(n).attr('id'), { lon: Number($(n).attr('lon')), lat: Number($(n).attr('lat')) }]));
  const ways = new Map($('osm > way').toArray().map(w => [$(w).attr('id'), $(w).children('nd').toArray().map(n => nodes.get($(n).attr('ref'))).filter(Boolean)]));
  for (const element of $('osm > way, osm > relation').toArray()) {
    const tags = Object.fromEntries($(element).children('tag').toArray().map(t => [$(t).attr('k'), $(t).attr('v')]));
    if (!tags.name && !tags['name:en']) continue;
    const points = element.name === 'way' ? ways.get($(element).attr('id')) : $(element).children('member[role="outer"]').toArray().flatMap(m => ways.get($(m).attr('ref')) ?? []);
    if (!points?.length) continue;
    const feature = { id: `${element.name}/${$(element).attr('id')}`, tags, points, source: url };
    features.push(feature);
    if (tags.building && /파크원|IFC|63빌딩|서울스퀘어/.test(tags.name ?? '')) console.log(JSON.stringify({ id: feature.id, name: tags.name, height: tags.height }));
  }
}
await writeFile(`${directory}/candidates.json`, JSON.stringify(features));
