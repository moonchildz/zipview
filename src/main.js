import './style.css';
import './plan-openings.css';
import { createIcons, icons } from 'lucide';
import { complex, plans, lookup as legacyLookup, imagePath as legacyImagePath } from './data.js';
import {resolveHomeSelection} from './home-selection.js';
import {modelForPlan} from './plan-models.js';
import { ApartmentScene } from './scene.js';
import { OutlookScene } from './outlook.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const xiLink = document.createElement('a');
xiLink.href = '/?site=xi'; xiLink.textContent = '경희궁자이 204동 201호';
document.querySelector('.examples').append(xiLink);
let selectedPlan = {...plans.find(p => p.id === '59D'),complexId:complex.id,file:legacyImagePath('59D').slice(1)};
let selectedModel;
let selection = {...legacyLookup('북아현로1길 50', '206', '504'),comparison:true};
let view = 'outlook';
let outlook;
let scene;
let graphicsError = false;
let catalog;
try{const r=await fetch('/research/linkage/generated/catalog.json');if(r.ok)catalog=await r.json();}
catch(error){console.error('세대 연결 인덱스 로딩 실패',error);}
const lookup=(address,building,unit)=>catalog?resolveHomeSelection(catalog,address,building,unit):legacyLookup(address,building,unit);
if(catalog){selection=lookup('북아현로1길 50','206','504');if(!selection.error)selectedPlan=displayPlan(selection.plan);}
function imagePath(id){return id===selectedPlan.id&&selectedPlan.imageFile?`/${selectedPlan.imageFile}`:legacyImagePath(id);}
function displayPlan(plan){
  const type=plan.displayType??plan.id;
  return {...plan,id:type,imageFile:plan.file??plan.imageFile,model:!!modelForPlan(plan),kind:plan.variant==='basic'?'기본형':plan.variant==='extended'?'확장형':plan.kind??'원본 평면도'};
}
const openingToolbar=document.createElement('div');
openingToolbar.id='opening-toolbar';openingToolbar.className='opening-toolbar';
openingToolbar.innerHTML='<label for="opening-select"><i data-lucide="app-window"></i>창문</label><select id="opening-select" aria-label="창문 선택"></select><span id="opening-status" role="status"></span><a id="calibration-evidence" target="_blank" rel="noopener" hidden>치수 근거 도면</a>';
$('#scene-panel').before(openingToolbar);
const stage=document.createElement('div');stage.className='plan-image-stage';
$('#image-panel').append(stage);stage.append($('#image-link'));
const svgNS='http://www.w3.org/2000/svg',openingOverlay=document.createElementNS(svgNS,'svg');
openingOverlay.id='plan-openings';openingOverlay.setAttribute('aria-label','원본 도면의 창문 위치');stage.append(openingOverlay);
const croppedReference=document.createElementNS(svgNS,'svg'),croppedImage=document.createElementNS(svgNS,'image');
croppedReference.id='cropped-reference';croppedReference.style.cssText='width:100%;height:100%;display:none';croppedReference.append(croppedImage);$('#image-link').append(croppedReference);
try { scene = new ApartmentScene($('#canvas-host'),{onWindow:selectWindow}); }
catch (error) { graphicsError = true; console.error(error); }
function selectWindow(id){
  if(!scene||!selectedModel||!id)return;
  try{
    const pose=scene.enterWindow(id);showView('3d');
    $('#opening-select').value=id;$('#cut-walls').checked=false;
    $$('#rooms button').forEach(el=>el.classList.remove('active'));
    const scale=pose.scaleSource==='display-normalization-only'?'길이 축척 미확인':'길이 축척 추정';
    $('#opening-status').textContent=`눈높이 ${pose.eyeHeight.toFixed(1)}m · 창 안쪽 ${pose.insetMeters.toFixed(2)}m · ${scale} · 외부 전망 미연결`;
  }catch(error){$('#opening-status').textContent=`창문 시점을 열 수 없습니다: ${error.message}`;}
}
$('#opening-select').addEventListener('change',e=>selectWindow(e.target.value));
function updateOpenings(){
  $('#opening-select').replaceChildren(new Option('창문 선택',''));
  openingOverlay.replaceChildren();
  for(const [i,w] of (selectedModel?.windows??[]).entries()){
    $('#opening-select').add(new Option(`${i+1}. ${w.name}`,w.id));
    const g=document.createElementNS(svgNS,'g');g.setAttribute('role','button');g.setAttribute('tabindex','0');g.setAttribute('aria-label',w.name);g.dataset.window=w.id;
    const line=document.createElementNS(svgNS,'line');
    for(const [key,value] of Object.entries({x1:w.a[0],y1:w.a[1],x2:w.b[0],y2:w.b[1]}))line.setAttribute(key,value);
    const mid=w.a.map((v,j)=>(v+w.b[j])/2),circle=document.createElementNS(svgNS,'circle'),text=document.createElementNS(svgNS,'text');
    circle.setAttribute('cx',mid[0]);circle.setAttribute('cy',mid[1]);circle.setAttribute('r','9');
    text.setAttribute('x',mid[0]);text.setAttribute('y',mid[1]);text.textContent=String(i+1);
    const title=document.createElementNS(svgNS,'title');title.textContent=w.name;
    g.append(title,line,circle,text);g.addEventListener('click',()=>selectWindow(w.id));
    g.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();selectWindow(w.id);}});openingOverlay.append(g);
  }
  $('#opening-status').textContent=selectedModel?'원본 이미지 판독 · 창 높이·실제 방위 미확인':'';
  const calibration=selectedModel?.calibration;
  $('#calibration-evidence').hidden=!calibration;
  if(calibration){$('#calibration-evidence').href=`/${calibration.file}`;$('#opening-status').textContent='도면 치수로 크기 보정 · 창 높이·실제 방위 미확인';}
}
function updateReferenceCrop(){
  const size=selectedModel?.source?.imageSize??[$('#reference-image').naturalWidth,$('#reference-image').naturalHeight];
  const crop=view==='plan'?selectedPlan.crop:null;
  const box=crop?`${crop.left-30} ${crop.top-30} ${crop.right-crop.left+60} ${crop.bottom-crop.top+60}`:`0 0 ${size[0]} ${size[1]}`;
  openingOverlay.setAttribute('viewBox',box);
  croppedReference.style.display=crop?'block':'none';$('#reference-image').style.display=crop?'none':'block';
  if(crop){croppedReference.setAttribute('viewBox',box);croppedReference.setAttribute('aria-label',`${selectedPlan.id} 선택 평면`);croppedImage.setAttribute('href',$('#reference-image').src);croppedImage.setAttribute('width',size[0]);croppedImage.setAttribute('height',size[1]);}
}
$('#reference-image').addEventListener('load',updateReferenceCrop);

