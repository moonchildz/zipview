import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const root='research/linkage',out=`${root}/generated/plan-audit`;
await fs.mkdir(out,{recursive:true});
const assets=new Map(),hashes=new Set(),complexes=[],gaps=[];
async function inspect(v){
 if(!v.file)return {status:'no-file'};
 const key=`${v.file}:${v.sha256}`;if(assets.has(key))return assets.get(key);
 let r={file:v.file,expectedSha256:v.sha256};
 try{
  const absolute=path.resolve(v.file),allowed=path.resolve(root)+path.sep;
  if(!absolute.startsWith(allowed))throw Error('outside asset root');
  const bytes=await fs.readFile(absolute),hash=createHash('sha256').update(bytes).digest('hex');
  // Decode pixels, rather than checking only the image header.
  const {info}=await sharp(bytes,{failOn:'error'}).raw().toBuffer({resolveWithObject:true});
  r={...r,sha256:hash,width:info.width,height:info.height,bytes:bytes.length,status:hash===v.sha256?'valid':'hash-mismatch'};
  if(r.status==='valid')hashes.add(hash);
 }catch(e){r={...r,status:e.code==='ENOENT'?'missing-file':'invalid-image',error:e.message};}
 assets.set(key,r);return r;
}
for(const file of (await fs.readdir(`${root}/providers/kb`)).filter(n=>/^\d+\.json$/.test(n))){
 const p=JSON.parse(await fs.readFile(`${root}/providers/kb/${file}`,'utf8')),types=new Map(),units=new Map();
 const base={providerId:p.providerId,name:p.name,address:p.address,source:p.source};
 for(const plan of p.plans??[]){
  const checks=[];for(const v of plan.variants??[])checks.push(await inspect(v));
  const valid=checks.some(c=>c.status==='valid');types.set(String(plan.areaId),{plan,valid});
  if(!valid)gaps.push({...base,reason:'missing-type-image',areaId:plan.areaId,type:plan.displayType,households:plan.households,references:plan.references??[],files:checks});
 }
 for(const u of p.units??[]){const key=`${u.building}:${u.unit}`;if(!units.has(key))units.set(key,[]);units.get(key).push(u);}
 let linked=0,conflicts=0,unmapped=0;
 for(const [key,rows] of units){
  const ids=[...new Set(rows.map(u=>String(u.areaId)))];
  if(ids.length>1){conflicts++;gaps.push({...base,reason:'conflicting-unit-types',unit:key,areaIds:ids});}
  else if(types.get(ids[0])?.valid)linked++;
  else unmapped++;
 }
 const expected=Number(p.households),missing=Number.isInteger(expected)&&expected>0?Math.max(0,expected-units.size):null;
 if(missing)gaps.push({...base,reason:'missing-unit-records',households:expected,knownUnits:units.size,missingUnits:missing});
 if(units.size>expected&&expected>0)gaps.push({...base,reason:'unit-count-excess',households:expected,knownUnits:units.size});
 const c={...base,expectedUnits:expected,knownUnits:units.size,types:types.size,typesWithImages:[...types.values()].filter(t=>t.valid).length,unitsWithValidImages:linked,conflictingUnits:conflicts,unitsWithoutValidImages:unmapped,missingUnitRecords:missing,sourceErrors:p.errors??[]};
 c.completeProviderLookup=expected>0&&units.size===expected&&linked===expected&&c.types===c.typesWithImages&&!c.sourceErrors.length;
 complexes.push(c);
 if(complexes.length%300===0)console.log(JSON.stringify({providersChecked:complexes.length,assetsChecked:assets.size}));
}
const evidence=JSON.parse(await fs.readFile(`${root}/downloads/evidence/sh/manifest.json`,'utf8'));
const supplements=[];
for(const c of evidence.complexes)for(const v of c.assets)supplements.push({name:c.name,type:v.type,source:v.url,...await inspect(v)});
const summary={checkedAt:new Date().toISOString(),providers:complexes.length,providersWithImages:complexes.filter(c=>c.typesWithImages>0).length,completeProviderLookups:complexes.filter(c=>c.completeProviderLookup).length,providerUnitsWithValidImages:complexes.reduce((n,c)=>n+c.unitsWithValidImages,0),gapCounts:gaps.reduce((a,g)=>(a[g.reason]=(a[g.reason]||0)+1,a),{}),assetChecks:[...assets.values()].reduce((a,v)=>(a[v.status]=(a[v.status]||0)+1,a),{}),uniqueValidImageHashes:hashes.size,shAssets:supplements.length,notes:['Provider-level unit counts are not nationwide independently verified households.','SH assets are not automatically matched by area alone.','No new remote collection or permissions inferred.']};
for(const [name,data] of Object.entries({summary,complexes,gaps,assets:[...assets.values()],shEvidence:supplements}))await fs.writeFile(`${out}/${name}.json`,JSON.stringify(data,null,2)+'\n');
const csv=rows=>'\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
const queue=gaps.filter(g=>g.reason==='missing-type-image').sort((a,b)=>(Number(b.households)||0)-(Number(a.households)||0));
await fs.writeFile(`${out}/missing-types.csv`,csv([['providerId','complex','address','type','areaId','households','source','references'],...queue.map(g=>[g.providerId,g.name,g.address,g.type,g.areaId,g.households,g.source,g.references.map(r=>r.url).join(' | ')])]));
await fs.writeFile(`${out}/complexes.csv`,csv([['providerId','complex','address','knownUnits','expectedUnits','types','typesWithImages','unitsWithValidImages','conflictingUnits','missingUnitRecords'],...complexes.map(c=>[c.providerId,c.name,c.address,c.knownUnits,c.expectedUnits,c.types,c.typesWithImages,c.unitsWithValidImages,c.conflictingUnits,c.missingUnitRecords])]));
console.log(JSON.stringify(summary,null,2));
const payload=JSON.stringify({summary,complexes}).replaceAll('<','\\u003c');
await fs.writeFile(`${out}/review.html`,`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>서울 평면도 보완 현황</title><style>body{font:15px system-ui;margin:32px;color:#203047;background:#f4f6fa}input,select{padding:10px;margin:8px}table{border-collapse:collapse;background:white;width:100%}th,td{padding:10px;text-align:left;border-bottom:1px solid #ddd}th{position:sticky;top:0;background:#e4eaf2}small{color:#52637a}a{color:#1264b3}</style><h1>서울 평면도 보완 현황</h1><p id="summary"></p><p>공급자 자료 기준입니다. 실제 창 위치·방향과 공개 서비스 이용권한은 별도 확인이 필요합니다.</p><p><a href="missing-types.csv">누락 타입 CSV</a> · <a href="complexes.csv">단지별 CSV</a></p><input id="q" placeholder="단지명 또는 주소 검색"><select id="filter"><option value="all">전체</option><option value="images">평면도 보유</option><option value="missing">타입 이미지 누락</option><option value="conflict">호수 연결 충돌</option></select><p id="count"></p><table><thead><tr><th>단지</th><th>타입 확보</th><th>등록 호수 / 공급자 세대수</th><th>평면도 연결</th><th>충돌</th></tr></thead><tbody id="rows"></tbody></table><script>const data=${payload};const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));document.querySelector('#summary').textContent='검사 '+data.summary.providers+'개 공급자 단지 · 평면도 보유 '+data.summary.providersWithImages+'개 · 충돌 제외 연결 '+data.summary.providerUnitsWithValidImages.toLocaleString()+'세대';function render(){const q=document.querySelector('#q').value.trim(),f=document.querySelector('#filter').value;const rows=data.complexes.filter(c=>(c.name+' '+c.address).includes(q)&&(f==='all'||f==='images'&&c.typesWithImages>0||f==='missing'&&c.typesWithImages<c.types||f==='conflict'&&c.conflictingUnits>0));document.querySelector('#count').textContent=rows.length+'개';document.querySelector('#rows').innerHTML=rows.map(c=>'<tr><td>'+e(c.name)+'<br><small>'+e(c.address)+'</small></td><td>'+c.typesWithImages+' / '+c.types+'</td><td>'+c.knownUnits+' / '+c.expectedUnits+'</td><td>'+c.unitsWithValidImages+'</td><td>'+c.conflictingUnits+'</td></tr>').join('');}document.querySelector('#q').oninput=render;document.querySelector('#filter').onchange=render;render();</script></html>`);
