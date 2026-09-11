import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import yauzl from 'yauzl';

const dir = 'research/linkage/downloads/housing';
const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8'));
const zip = await new Promise((resolve, reject) => yauzl.open(`${dir}/housing-2025.zip`, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
const targets = [
  { id: 'gyeonghuigung-xi', address: '서울특별시 종로구 송월길 99', legalCode: '1111017900', bun: 199, ji: 0, units: [] },
  { id: 'sinchon-prugio', address: '서울특별시 서대문구 북아현로1길 50', legalCode: '1141011000', bun: 1011, ji: 0, units: [] },
];
const entry = await new Promise((resolve, reject) => {
  zip.on('error', reject);
  zip.on('end', () => reject(new Error('Full CSV entry missing')));
  zip.on('entry', value => {
    if (value.fileName.endsWith('.csv') && value.uncompressedSize > 1000000000) resolve(value);
    else zip.readEntry();
  });
  zip.readEntry();
});
const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, value) => error ? reject(error) : resolve(value)));
const hash = createHash('sha256');
let rows = 0;
const hashStream = new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk); } });
await pipeline(stream, hashStream, parse({ columns: true, bom: true }), async records => {
  for await (const row of records) {
    rows++;
    const target = targets.find(t => row['도로명주소'] === t.address && row['법정동코드'] === t.legalCode && Number(row['본번']) === t.bun && Number(row['부번']) === t.ji);
    if (target) target.units.push({
      building: row['동명'], unit: row['호명'], exclusiveArea: Number(row['전용면적']),
      name: row['단지명'], registryId: row['건축물대장PK'] || null,
      complexCode: row['단지코드'], buildingCode: row['동코드'], unitCode: row['호코드'],
      year: row['기준연도'], month: row['기준월'], sourceRow: rows + 1,
    });
    if (rows % 1000000 === 0) console.log(`${rows} rows; matches ${targets.map(t => `${t.id}=${t.units.length}`).join(', ')}`);
  }
});
zip.close();
const sha256 = hash.digest('hex');
if (rows !== manifest.expectedRows || sha256 !== manifest.expectedCsvSha256) throw new Error(`Source integrity mismatch: ${rows} rows, ${sha256}`);
const output = { source: manifest.source, checkedAt: new Date().toISOString(), sourceFile: entry.fileName, rows, sha256, targets };
await writeFile(`${dir}/target-units.json`, `${JSON.stringify(output, null, 2)}\n`);
console.log(targets.map(t => ({ id: t.id, units: t.units.length, buildings: [...new Set(t.units.map(u => u.building))] })));
