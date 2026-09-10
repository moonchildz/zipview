export const SEOUL_DISTRICTS = ['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구'];
export const SEOUL_APARTMENT_SOURCE='https://data.seoul.go.kr/dataList/OA-15818/A/1/datasetView.do';
const numeric=value=>value===null||value===undefined||String(value).trim()===''?null:Number.isFinite(Number(value))?Number(value):null;
export function normalizeComplex(row) {
  if(!row.apt_cd||!row.apt_nm||!SEOUL_DISTRICTS.includes(row.sgg_addr))throw new Error('Invalid Seoul complex identity/district');
  const x=numeric(row.xcrd),y=numeric(row.ycrd);
  // Range checks do not constitute a CRS or point-to-building registration check.
  const plausible=x!==null&&y!==null&&x>=126.7&&x<=127.3&&y>=37.4&&y<=37.75;
  return {id:`seoul:${row.apt_cd}`,providerId:row.apt_cd,name:row.apt_nm,district:row.sgg_addr,
    address:row.apt_rdn_addr||null,addressStatus:row.apt_rdn_addr?'provider-unverified':'missing',
    kind:row.cmpx_clsf||null,buildingCount:numeric(row.whol_dong_cnt),households:numeric(row.tnohsh),
    tenure:row.hh_type||null,approvalValue:row.use_aprv_ymd??null,providerStatus:row.use_yn||null,
    point:plausible?[x,y]:null,rawCoordinates:[row.xcrd??null,row.ycrd??null],
    coordinateStatus:plausible?'plausible-unverified':x===null||y===null?'missing':'out-of-range',
    source:SEOUL_APARTMENT_SOURCE,unitLayoutStatus:'missing',verified:false};
}
export function normalizeComplexes(raw) {
  if(!Array.isArray(raw?.DATA)||!raw?.DESCRIPTION?.APT_CD)throw new Error('Not a Seoul apartment full-export response');
  const rows=raw.DATA.map(normalizeComplex),ids=new Set(rows.map(r=>r.id));
  if(ids.size!==rows.length)throw new Error('Duplicate complex ID: refusing to silently overwrite');
  return rows;
}
export function geometryBounds(geometry) {
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  function visit(coords){
    if(Array.isArray(coords)&&typeof coords[0]==='number'){
      const [x,y]=coords;if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Nonfinite geometry');
      west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y);
    }else if(Array.isArray(coords))coords.forEach(visit);
  }
  visit(geometry?.coordinates);
  if(!Number.isFinite(west))throw new Error('Empty geometry');
  return [west,south,east,north];
}
export function metersTag(value) {
  if(typeof value!=='string'||!/^\s*\d+(\.\d+)?\s*(m)?\s*$/.test(value))return null;
  const n=Number.parseFloat(value);return n>0&&n<1000?n:null;
}
export function normalizeEnvironment(feature) {
  // osmtogeojson's streaming callback retains nested tags even with flatProperties.
  const metadata=feature.properties??{},p=metadata.tags??metadata,polygon=['Polygon','MultiPolygon'].includes(feature.geometry?.type);
  const category=p['ISO3166-2']==='KR-11'?'boundary':p['building:part']&&p['building:part']!=='no'?'building-part':p.building&&p.building!=='no'?'building':p.highway?'road':null;
  if(!category||metadata.tainted||p.tainted||(['building','building-part','boundary'].includes(category)&&!polygon))return null;
  const id=String(feature.id??p.id??'');if(!/^(way|relation)\/\d+$/.test(id))return null;
  const height=metersTag(p.height),levels=numeric(p['building:levels']);
  return {id,category,name:p.name||null,kind:p.building||p.highway||p['building:part']||null,
    height,heightStatus:height===null?'missing':'osm-tag-unverified',levels:levels>0?levels:null,
    width:metersTag(p.width),widthStatus:metersTag(p.width)===null?'missing':'osm-tag-unverified',
    bounds:geometryBounds(feature.geometry),geometry:feature.geometry,source:`https://www.openstreetmap.org/${id}`,
    tags:Object.fromEntries(['building','building:part','building:levels','height','min_height','name','ref','addr:housenumber','addr:street','addr:full','highway','width','lanes','bridge','tunnel','layer','ISO3166-2'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]])),
    verified:false};
}
export function expandUnitRanges(ranges) {
  const units=[],seen=new Set();
  for(const r of ranges){
    if(!r.source||!r.building||!r.chartType||!Number.isInteger(r.firstFloor)||!Number.isInteger(r.lastFloor)||r.firstFloor<1||r.lastFloor<r.firstFloor||r.lastFloor>200||!Array.isArray(r.lines)||!r.lines.length)throw new Error('Invalid sourced unit range');
    for(let floor=r.firstFloor;floor<=r.lastFloor;floor++)for(const line of r.lines){
      if(!Number.isInteger(line)||line<1||line>99)throw new Error('Invalid source-chart line');
      const unit=String(floor*100+line),id=`${r.building}:${unit}`;
      if(seen.has(id))throw new Error('Overlapping unit ranges');seen.add(id);
      units.push({building:String(r.building),floor,unit,line,chartType:r.chartType,
        exactVariant:r.exactVariant??null,source:r.source,status:'source-chart-transcription',mirrored:null,verified:false});
    }
  }
  return units;
}
