import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { insideFootprint } from '../src/outlook-math.js';

export async function attachBuildingNames(buildings, local) {
  const doc = load(await readFile('research/sinchon-prugio/outlook/osm.xml', 'utf8'), { xmlMode: true });
  const tags = el => Object.fromEntries(doc(el).children('tag').toArray().map(t => [doc(t).attr('k'), doc(t).attr('v')]));
  const nodes = new Map(doc('node').toArray().map(n => [doc(n).attr('id'), local({lon:Number(doc(n).attr('lon')),lat:Number(doc(n).attr('lat'))})]));
  const ways = new Map(doc('way').toArray().map(w => [doc(w).attr('id'), { id:doc(w).attr('id'), refs:doc(w).children('nd').toArray().map(n => doc(n).attr('ref')), tags:tags(w) }]));
  const sites = [];
  const add = (id, t, refs) => {
    if (!t.name || t.landuse !== 'residential' || refs.length < 4 || refs[0] !== refs.at(-1) || refs.some(r => !nodes.has(r))) return;
    sites.push({ id, name:t.name, points:refs.map(r => nodes.get(r)) });
  };
  for (const w of ways.values()) add(`way/${w.id}`, w.tags, w.refs);
  for (const r of doc('relation').toArray()) {
    const t = tags(r);
    if (!t.name || t.landuse !== 'residential' || t.type !== 'multipolygon') continue;
    // Only closed outer ways with no inner rings are used for site-name inference.
    if (doc(r).children('member[role="inner"]').length) continue;
    for (const m of doc(r).children('member[type="way"][role="outer"]').toArray()) {
      const w = ways.get(doc(m).attr('ref'));
      if (w) add(`relation/${doc(r).attr('id')}`, t, w.refs);
    }
  }
  for (const b of buildings) {
    const numeric = /^\d+동?$/.test(b.name);
    const matches = numeric ? sites.filter(s => b.points.filter(p => insideFootprint(p, s.points)).length / b.points.length >= .8) : [];
    const unique = [...new Map(matches.map(s => [s.id, s])).values()];
    const site = unique.length === 1 ? unique[0] : null;
    b.label = b.name ? numeric ? `${site?.name ?? '단지 미확인'} ${b.name.replace(/동$/, '')}동` : b.name : `이름 미확인 #${b.id}`;
    b.nameSource = site ? 'osm-name-and-site-containment' : b.name ? 'osm-name' : 'missing';
    b.siteSource = site ? `https://www.openstreetmap.org/${site.id}` : null;
    b.source = `https://www.openstreetmap.org/way/${b.id}`;
  }
}
