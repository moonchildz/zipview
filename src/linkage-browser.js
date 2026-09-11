import './style.css';
import './linkage.css';
import {createUnitIndex,planImageCount} from './unit-linkage.js';
import {splitAddressInput} from './address-input.js';

document.title='주소·동·호 전체 자료 조회 | 집과 전망';
document.body.innerHTML=`<header class="topbar"><div class="brand"><strong>집과 전망</strong><span>전체 자료 조회</span></div><a href="/?site=xi">공간 데모</a></header>
<main class="linkage-page"><h1>주소로 평면도 찾기</h1><p id="coverage" role="status">자료를 불러오는 중입니다.</p>
<form id="linkage-form"><label>주소 또는 단지명<input name="address" list="complex-options" required autocomplete="off" placeholder="예: 서울 종로구 송월길 99"></label><datalist id="complex-options"></datalist>
<label>동 (선택)<input name="building" inputmode="numeric"></label><label>호 (선택)<input name="unit" inputmode="numeric"></label><button class="primary">조회</button></form>
<p id="pipeline-status" role="status"></p><section id="linkage-result" aria-live="polite"></section>
<section id="saved-complexes"><h2>평면도 보유 단지</h2><div id="saved-list"></div></section>
<details><summary>자료 수집·연결 현황</summary><p id="missing-inputs"></p><a href="/research/linkage/generated/report.json" target="_blank">전체 연결 보고서</a></details></main>`;
const $=s=>document.querySelector(s),form=$('#linkage-form'),result=$('#linkage-result');
const labels={'ambiguous-address':'일치하는 단지를 선택해 주세요.','address-not-registered':'로컬 자료에서 주소를 찾지 못했습니다.',
  'invalid-address':'주소를 확인해 주세요.','address-candidates':'검색된 단지를 선택해 주세요.',
  'address-not-found':'공개 자료에서 해당 주소의 단지를 찾지 못했습니다.','complex-found':'단지 평면도 목록',
  'invalid-input':'동·호를 함께 입력하거나 주소만 입력해 주세요.',
  'image-line-candidate':'배치도에서 읽은 라인별 타입 후보',
  'unit-unlinked':'건물은 등록돼 있습니다. 해당 호수의 타입 연결은 아직 없습니다.',
  'unit-not-found':'공식 호별 목록에 없는 동·호입니다.',
  'building-unlinked':'단지는 찾았습니다. 해당 동·호의 타입 연결은 아직 없습니다.',
  conflict:'연결 근거가 충돌하여 해당 호수의 타입을 확정하지 않았습니다.','scenario-only':'비교 시나리오',linked:'동·호 연결 결과'};