for (const building of complex.buildings) $('#building').add(new Option(`${building}동`, building));
$('#building').value = '206';

for (const id of ['floor-a', 'floor-b']) {
  for (let floor = 1; floor <= 17; floor++) $(`#${id}`).add(new Option(`${floor}층`, floor));
}
$('#floor-a').value = '5';
$('#floor-b').value = '10';
async function startOutlook() {
  if (outlook) { outlook.render(); return; }
  try {
    outlook = new OutlookScene($('#outlook-host'), (state, elevations) => {
      ['a', 'b'].forEach((key, i) => {
        $(`#label-${key}`).textContent = `206동 ${state.floors[i]}04호`;
        $(`#elevation-${key}`).textContent = `${state.floors[i]}층 · 추정 표고 ${elevations[i].toFixed(1)}m`;
      });
      $('#height-delta').textContent = `높이 차 ${Math.abs(elevations[1] - elevations[0]).toFixed(1)}m`;
      $('#bearing').value = Math.round(state.bearing);
      $('#bearing-value').textContent = `${Math.round(state.bearing)}°`;
      $('#view-fov').value = state.fov;
      $('#observer-status').textContent = `바닥 기준 눈높이 ${state.eyeHeight.toFixed(2)}m · 외벽 밖 0.8m 기준점 + 동 ${state.east.toFixed(1)}m / 북 ${state.north.toFixed(1)}m 보정 · 실내 미연결`;
    });
    await outlook.load();
    $('#outlook-loading').hidden = true;
    $('#dataset-stats').textContent = `주변 건물 ${outlook.data.buildings.length.toLocaleString()}개 중 높이 태그 ${outlook.data.buildings.filter(b => b.heightSource === 'osm-height').length}개. 나머지는 환산/가정. 주요 랜드마크 ${outlook.data.landmarks.length}개 · 지형 32km. 원거리 일반 건물 누락으로 실제 가림과 다를 수 있음.`;
  } catch (error) {
    $('#outlook-loading').textContent = `전망을 시작할 수 없습니다: ${error.message}`;
  }
}
for (const [id, key] of [['eye-height', 'eyeHeight'], ['floor-height', 'floorHeight'], ['ground-offset', 'offset'], ['window-east', 'east'], ['window-north', 'north'], ['bearing', 'bearing'], ['view-fov', 'fov']]) {
  $(`#${id}`).addEventListener('input', e => {
    if (!outlook || !e.target.value || !e.target.validity.valid) return;
    outlook.state[key] = Number(e.target.value);
    outlook.update();
  });
}
['a', 'b'].forEach((key, i) => $(`#floor-${key}`).addEventListener('change', e => {
  if (outlook) { outlook.state.floors[i] = Number(e.target.value); outlook.update(); }
}));
$('#estimated-buildings').addEventListener('change', e => {
  if (outlook?.estimated) { outlook.estimated.visible = e.target.checked; outlook.render(); }
});
$('#landmark-select').addEventListener('change', e => {
  if (!outlook?.landmarks) return;
  outlook.selectedLandmark = outlook.landmarks.find(l => l.id === e.target.value);
  outlook.focusLandmark();
});
$('#landmark-focus').addEventListener('click', () => outlook?.focusLandmark());
$('#landmarks-visible').addEventListener('change', e => {
  if (!outlook?.landmarks) return;
  outlook.landmarks.forEach(l => { l.group.visible = e.target.checked; });
  outlook.render();
});
$('#roads-visible').addEventListener('change', e => {
  if (!outlook?.streets) return;
  outlook.streets.visible = e.target.checked;
  outlook.render();
});
$('#facades-visible').addEventListener('change', e => {
  if (!outlook?.facadeMeshes) return;
  outlook.facadeMeshes.forEach(mesh => { mesh.visible = e.target.checked; });
  outlook.render();
});
$('#outlook-reset').addEventListener('click', () => {
  if (!outlook) return;
  outlook.reset();
  for (const [id, value] of [['eye-height', 1.5], ['floor-height', 2.9], ['ground-offset', 0], ['window-east', 0], ['window-north', 0]]) $(`#${id}`).value = value;
  $('#estimated-buildings').checked = true;
  if (outlook.estimated) outlook.estimated.visible = true;
  outlook.update();
});
$('#open-comparison').addEventListener('click', () => {
  $('#building').value = '206'; $('#unit').value = '504'; $('#address').value = '북아현로1길 50'; search();
});

