import './style.css';
import {createIcons,icons} from 'lucide';
import {OutlookScene} from './outlook.js';
import {xiWindowCandidates,xiRightEndWindow} from './xi-window.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
document.title='경희궁자이 204동 201호 | 집과 전망';
$('.brand span').textContent='경희궁자이';
$('.search-section h1').textContent='경희궁자이 2단지';
$('#address').value='송월길 99'; $('#address').readOnly=true;
$('#building').add(new Option('204동','204')); $('#unit').value='201'; $('#unit').readOnly=true;
$('#search-form').addEventListener('submit',e=>{e.preventDefault();$('#outlook-panel').hidden=false;});
$('.examples').replaceChildren();
const previous=document.createElement('a');previous.href='/';previous.textContent='신촌푸르지오 결과로 이동';$('.examples').append(previous);
$('#unit-title').textContent='204동 201호';
$('#selection-kind').textContent='사용자 지정 대상';
$('#type-value').textContent='미확인';$('#area-value').textContent='미확인';
$('#match-status').textContent='204동 확인 · 201호 평면/창 연결 미확인';
$('.unit-section .data-note').textContent='2층 기준 외벽 후보 시점입니다. 해당 세대의 실제 전망으로 검증되지 않았습니다.';
$('.plan-section').hidden=true;
$('.source-section').replaceChildren();
const source=document.createElement('a');source.href='/research/gyeonghuigung-xi/README.md';source.target='_blank';source.textContent='자료와 계산 근거';$('.source-section').append(source);
$('#viewer-title').textContent='204동 · 2층 시점 후보';
$('#scene-panel').hidden=true;$('#image-panel').hidden=true;$('#outlook-panel').hidden=false;
$('.workspace').classList.add('show-outlook');
$$('.tabs button').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.view==='outlook'));if(b.dataset.view!=='outlook'){b.disabled=true;b.title='201호 평면 및 동호수 연결 자료 미확인';}});
$('.outlook-heading strong').textContent='204동 · 외벽 후보에서 층별 비교';
$('#outlook-type').textContent='201호 요청 · 2층과 7층 비교 시나리오';
$('.estimate-tag').textContent='창 위치 미확인';
$('#download-image').hidden=true;
$('#view-caption').textContent='204동 외벽 후보 · 201호의 실제 창 위치·실내 구조 미연결';
$('.locator-source').hidden=true;
$('.direction-locator summary span').textContent='외벽 형상에서 자동 계산';
$('#locator-map text').textContent='204';
$('#window-warning').textContent='시점이 204동 건물 안에 있습니다. 외벽 후보를 다시 확인해 주세요.';
$('.outlook-options a')?.remove();
for(const a of $$('a'))if(a.href.includes('kbland'))a.remove();
for(const [id,floor] of [['floor-a',2],['floor-b',7]]){for(let i=1;i<=21;i++)$('#'+id).add(new Option(`${i}층`,i));$('#'+id).value=floor;}
const candidateLabel=document.createElement('label');candidateLabel.textContent='계산된 외벽 후보 ';
const candidateSelect=document.createElement('select');candidateSelect.id='xi-facade';candidateLabel.append(candidateSelect);
candidateLabel.style.cssText='display:flex;gap:12px;align-items:center;padding:12px 20px;flex-wrap:wrap';
$('#terrain-source').after(candidateLabel);
const directionNote=document.createElement('p');directionNote.id='xi-direction-note';
directionNote.style.cssText='padding:0 20px;line-height:1.6';
directionNote.innerHTML='방향 재검토: 기본 외벽은 <strong>남동향 약 139°</strong>입니다(북쪽 0°, 시계 방향). '
  +'<a href="https://town.aipartner.com/realtor/20840" target="_blank" rel="noopener noreferrer">204동 59A 남동향·84E 남서향 매물</a>과 대조했습니다. '
  +'1·2호가 정원 쪽이라는 <a href="https://www.geummaecatch.com/complex/109379/review" target="_blank" rel="noopener noreferrer">간접 자료</a>를 함께 보면 201호도 남동향으로 추정됩니다. '
  +'동호 배치 원본은 확보하지 못해 201호의 정확한 창 위치는 아직 미확정입니다.';
