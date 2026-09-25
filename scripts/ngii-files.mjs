import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';
import { load } from 'cheerio';

export function normalizeSheet(item, district, scale=1000) {
  if (Number(scale)!==1000 || String(item.scale) !== '1000' || !/^\d{9}$/.test(item.num) || !/^\d{4}$/.test(item.makeYer)
      || !Number.isInteger(Number(item.objectid)) || item.historyNo == null || !item.name) {
    throw new Error('NGII 도엽 응답 형식이 변경되었습니다.');
  }
  return { key: `${item.num}:${item.makeYer}:${item.gosiYer}:${item.historyNo}`, number: item.num,
    objectId: String(item.objectid), history: String(item.historyNo), name: item.name,
    year: String(item.makeYer), notice: String(item.gosiYer), districts: [district],
    ...(['minx','miny','maxx','maxy'].every(k=>item[k]!=null&&Number.isFinite(Number(item[k])))
      ? {bounds5179:['minx','miny','maxx','maxy'].map(k=>Number(item[k]))} : {}),
    status: 'pending', payload: { orderTp: '3', mapScale: String(scale), mapNo: item.num,
      mapName: item.name, mapHistoryNo: String(item.historyNo), mapKind: '0' } };
}

export function checkInventory(counts, items) {
  const count = counts?.items?.find(x => x.name === '수치지도 V2')?.cnt;
  if (!Number.isInteger(Number(count)) || count == null || !Array.isArray(items)
      || Number(count) !== items.length || items.length >= 500) {
    throw new Error(`도엽 목록 누락 가능성: 서버 집계 ${count}, 응답 ${items?.length}. 완료 처리하지 않습니다.`);
  }
}

export function mergeSheets(groups, previous = []) {
  const byNumber = new Map();
  for (const sheet of groups.flat()) {
    const old = byNumber.get(sheet.number);
    if (old && old.key !== sheet.key) throw new Error(`구 경계의 최신 도엽 버전 불일치: ${sheet.number}`);
    if (old) old.districts = [...new Set([...old.districts, ...sheet.districts])];
    else byNumber.set(sheet.number, structuredClone(sheet));
  }
  const prior = new Map(previous.map(x => [x.key, x]));
  return [...byNumber.values()].sort((a,b)=>a.number.localeCompare(b.number)).map(x=> {
    const p = prior.get(x.key);
    return p ? { ...x, status:p.status, ...(p.file ? {file:p.file} : {}), ...(p.review ? {review:p.review} : {}) } : x;
  });
}

export function nextBatch(sheets, size = 100) {
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('batch-size는 1~100이어야 합니다.');
  return sheets.filter(x=>x.status === 'pending').slice(0,size);
}

export function safeFilename(name,{allowNgi=false}={}) {
  if (!name || name !== path.win32.basename(name) || name !== path.posix.basename(name)
      || /[<>:"|?*\x00-\x1f]/.test(name) || /[ .]$/.test(name)
      || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)
      || !(allowNgi?/\.(zip|xml|ngi|nda)$/i:/\.(zip|xml)$/i).test(name)) throw new Error('예상하지 못한 다운로드 파일명');
  return name;
}

export function metadataMatches(xml, sheet, {ignoreName=false}={}) {
  if(String(sheet.payload?.mapScale??1000)!=='1000')return false;
  const $ = load(xml, {xmlMode:true});
  const value = name => $(name).text().trim();
  const root=$.root().children().first();
  if(root[0]?.name?.split(':').at(-1)==='MD_Metadata') {
    const prefix=root[0].name.split(':')[0];
    if(root.attr(`xmlns:${prefix}`)!=='http://standards.iso.org/iso/19115/-3/mdb/2.0')return false;
    const child=(nodes,name)=>nodes.children().filter((i,n)=>n.name?.split(':').at(-1)===name);
    const at=(nodes,...names)=>names.reduce((current,name)=>child(current,name),nodes);
    const citation=at(root,'identificationInfo','MD_DataIdentification','citation','CI_Citation');
    const titles=at(citation,'title','CharacterString');
    if(citation.length!==1||titles.length!==1)return false;
    const title=titles.text().trim().replaceAll(',','');
    const match=title.match(/^1\/(1000|5000)\s+수치지형도(?:\s+.+?|\s*\([^)]*\))\s*-\s*도엽번호\s*:\s*(\d{8,9})$/);
    const details=at(citation,'otherCitationDetails','CharacterString').toArray().map(n=>$(n).text().trim());
    const detail=label=> {
      const values=details.filter(t=>t.startsWith(label+' :')).map(t=>t.slice(t.indexOf(':')+1).trim());
      return values.length===1?values[0]:null;
    };
    // NGII currently spells featureCatalogureCitation this way in its ISO export.
    const catalogue=at(root,'contentInfo','MD_FeatureCatalogueDescription','featureCatalogureCitation','CI_Citation','title','CharacterString');
    // ISO exports omit the old map name/history fields. Only latest-history (0)
    // catalog requests qualify; identity comes from sheet, scale, edition and V2 catalogue.
    return Boolean(match && match[1]===String(sheet.payload?.mapScale??1000) && match[2]===sheet.number && detail('제작년도')===sheet.year
      && detail('고시번호')===sheet.notice && sheet.history==='0'
      && catalogue.length===1 && catalogue.text().replace(/\s/g,'')==='수치지도2.0지형지물속성목록');
  }
  return value('지도종류코드') === '수치지도2.0' && value('축척코드').replaceAll(',','') === '1:'+String(sheet.payload?.mapScale??1000)
    && value('도엽번호') === sheet.number && value('제작년도') === sheet.year
    // Search-layer OBJECTID is not the metadata table's 지도순번.
    && (ignoreName || value('도엽명') === sheet.name) && value('지도이력번호') === sheet.history
    && value('고시번호') === sheet.notice;
}

