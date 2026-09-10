import {buildXiInterior,planToWorld,validPlanPoint,canMovePlan} from './xi-interior-geometry.js';
import {getXiPlan} from './xi-plans.js';
import {xiFrontBearing} from './xi-unit-layout.js';
import {xiPlanOrientation,transformPlanPoint,inversePlanPoint} from './xi-plan-orientation.js';
import './xi-interior.css';

export function mountXiInterior(outlook) {
  const plan=getXiPlan(outlook.target),crop=plan.crop;
  const panel=document.createElement('section');panel.className='xi-interior-controls';panel.hidden=true;
  panel.innerHTML=`<div><strong>집 안에서 보기</strong><p>평면을 눌러 관찰 위치를 선택하세요. 화면을 드래그하면 고개를 돌립니다.</p>
    <svg id="xi-observer-plan" viewBox="0 0 800 800" tabindex="0" role="application" aria-label="북쪽이 위인 실내 평면. 클릭으로 위치 선택, 방향키로 화면 방향 이동">
    <defs><clipPath id="xi-interior-plan-crop"><rect x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}"/></clipPath></defs>
    <g id="xi-interior-plan-transform"><g clip-path="url(#xi-interior-plan-crop)"><image href="${plan.image}" width="${plan.imageSize[0]}" height="${plan.imageSize[1]}"/></g>
    <circle id="xi-observer-dot" r="10" fill="#e96e32" stroke="white" stroke-width="3"/></g>
    <path id="xi-observer-sight" fill="none" stroke="#e96e32" stroke-width="5" pointer-events="none"/>
    <g class="xi-compass"><text x="400" y="32">N</text><text x="778" y="408">E</text><text x="400" y="790">S</text><text x="22" y="408">W</text></g></svg></div>
    <div><div class="xi-interior-presets"><button type="button" data-spot="near">거실 창 앞</button><button type="button" data-spot="living">거실 중앙</button><button type="button" data-spot="back">거실 뒤쪽</button></div>
    <p id="xi-observer-status" aria-live="polite"></p><p>주황색 점이 현재 위치입니다. 방향키 이동은 벽에서 멈춥니다. 평면 클릭은 선택한 방으로 이동합니다.</p>
    <p>${plan.id} 평면 판독 초안 · 벽 두께 12~18cm, 천장 2.55m 가정. 발코니 단차와 준공 치수는 미검증입니다.</p></div>`;
  document.querySelector('.xi-window-stage').prepend(panel);
  const svg=panel.querySelector('svg'),dot=panel.querySelector('circle'),status=panel.querySelector('#xi-observer-status');
  let point=[...plan.presets.living],groups=[],signature='';
  const config=()=>({line:Number(outlook.host.dataset.unitLine||1),mirrored:outlook.host.dataset.mirrored==='true'});
  const paint=()=>{dot.setAttribute('cx',point[0]);dot.setAttribute('cy',point[1]);
    const orientation=xiPlanOrientation(outlook.target,config().mirrored);
    panel.querySelector('#xi-interior-plan-transform').setAttribute('transform',`matrix(${orientation.matrix.join(' ')})`);
    Object.assign(svg.dataset,{mirrored:String(orientation.mirrored),rotation:String(orientation.rotation),northUp:'true'});
    const drawn=transformPlanPoint(orientation.matrix,point),yaw=outlook.state.bearing*Math.PI/180;
    panel.querySelector('#xi-observer-sight').setAttribute('d',`M${drawn} l${Math.sin(yaw)*65},${-Math.cos(yaw)*65}`);
    const p=controller.position();outlook.host.dataset.interiorPlanPoint=point.join(',');
    status.textContent=`${config().line}라인 · ${orientation.mirrored?'좌우 반전':'원본 방향'} · 북쪽 기준 · 눈높이 ${outlook.state.eyeHeight.toFixed(2)}m`;
    outlook.host.dataset.interiorWorld=p.map(v=>v.toFixed(3)).join(',');};
  const dispose=()=>{for(const group of groups){outlook.scene.remove(group);const mats=new Set();group.traverse(c=>{c.geometry?.dispose();if(c.material)mats.add(c.material);});mats.forEach(m=>m.dispose());}groups=[];};
  const move=(next,walk=false)=>{if(!validPlanPoint(next,outlook.target)||(walk&&!canMovePlan(point,next,outlook.target))){status.textContent='벽 가까이에는 설 수 없습니다. 방 안쪽을 선택하세요.';return;}point=next;outlook.state.east=0;outlook.state.north=0;outlook.update();};
  const controller={active:false,
    position(){const {line,mirrored}=config();return planToWorld(outlook.target,line,mirrored,point);},
    selectWindow(opening){point=[opening.pixel[0],opening.side==='front'?plan.presets.living[1]:plan.bounds.top+86];if(!validPlanPoint(point,outlook.target))point=[...plan.presets.living];},
    setActive(active){this.active=active;panel.hidden=!active;
      outlook.host.dataset.interior=active?'active':'off';
      document.querySelector('#view-caption').textContent=active?'실내 벽·창 개구부와 외부 모델을 같은 시점으로 표시 · 평면 투영 초안':'외부 창 5곳 판독 후보 · 실제 현장 전망 미검증';
      outlook.cameras.forEach((c,i)=>{if(active){c.layers.disable(4);c.layers.enable(i+2);}else{c.layers.enable(4);c.layers.disable(i+2);}});
      outlook.state.east=0;outlook.state.north=0;outlook.update();},
    sync(){
      if(!this.active){groups.forEach(g=>g.visible=false);return;}
      const options={...config(),floorHeight:outlook.state.floorHeight,offset:outlook.state.offset};
      const next=JSON.stringify([options,outlook.state.floors]);
      if(next!==signature){dispose();signature=next;
        groups=outlook.state.floors.map((floor,i)=>{const group=buildXiInterior(outlook.target,outlook.data.center,{...options,floor});group.traverse(c=>c.layers.set(i+2));outlook.scene.add(group);return group;});
      }
      groups.forEach(g=>g.visible=true);paint();
    },
  };
  svg.addEventListener('click',e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const local=p.matrixTransform(svg.getScreenCTM().inverse());move(inversePlanPoint(xiPlanOrientation(outlook.target,config().mirrored).matrix,[local.x,local.y]));});
  svg.addEventListener('keydown',e=>{const delta={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]}[e.key];if(delta){e.preventDefault();const matrix=xiPlanOrientation(outlook.target,config().mirrored).matrix;const drawn=transformPlanPoint(matrix,point);move(inversePlanPoint(matrix,drawn.map((v,i)=>v+delta[i])),true);}});
  panel.querySelectorAll('[data-spot]').forEach(button=>button.addEventListener('click',()=>{
    move([...plan.presets[button.dataset.spot]]);
    outlook.state.bearing=outlook.data.window.bearing;
    // Presets always look out of the living-room/front facade.
    outlook.state.bearing=xiFrontBearing(outlook.target);outlook.state.pitch=0;outlook.update();
  }));
  outlook.interior=controller;return controller;
}