candidateLabel.after(directionNote);
const windowLabel=document.createElement('label');windowLabel.textContent='거실 창 위치 추정 ';
windowLabel.style.cssText=candidateLabel.style.cssText;
const windowSelect=document.createElement('select');windowSelect.id='xi-window';
windowSelect.add(new Option('지도 오른쪽 끝에서 1m · 현재 위치','right-end'));
windowSelect.add(new Option('남서쪽 세대 후보','southwest'));
windowSelect.add(new Option('북동쪽 세대 후보','northeast'));
windowSelect.add(new Option('이전 외벽 중점','midpoint'));
windowLabel.append(windowSelect);directionNote.after(windowLabel);
const windowNote=document.createElement('p');windowNote.id='xi-window-note';windowNote.style.cssText=directionNote.style.cssText;
windowNote.textContent='거실이 건물 끝에 있다는 사용자 설명에 따라, 북쪽이 위인 지도에서 남동향 외벽의 오른쪽 끝에서 1m 안쪽으로 옮겼습니다. 창 바로 앞 시점이며 정확한 창 중심을 측량한 위치는 아닙니다. 이전 세대 후보와 중점도 비교할 수 있습니다.';
windowLabel.after(windowNote);
$('label[for="view-fov"]').textContent='가로 시야각';$('#view-fov').max=75;
const fovValue=document.createElement('output');fovValue.id='xi-fov-value';$('#view-fov').after(fovValue);
const viewNote=document.createElement('p');viewNote.style.cssText=directionNote.style.cssText;
viewNote.textContent='가로 50° · 수평 시선이 기본입니다. 화면 가장자리의 광각 늘어짐을 줄였습니다. 실제 눈에 보이는 크기는 화면 크기와 시청 거리에 따라 달라집니다.';
windowNote.after(viewNote);
const positionDetails=document.createElement('details');positionDetails.className='calibration';
const positionSummary=document.createElement('summary');positionSummary.textContent='거실 창 위치 비교 · 지도 오른쪽 끝';
positionDetails.append(positionSummary,windowLabel,windowNote,candidateLabel,directionNote,viewNote);
$('.bearing-row').after(positionDetails);
const outlook=new OutlookScene($('#outlook-host'),(state,elevations)=>{
  for(const [i,key] of ['a','b'].entries()){
    $(`#label-${key}`).textContent=`204동 ${state.floors[i]}층 · 외벽 후보`;
    $(`#elevation-${key}`).textContent=`추정 눈높이 표고 ${elevations[i].toFixed(1)}m`;
  }
  $('#height-delta').textContent=`높이 차 ${Math.abs(elevations[1]-elevations[0]).toFixed(1)}m`;
  $('#bearing').value=Math.round(state.bearing);$('#bearing-value').textContent=`${Math.round(state.bearing)}°`;
  $('#view-fov').value=state.fov;
  fovValue.textContent=`${Math.round(state.fov)}°`;
  $('#observer-status').textContent=`204동 지형 표고 + (층−1)×${state.floorHeight}m + 눈높이 ${state.eyeHeight}m · 1층 바닥 표고 미검증`;
},{sceneUrl:'/research/gyeonghuigung-xi/scene.json',correction:false,floors:[2,7],horizontalFov:true,fov:50,pitch:0,label:'경희궁자이 204동 2층과 7층 외벽 후보 전망',sourceNote:'OSM 건물 + 기존 지형 추정 · 북아현동 수치지도 범위 밖 · 201호 창 위치/1층 표고 미확인'});
for(const [id,key] of [['eye-height','eyeHeight'],['floor-height','floorHeight'],['ground-offset','offset'],['window-east','east'],['window-north','north'],['bearing','bearing'],['view-fov','fov']]){
  $('#'+id).addEventListener('input',e=>{if(e.target.value&&e.target.validity.valid){outlook.state[key]=Number(e.target.value);outlook.update();}});
}
['a','b'].forEach((key,i)=>$('#floor-'+key).addEventListener('change',e=>{outlook.state.floors[i]=+e.target.value;outlook.update();}));
$('#outlook-reset').addEventListener('click',()=>{outlook.reset();for(const [id,value] of [['eye-height',1.5],['floor-height',2.9],['ground-offset',0],['window-east',0],['window-north',0]])$('#'+id).value=value;});
$('#estimated-buildings').addEventListener('change',e=>{if(outlook.estimated)outlook.estimated.visible=e.target.checked;outlook.render();});
$('#roads-visible').addEventListener('change',e=>{outlook.streets.visible=e.target.checked;outlook.render();});
$('#facades-visible').addEventListener('change',e=>{outlook.facadeMeshes.forEach(m=>m.visible=e.target.checked);outlook.render();});
$('#landmarks-visible').addEventListener('change',e=>{outlook.landmarks.forEach(l=>l.group.visible=e.target.checked);outlook.render();});
$('#landmark-select').addEventListener('change',e=>{outlook.selectedLandmark=outlook.landmarks.find(l=>l.id===e.target.value);outlook.focusLandmark();});
$('#landmark-focus').addEventListener('click',()=>outlook.focusLandmark());
try{
  await outlook.load();$('#outlook-loading').hidden=true;
  $('#outlook-host').dataset.site='xi';
  $('#dataset-stats').textContent=`204동: OSM 21층·65m, 지반 추정 ${outlook.target.base.toFixed(1)}m. 건물 ${outlook.data.buildings.length}개. 수목·단지 옹벽·실제 1층 단차 미반영.`;
  for(const [i,f] of outlook.data.facadeCandidates.entries())candidateSelect.add(new Option(`${i===0?'남동향 추정 · ':''}${Math.round(f.bearing)}° · 외벽 ${f.edge+1}`,String(i)));
  const defaultFacade=outlook.data.facadeCandidates[0];
  const windows=xiWindowCandidates(outlook.target,defaultFacade,outlook.data.center);
  windows.push(xiRightEndWindow(outlook.target,defaultFacade,outlook.data.center));
  const setWindow=()=>{
    const f=windowSelect.value==='midpoint'?defaultFacade:windows.find(w=>w.id===windowSelect.value);
    Object.assign(outlook.data.window,{lon:f.lon,lat:f.lat,bearing:f.bearing});outlook.reset();
    $('#outlook-host').dataset.windowCandidate=windowSelect.value;
  };
  windowSelect.addEventListener('change',setWindow);
  setWindow();
  candidateSelect.addEventListener('change',()=>{
    windowSelect.disabled=candidateSelect.value!=='0';
    if(candidateSelect.value==='0'){setWindow();return;}
    $('#outlook-host').dataset.windowCandidate='other-facade';
    const f=outlook.data.facadeCandidates[+candidateSelect.value];Object.assign(outlook.data.window,{lon:f.lon,lat:f.lat,bearing:f.bearing});outlook.reset();
  });
}catch(e){$('#outlook-loading').textContent=`전망 로딩 실패: ${e.message}`;console.error(e);}
createIcons({icons});