// Read every entry, checking decompression, size and CRC. Never extract archive paths.
export async function verifyZip(filename) {
  const zip = await new Promise((resolve,reject)=>yauzl.open(filename,{lazyEntries:true},(e,z)=>e?reject(e):resolve(z)));
  const layers = new Map();
  try {
    await new Promise((resolve,reject)=> {
      zip.on('error',reject); zip.on('end',resolve);
      zip.on('entry',entry=> {
        if (entry.fileName.endsWith('/')) {zip.readEntry(); return;}
        zip.openReadStream(entry,(err,stream)=> {
          if(err) {reject(err);return;}
          let crc=0, size=0;
          stream.on('error',reject);
          stream.on('data',chunk=> {crc=crc32(chunk,crc);size+=chunk.length;});
          stream.on('end',()=> {
            if(crc !== entry.crc32 || size !== entry.uncompressedSize) {reject(new Error('ZIP CRC/크기 불일치'));return;}
            const ext=path.extname(entry.fileName).toLowerCase();
            const stem=entry.fileName.slice(0,-ext.length).toLowerCase();
            if(!layers.has(stem))layers.set(stem,new Set());
            layers.get(stem).add(ext); zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  } finally {zip.close();}
  if (![...layers.values()].some(exts=>['.shp','.shx','.dbf','.prj'].every(ext=>exts.has(ext)))) {
    const error=new Error('SHP/SHX/DBF/PRJ 레이어가 없는 ZIP (NGI 형식이면 별도 변환 필요)');
    error.code='NGII_INCOMPLETE_LAYERS';throw error;
  }
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export async function writeJson(filename, data) {
  await fs.mkdir(path.dirname(filename),{recursive:true});
  await fs.writeFile(`${filename}.tmp`,JSON.stringify(data,null,2)+'\n');
  // Windows readers/antivirus may briefly hold the destination without delete sharing.
  // Keep the complete temporary file and retry; never remove the previous manifest.
  for(let attempt=0;;attempt++) {
    try {await fs.rename(`${filename}.tmp`,filename);return;}
    catch(error) {
      if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=20)throw error;
      await new Promise(resolve=>setTimeout(resolve,100+Math.min(attempt,5)*100));
    }
  }
}

export async function reconcileFiles(sheets, output, cache = new Map()) {
  const names = await fs.readdir(output);
  let changed = false;
  for (const sheet of sheets) {
    let verified = null, review = null;
    const candidates=names.filter(n=>n.includes(`_${sheet.number}_`) && /\.xml$/i.test(n));
    for(const name of candidates) {
      const xmlPath=path.join(output,name), zipPath=xmlPath.replace(/\.xml$/i,'.zip');
      try {
        const [xmlStat,zipStat]=await Promise.all([fs.stat(xmlPath),fs.stat(zipPath)]);
        if(!xmlStat.isFile() || !zipStat.isFile())continue;
        const stamp=`${sheet.key}:${xmlStat.size}:${xmlStat.mtimeMs}:${zipStat.size}:${zipStat.mtimeMs}`;
        const cached=cache.get(zipPath);
        if(cached?.stamp===stamp) {if(cached.file) verified=cached.file;review=cached.review;}
        else {
          const xml=await fs.readFile(xmlPath,'utf8');
          const exact=metadataMatches(xml,sheet);
          if(!exact&&Date.now()-Math.max(xmlStat.mtimeMs,zipStat.mtimeMs)<10000)continue;
          const sha256=await verifyZip(zipPath);
          let coordinates;
          if(!exact) {
            review={reason:'metadata-mismatch',zip:zipPath,xml:xmlPath,sha256,checkedAt:new Date().toISOString()};
            if(metadataMatches(xml,sheet,{ignoreName:true})) {
              review.reason='name-mismatch';
              try {
                coordinates=await (await import('./ngii-coordinate-check.mjs')).checkCoordinates(zipPath,sheet);
                review.coordinates=coordinates;
              } catch(error) {review.coordinateError=error.message;}
            }
          }
          if(exact||coordinates?.matches) {
            verified={zip:path.basename(zipPath),xml:name,sha256,bytes:zipStat.size,
              ...(!exact?{validation:'name-mismatch-coordinates',coordinates}: {})};
            review=null;
          }
          cache.set(zipPath,{stamp,file:verified,review});
        }
        if(verified)break;
      } catch(error) {
        // A fully readable archive with missing sidecars is not an active transfer.
        // Keep it as a gap rather than blocking all later batches indefinitely.
        if(error.code==='NGII_INCOMPLETE_LAYERS') {
          const stats=await Promise.all([fs.stat(xmlPath),fs.stat(zipPath)]).catch(()=>null);
          if(stats&&Date.now()-Math.max(...stats.map(s=>s.mtimeMs))>=10000) {
            review={reason:'incomplete-layers',zip:zipPath,xml:xmlPath,message:error.message,checkedAt:new Date().toISOString()};
          }
        }
        // Native transfers may still be writing the file. Recheck on the next pass.
        if(error.code !== 'ENOENT') cache.delete(zipPath);
      }
    }
    if(verified) {
      if(sheet.status!=='verified' || sheet.file?.sha256!==verified.sha256)changed=true;
      sheet.status='verified';sheet.file=verified;delete sheet.review;
    } else if(review) {
      if(sheet.status!=='review'||sheet.review?.sha256!==review.sha256)changed=true;
      sheet.status='review';sheet.review=review;delete sheet.file;
    } else if(sheet.status==='verified') {
      sheet.status='pending';delete sheet.file;changed=true;
    }
  }
  return changed;
}
