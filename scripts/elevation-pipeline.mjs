import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const read=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch{return null;}};
const steps=[];
const offline=process.argv.includes('--offline');
function run(script,args=[]){
  console.log(`Elevation pipeline: ${script}`);
  const r=spawnSync(process.execPath,[`scripts/${script}.mjs`,...args],{stdio:'inherit'});
  steps.push({script,passed:r.status===0});if(r.status!==0)throw new Error(`Stage failed: ${script}`);
}
if(offline){
  for(const path of ['research/linkage/downloads/hanshin-hanjin/osm.json','research/linkage/downloads/hanshin-hanjin/205-detail.html','research/linkage/providers/kb/36331.json']){
    try{await readFile(path);}catch{throw new Error(`Offline source missing: ${path}; run pipeline:elevations once online`);}
  }
}else run('collect-hanshin-sources');
if(!(await read('research/linkage/providers/kb/36331.json')))run('address-pipeline',['한신한진']);
const inventory=await read('research/linkage/downloads/housing/target-units.json');
if(!inventory?.targets.some(t=>t.id==='hanshin-hanjin'))run('extract-housing-inventory');
run('rebuild-sinchon-footprints');
run('prepare-hanshin');
run('build-linkage');
const catalog=await read('research/linkage/generated/catalog.json');
const targets=[['gyeonghuigung-xi',14,1148],['sinchon-prugio',10,426],['seoul:A13606004',1,84]].map(([id,expectedBuildings,expectedUnits])=>{
  const buildings=catalog.estimatedViewReport.filter(r=>r.complexId===id),count=buildings.reduce((n,b)=>n+b.estimatedUnits,0);
  return {id,name:catalog.complexes.find(c=>c.id===id).name,expectedBuildings,expectedUnits,estimatedUnits:count,buildings,
    complete:buildings.length===expectedBuildings&&count===expectedUnits&&buildings.every(b=>!b.errors.length&&b.estimatedUnits===b.sourceUnits)};
});
const report={checkedAt:new Date().toISOString(),scope:'Terrain-derived floor and eye elevations plus estimated exterior views',
  complete:targets.every(t=>t.complete),verified:false,steps,targets};
await mkdir('research/linkage/generated',{recursive:true});
await writeFile('research/linkage/generated/elevation-pipeline.json',JSON.stringify(report,null,2));
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>동별 지형·높이 적용 결과</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#203c34}table{border-collapse:collapse;width:100%}td,th{padding:12px 8px;border-bottom:1px solid #dde5e1;text-align:left}a{color:#176957}section{overflow:auto}</style><h1>동별 지형·높이 적용 결과</h1><p>지반 + (층−1) × 2.9m + 눈높이 1.5m. 지반은 지형 자료에서 계산한 값이며 실제 1층 마감 바닥과 창 위치는 추정입니다.</p>${targets.map(t=>`<h2>${escape(t.name)}</h2><p>${t.estimatedUnits}/${t.expectedUnits}세대 적용</p><section><table><tr><th>동</th><th>지반 표고</th><th>최고 층수</th><th>건물 높이</th><th>세대</th><th>실행</th></tr>${t.buildings.sort((a,b)=>Number(a.building)-Number(b.building)).map(b=>{
  const u=catalog.units.find(u=>u.complexId===t.id&&u.building===b.building&&u.estimatedViewReady&&u.elevation.floor>=2)??catalog.units.find(u=>u.complexId===t.id&&u.building===b.building&&u.estimatedViewReady);
  return `<tr><td>${b.building}동</td><td>${b.ground.toFixed(2)}m</td><td>${b.levels}층</td><td>${b.height.toFixed(2)}m${t.id==='seoul:A13606004'?' (층수 환산)':''}</td><td>${b.estimatedUnits}</td><td><a href="${escape(u.estimatedPreview)}">${u.unit}호 전망</a></td></tr>`;
}).join('')}</table></section>`).join('')}<p><a href="/">주소·동·호 검색</a> · <a href="elevation-pipeline.json">계산 결과 JSON</a></p></html>`;
await writeFile('research/linkage/generated/elevation-review.html',html);
console.log(JSON.stringify({complete:report.complete,targets:targets.map(({buildings,...t})=>t)},null,2));
if(!report.complete)process.exitCode=1;
