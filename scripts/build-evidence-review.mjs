import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';

// Reviews are bound to downloaded image content, never to a reused type label.
const reviews={
  'bfcafc904a8b':['신촌 SH 34A·34B 건축 도면','치수선과 문·창호 표시가 있다. 640×452 공개본으로 작은 수치는 판독 보류. KB 34AT/34B와 동일 타입으로 확정하지 않음.'],
  'ef38aea4fba4':['신촌 SH 49A 기본·확장 도면','하단에 209동 테라스 부분이 명시되어 있다. 209동 형태 검토 근거이며 전체 동 경계·호별 배치·높이를 확정하는 자료는 아님.'],
  '06de3ea4482a':['신촌 SH 53A 기본·확장 도면','기본형과 확장형 및 창호 표시. KB 53BT와 타입·옵션 대조 필요.'],
  '83544a2c9336':['신촌 SH 치수 평면 안내도','1654×2340, 34A·34B·49A·53A 확장형. 203동 임대형 45세대를 SH 34A·34B·49A로 재연결하고 별도 모델에 치수·창을 반영했다. 개략도이며 실제 방위·반전과 창 높이는 미확인.'],
  '67afda9f554c':['신촌 SH 배치도','북아현1-2 단지 배치와 북쪽 방향, 주변 학교 표시. 640×452로 동별 세부 숫자의 판독에 한계가 있음.'],
  'bb2cc7845ddb':['신촌 34AT 치수 도면 재게시본','전용 34.250㎡·15세대 표기. KB 29616의 면적·세대수와 일치하는 후보. 창 높이·방위·개별 호수는 제공하지 않음.'],
  '9379d0dec5ef':['신촌 34B 치수 도면 재게시본','전용 34.752㎡·4세대 표기. KB 75982의 반올림 면적·세대수와 일치하는 후보. SH 203동 34B 안내도와 동일 도형으로 취급하면 안 됨.'],
  '15367c8d2f23':['신촌 49AT(A) 치수 도면 재게시본','전용 49.020㎡·4세대 표기. KB 179187의 49A와 명칭 차이가 있어 옵션·도형 대조 후 연결 필요.'],
  '7aa46eeedd3e':['경희궁자이 2단지 84F 평면도','84F 테라스 매물 원문에 첨부된 작은 평면도. 원문은 동·호·층을 명시하지 않으므로 84F/F1 15세대 구분은 해결하지 못함.'],
  '06f6ca32c33e':['동소문한진 SH 세대 도면','6840×4816 원본. 성북로4길52 재개발임대 자료로 205동 적용 여부는 아직 확인되지 않음.'],
  'babefec65f89':['동소문한진 SH 치수 도면','벽체·창호와 치수 표기가 있다. 해당 임대 단지의 참고 자료이며 한신한진 205동 평면도라고 확정하지 않음.'],
  'fcd8fcb9684f':['2021 재개발임대 모집공고 PDF','68쪽 모집공고. 신촌·동소문한진의 공급 면적·단지 주소 확인용. 층별 단면도나 세대별 창 높이를 제공하는 자료는 아님.']
};
const additional=JSON.parse(await readFile('research/linkage/generated/additional-sources.json','utf8'));
const sh=JSON.parse(await readFile('research/linkage/downloads/evidence/sh/manifest.json','utf8'));
const candidates=[...additional.sources.flatMap(s=>s.assets.map(a=>({...a,complex:s.complexId,source:s.url}))),...sh.complexes.flatMap(c=>c.assets.map(a=>({...a,complex:c.name,source:sh.source})))];
const seen=new Set(),assets=[];
for(const asset of candidates){
  if(seen.has(asset.sha256))continue;
  seen.add(asset.sha256);
  const path=resolve(asset.file),root=resolve('research/linkage/downloads/evidence');
  if(relative(root,path).startsWith('..'))throw new Error('Evidence outside downloads/evidence');
  const bytes=await readFile(path),hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==asset.sha256)throw new Error(`Changed evidence: ${asset.file}`);
  const review=reviews[hash.slice(0,12)];
  const applied=['83544a2c9336','bb2cc7845ddb','9379d0dec5ef','15367c8d2f23'].includes(hash.slice(0,12));
  assets.push({...asset,status:review?'reviewed-reference':'downloaded-unreviewed',title:review?.[0],review:review?.[1],appliedToGeometry:applied,application:applied?'source-scoped local plan/scale estimate; geographic placement unverified':null});
}
const report={checkedAt:new Date().toISOString(),uniqueAssets:assets.length,reviewedReferences:assets.filter(a=>a.title).length,missingReviewedReferences:Object.keys(reviews).filter(prefix=>!assets.some(a=>a.sha256.startsWith(prefix))),assets,unresolved:['Xi2 84F/F1 exact unit allocation','Sinchon209/210 geographic footprint registration','Measured per-floor elevations and window sill/head heights','SH rental plan to provider unit/type crosswalk','Hanshin Hanjin205 scope confirmation']};
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cards=assets.filter(a=>a.title).map(a=>`<article><h2>${escape(a.title)}</h2><p>${escape(a.review)}</p><p><a href="${escape(a.source)}">출처</a> · <a href="/${escape(a.file)}">원본 열기</a></p>${a.width?`<a href="/${escape(a.file)}"><img loading="lazy" src="/${escape(a.file)}" alt="${escape(a.title)}"></a>`:''}<small>${escape(a.width?`${a.width} × ${a.height}`:'PDF')} · SHA-256 ${escape(a.sha256)}</small></article>`).join('');
await mkdir('research/linkage/generated',{recursive:true});
await writeFile('research/linkage/generated/evidence-review.json',JSON.stringify(report,null,2)+'\n');
await writeFile('research/linkage/generated/evidence-review.html',`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>추가 확보 도면</title><style>body{font:16px/1.6 system-ui;margin:32px auto;padding:0 20px;max-width:1100px;color:#182735;background:#f2f5f7}article{background:white;padding:24px;margin:24px 0;border-radius:12px}img{display:block;max-width:100%;max-height:850px;margin:auto}small{overflow-wrap:anywhere}a{color:#075cad}h2{font-size:22px}</style><h1>추가 확보 도면과 연결 근거</h1><p>다운로드한 파일 ${report.uniqueAssets}개 중 검토한 도면·문서 ${report.reviewedReferences}개입니다. 자료 검토 상태이며 3D 위치·높이 반영 완료를 뜻하지 않습니다.</p>${cards}</html>`);
console.log(JSON.stringify({uniqueAssets:report.uniqueAssets,reviewedReferences:report.reviewedReferences,missingReviewedReferences:report.missingReviewedReferences}));
if(report.missingReviewedReferences.length)process.exitCode=1;