function updateRooms() {
  $('#rooms').replaceChildren();
  for (const [index, room] of (selectedModel?.rooms ?? []).entries()) {
    const button = document.createElement('button');
    button.textContent = room.name;
    button.type = 'button';
    button.title = `${room.name} 내부 시점`;
    button.addEventListener('click', () => {
      if (!scene) return;
      scene.enterRoom(index);
      $('#opening-select').value='';
      $('#opening-status').textContent='원본 이미지 판독 · 창 높이·실제 방위 미확인';
      $('#cut-walls').checked = false;
      $$('#rooms button').forEach(el => el.classList.toggle('active', el === button));
    });
    $('#rooms').append(button);
  }
}

function showView(next) {
  if(next==='outlook'&&selection?.estimatedPreview&&!selection.comparison&&!selection.scenario){location.href=selection.estimatedPreview;return;}
  view = next;
  $$('.tabs button').forEach(b => { b.setAttribute('aria-selected', String(b.dataset.view === view)); b.tabIndex = b.dataset.view === view ? 0 : -1; });
  $('#scene-panel').hidden = view !== '3d';
  $('#image-panel').hidden = !['plan', 'site'].includes(view);
  $('#outlook-panel').hidden = view !== 'outlook';
  const comparable = !!(selection?.comparison||selection?.scenario);
  $('#comparison-content').hidden = !comparable;
  $('#outlook-unavailable').hidden = comparable;
  document.querySelector('.workspace').classList.toggle('show-outlook', view === 'outlook');
  if (view === 'outlook' && comparable) startOutlook();
  $('#scene-error').hidden = !!selectedModel && !graphicsError;
  $('#canvas-host').hidden = !selectedModel || graphicsError;
  $$('.scene-tools, .scene-bottom, .scene-label').forEach(el => { el.hidden = !selectedModel || graphicsError; });
  openingToolbar.hidden=!selectedModel||!['3d','plan'].includes(view);
  openingOverlay.hidden=view!=='plan'||!selectedModel;
  if (graphicsError) {
    $('#scene-error h3').textContent = '3D 화면을 시작할 수 없습니다';
    $('#scene-error p').textContent = 'WebGL 지원 브라우저에서 열거나 평면도를 확인해 주세요.';
  }
  if (view === '3d' && scene) { scene.resize(); }
  if (view === 'plan' || view === 'site') {
    const src = imagePath(view === 'site' ? 'site-and-units' : selectedPlan.id);
    $('#reference-image').src = src;
    $('#reference-image').alt = view === 'site' ? '신촌푸르지오 분양 당시 단지 배치도 및 동호수 배치표' : `${selectedPlan.id} ${selectedPlan.kind} 원본 평면도`;
    $('#image-link').href = src;
    updateReferenceCrop();
  }
  const captions = {
    '3d': '벽체·창호 위치는 이미지 판독 초안, 길이·높이는 추정치',
    plan: '분양용 이미지 · 현 세대의 실제 시공 상태는 미확인',
    site: '2015년 분양 자료 · 1·2단지 통합 배치도',
    outlook: '206동 4호 라인 시나리오 · 수목·창틀·실제 외벽 질감 미반영',
  };
  $('#view-caption').textContent = view==='3d'&&selectedModel?.scaleSource==='display-normalization-only'?'원본 이미지 판독 · 표시용 축척 · 실측 길이·높이·전망 미확인':captions[view];
}

