import './style.css';
import {createIcons,icons} from 'lucide';
import {OutlookScene} from './outlook.js';
import {createUnitIndex} from './unit-linkage.js';
import {estimateElevation} from './estimated-view.js';
import {localPoint} from './outlook-math.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const params=new URLSearchParams(location.search);
let outlook;
try{
  const response=await fetch('/research/linkage/generated/catalog.json');
  if(!response.ok)throw new Error('동·호 자료를 불러오지 못했습니다.');
  const catalog=await response.json(),index=createUnitIndex(catalog);
  const address=params.get('address'),building=params.get('building'),unit=params.get('unit');
  const selection=index.resolve(address,building,unit);
  if(!selection.estimatedViewReady)throw new Error('이 동·호는 지형 전망 연결 대상에 없습니다. 주소 검색에서 등록된 세대를 선택해 주세요.');
  const {geometry,elevation,estimatedWindow,complex}=selection;
  const available=catalog.units.filter(u=>u.complexId===complex.id&&u.building===building&&u.estimatedViewReady);
  const line=Number(unit)%100,floors=[...new Set(available.filter(u=>Number(u.unit)%100===line).map(u=>u.elevation.floor))].sort((a,b)=>a-b);
  const comparison=floors.find(f=>f>=elevation.floor+5)??floors.at(-1);
  const selectedFloors=[elevation.floor,comparison];
  const searchUrl=`/?${new URLSearchParams({site:'catalog',address:complex.id,building,unit})}`;
  document.body.classList.add('xi-app');
  $('.pilot').textContent='지형 기반 추정';
  document.title=`${complex.name} ${building}동 ${unit}호 · 지형 전망`;
  $('.brand span').textContent='지형·높이 반영 전망';
  $('.search-section h1').textContent=complex.name;
  // This route shows an estimated exterior viewpoint. The established interior
  // route remains the source for plan-based placements when one is available.
  $('#search-form').addEventListener('submit',e=>{
    e.preventDefault();location.href=`/?${new URLSearchParams({site:'catalog',address:$('#address').value,building:$('#building').value,unit:$('#unit').value})}`;
  });
  $('#address').value=complex.address;
  $('#building').replaceChildren(...catalog.buildings.filter(b=>b.complexId===complex.id&&b.geometry).map(b=>new Option(`${b.building}동`,b.building)));
  $('#building').value=building;$('#unit').value=unit;
  $('.examples').replaceChildren();
  const back=document.createElement('a');back.href=searchUrl;back.textContent='이 세대의 평면도·연결 자료';$('.examples').append(back);
  $('#unit-title').textContent=`${building}동 ${unit}호`;$('#selection-kind').textContent='지형 기반 전망';
  $('#type-value').textContent=selection.plan?.displayType??selection.planId??'타입 연결 중';
  const area=selection.officialUnit?.exclusiveArea??selection.plan?.area;
  $('#area-value').textContent=area?`전용 ${area}㎡`:'면적 연결 중';
  $('#match-status').textContent='동·호 높이 적용 · 창 위치 추정';
  $('.unit-section .data-note').textContent='해당 동의 지반에 층고 2.9m와 눈높이 1.5m를 더했습니다. 1층 마감 바닥·층별 차이는 추정값입니다.';
  $('.plan-section').hidden=true;
  $('.source-section').replaceChildren();
  const source=document.createElement('a');source.href=/^https?:/.test(geometry.source)?geometry.source:`/${geometry.source.replaceAll('\\','/')}`;source.target='_blank';source.rel='noreferrer';source.textContent='이 동의 건물 외곽 출처';$('.source-section').append(source);
  $('#viewer-title').textContent=`${building}동 ${unit}호 · 추정 전망`;
  $('#scene-panel').hidden=true;$('#image-panel').hidden=true;$('#outlook-panel').hidden=false;
  $('.workspace').classList.add('show-outlook');$('.tabs').hidden=true;
  $('.outlook-heading strong').textContent=`${building}동 · ${line}호 라인 높이 비교`;
  $('#outlook-type').textContent=selection.plan?.displayType??'';
  $('.estimate-tag').textContent='외벽 시점 추정';
  $('#download-image').hidden=true;
  $('#view-caption').textContent='지형·건물 높이 반영 · 실제 거실 창 위치와 방향은 추가 보정 대상';
  $('.locator-source').hidden=true;
  $('.direction-locator summary span').textContent='건물 외곽에서 계산한 시점';
  $('#locator-map text').textContent=building;
  $('#window-warning').textContent='현재 시점이 건물 내부입니다. 위치 보정값을 확인해 주세요.';
  $('.environment-toolbar a').hidden=true;
  $('.model-review').open=false;$('.direction-locator').open=false;
  $('label[for="view-fov"]').textContent='가로 시야각';$('#view-fov').max=75;$('#view-fov').value=50;
  for(const [i,key] of ['a','b'].entries()){
    $('#floor-'+key).replaceChildren(...floors.map(f=>new Option(`${f}층`,f)));$('#floor-'+key).value=selectedFloors[i];
  }
  const facadeNote=estimatedWindow.method==='source-bearing-exterior-edge-estimate'?'기존 방향 후보를 건물 외곽에 투영':'긴 외벽의 남향 우선 후보를 자동 선택';
  outlook=new OutlookScene($('#outlook-host'),(state,elevations)=>{
    for(const [i,key] of ['a','b'].entries()){
      const e=estimateElevation(geometry,state.floors[i],state);
      $('#label-'+key).textContent=`${state.floors[i]*100+line}호`;
      $('#elevation-'+key).textContent=`바닥 ${e.floorElevation.toFixed(1)}m · 눈높이 ${elevations[i].toFixed(1)}m`;
    }
    $('#height-delta').textContent=`높이 차 ${Math.abs(elevations[1]-elevations[0]).toFixed(1)}m`;
    $('#bearing').value=state.bearing;$('#bearing-value').textContent=`${state.bearing.toFixed(1)}°`;
    $('#view-fov').value=state.fov;
    $('#observer-status').textContent=`지반 ${geometry.base.toFixed(2)}m + 보정 ${state.offset}m + (층−1)×${state.floorHeight}m + 눈높이 ${state.eyeHeight}m`;
  },{sceneUrl:`/${geometry.scene}`,floors:selectedFloors,horizontalFov:true,fov:50,pitch:0,
    locatorAtWindow:true,
    label:`${complex.name} ${building}동 지형·높이 추정 전망`,
    sourceNote:`${/ngii/i.test(elevation.groundSource)?'수치지도 등고선 지형':'Mapzen 고도 지형'} · ${facadeNote}. 동·호별 창 위치·반전은 미검증 추정입니다.`,
    prepareData(data){
      const target=data.buildings.find(b=>b.id===geometry.id&&b.siteSource===geometry.siteSource);
      if(!target)throw new Error('단지와 건물 외곽의 연결이 일치하지 않습니다.');
      Object.assign(target,{base:geometry.base,height:geometry.height,levels:geometry.levels,heightSource:geometry.heightSource});
      if(target.parts)for(const part of target.parts)Object.assign(part,{base:geometry.base,...(part.inheritBuildingHeight?{height:geometry.height,levels:geometry.levels}:{})});
      data.targetBuildingId=target.id;data.targetLabel=`${building}동`;
      data.window={...estimatedWindow};data.previousWindow={...estimatedWindow};
    }});
  for(const [id,key] of [['eye-height','eyeHeight'],['floor-height','floorHeight'],['ground-offset','offset'],['window-east','east'],['window-north','north'],['bearing','bearing'],['view-fov','fov']]){
    $('#'+id).addEventListener('input',e=>{if(e.target.value&&e.target.validity.valid){outlook.state[key]=Number(e.target.value);outlook.update();}});
  }
  for(const [i,key] of ['a','b'].entries())$('#floor-'+key).addEventListener('change',e=>{outlook.state.floors[i]=Number(e.target.value);outlook.update();});
  $('#outlook-reset').addEventListener('click',()=>{
    outlook.reset();for(const [id,value] of [['eye-height',1.5],['floor-height',2.9],['ground-offset',0],['window-east',0],['window-north',0]])$('#'+id).value=value;
  });
  for(const [id,key] of [['estimated-buildings','estimated'],['roads-visible','streets']])$('#'+id).addEventListener('change',e=>{if(outlook[key])outlook[key].visible=e.target.checked;outlook.render();});
  $('#facades-visible').addEventListener('change',e=>{outlook.facadeMeshes?.forEach(m=>m.visible=e.target.checked);outlook.render();});
  $('#landmarks-visible').addEventListener('change',e=>{outlook.landmarks?.forEach(l=>l.group.visible=e.target.checked);outlook.render();});
  $('#landmark-select').addEventListener('change',e=>{outlook.selectedLandmark=outlook.landmarks?.find(l=>l.id===e.target.value);outlook.focusLandmark();});
  $('#landmark-focus').addEventListener('click',()=>outlook.focusLandmark());
  await outlook.load();
  const point=localPoint(estimatedWindow.lon,estimatedWindow.lat,geometry.center);
  $('#locator-map').setAttribute('viewBox',`${point[0]-75} ${point[1]-55} 150 110`);
  $('#outlook-host').dataset.selectedBuilding=building;$('#outlook-host').dataset.selectedUnit=unit;$('#outlook-host').dataset.complex=complex.id;
  $('#outlook-host').dataset.groundElevation=geometry.base;$('#outlook-host').dataset.estimated='true';
  $('#outlook-loading').hidden=true;
  $('#dataset-stats').textContent=`${building}동 지반 ${geometry.base.toFixed(2)}m · ${geometry.levels}층 · 건물 높이 ${geometry.height.toFixed(2)}m (${geometry.heightSource==='official-building-register'?'건축물대장':geometry.heightSource==='official-levels-times-assumed-2.9'?'대장 층수 × 2.9m 추정':'지도 자료·층수 환산'}). 해당 동 ${available.length}세대에 적용.`;
}catch(e){
  $('#outlook-panel').hidden=false;$('#scene-panel').hidden=true;
  $('#outlook-loading').hidden=false;$('#outlook-loading').textContent=e.message;
  $('#match-status').textContent=e.message;console.error(e);
}
createIcons({icons});
