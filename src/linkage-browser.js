import './style.css';
import './linkage.css';
import {createUnitIndex} from './unit-linkage.js';

document.title='주소·동·호 전체 자료 조회 | 집과 전망';
document.body.innerHTML=`<header class="topbar"><div class="brand"><strong>집과 전망</strong><span>전체 자료 조회</span></div><a href="/?site=xi">공간 데모</a></header>
<main class="linkage-page"><h1>주소로 평면도 찾기</h1><p>도로명·지번 주소 또는 아파트명을 입력하세요. 동·호를 알면 함께 입력할 수 있습니다.</p><p id="coverage" role="status">자료를 불러오는 중입니다.</p>
<form id="linkage-form"><label>주소 또는 단지명<input name="address" list="complex-options" required autocomplete="off" placeholder="예: 서울 종로구 송월길 99"></label><datalist id="complex-options"></datalist>
<label>동 (선택)<input name="building" inputmode="numeric"></label><label>호 (선택)<input name="unit" inputmode="numeric"></label><button class="primary">조회</button></form>
<p id="pipeline-status" role="status"></p><section id="linkage-result" aria-live="polite"></section>
<details><summary>자료 수집·연결 현황</summary><p id="missing-inputs"></p><a href="/research/linkage/generated/report.json" target="_blank">전체 연결 보고서</a></details></main>`;
const $=s=>document.querySelector(s),form=$('#linkage-form'),result=$('#linkage-result');
const labels={'ambiguous-address':'일치하는 단지를 선택해 주세요.','address-not-registered':'로컬 자료에서 주소를 찾지 못했습니다.',
  'address-not-found':'공개 자료에서 해당 주소의 단지를 찾지 못했습니다.','complex-found':'단지 평면도 목록',
  'invalid-input':'동·호를 함께 입력하거나 주소만 입력해 주세요.',
  'image-line-candidate':'배치도에서 읽은 라인별 타입 후보',
  'unit-unlinked':'건물은 등록돼 있습니다. 해당 호수의 타입 연결은 아직 없습니다.',
  'building-unlinked':'단지는 찾았습니다. 해당 동·호의 타입 연결은 아직 없습니다.',
  conflict:'연결 근거가 충돌하여 해당 호수의 타입을 확정하지 않았습니다.','scenario-only':'비교 시나리오',linked:'동·호 연결 결과'};
