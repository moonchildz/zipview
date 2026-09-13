import {PNG} from 'pngjs';
import {staticImageryGrid} from '../src/imagery-coordinates.js';

export async function mockGroundImagery(page) {
  const requests=[];
  const png=new PNG({width:1280,height:1280});
  for(let y=0;y<1280;y++)for(let x=0;x<1280;x++) {
    const i=(y*1280+x)*4,cell=(Math.floor(x/80)+Math.floor(y/80))%2;
    png.data[i]=cell?185:130;png.data[i+1]=cell?120:170;png.data[i+2]=cell?110:195;png.data[i+3]=255;
  }
  const body=PNG.sync.write(png);
  await page.route('**/api/imagery/**',async route=>{
    const url=new URL(route.request().url());requests.push(url);
    if(url.pathname.endsWith('/metadata')) {
      const center=['lon','lat'].map(k=>Number(url.searchParams.get(k))),zoom=Number(url.searchParams.get('zoom'));
      return route.fulfill({json:{provider:'google-static',grid:staticImageryGrid(center,zoom),width:1280,height:1280}});
    }
    return route.fulfill({contentType:'image/png',body});
  });
  return requests;
}
