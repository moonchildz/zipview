import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const out='research/linkage/generated/usable-plan-candidates';
await fs.mkdir(out,{recursive:true});
const candidates=JSON.parse(await fs.readFile('research/linkage/generated/plan-audit/complexes.json','utf8')).filter(c=>c.completeProviderLookup).sort((a,b)=>b.unitsWithValidImages-a.unitsWithValidImages);
// Recorded visual review of the 40 contact-sheet specimens on 2026-09-20.
// This is evidence for one named image per complex, not all of its plan types.
const reviewed=JSON.parse(await fs.readFile('verification/usable-plan-audit/sample.json','utf8'));
const noVisibleDimensions=new Set(['32148','39634','1182','15219','991','1025','2128','1218']);
const evidence=[];
for(const c of reviewed){
 const bytes=await fs.readFile(c.file);
 evidence.push({providerId:c.providerId,name:c.name,type:c.representativeType,file:c.file,sha256:createHash('sha256').update(bytes).digest('hex'),reviewedAt:'2026-09-20',method:'manual-visual-contact-sheet',layout:'clean-color-floorplan',visibleDimensionLines:!noVisibleDimensions.has(c.providerId),scope:'representative-image-only',allTypesVisuallyReviewed:false,modelReady:false});
}
const summary={generatedAt:new Date().toISOString(),candidateComplexes:candidates.length,candidateTypes:candidates.reduce((n,c)=>n+c.types,0),candidateUnits:candidates.reduce((n,c)=>n+c.unitsWithValidImages,0),visuallySampledComplexes:evidence.length,cleanRepresentativeImages:evidence.length,representativesWithDimensionLines:evidence.filter(e=>e.visibleDimensionLines).length,notes:['Provider-image coverage and unit counts, not independently verified actual households.','Top 40 complexes by linked household count; not a random or exhaustive quality sample.','Dimension lines may be partial; numerical accuracy and scaling remain unverified.','No scan restoration, tracing, conversion or new models performed.','New SH/LH library is not counted without content review and identity crosswalk.']};
await fs.writeFile(`${out}/summary.json`,JSON.stringify(summary,null,2));
await fs.writeFile(`${out}/visual-evidence.json`,JSON.stringify(evidence,null,2));
const csv=rows=>'\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
await fs.writeFile(`${out}/candidates.csv`,csv([['providerId','name','address','typesWithImages','providerUnits','representativeReviewed','reviewedType','dimensionLines'],...candidates.map(c=>{const e=evidence.find(e=>e.providerId===c.providerId);return [c.providerId,c.name,c.address,c.types,c.unitsWithValidImages,!!e,e?.type,e?.visibleDimensionLines];})]));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await fs.writeFile(`${out}/review.html`,`<!doctype html><html lang="ko"><meta charset="utf-8"><title>활용하기 쉬운 평면도 후보</title><style>body{font:16px system-ui;background:#f3f6f8;color:#234;margin:28px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:18px}article{background:white;padding:16px;border:1px solid #ddd}img{width:100%;height:260px;object-fit:contain}small{display:block}a{color:#1265ab}</style><h1>활용하기 쉬운 평면도 후보</h1><p><b>이 화면은 2026-09-20 후보 검사 기록입니다.</b> 실제 제작 진행은 <a href="../apartment-model-work/review.html">아파트 모델 제작 현황</a>에서 확인합니다.</p><p>파일·공급자 동호수 자료 조건을 충족한 후보 ${summary.candidateComplexes}개 단지. 이 중 세대수 상위 ${evidence.length}개 단지의 대표 도면 각 1개를 직접 검토했습니다.</p><p>검토한 ${evidence.length}개 모두 선명한 컬러 평면 이미지입니다. ${summary.representativesWithDimensionLines}개에는 치수선 표기가 있습니다. 모든 타입의 품질, 실제 치수·창 높이·호수별 방향을 검증했다는 뜻은 아닙니다.</p><p><a href="candidates.csv">전체 후보 CSV</a> · <a href="visual-evidence.json">이미지별 검토 근거</a></p><main>${evidence.map(e=>{const c=candidates.find(c=>c.providerId===e.providerId),file=path.relative(out,e.file).replaceAll('\\','/');return `<article><b>${esc(e.name)} / ${esc(e.type)}</b><small>${esc(c.address)}</small><small>이미지 있는 타입 ${c.types}개 · 공급자 연결 ${c.unitsWithValidImages.toLocaleString()}세대</small><a href="${esc(file)}"><img loading="lazy" src="${esc(file)}"></a><p>${e.visibleDimensionLines?'치수선 표기 있음 — 일부만 있을 수 있음':'치수 표기 미확인 — 별도 크기 근거 필요'}</p><small>대표 이미지 1개 검토 · 3D 모델 미제작</small></article>`;}).join('')}</main></html>`);
console.log(JSON.stringify(summary,null,2));
