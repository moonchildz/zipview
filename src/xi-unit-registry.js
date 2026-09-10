export const XI_UNIT_SOURCES={
  lines:'https://www.r1472.co.kr/_file/Group/21506081506430596_042.jpg',
  types:'https://s3.ap-northeast-2.amazonaws.com/zippoom-blueprint/1c0611ad-1ccd-488b-aa26-70017fdeee9a%EA%B2%BD%ED%9D%AC%EA%B6%81%EC%9E%90%EC%9D%B4.webp',
  plan84:'https://w2althy.tistory.com/15598549',
  area84:'https://fin.land.naver.com/articles/2531096231',
};
// Range entries are brochure-derived placement candidates, not a current unit register.
export const XI_UNIT_RULES={
  '204':{buildingId:608374570,knownLines:[1,2,3,4,5],planLines:[1,2],firstFloor:2,lastFloor:18,buildingFloors:21,planId:'59A',exclusiveArea:59.85,supplyArea:82.6},
  '205':{buildingId:608374571,knownLines:[1,2,3,4,5],planLines:[1,2],firstFloor:2,lastFloor:21,buildingFloors:21,planId:'59A',exclusiveArea:59.85,supplyArea:82.6},
  '211':{buildingId:608374573,knownLines:[1,2],planLines:[1,2],firstFloor:2,lastFloor:15,buildingFloors:15,planId:'84A',exclusiveArea:84.61,supplyArea:111.55},
};
export function resolveXiUnit({complex='경희궁자이2단지',building,unit}){
  const normalized=String(complex).replace(/[\s·(),-]/g,'');
  const supported=['경희궁자이2단지','경희궁자이2단지아파트','송월길99','서울특별시종로구송월길99','서울종로구송월길99'];
  const b=String(building??'').trim().replace(/동$/,''),u=String(unit??'').trim().replace(/호$/,'');
  const fail=(status,message,extra={})=>({status,message,building:b,unit:u,ready:false,verified:false,...extra});
  if(!supported.includes(normalized))return fail('unknown-complex','이 단지의 동·호 연결 자료는 아직 등록되지 않았습니다.');
  if(!/^\d{3}$/.test(b)||!/^\d{3,5}$/.test(u))return fail('invalid-input','동과 호수를 숫자로 입력해 주세요. 예: 211동 1201호');
  const floor=Math.floor(+u/100),line=+u%100,rule=XI_UNIT_RULES[b];
  if(!rule)return fail('unmapped-building',`${b}동의 동호수·타입 연결 자료가 아직 등록되지 않았습니다.`);
  if(!rule.knownLines.includes(line))return fail('line-not-in-source',`${b}동 배치도에는 ${rule.knownLines.join('·')}라인이 표시돼 있습니다. ${u}호의 ${line}라인은 자료와 맞지 않습니다.`,{knownLines:rule.knownLines,sources:[XI_UNIT_SOURCES.lines],suggestions:rule.planLines.map(n=>`${floor*100+n}`)});
  if(floor<1||floor>rule.buildingFloors)return fail('floor-outside-source',`${b}동은 자료상 최고 ${rule.buildingFloors}층입니다.`);
  if(!rule.planLines.includes(line))return fail('unmapped-type',`${b}동 ${line}라인은 배치도에 있지만 해당 평면·방향 연결은 아직 등록되지 않았습니다.`);
  if(floor<rule.firstFloor)return fail('floor-exception-unresolved','1층의 필로티·공용시설·호수 예외를 확인하지 못해 자동 배치를 보류합니다.');
  if(floor>rule.lastFloor)return fail('wing-floor-outside-source',`${b}동 ${line}라인은 자료상 최고 ${rule.lastFloor}층 부분입니다.`);
  return {...rule,complex:'경희궁자이2단지',building:b,unit:String(+u),floor,line,status:'source-linked-candidate',ready:true,verified:false,
    sources:[XI_UNIT_SOURCES.lines,XI_UNIT_SOURCES.types],message:'배치도·타입 자료 연결 후보 · 준공 및 층별 예외 미검증'};
}
export function requestedXiUnit(){const p=new URLSearchParams(location.search);return resolveXiUnit({complex:p.get('complex')??undefined,building:p.get('building')??'204',unit:p.get('unit')??'201'});}
