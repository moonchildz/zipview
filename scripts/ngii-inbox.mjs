import fs from 'node:fs/promises';
import path from 'node:path';
import { reconcileFiles, safeFilename } from './ngii-files.mjs';

// Import only verified NGII ZIP/XML pairs from the native downloader's folders.
// The active collector remains the sole writer of manifest.json.
export async function importNgiiInbox({sheets,inbox,output,cache=new Map()}) {
  inbox=path.resolve(inbox);output=path.resolve(output);
  if(inbox===output)throw new Error('다운로드 수신 폴더와 mapinfo 폴더는 달라야 합니다.');
  const entries=await fs.readdir(inbox,{withFileTypes:true});
  // Support an explicitly selected download directory and native named subfolders.
  const folders=[{name:'.'},...entries.filter(e=>e.isDirectory() && /^(?:down_\d{6}_\d+|map_all_\d+)$/.test(e.name))];
  const imported=[], conflicts=[], reviews=[];
  for(const folder of folders) {
    const source=path.join(inbox,folder.name);
    // Avoid following links/junctions outside the selected download root.
    const realSource=await fs.realpath(source),realInbox=await fs.realpath(inbox);
    if(realSource.toLowerCase()!==realInbox.toLowerCase() && path.dirname(realSource).toLowerCase()!==realInbox.toLowerCase())continue;
    const candidates=sheets.filter(s=>s.status!=='verified').map(s=>({...s,status:'pending',file:undefined}));
    await reconcileFiles(candidates,source,cache);
    for(const candidate of candidates.filter(s=>s.status==='review')) {
      const target=sheets.find(s=>s.key===candidate.key);
      target.status='review';target.review=candidate.review;
      reviews.push({number:target.number,...target.review});
    }
    for(const sheet of candidates.filter(s=>s.status==='verified')) {
      let copied=false;
      for(const name of [sheet.file.zip,sheet.file.xml]) {
        safeFilename(name);
        try {
          await fs.copyFile(path.join(source,name),path.join(output,name),1);
          copied=true;
        } catch(error) {
          if(error.code!=='EEXIST')throw error;
          // Do not overwrite user files. The collector checks existing contents.
          conflicts.push(name);
        }
      }
      if(copied)imported.push({number:sheet.number,folder:folder.name});
    }
  }
  return {imported,conflicts,reviews};
}