function renderSelection() {
  selectedModel=modelForPlan(selectedPlan,selection??{});
  $('#unit-title').textContent = selection ? `${selection.building}동 ${selection.unit}호` : `${selectedPlan.id} 타입 열람`;
  $('#selection-kind').textContent = selection?.scenario ? '비교 시나리오' : selection?.sourceStatus?.startsWith('provider-') ? '공급자 호별 자료' : selection ? '분양표 기준' : '세대 연결 없음';
  $('#match-status').textContent = selection?.scenario ? '4호 라인 59D 추정 · 세대별 확인 전' : selection ? `호별 타입 · ${selectedPlan.kind} 도면 연결` : '타입 도면만 선택됨';
  $('#type-value').textContent = selectedPlan.id;
  $('#area-value').textContent = `${selectedPlan.area.toFixed(4)} ㎡`;
  $('#viewer-title').textContent = `${selectedPlan.id} · ${selectedPlan.kind}`;
  $('#outlook-type').textContent = selection ? `${selection.building}동 ${selection.unit}호 · ${selectedPlan.id}` : `${selectedPlan.id} · 세대 미지정`;
  $('#download-image').href = imagePath(selectedPlan.id);
  $$('.plan-button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === selectedPlan.id)));
  $('#cut-walls').checked = true;
  if (scene) { scene.build(selectedModel, true); scene.resize(); scene.reset(); }
  updateOpenings();
  updateRooms();
  showView(view);
}

const planChoices=plans.map(p=>displayPlan({...p,complexId:complex.id,file:legacyImagePath(p.id).slice(1)}));
for(const plan of catalog?.plans??[]){
  if(plan.complexId!==complex.id||!plan.available||!plan.trace)continue;
  const existing=planChoices.findIndex(p=>p.id===plan.displayType);
  if(existing>=0)planChoices[existing]=displayPlan(plan);else planChoices.push(displayPlan(plan));
}
$('.plan-section .section-heading>span').textContent=`${planChoices.length}종`;
for (const plan of planChoices) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plan-button';
  button.dataset.type = plan.id;
  button.innerHTML = `<strong>${plan.id}</strong><span>${plan.model ? '3D' : '도면'}</span>`;
  button.addEventListener('click', () => {
    selectedPlan = plan;
    selection = null;
    $('#lookup-error').hidden = true;
    view = plan.model ? '3d' : 'plan';
    renderSelection();
  });
  $('#plan-list').append(button);
}

