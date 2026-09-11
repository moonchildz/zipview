import {XI_OPENINGS,xiOpeningCandidates,xiUnitPolygon} from './xi-unit-layout.js';
import {getXiPlan} from './xi-plans.js';
import './xi-window-picker.css';
import {mountXiWindowFacade} from './xi-window-facade.js';
import {xiPlanOrientation,transformPlanPoint} from './xi-plan-orientation.js';
import {xiLineOrientations,xiOrientationDecision,XI_PLAN_ENTRANCE} from './xi-orientation-evidence.js';

const ns='http://www.w3.org/2000/svg';
const $=s=>document.querySelector(s);
const svgNode=(tag,attributes)=>{
  const el=document.createElementNS(ns,tag);
  for(const [key,value] of Object.entries(attributes)) el.setAttribute(key,value);
  return el;
};

export function mountXiWindowPicker(outlook) {
  const plan=getXiPlan(outlook.target),crop=plan.crop;
  const stage=document.createElement('div');stage.className='xi-window-stage';
  const picker=document.createElement('section');picker.className='xi-window-picker';
  picker.setAttribute('aria-label','세대별 창문 선택');
  picker.innerHTML=`<div class="xi-picker-heading"><strong>창문 선택</strong><span>59A · 연결 추정</span></div>
    <div class="xi-picker-controls"><label>라인<select id="xi-line"><option value="1">1라인 · 201호 후보</option><option value="2">2라인 · 202호 후보</option></select></label>
    <button id="xi-mirror" class="icon-button" type="button" aria-label="지도 연결 좌우 반전" aria-pressed="false" title="지도 연결 좌우 반전"><i data-lucide="flip-horizontal-2"></i></button></div>
    <div class="xi-plan-surface"><svg id="xi-opening-plan" viewBox="0 0 800 800" aria-label="북쪽이 위인 59A 확장형 참고 평면과 외부 창 후보">
      <defs><clipPath id="xi-plan-crop"><rect x="850" y="90" width="560" height="545"/></clipPath></defs>
      <g id="xi-plan-image-transform"><g clip-path="url(#xi-plan-crop)"><image href="${plan.image}" width="1440" height="634"/></g></g>
      <g class="xi-compass" aria-label="위 북쪽, 오른쪽 동쪽, 아래 남쪽, 왼쪽 서쪽"><text x="400" y="32">N</text><text x="778" y="408">E</text><text x="400" y="790">S</text><text x="22" y="408">W</text></g>
      <path id="xi-plan-sight" fill="none" stroke="#bd652b" stroke-width="5" pointer-events="none"/>
      <g id="xi-plan-entrance" pointer-events="none"><rect x="-9" y="-9" width="18" height="18" fill="#356a91" stroke="white" stroke-width="2"/><text x="15" y="7" font-size="22" fill="#245678">현관</text></g>
      <g id="xi-plan-openings"></g></svg><svg id="xi-unit-map" viewBox="-29 -28 60 59" aria-label="북쪽이 위인 204동 라인 위치 후보" hidden></svg></div>
    <div id="xi-opening-list" class="xi-opening-list" role="group" aria-label="외부 창 후보"></div>
    <div class="xi-window-facts" aria-live="polite"><strong id="xi-active-window"></strong><span id="xi-window-direction"></span><span id="xi-window-size"></span></div>
    <span class="xi-accuracy">호수 배치 판독 · 창 좌표 추정</span><span id="xi-orientation-status" class="xi-orientation-status"></span>
    <details class="xi-evidence"><summary>배치 근거와 오차</summary><p id="xi-orientation-basis"></p><p>현관·공용 코어·호수 배치는 자료를 수동 판독한 좌표입니다. 자동 이미지 인식이나 준공 검증 결과는 아닙니다. 창 5곳은 59A 참고 평면에서 읽어 OSM 외벽에 투영했습니다. 발코니 단차·201호 준공 평면·1층 바닥 표고는 미확인입니다. 실외기실·환기구는 포함하지 않았습니다.</p>
      <p>204·205동 1·2라인 외관 창 폭은 도면 하단 3510+3800+3215mm 치수와 이미지의 창 구간을 비례 환산했습니다. 창 높이 1.8m·창턱 0.6m·창틀 분할은 추정입니다. 층별 반복과 발코니 단차도 미검증입니다.</p>
      <p>단지 14개 동에 입면 표현 적용. 위 도면 연결 부분 이외에는 조감도 참고 추정이며, 타입별 창 위치·치수는 미확보입니다. 주민센터 등 비주거 건물은 아직 적용 전입니다.</p>
      <p>18층 부분 높이는 기존 65m를 층수 비율로 환산한 후보이며 실측값이 아닙니다.</p>
      <a href="/research/gyeonghuigung-xi/unit-layout-research.md" target="_blank" rel="noreferrer">자료 수집 기록</a></details>`;
  $('#outlook-host').before(stage);stage.append(picker,$('#outlook-host'));
  const orientations=xiLineOrientations(outlook.target);
  const updateFacade=mountXiWindowFacade(outlook);
  let line=outlook.options.initialLine??1,mirrored=orientations[line],selected='living';
  let candidates=[];

  function choose(id) {
    const opening=candidates.find(w=>w.id===id);
    if(!opening) throw new Error('Unknown window');
    selected=id;
    Object.assign(outlook.data.window,{lon:opening.lon,lat:opening.lat,bearing:opening.bearing});
    Object.assign(outlook.host.dataset,{windowCandidate:`line-${line}-${id}`,openingId:id,openingName:opening.name,
      unitLine:String(line),windowVerified:'false',mirrored:String(mirrored)});
    outlook.state.east=0;outlook.state.north=0;
    outlook.state.bearing=opening.bearing;outlook.state.pitch=0;
    $('#window-east').value=0;$('#window-north').value=0;
    $('#xi-active-window').textContent=opening.name;
    $('#xi-window-size').textContent=`창 폭 약 ${opening.widthMeters.toFixed(2)}m · 도면 비례 추정`;
    $('#xi-window-direction').textContent=`${Math.round(opening.bearing)}° · ${opening.side==='front'?'남동향':'북서향'} · 외벽 밖 0.2m`;
    outlook.interior?.selectWindow(opening);
    picker.querySelectorAll('[data-opening]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.opening===id)));
    drawPlan();drawMap();outlook.update();
  }

  function drawPlan() {
    const orientation=xiPlanOrientation(outlook.target,mirrored),point=p=>transformPlanPoint(orientation.matrix,p);
    $('#xi-plan-image-transform').setAttribute('transform',`matrix(${orientation.matrix.join(' ')})`);
    Object.assign($('#xi-opening-plan').dataset,{mirrored:String(mirrored),rotation:String(orientation.rotation),northUp:'true'});
    $('#xi-plan-entrance').setAttribute('transform',`translate(${point(plan.entrance.entrance).join(' ')})`);
    for(const w of plan.openings) {
      const center=point(w.pixel),a=point(w.segment.slice(0,2)),b=point(w.segment.slice(2));
      const marker=$(`#xi-plan-openings [data-opening="${w.id}"]`);
      marker.setAttribute('transform',`translate(${center.join(' ')})`);
      const glass=marker.querySelector('line');
      for(const [key,value] of Object.entries({x1:a[0]-center[0],y1:a[1]-center[1],x2:b[0]-center[0],y2:b[1]-center[1]}))glass.setAttribute(key,value);
    }
    const w=candidates.find(w=>w.id===selected),p=point(w.pixel),yaw=w.bearing*Math.PI/180;
    const dx=Math.sin(yaw),dy=-Math.cos(yaw),end=[p[0]+dx*62,p[1]+dy*62];
    $('#xi-plan-sight').setAttribute('d',`M${p} L${end} m${-dx*13-dy*8},${-dy*13+dx*8} L${end} l${-dx*13+dy*8},${-dy*13-dx*8}`);
  }

  function drawMap() {
    const map=$('#xi-unit-map');
    const xs=outlook.target.points.map(p=>p[0]),ys=outlook.target.points.map(p=>p[1]);
    const minX=Math.min(...xs)-5,minY=Math.min(...ys)-5;
    map.setAttribute('viewBox',`${minX} ${minY} ${Math.max(...xs)-minX+5} ${Math.max(...ys)-minY+5}`);
    const focused=map.contains(document.activeElement)?document.activeElement.dataset.opening:null;
    map.replaceChildren();
    map.append(svgNode('polygon',{points:outlook.target.points.map(p=>p.join(',')).join(' '),fill:'#e0e5e5',stroke:'#899798','stroke-width':'.3'}));
    for(const n of [1,2]) {
      const polygon=xiUnitPolygon(outlook.target,n);
      map.append(svgNode('polygon',{points:polygon.map(p=>p.join(',')).join(' '),fill:n===line?'#cfe9df':'#edf1f2',stroke:'#648878','stroke-width':'.35'}));
      const centroid=polygon.reduce((a,p)=>a.map((v,i)=>v+p[i]/4),[0,0]);
      const label=svgNode('text',{x:centroid[0],y:centroid[1],'font-size':'2.4','text-anchor':'middle',fill:'#244a40'});
      label.textContent=`${n}라인`;map.append(label);
    }
    for(const w of candidates) {
      const marker=svgNode('circle',{cx:w.point[0],cy:w.point[1],r:w.id===selected?'1.1':'.75',fill:w.id===selected?'#bd652b':'#177860',stroke:'white','stroke-width':'.25'});
      marker.dataset.opening=w.id;marker.setAttribute('role','button');marker.setAttribute('tabindex','0');
      marker.setAttribute('aria-label',`${w.name} 창 전망`);marker.setAttribute('aria-pressed',String(w.id===selected));
      wire(marker,w.id);map.append(marker);
    }
    const w=candidates.find(w=>w.id===selected),yaw=w.bearing*Math.PI/180;
    map.append(svgNode('path',{d:`M${w.point} l${Math.sin(yaw)*7},${-Math.cos(yaw)*7}`,stroke:'#bd652b','stroke-width':'.6',fill:'none'}));
    const north=svgNode('text',{x:minX+1,y:minY+3,'font-size':3,fill:'#263c32'});north.textContent='N ↑';map.append(north);
    if(focused)map.querySelector(`[data-opening="${focused}"]`)?.focus({preventScroll:true});
  }

  function wire(el,id) {
    el.addEventListener('click',()=>choose(id));
    if(el.tagName.toLowerCase()!=='button') el.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(id);}
    });
  }

  for(const [i,w] of plan.openings.entries()) {
    const group=svgNode('g',{role:'button',tabindex:0,'aria-label':`${w.name} 창 전망`,'aria-pressed':'false',class:'xi-opening-marker'});
    group.dataset.opening=w.id;
    group.append(svgNode('rect',{x:-32,y:-28,width:64,height:56,fill:'transparent'}));
    group.append(svgNode('line',{x1:w.segment[0],y1:w.segment[1],x2:w.segment[2],y2:w.segment[3],class:'xi-opening-glass'}));
    group.append(svgNode('circle',{cx:0,cy:0,r:23,class:'xi-opening-dot'}));
    const label=svgNode('text',{x:0,y:7,'text-anchor':'middle','font-size':24});label.textContent=i+1;group.append(label);
    wire(group,w.id);$('#xi-plan-openings').append(group);
    const button=document.createElement('button');button.type='button';button.dataset.opening=w.id;
    button.innerHTML=`<span>${i+1}</span>${w.name}`;wire(button,w.id);$('#xi-opening-list').append(button);
  }
  const refresh=()=>{
    candidates=xiOpeningCandidates(outlook.target,outlook.data.center,{line,mirrored});
    const decision=xiOrientationDecision(outlook.target,line),matches=decision.mirrored===mirrored;
    $('#xi-orientation-status').textContent=`${mirrored?'좌우 반전':'원본 평면'} · ${matches?'현관–코어 대조 추정':'자료 판정과 다른 수동 후보'} · 반전 검증 보류`;
    $('#xi-orientation-basis').textContent=`${line}라인: 원본 ${decision.candidates.find(c=>!c.mirrored)?.entranceTowardCore?'일치':'불일치'} / 반전 ${decision.candidates.find(c=>c.mirrored)?.entranceTowardCore?'일치':'불일치'}. 기준: 현관의 세대 내 좌우 위치와 공용 코어가 있는 쪽. 북쪽 기준 회전은 별도 적용합니다.`;
    Object.assign(outlook.host.dataset,{orientationEvidence:decision.status,orientationMatchesEvidence:String(matches),orientationMethod:decision.reason,
      orientationAutomaticPlacement:String(decision.automaticPlacement),orientationRegistration:decision.registration.status});
    $('#xi-mirror').setAttribute('aria-pressed',String(mirrored));
    updateFacade(orientations);
    choose(selected);
  };
  $('#xi-line').addEventListener('change',e=>{
    if(outlook.options.isValidLine&&!outlook.options.isValidLine(Number(e.target.value),outlook.state.floors)){e.target.value=String(line);return;}
    line=Number(e.target.value);mirrored=orientations[line];refresh();
  });
  $('#xi-mirror').addEventListener('click',()=>{mirrored=!mirrored;orientations[line]=mirrored;refresh();});
  $('#outlook-reset').addEventListener('click',()=>choose(selected));
  const img=$('#xi-opening-plan image');img.setAttribute('href',plan.image);img.setAttribute('width',plan.imageSize[0]);img.setAttribute('height',plan.imageSize[1]);
  for(const [key,value] of Object.entries(crop))$('#xi-plan-crop rect').setAttribute(key,value);
  $('.xi-picker-heading span').textContent=`${plan.id} · 연결 추정`;
  $('#xi-line').value=String(line);
  if(plan.id!=='59A'){
    $('.xi-evidence').innerHTML='<summary>배치 근거와 오차</summary><p id="xi-orientation-basis"></p><p>211동 배치도의 1·2라인과 84A 부분을 연결했습니다. 84A 확장형 평면의 3810+5000+3515mm 치수로 창 폭을 추정합니다. 실제 준공 평면·창턱·층별 예외는 미검증입니다.</p><a href="/research/gyeonghuigung-xi/unit-lookup-research.md" target="_blank">자료 연결 근거</a>';
  }
  refresh();
  return {updateFacade:()=>updateFacade(orientations),setMode(mode){
    picker.hidden=mode==='outlook'||mode==='3d';stage.classList.toggle('xi-view-only',mode==='outlook');
    $('#xi-opening-plan').toggleAttribute('hidden',mode==='site');$('#xi-unit-map').toggleAttribute('hidden',mode!=='site');
    outlook.render();
  }};
}
