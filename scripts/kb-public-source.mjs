import {load} from 'cheerio';
// Read only the JSON embedded in the public HTML. Never execute a site's scripts.
export function extractPublicComplex(html,expectedId){
  const dom=load(html),found=[];
  function visit(value){
    if(!value||typeof value!=='object')return;
    if(value.data?.detail?.['단지기본일련번호']!==undefined&&Array.isArray(value.data.typeList))found.push(value.data);
    for(const child of Object.values(value))visit(child);
  }
  let flight='';
  for(const el of dom('script').toArray()){
    const text=dom(el).text();
    if(!text.startsWith('self.__next_f.push('))continue;
    try{const args=JSON.parse(text.slice(text.indexOf('(')+1,text.lastIndexOf(')')));if(args[0]===1&&typeof args[1]==='string')flight+=args[1];}catch{/* Other runtime scripts are not data. */}
  }
  for(const line of flight.split('\n')){
    const i=line.indexOf(':');if(i<0)continue;
    try{visit(JSON.parse(line.slice(i+1)));}catch{/* Flight references and text frames are not JSON objects. */}
  }
  const data=found.find(d=>String(d.detail['단지기본일련번호'])===String(expectedId));
  if(!data)throw new Error('KB public page schema changed or complex identity mismatch');
  const d=data.detail;
  const plans=[];
  for(const t of data.typeList){
    if(String(t['단지기본일련번호'])!==String(expectedId))throw new Error('Cross-complex plan record');
    const areaId=String(t['면적일련번호']);if(!/^\d+$/.test(areaId))throw new Error('Missing provider area identity');
    const area=Number(t['전용면적']),supply=Number(t['공급면적']);
    if(!Number.isFinite(area)||area<=0||!Number.isFinite(supply)||supply<area)throw new Error('Invalid plan area');
    const typeSuffix=String(t['주택형타입내용']??'');
    const references=[];
    if(t['평면도보기주소']) {
      try {
        const url=new URL(t['평면도보기주소']);
        if(url.protocol==='https:'&&['land.naver.com','new.land.naver.com'].includes(url.hostname))
          references.push({kind:'provider-plan-viewer',url:url.href});
      } catch {/* Keep invalid external references out of the collection queue. */}
    }
    const variants=[];
    for(const [variant,flag,path,name] of [['basic','기본평면도노출여부','기본컨텐츠경로','기본평면도이미지파일명'],['extended','확장평면도노출여부','확장컨텐츠경로','확장형평면도이미지파일명']]){
      if(t[flag]!=='1'||!t[name])continue;
      const url=String(t['이미지도메인URL']??'')+String(t[path]??'')+String(t[name]);
      if(new URL(url).origin!=='https://file.kbland.kr')throw new Error('Unexpected plan image host');
      variants.push({variant,url});
    }
    plans.push({areaId,area,supply,typeSuffix,displayType:`${Math.floor(area)}${typeSuffix}`,providerLabel:`${supply}㎡ ${typeSuffix}`.trim(),
      households:Number(t['세대수'])||null,rooms:Number(t['방수'])||null,bathrooms:Number(t['욕실수'])||null,variants,references});
  }
  return {provider:'kb-public',providerId:String(expectedId),source:`https://kbland.kr/se/c/${expectedId}`,
    name:d['단지명'],address:d['신주소'],landAddress:d['구주소'],households:Number(d['총세대수'])||null,
    buildingCount:Number(d['총동수'])||null,point:[Number(d['wgs84경도']),Number(d['wgs84위도'])],
    providerHasUnitInfo:d['호실정보존재여부']==='1',plans};
}

export function apiData(json){
  if(json?.dataHeader?.resultCode!=='10000')throw new Error('Provider refused request');
  if(json.dataBody?.resultCode===33210)return null;
  if(json.dataBody?.resultCode!==11000)throw new Error(`Provider response code ${json.dataBody?.resultCode??'missing'}`);
  return json.dataBody.data;
}
export function parseSearch(json){
  const data=apiData(json);if(!data)return {candidates:[],total:0};
  const group=data.data?.HSCM;if(!group)return {candidates:[],total:0};
  if(!Array.isArray(group.data))throw new Error('Provider search schema changed');
  return {total:Number(group.totcnt),candidates:group.data.filter(r=>/^\d+$/.test(String(r.COMPLEX_NO))).map(r=>({
    providerId:String(r.COMPLEX_NO),name:r.HSCM_NM,address:r.NEWADDRESS,landAddress:r.JUSO_ARNO,
    source:`https://kbland.kr/se/c/${r.COMPLEX_NO}`}))};
}
export function parseDongList(json){
  const data=apiData(json);if(data===null)return [];
  if(!Array.isArray(data))throw new Error('Provider dong list schema changed');
  return data.map(d=>{
    const building=String(d['동명']??'').replace(/동$/,'').trim(),id=String(d['동일련번호']??'');
    if(!/^\d+$/.test(id)||!/^\d+$/.test(building))throw new Error('Unsupported dong identity');
    return {building,providerDongId:id};
  });
}
export function parseHoList(json,dong,planAreaIds){
  const data=apiData(json);if(data===null)return [];
  if(!Array.isArray(data))throw new Error('Provider unit list schema changed');
  return data.map(h=>{
    const unit=String(h['호명']??'').replace(/호$/,'').trim(),areaId=String(h['면적일련번호']??'');
    if(!/^\d{3,5}$/.test(unit)||Number(unit)%100===0)throw new Error('Unsupported unit number');
    return {building:dong.building,unit,providerDongId:dong.providerDongId,areaId:planAreaIds.has(areaId)?areaId:null,
      status:planAreaIds.has(areaId)?'provider-unit-link':'provider-area-unlinked'};
  });
}
