import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchBrowser} from './ngii-browser.mjs';

export function compareBounds(actual, expected, tolerance=2) {
  const valid=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<b[2]&&b[1]<b[3];
  if(!valid(actual)||!valid(expected))return {matches:false};
  const maxErrorMeters=Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])));
  return {matches:maxErrorMeters<=tolerance,maxErrorMeters,toleranceMeters:tolerance};
}

export async function checkCoordinates(zipPath,sheet) {
  let expected=sheet.bounds5179;
  if(!expected) {
    // Public lookup only; never touch the authenticated download window.
    const browser=await launchBrowser({inventory:true});
    try {
      const data=await browser.page.evaluate(number=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Coordinate catalogue timeout')),30000);
        mapQuery.clear();mapQuery.index=[number];mapQuery.scale='1000';simple.settings.scale=null;
        mapQuery.searchSuchi('3',null,null,result=>{clearTimeout(timer);resolve(result);});
      }),sheet.number);
      const items=data?.items?.filter(x=>x.num===sheet.number&&String(x.makeYer)===sheet.year
        &&String(x.gosiYer)===sheet.notice&&String(x.historyNo)===sheet.history&&String(x.scale)==='1000'&&x.name===sheet.name);
      if(items?.length!==1)throw new Error('공식 도엽 좌표/버전을 확인할 수 없음');
      expected=['minx','miny','maxx','maxy'].map(k=>Number(items[0][k]));
    } finally {await browser.close();}
  }
  const root=fileURLToPath(new URL('../',import.meta.url));
  const localPython=path.join(root,'.tools/mapinfo-python',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const python=await fs.access(localPython).then(()=>localPython,()=>process.platform==='win32'?'python':'python3');
  const {stdout}=await promisify(execFile)(python,[fileURLToPath(new URL('./ngii-coordinate-check.py',import.meta.url)),zipPath],
    {timeout:60000,maxBuffer:1024*1024,windowsHide:true});
  const actual=JSON.parse(stdout);
  return {...compareBounds(actual.bounds,expected),crs:'EPSG:5179',catalogueBounds:expected,geometryBounds:actual.bounds,layers:actual.layers,
    checkedAt:new Date().toISOString(),source:'https://map.ngii.go.kr/ms/map/NlipMap.do?tabGb=total'};
}