const gapLabels={'floor-exceptions-unverified':'호수 존재·층별 타입 예외 미확인','floor-above-building-levels':'등록된 건물 층수 초과','plan-not-registered':'타입 평면도 미등록','plan-file-missing':'평면도 파일 미확보','building-geometry-unlinked':'동 외곽 미연결','orientation-unlinked':'방향·반전 미연결','orientation-unverified':'방향·반전은 추정 후보','floor-elevation-unverified':'바닥 표고 미검증','as-built-unverified':'준공 상태 미검증','unit-chart-missing-or-exception':'동호수표 또는 층별 예외 미확인','building-crosswalk-missing':'동의 대응표 미확보','scenario-not-unit-evidence':'실제 호수 존재 미확인','conflicting-unit-evidence':'타입 근거 충돌'};
function element(tag,text,parent=result){const el=document.createElement(tag);if(text)el.textContent=text;parent.append(el);return el;}
function link(text,url,parent=result){const a=element('a',text,parent);a.href=url;return a;}
let catalog,index,busy=false;
function setCatalog(value){
  catalog=value;index=createUnitIndex(catalog);const c=catalog.coverage;
  $('#coverage').textContent=`로컬 단지 ${c.complexes.toLocaleString()}곳 · 타입·도면 레코드 ${c.plans}건 (원본 이미지 ${c.planImages??0}장) · 세대 연결 ${c.unitAssociations}건. 미등록 주소는 조회 시 공개 자료를 자동 수집합니다.`;
  $('#missing-inputs').textContent=catalog.inputs.filter(i=>i.status==='missing').map(i=>`${i.path} — 현재 PC에 없음`).join('\n');
}
function values(){return ['address','building','unit'].map(k=>form.elements[k].value.trim());}
function localResult(){return index.resolve(...values());}
function display(r){
  result.replaceChildren();result.dataset.status=r.status;element('h2',labels[r.status]??r.status);
  if(r.complex)element('p',`${r.complex.name} · ${r.complex.address??'주소 미확인'}${r.building?` · ${r.building}동 ${r.unit}호`:''}`);
  for(const c of r.candidates??[]){const button=element('button',`${c.name} — ${c.address??c.id}`);button.type='button';button.onclick=()=>{form.elements.address.value=c.id;show();};}
  if(r.planId)element('p',`연결 타입: ${r.plan?.displayType??r.planId}${r.plan?.area?` · 전용 ${r.plan.area}㎡`:''}`);
  if(r.status==='image-line-candidate'){
    element('p',`${r.building}동 ${r.line}라인 기준입니다. 해당 호수의 존재 및 층별 타입 예외는 아직 확인되지 않았습니다.`);
    const a=link('판독 근거: 원본 배치도',r.source);a.target='_blank';a.rel='noreferrer';
  }
  if(r.placement)element('p',`거실 방향 후보 ${r.placement.bearing.toFixed(1)}° · ${r.placement.mirrored?'좌우 반전':'원본 좌우'} · 미검증`);
  if(r.plan?.available)link(r.status==='image-line-candidate'?'라인 후보 평면도 원본':'이 호수의 평면도 원본',`/${r.plan.file}`).target='_blank';
  if(r.preview)link(r.scenario?'비교 시나리오 열기':'연결된 데모 보기',r.preview);
  if(r.gaps?.length)element('p',r.gaps.map(g=>gapLabels[g]??g).join(' · '));
  if(r.availablePlans?.length){
    element('h3','이 단지의 평면도');
    if(!r.planId&&values()[2])element('p','아래는 단지 전체의 타입 목록입니다. 입력한 호수에 해당하는 타입으로 확정한 것은 아닙니다.');
    const grid=element('div','');grid.className='provider-plans';
    for(const p of r.availablePlans){
      const card=element('article','',grid);element('strong',`${p.displayType??p.id}${p.variant&&p.variant!=='unavailable'?` · ${p.variant==='extended'?'확장형':'기본형'}`:''}`,card);
      if(p.area)element('p',`전용 ${p.area}㎡${p.supply?` · 공급 ${p.supply}㎡ (약 ${(p.supply/3.305785).toFixed(1)}평)`:''}`,card);
      if(p.available){const a=link('원본 평면도 열기',`/${p.file}`,card);a.target='_blank';const img=element('img','',a);img.src=`/${p.file}`;img.alt=`${p.displayType??p.id} 평면도`;img.loading='lazy';}
      else element('p','원본 이미지 미확보',card);
      if(p.source){const a=link('출처',/^https?:/.test(p.source)?p.source:`/${p.source}`,card);a.target='_blank';a.rel='noreferrer';}
    }
  }
  if(r.complex?.providerErrors?.length){const details=element('details');element('summary','추가로 필요한 자료',details);for(const e of r.complex.providerErrors)element('p',e.reason,details);}
}
async function collect(providerId){
  const r=localResult(),address=r.complex?.address||values()[0];
  $('#pipeline-status').textContent='공개 단지 검색 → 평형·평면도 수집 → 동호수 연결표 확인 → 저장 중…';
  const response=await fetch('/api/address-pipeline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address,providerId})});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'수집 실패');
  if(data.catalog){setCatalog(data.catalog);const c=catalog.complexes.find(c=>c.kbId===data.result.complex.providerId);form.elements.address.value=c?.address??address;
    const state=data.result;$('#pipeline-status').textContent=`자동 수집: ${state.complex.plans.length}개 평형 · 평면 이미지 ${state.complex.plans.flatMap(p=>p.variants).filter(v=>v.file).length}장 · 공급자 동호수 연결 ${state.complex.units.filter(u=>u.areaId).length}건 · 외부 요청 ${state.requests}회 / 캐시 ${state.cacheHits}회${state.matchBasis==='unique-provider-search-candidate'?' · 검색 결과 단지명·주소를 확인해 주세요.':''}`;
    display(localResult());return;
  }
  result.replaceChildren();element('h2',labels[data.result.status]??data.result.status);
  $('#pipeline-status').textContent=`검색 후보 ${data.result.total??0}건`;
  for(const c of data.result.candidates??[]){const button=element('button',`${c.name} — ${c.address}`);button.type='button';button.onclick=()=>show(true,c.providerId);}
}
async function show(force=false,providerId){
  if(busy)return;busy=true;form.querySelector('button').disabled=true;
  try{
    const match=values()[0].match(/^(.*?)\s+(\d+)동\s*(\d{3,5})호\s*$/);
    if(match){form.elements.address.value=match[1];form.elements.building.value=match[2];form.elements.unit.value=match[3];}
    const r=localResult();display(r);
    if(force||(!r.complex?.kbId&&r.status!=='invalid-input'&&r.complex?.id!=='seoul-daebang-planned'))await collect(providerId);
    else $('#pipeline-status').textContent='저장된 자료에서 조회했습니다.';
    const v=values();history.replaceState(null,'',`/?${new URLSearchParams({site:'catalog',address:v[0],building:v[1],unit:v[2]})}`);
  }catch(e){$('#pipeline-status').textContent=`자동 수집을 완료하지 못했습니다: ${e.message}`;}
  finally{busy=false;form.querySelector('button').disabled=false;}
}
try{
  const response=await fetch('/research/linkage/generated/catalog.json');if(!response.ok)throw new Error('로컬 인덱스가 없습니다.');setCatalog(await response.json());
  form.elements.address.addEventListener('input',()=>$('#complex-options').replaceChildren(...index.search(form.elements.address.value).slice(0,100).map(c=>{const o=document.createElement('option');o.value=c.address||c.id;o.label=c.name;return o;})));
  form.addEventListener('submit',e=>{e.preventDefault();show();});
  const q=new URLSearchParams(location.search);for(const k of ['address','building','unit'])form.elements[k].value=q.get(k)??'';
  if(values()[0])show();
}catch(e){$('#coverage').textContent=e.message;}
