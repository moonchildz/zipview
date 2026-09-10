import {PNG} from 'pngjs';
import {readFileSync} from 'node:fs';
import {imageryGrid} from '../src/imagery-coordinates.js';

export async function mockGroundImagery(page) {
  const requests=[];
  const png=new PNG({width:256,height:256});
  for(let y=0;y<256;y++)for(let x=0;x<256;x++) {
    const i=(y*256+x)*4,cell=(Math.floor(x/32)+Math.floor(y/32))%2;
    png.data[i]=cell?185:130;png.data[i+1]=cell?120:170;png.data[i+2]=cell?110:195;png.data[i+3]=255;
  }
  const body=PNG.sync.write(png);
  await page.route('**/api/imagery/**',async route=>{
    const url=new URL(route.request().url());requests.push(url);
    if(url.pathname.endsWith('/metadata')) {
      const path=url.pathname.includes('/xi/')?'research/gyeonghuigung-xi/scene.json':'research/sinchon-prugio/outlook/scene.json';
      const data=JSON.parse(readFileSync(path,'utf8')),zoom=Number(url.searchParams.get('zoom'));
      return route.fulfill({json:{grid:imageryGrid(data.center,zoom,zoom===15?2:6),tileSize:256,copyright:'TEST FIXTURE - NOT SATELLITE IMAGERY'}});
    }
    return route.fulfill({contentType:'image/png',body});
  });
  return requests;
}
