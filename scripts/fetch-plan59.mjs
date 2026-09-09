import { load } from 'cheerio';
import { writeFile } from 'node:fs/promises';
const response = await fetch('https://kbland.kr/se/c/30737');
if (!response.ok) throw new Error(`KB ${response.status}`);
const $ = load(await response.text());
const matches = [];
$('img').each((_, img) => {
  const src = $(img).attr('src');
  if (!src?.includes('/plane/')) return;
  let node = $(img);
  for(let i=0;i<8;i++) {
    node=node.parent();
    const text=node.text();
    if(text.includes('81D') && text.length < 1000) { matches.push({src,text});break; }
  }
});
console.log(JSON.stringify(matches,null,2));
if(matches.length!==1) throw new Error('Ambiguous 59D source');
const img = await fetch(matches[0].src);
if(!img.ok) throw new Error(`Image ${img.status}`);
await writeFile('research/sinchon-prugio/images/59D.jpg',Buffer.from(await img.arrayBuffer()));
await writeFile('research/sinchon-prugio/outlook/59D-source.json',JSON.stringify({page:'https://kbland.kr/se/c/30737',...matches[0]},null,2));