const gapLabels={'floor-exceptions-unverified':'호수 존재·층별 타입 예외 미확인','floor-above-building-levels':'등록된 건물 층수 초과','plan-not-registered':'타입 평면도 미등록','plan-file-missing':'평면도 파일 미확보','building-geometry-unlinked':'동 외곽 미연결','orientation-unlinked':'방향·반전 미연결','orientation-unverified':'방향·반전은 추정 후보','floor-elevation-unverified':'바닥 표고 미검증','as-built-unverified':'준공 상태 미검증','unit-chart-missing-or-exception':'동호수표 또는 층별 예외 미확인','building-crosswalk-missing':'동의 대응표 미확보','scenario-not-unit-evidence':'실제 호수 존재 미확인','conflicting-unit-evidence':'타입 근거 충돌'};
function element(tag,text,parent=result){const el=document.createElement(tag);if(text)el.textContent=text;parent.append(el);return el;}
function link(text,url,parent=result){const a=element('a',text,parent);a.href=url;return a;}
let catalog,index,busy=false;
function setCatalog(value){
  catalog=value;index=createUnitIndex(catalog);const c=catalog.coverage;
  $('#coverage').textContent=`주소 등록 ${c.complexes.toLocaleString()}개 단지 · 평면도 보유 ${c.complexesWithPlanImages??new Set(catalog.plans.filter(p=>p.available).map(p=>p.complexId)).size}개 단지 (${c.planImages??0}장) · 세대 연결 중 원자료 호별 도면 ${c.sourceUnitsWithPlanImages??0}호 · 전수 연결 ${c.fullyLinkedComplexes??0}개 단지`;
  $('#missing-inputs').textContent=catalog.inputs.filter(i=>i.status==='missing').map(i=>`${i.path} — 현재 PC에 없음`).join('\n');
  const list=$('#saved-list');list.replaceChildren();
  for(const complex of catalog.complexes){
    const plans=catalog.plans.filter(p=>p.complexId===complex.id&&p.available),count=planImageCount(plans);if(!count)continue;
    const a=link('', `/?${new URLSearchParams({site:'catalog',address:complex.id})}`,list);
    const p=plans.find(p=>/\.(png|jpe?g|webp)$/i.test(p.file));
    if(p){const img=element('img','',a);img.src=`/${p.file}`;img.alt=`${complex.name} 평면도`;img.loading='lazy';}
    const text=element('div','',a);element('strong',`${complex.name} · ${count}장`,text);
    element('span',complex.address??'주소 미확인',text);
    const coverage=catalog.unitCoverage?.find(c=>c.complexId===complex.id);
    if(coverage)element('span',`호별 도면 ${coverage.unitsWithPlanImages}/${coverage.expectedUnits??'?'}호 · ${coverage.completePlanLookup?'자료상 전수 연결':'연결 미완료'}${coverage.lineCandidates?` · 라인 후보 ${coverage.lineCandidates}개`:''}`,text);
  }
}
function values(){return ['address','building','unit'].map(k=>form.elements[k].value.trim());}
function localResult(){return index.resolve(...values());}
function display(r){
  result.replaceChildren();result.dataset.status=r.status;element('h2',r.sourceStatus==='source-linked-candidate'?'배치 자료에 따른 세대 타입 후보':labels[r.status]??r.status);
  if(r.complex)element('p',`${r.complex.name} · ${r.complex.address??'주소 미확인'}${r.building?` · ${r.building}동 ${r.unit??''}호`:''}`);
  const coverage=catalog.unitCoverage?.find(c=>c.complexId===r.complex?.id);
  if(coverage){
    const p=element('p',`단지 전체: 자료상 ${coverage.expectedUnits??'미상'}호 중 호별 평면도 ${coverage.unitsWithPlanImages}호 연결 · ${coverage.completePlanLookup?'자료상 전수 연결':'전수 연결 미완료'}`);p.className='unit-coverage-status';
    if(coverage.unitCandidates||coverage.lineCandidates)element('p',`별도 세대 후보 ${coverage.unitCandidates}호 · 배치도 라인 후보 ${coverage.lineCandidates}개 (호수 존재·층별 예외 미확인)`);
  }
  for(const c of r.candidates??[]){const button=element('button',`${c.name} — ${c.address??c.id}`);button.type='button';button.onclick=()=>{form.elements.address.value=c.id;show();};}
  if(r.planId)element('p',`연결 타입: ${r.plan?.displayType??r.planId}${r.plan?.area?` · 전용 ${r.plan.area}㎡`:''}`);
  if(r.officialUnit){
    element('p',`공식 호별 자료: 전용 ${r.officialUnit.exclusiveArea}㎡ · ${r.officialUnit.year}년 ${r.officialUnit.month}월 기준`);
    const a=link('국토부 호별 원자료',r.officialUnit.source);a.target='_blank';a.rel='noreferrer';
    if(!r.planId)element('p','호수 존재와 전용면적은 확인되었습니다. 동일 면적의 세부 타입 구분은 아직 연결 중입니다.');
  }
  if(r.status==='image-line-candidate'){
    element('p',`${r.building}동 ${r.line}라인 기준입니다. 해당 호수의 존재 및 층별 타입 예외는 아직 확인되지 않았습니다.`);
    const a=link('판독 근거: 원본 배치도',r.source);a.target='_blank';a.rel='noreferrer';
  }
  if(r.placement)element('p',`거실 방향 후보 ${r.placement.bearing.toFixed(1)}° · ${r.placement.mirrored?'좌우 반전':'원본 좌우'} · 미검증`);
  if(r.plan?.available){
    const a=link(r.status==='image-line-candidate'?'라인 후보 평면도 원본':'이 호수의 평면도 원본',`/${r.plan.file}`);a.target='_blank';a.id='selected-plan';
    const img=element('img','',a);img.src=`/${r.plan.file}`;img.alt=`${r.building}동 ${r.unit}호 ${r.plan.displayType??r.planId} 평면도`;
  }
  if(r.preview)link(r.scenario?'비교 시나리오 열기':'연결된 데모 보기',r.preview);
  else if(r.planPreview)link('집 구조 열기',r.planPreview);
  if(r.gaps?.length)element('p',r.gaps.map(g=>g==='unit-absent-from-complete-inventory'?'완전 대조한 공식 호별 목록에 없음':gapLabels[g]??g).join(' · '));
  if(r.availablePlans?.length){
    let parent=result;
    if(r.plan?.available){parent=element('details');element('summary',`단지 전체 평면도 (${r.availablePlans.length}개 레코드)`,parent);}
    else element('h3','이 단지의 평면도');
    if(!r.planId&&values()[2])element('p','아래는 단지 전체의 타입 목록입니다. 입력한 호수에 해당하는 타입으로 확정한 것은 아닙니다.');
    const grid=element('div','',parent);grid.className='provider-plans';
    for(const p of r.availablePlans){
      const card=element('article','',grid);element('strong',`${p.displayType??p.id}${p.variant&&p.variant!=='unavailable'?` · ${p.variant==='extended'?'확장형':'기본형'}`:''}`,card);
      if(p.area)element('p',`전용 ${p.area}㎡${p.supply?` · 공급 ${p.supply}㎡ (약 ${(p.supply/3.305785).toFixed(1)}평)`:''}`,card);
      if(p.available){const a=link('원본 평면도 열기',`/${p.file}`,card);a.target='_blank';const img=element('img','',a);img.src=`/${p.file}`;img.alt=`${p.displayType??p.id} 평면도`;img.loading='lazy';}
      else element('p','원본 이미지 미확보',card);
      if(p.source){const a=link('출처',/^https?:/.test(p.source)?p.source:`/${p.source}`,card);a.target='_blank';a.rel='noreferrer';}
    }
  }
  if(r.complex?.providerErrors?.length){const details=element('details');element('summary','추가로 필요한 자료',details);for(const e of r.complex.providerErrors)element('p',e.reason,details);}
  if(r.complex&&!r.availablePlans?.length)element('p','단지 주소는 등록되어 있으나 평면도는 아직 확보하지 못했습니다.');
  if(r.complex&&r.complex.id!=='seoul-daebang-planned'){
    const button=element('button','평면도·동호수 자료 수집');button.type='button';button.onclick=()=>show(true,r.complex.kbId);
  }
}
async function collect(providerId){
  const r=localResult(),address=r.complex?.address||values()[0];
  $('#pipeline-status').textContent='공개 단지 검색 → 평형·평면도 수집 → 동호수 연결표 확인 → 저장 중…';
  const response=await fetch('/api/address-pipeline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address,providerId})});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('수집 서버에 연결할 수 없습니다. 저장된 평면도는 계속 조회할 수 있습니다.');
  const data=await response.json();if(!response.ok)throw new Error(data.error??'수집 실패');
  if(data.catalog){setCatalog(data.catalog);const c=catalog.complexes.find(c=>c.kbId===data.result.complex.providerId);
    if(c&&localResult().complex?.id!==c.id)form.elements.address.value=c.id;
    const state=data.result;$('#pipeline-status').textContent=`자동 수집: ${state.complex.plans.length}개 평형 · 평면 이미지 ${state.complex.plans.flatMap(p=>p.variants).filter(v=>v.file).length}장 · 공급자 동호수 연결 ${state.complex.units.filter(u=>u.areaId).length}건 · 외부 요청 ${state.requests}회 / 캐시 ${state.cacheHits}회${state.matchBasis==='unique-provider-search-candidate'?' · 검색 결과 단지명·주소를 확인해 주세요.':''}`;
    display(localResult());return;
  }
  if(!r.complex){result.replaceChildren();result.dataset.status=data.result.status;}
  element('h2',labels[data.result.status]??data.result.status);
  $('#pipeline-status').textContent=`검색 후보 ${data.result.total??0}건`;
  for(const c of data.result.candidates??[]){const button=element('button',`${c.name} — ${c.address}`);button.type='button';button.onclick=()=>show(true,c.providerId);}
}
async function show(force=false,providerId){
  if(busy)return;busy=true;for(const input of form.querySelectorAll('input,button'))input.disabled=true;
  try{
    const request=splitAddressInput(values()[0]);
    if(request.building){form.elements.address.value=request.address;form.elements.building.value=request.building;form.elements.unit.value=request.unit??'';}
    const r=localResult();display(r);
    const candidates=r.status==='address-not-registered'?index.search(values()[0]).slice(0,20):[];
    const missingImages=r.availablePlans?.some(p=>p.file&&!p.available);
    const needCollection=r.status==='address-not-registered'||(r.complex&&!r.complex.kbId&&(!r.availablePlans?.some(p=>p.available)||(values()[2]&&!r.planId&&r.status!=='conflict')))||missingImages;
    if(!force&&candidates.length){display({status:'address-candidates',candidates});$('#pipeline-status').textContent=`로컬 검색 후보 ${candidates.length}건`;}
    else if(force||(needCollection&&!['invalid-input','invalid-address','ambiguous-address'].includes(r.status)&&r.complex?.id!=='seoul-daebang-planned'))await collect(providerId??r.complex?.kbId);
    else $('#pipeline-status').textContent='저장된 자료에서 조회했습니다.';
    const v=values();history.replaceState(null,'',`/?${new URLSearchParams({site:'catalog',address:v[0],building:v[1],unit:v[2]})}`);
  }catch(e){$('#pipeline-status').textContent=`조회를 완료하지 못했습니다: ${e.message}`;}
  finally{busy=false;for(const input of form.querySelectorAll('input,button'))input.disabled=false;}
}
try{
  const response=await fetch('/research/linkage/generated/catalog.json');if(!response.ok)throw new Error('로컬 인덱스가 없습니다.');setCatalog(await response.json());
  form.elements.address.addEventListener('input',()=>$('#complex-options').replaceChildren(...index.search(form.elements.address.value).slice(0,100).map(c=>{const o=document.createElement('option');o.value=c.address||c.id;o.label=c.name;return o;})));
  form.addEventListener('submit',e=>{e.preventDefault();show();});
  const q=new URLSearchParams(location.search);for(const k of ['address','building','unit'])form.elements[k].value=q.get(k)??'';
  if(values()[0])show();
}catch(e){$('#coverage').textContent=e.message;}
