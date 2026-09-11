import './style.css';
import {requestedXiUnit} from './xi-unit-registry.js';
import {mountXiSearch} from './xi-search.js';
const result=await requestedXiUnit();mountXiSearch(result);
document.title='동·호 조회 결과 | 집과 전망';
document.querySelector('.search-section h1').textContent='동·호로 조회';
document.querySelector('.unit-section').hidden=true;document.querySelector('.plan-section').hidden=true;
document.querySelector('.source-section').hidden=true;document.querySelector('.examples').replaceChildren();
const workspace=document.querySelector('.workspace');workspace.replaceChildren();workspace.style.cssText='display:block;padding:32px;line-height:1.8';
const title=document.createElement('h2');title.textContent=`${result.building}동 ${result.unit}호 조회 결과`;
const message=document.createElement('p');message.id='unit-lookup-message';message.textContent=result.message;
workspace.append(title,message);workspace.dataset.lookupStatus=result.status;
const note=document.createElement('p');note.textContent='이전 세대의 평면이나 전망을 대신 표시하지 않습니다.';workspace.append(note);
for(const unit of result.suggestions??[]){const link=document.createElement('a');link.href=`/?site=xi&building=${encodeURIComponent(result.building)}&unit=${encodeURIComponent(unit)}`;link.textContent=`${result.building}동 ${unit}호 조회`;link.style.cssText='display:block;margin:12px 0';workspace.append(link);}
if(result.sources?.[0]){const link=document.createElement('a');link.href=result.sources[0];link.textContent='호수 배치도 근거';link.target='_blank';link.rel='noreferrer';workspace.append(link);}
