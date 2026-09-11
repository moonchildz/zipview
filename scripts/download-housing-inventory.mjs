import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';

const base = 'https://www.data.go.kr';
const source = `${base}/data/3073746/fileData.do`;
const dir = 'research/linkage/downloads/housing';
await mkdir(dir, { recursive: true });
const destination = `${dir}/housing-2025.zip`;
if (await stat(destination).catch(() => null)) {
  console.log(`Cached: ${destination}`);
  process.exit(0);
}
const cookies = new Map();
async function request(path, params) {
  const response = await fetch(new URL(path, base), {
    method: params ? 'POST' : 'GET',
    headers: {
      Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      Referer: source,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' } : {}),
    },
    body: params ? new URLSearchParams(params) : undefined,
    signal: AbortSignal.timeout(600000),
    redirect: 'error',
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const index = pair.indexOf('=');
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}
const html = await (await request(source)).text();
const $ = load(html);
const onclick = $('[onclick]').toArray().map(e => $(e).attr('onclick')).find(x => x.startsWith('fileDetailObj.fn_fileDataDown('));
const args = [...(onclick ?? '').matchAll(/'([^']*)'/g)].map(x => x[1]);
if (args.length !== 5) throw new Error('Public download button changed');
const [publicDataPk, publicDataDetailPk, atchFileId, fileDetailSn] = args;
const metadata = await (await request('/tcs/dss/selectFileDataDownload.do', {
  publicDataPk, publicDataDetailPk, atchFileId, fileDetailSn, publicDataTyCode: 'PR0051',
  url: '/tcs/dss/selectFileDataDownload.do',
})).json();
if (metadata.status !== true) throw new Error(metadata.error ?? 'Download unavailable');
const file = { atchFileId: metadata.atchFileId, fileDetailSn: metadata.fileDetailSn };
const limit = await (await request('/cmm/cmm/check-limit.json', file)).json();
console.log('Public download limit:', limit);
if (limit.needCaptcha !== false) throw new Error('Download requires a human challenge or has an unknown limit state');
const query = new URLSearchParams({ ...file, dataNm: metadata.dataSetFileDetailInfo.dataNm });
const response = await request(`/cmm/cmm/fileDownload.do?${query}`);
console.log('Download:', response.headers.get('content-type'), response.headers.get('content-length'));
if (/text\/html|application\/json/.test(response.headers.get('content-type') ?? '')) throw new Error('Download did not return a file');
const hash = createHash('sha256');
let bytes = 0;
let lastReport = Date.now();
const meter = new Transform({ transform(chunk, encoding, callback) {
  if (bytes === 0 && chunk.subarray(0, 2).toString() !== 'PK') return callback(new Error('Not a ZIP archive'));
  bytes += chunk.length;
  hash.update(chunk);
  if (Date.now() - lastReport > 10000) { console.log(`${Math.round(bytes / 1048576)} MiB downloaded`); lastReport = Date.now(); }
  callback(null, chunk);
} });
await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(`${destination}.part`));
await rename(`${destination}.part`, destination);
const manifest = { source, checkedAt: new Date().toISOString(), bytes, zipSha256: hash.digest('hex'),
  name: metadata.fileDataRegistVO.orginlFileNm,
  expectedRows: Number(metadata.fileDataRegistVO.atchFileCo),
  expectedCsvSha256: 'bbadcb0e85787f3db157b199a6b9df1601e995228a3976106ec5440c2cd8935c',
};
await writeFile(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(manifest);