function search() {
  const result = lookup($('#address').value, $('#building').value, $('#unit').value);
  const error = $('#lookup-error');
  error.hidden = !result.error;
  if (result.error) {
    error.textContent = result.error;
    selection = null;
    renderSelection();
    return;
  }
  selection = result;
  selectedPlan=displayPlan(result.plan);
  if ((selection.comparison||selection.scenario) && outlook) {
    outlook.state.floors = [5, 10];
    $('#floor-a').value = '5';
    $('#floor-b').value = '10';
    outlook.update();
  }
  view = selection.comparison||selection.scenario ? 'outlook' : selectedPlan.model ? '3d' : 'plan';
  renderSelection();
}
$('#search-form').addEventListener('submit', e => {
  e.preventDefault();location.href=`/?${new URLSearchParams({site:'catalog',address:$('#address').value,building:$('#building').value,unit:$('#unit').value})}`;
});
const requestedUnit = new URLSearchParams(location.search);
if (requestedUnit.has('building') && requestedUnit.has('unit')) {
  $('#address').value = complex.address;
  $('#building').value = requestedUnit.get('building');
  $('#unit').value = requestedUnit.get('unit');
  search();
}
$$('[data-example]').forEach(button => button.addEventListener('click', () => {
  const [building, unit] = button.dataset.example.split(',');
  $('#address').value = '북아현로1길 50';
  $('#building').value = building;
  $('#unit').value = unit;
  search();
}));
$$('.tabs button').forEach(button => {
  button.addEventListener('click', () => showView(button.dataset.view));
  button.addEventListener('keydown', e => {
    const tabs = $$('.tabs button');
    const index = tabs.indexOf(button);
    const next = e.key === 'ArrowRight' ? (index + 1) % tabs.length : e.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
    if (next !== null) { e.preventDefault(); tabs[next].focus(); showView(tabs[next].dataset.view); }
  });
});
$('#open-plan').addEventListener('click', () => showView('plan'));
$('#reset-camera').addEventListener('click', () => {
  if (!scene) return;
  scene.build(selectedModel, $('#cut-walls').checked);
  scene.reset();
  $('#opening-select').value='';$('#opening-status').textContent='원본 이미지 판독 · 창 높이·실제 방위 미확인';
  $$('#rooms button').forEach(b => b.classList.remove('active'));
});
$('#cut-walls').addEventListener('change', e => {
  if (!scene) return;
  const wasInterior = scene.interior;
  scene.build(selectedModel, e.target.checked);
  if (wasInterior) { scene.reset(); $$('#rooms button').forEach(b => b.classList.remove('active')); }
  $('#opening-select').value='';
});
$('#zoom-in').addEventListener('click', () => scene?.zoom(0.85));
$('#zoom-out').addEventListener('click', () => scene?.zoom(1.15));
$('#capture').addEventListener('click', () => {
  if (!scene) return;
  const link = document.createElement('a');
  link.download = `${selectedPlan.id}-approximate-model.png`;
  link.href = scene.capture();
  link.click();
});
createIcons({ icons });
renderSelection();
