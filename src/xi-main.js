import './style.css';
import {createIcons,icons} from 'lucide';
import {OutlookScene} from './outlook.js';
import {applyXiLayoutHypothesis} from './xi-unit-layout.js';
import {mountXiWindowPicker} from './xi-window-picker.js';
import {applyXiComplexFacades} from './xi-complex-facades.js';
import {mountXiInterior} from './xi-interior.js';
import {requestedXiUnit} from './xi-unit-registry.js';
import {mountXiSearch} from './xi-search.js';
import {xiOpeningCandidates} from './xi-unit-layout.js';

const selection=await requestedXiUnit(),dong=selection.building,type=selection.planId;

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
document.body.classList.add('xi-app');
document.title=`경희궁자이 ${dong}동 ${selection.unit}호 | 창문별 전망`;
$('.brand span').textContent='경희궁자이';
$('.search-section h1').textContent='경희궁자이 2단지';
mountXiSearch(selection);
$('.examples').replaceChildren();
const previous=document.createElement('a');previous.href='/';previous.textContent='신촌푸르지오 결과로 이동';$('.examples').append(previous);
$('#selection-kind').textContent=selection.status.startsWith('official-')?'국토부 호별 자료':'호수 배치 판독 후보';
$('#type-value').textContent=type;$('#area-value').textContent=`전용 ${selection.exclusiveArea}㎡`;
$('#match-status').textContent='호별 타입 연결 · 창 좌표 추정';
$('.unit-section .data-note').textContent=`공급 ${selection.supplyArea}㎡ · 약 ${(selection.supplyArea/3.305785).toFixed(1)}평. 준공 평면·창 위치는 미검증입니다.`;
$('.plan-section').hidden=true;
$('.source-section').replaceChildren();
const source=document.createElement('a');source.href='/research/gyeonghuigung-xi/unit-layout-research.md';source.target='_blank';source.textContent='호수 배치 자료와 판독 기록';$('.source-section').append(source);
$('#viewer-title').textContent=`${dong}동 · 창문별 전망`;
$('#scene-panel').hidden=true;$('#image-panel').hidden=true;$('#outlook-panel').hidden=false;
$('.workspace').classList.add('show-outlook');
$('.tabs [data-view="3d"]').disabled=false;
$('.tabs [data-view="3d"]').textContent='집 안에서 보기';
$('.tabs [data-view="plan"]').innerHTML='<i data-lucide="panels-top-left"></i>창문 선택';
$('.tabs [data-view="site"]').innerHTML='<i data-lucide="building-2"></i>동 배치';
$('.outlook-heading strong').textContent=`${dong}동 · 창문별 층 비교`;
$('#outlook-type').textContent=`${type} 참고 평면 · 1·2라인 후보`;
$('.estimate-tag').textContent='창 좌표 추정';
$('#download-image').hidden=true;
$('#view-caption').textContent='외부 창 5곳 판독 후보 · 실제 현장 전망 미검증';
$('.locator-source').hidden=true;
$('.direction-locator summary span').textContent='선택한 창 후보의 지도 좌표';
$('#locator-map text').textContent=dong;
$('#window-warning').textContent=`시점이 ${dong}동 건물 안에 있습니다. 위치 보정값을 확인해 주세요.`;
for(const a of $$('a'))if(a.href.includes('kbland'))a.remove();
const floors=[selection.floor,Math.min(selection.floor+5,selection.lastFloor)];
for(const [id,floor] of [['floor-a',floors[0]],['floor-b',floors[1]]]){
  for(const i of selection.availableFloors??Array.from({length:selection.lastFloor-selection.firstFloor+1},(_,n)=>selection.firstFloor+n))$('#'+id).add(new Option(`${i}층`,i));$('#'+id).value=floor;
}
$('.model-review').open=false;$('.direction-locator').open=false;
$('label[for="view-fov"]').textContent='가로 시야각';$('#view-fov').max=75;
const fovValue=document.createElement('output');fovValue.id='xi-fov-value';$('#view-fov').after(fovValue);
let picker,interior;
let currentView='3d';
function setView(view) {
  currentView=view;
  $$('.tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.view===view)));
  picker?.setMode(view);
  interior?.setActive(view==='3d');
}
$$('.tabs button:not(:disabled)').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
setView('3d');

const outlook=new OutlookScene($('#outlook-host'),(state,elevations)=>{
  picker?.updateFacade();
  const line=Number($('#outlook-host').dataset.unitLine||1);
  const opening=$('#outlook-host').dataset.openingName||'거실';
  const unit=state.floors[0]*100+line;
  if(selection.unitNumbers)for(const [i,key] of ['a','b'].entries()){
    const allowed=selection.unitNumbers.filter(u=>Number(u)%100===line).map(u=>Math.floor(Number(u)/100)).sort((a,b)=>a-b);
    const select=$(`#floor-${key}`);
    if([...select.options].map(o=>o.value).join(',')!==allowed.join(','))select.replaceChildren(...allowed.map(f=>new Option(`${f}층`,f)));
    select.value=String(state.floors[i]);
  }
  for(const option of $$('#xi-line option')){
    const unit=String(state.floors[0]*100+Number(option.value));
    option.textContent=`${option.value}라인 · ${unit}호`;
    option.disabled=!!selection.unitNumbers&&!state.floors.every(f=>selection.unitNumbers.includes(String(f*100+Number(option.value))));
  }
  $('#unit').value=unit;$('#unit-title').textContent=`${dong}동 ${unit}호`;
  $('#viewer-title').textContent=outlook.interior?.active?`${dong}동 · 집 안에서 보기`:`${dong}동 · ${opening}`;
  for(const [i,key] of ['a','b'].entries()){
    $(`#label-${key}`).textContent=`${state.floors[i]*100+line}호 · ${outlook.interior?.active?'실내 관찰점':opening}`;
    $(`#elevation-${key}`).textContent=`눈높이 표고 추정 ${elevations[i].toFixed(1)}m`;
  }
  $('#height-delta').textContent=`높이 차 ${Math.abs(elevations[1]-elevations[0]).toFixed(1)}m`;
  $('#bearing').value=Math.round(state.bearing);$('#bearing-value').textContent=`${Math.round(state.bearing)}°`;
  $('#view-fov').value=state.fov;fovValue.textContent=`${Math.round(state.fov)}°`;
  $('#observer-status').textContent=`지형 표고 + (층−1)×${state.floorHeight}m + 눈높이 ${state.eyeHeight}m · 1층 바닥 표고 미검증`;
},{sceneUrl:'/research/gyeonghuigung-xi/scene.json',prepareData:data=>{
    data.targetBuildingId=selection.buildingId;data.targetLabel=`${dong}동`;
    const target=data.buildings.find(b=>b.id===selection.buildingId);
    if(!target||target.siteSource!=='https://www.openstreetmap.org/way/359124892')throw new Error('단지 내 동 식별 불일치');
    target.xiPlanId=type;applyXiLayoutHypothesis(data);applyXiComplexFacades(data);
    const opening=xiOpeningCandidates(target,data.center,{line:selection.line}).find(w=>w.id==='living');
    data.window={lon:opening.lon,lat:opening.lat,bearing:opening.bearing};data.previousWindow={...data.window};
  },correction:false,initialLine:selection.line,
  isValidLine:selection.unitNumbers?(line,floors)=>floors.every(f=>selection.unitNumbers.includes(String(f*100+line))):null,
  floors,horizontalFov:true,fov:50,pitch:0,label:'선택한 창 후보에서 두 층의 전망 비교',
  sourceNote:`${dong}동 ${selection.unit}호 → ${type} · 동호 배치·타입 자료 연결 후보 · 준공 치수·층별 예외 미검증`});

for(const [id,key] of [['eye-height','eyeHeight'],['floor-height','floorHeight'],['ground-offset','offset'],['window-east','east'],['window-north','north'],['bearing','bearing'],['view-fov','fov']]){
  $('#'+id).addEventListener('input',e=>{if(e.target.value&&e.target.validity.valid){outlook.state[key]=Number(e.target.value);outlook.update();}});
}
['a','b'].forEach((key,i)=>$('#floor-'+key).addEventListener('change',e=>{outlook.state.floors[i]=+e.target.value;outlook.update();}));
$('#outlook-reset').addEventListener('click',()=>{
  outlook.reset();
  for(const [id,value] of [['eye-height',1.5],['floor-height',2.9],['ground-offset',0],['window-east',0],['window-north',0]])$('#'+id).value=value;
});
$('#estimated-buildings').addEventListener('change',e=>{if(outlook.estimated)outlook.estimated.visible=e.target.checked;outlook.render();});
$('#roads-visible').addEventListener('change',e=>{if(outlook.streets)outlook.streets.visible=e.target.checked;outlook.render();});
$('#facades-visible').addEventListener('change',e=>{outlook.facadeMeshes?.forEach(m=>m.visible=e.target.checked);outlook.render();});
$('#landmarks-visible').addEventListener('change',e=>{outlook.landmarks?.forEach(l=>l.group.visible=e.target.checked);outlook.render();});
$('#landmark-select').addEventListener('change',e=>{outlook.selectedLandmark=outlook.landmarks?.find(l=>l.id===e.target.value);outlook.focusLandmark();});
$('#landmark-focus').addEventListener('click',()=>outlook.focusLandmark());
try {
  await outlook.load();$('#outlook-host').dataset.site='xi';
  picker=mountXiWindowPicker(outlook);picker.setMode(currentView);
  interior=mountXiInterior(outlook);setView(currentView);
  $('#outlook-host').dataset.layoutModel=dong==='204'?'18f-wing-hypothesis':`${type}-layout-hypothesis`;
  Object.assign($('#outlook-host').dataset,{selectedBuilding:dong,planId:type,lookupStatus:selection.status});
  $('#outlook-host').dataset.complexFacades=JSON.stringify(outlook.data.facadeCoverage);
  $('#outlook-loading').hidden=true;
  $('#dataset-stats').textContent=`${dong}동 ${outlook.target.heightSource==='official-building-register'?'건축물대장':'OSM 자료'}: 최고 ${outlook.target.levels}층·${outlook.target.height}m. ${type} 부분: ${outlook.target.parts[1].levels}층·${outlook.target.parts[1].height.toFixed(1)}m 후보. 지반 ${outlook.target.base.toFixed(1)}m 추정. 상가층·옹벽·수목 미검증.`;
} catch(e) {
  $('#outlook-loading').textContent=`전망 로딩 실패: ${e.message}`;console.error(e);
}
createIcons({icons});
