import './style.css';
import {createIcons,icons} from 'lucide';
import {OutlookScene} from './outlook.js';
import {applyXiLayoutHypothesis} from './xi-unit-layout.js';
import {mountXiWindowPicker} from './xi-window-picker.js';
import {applyXiComplexFacades} from './xi-complex-facades.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
document.body.classList.add('xi-app');
document.title='경희궁자이 204동 | 창문별 전망';
$('.brand span').textContent='경희궁자이';
$('.search-section h1').textContent='경희궁자이 2단지';
$('#address').value='송월길 99';$('#address').readOnly=true;
$('#building').add(new Option('204동','204'));$('#unit').value='201';$('#unit').readOnly=true;
$('#search-form').addEventListener('submit',e=>{e.preventDefault();setView('plan');});
$('.examples').replaceChildren();
const previous=document.createElement('a');previous.href='/';previous.textContent='신촌푸르지오 결과로 이동';$('.examples').append(previous);
$('#selection-kind').textContent='호수 배치 판독 후보';
$('#type-value').textContent='59A 후보';$('#area-value').textContent='미검증';
$('#match-status').textContent='1·2라인 배치 판독 · 창 좌표 추정';
$('.unit-section .data-note').textContent='참고 평면과 외벽을 연결한 후보입니다. 해당 세대의 준공 평면·창 위치는 검증되지 않았습니다.';
$('.plan-section').hidden=true;
$('.source-section').replaceChildren();
const source=document.createElement('a');source.href='/research/gyeonghuigung-xi/unit-layout-research.md';source.target='_blank';source.textContent='호수 배치 자료와 판독 기록';$('.source-section').append(source);
$('#viewer-title').textContent='204동 · 창문별 전망';
$('#scene-panel').hidden=true;$('#image-panel').hidden=true;$('#outlook-panel').hidden=false;
$('.workspace').classList.add('show-outlook');
$('.tabs [data-view="3d"]').disabled=true;
$('.tabs [data-view="3d"]').title='준공 실내 구조 미확보';
$('.tabs [data-view="plan"]').innerHTML='<i data-lucide="panels-top-left"></i>창문 선택';
$('.tabs [data-view="site"]').innerHTML='<i data-lucide="building-2"></i>동 배치';
$('.outlook-heading strong').textContent='204동 · 창문별 층 비교';
$('#outlook-type').textContent='59A 참고 평면 · 1·2라인 후보';
$('.estimate-tag').textContent='창 좌표 추정';
$('#download-image').hidden=true;
$('#view-caption').textContent='외부 창 5곳 판독 후보 · 실제 현장 전망 미검증';
$('.locator-source').hidden=true;
$('.direction-locator summary span').textContent='선택한 창 후보의 지도 좌표';
$('#locator-map text').textContent='204';
$('#window-warning').textContent='시점이 204동 건물 안에 있습니다. 위치 보정값을 확인해 주세요.';
for(const a of $$('a'))if(a.href.includes('kbland'))a.remove();
for(const [id,floor] of [['floor-a',2],['floor-b',7]]){
  for(let i=1;i<=18;i++)$('#'+id).add(new Option(`${i}층`,i));$('#'+id).value=floor;
}
$('.model-review').open=false;$('.direction-locator').open=false;
$('label[for="view-fov"]').textContent='가로 시야각';$('#view-fov').max=75;
const fovValue=document.createElement('output');fovValue.id='xi-fov-value';$('#view-fov').after(fovValue);
let picker;
let currentView='plan';
function setView(view) {
  currentView=view;
  $$('.tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.view===view)));
  picker?.setMode(view);
}
$$('.tabs button:not(:disabled)').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
setView('plan');

const outlook=new OutlookScene($('#outlook-host'),(state,elevations)=>{
  picker?.updateFacade();
  const line=Number($('#outlook-host').dataset.unitLine||1);
  const opening=$('#outlook-host').dataset.openingName||'거실';
  const unit=state.floors[0]*100+line;
  for(const option of $$('#xi-line option'))option.textContent=`${option.value}라인 · ${state.floors[0]*100+Number(option.value)}호 후보`;
  $('#unit').value=unit;$('#unit-title').textContent=`204동 ${unit}호 후보`;
  $('#viewer-title').textContent=`204동 · ${opening}`;
  for(const [i,key] of ['a','b'].entries()){
    $(`#label-${key}`).textContent=`${state.floors[i]*100+line}호 후보 · ${opening}`;
    $(`#elevation-${key}`).textContent=`눈높이 표고 추정 ${elevations[i].toFixed(1)}m`;
  }
  $('#height-delta').textContent=`높이 차 ${Math.abs(elevations[1]-elevations[0]).toFixed(1)}m`;
  $('#bearing').value=Math.round(state.bearing);$('#bearing-value').textContent=`${Math.round(state.bearing)}°`;
  $('#view-fov').value=state.fov;fovValue.textContent=`${Math.round(state.fov)}°`;
  $('#observer-status').textContent=`지형 표고 + (층−1)×${state.floorHeight}m + 눈높이 ${state.eyeHeight}m · 1층 바닥 표고 미검증`;
},{sceneUrl:'/research/gyeonghuigung-xi/scene.json',prepareData:data=>{applyXiLayoutHypothesis(data);applyXiComplexFacades(data);},correction:false,
  floors:[2,7],horizontalFov:true,fov:50,pitch:0,label:'선택한 창 후보에서 두 층의 전망 비교',
  sourceNote:'호수 배치 판독 + 59A 평면 투영 · 18층 부분 높이 후보 · 준공 치수·발코니 단차 미검증'});

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
  $('#outlook-host').dataset.layoutModel='18f-wing-hypothesis';
  $('#outlook-host').dataset.complexFacades=JSON.stringify(outlook.data.facadeCoverage);
  $('#outlook-loading').hidden=true;
  $('#dataset-stats').textContent=`204동 OSM 원본: 최고 21층·65m. 59A 부분: 18층·${outlook.target.parts[1].height.toFixed(1)}m 환산 후보. 지반 ${outlook.target.base.toFixed(1)}m 추정. 상가층·옹벽·수목 미검증.`;
} catch(e) {
  $('#outlook-loading').textContent=`전망 로딩 실패: ${e.message}`;console.error(e);
}
createIcons({icons});
