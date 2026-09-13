import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export async function atomicJson(filename,data) {
  await fs.mkdir(path.dirname(path.resolve(filename)),{recursive:true});
  const temporary=`${filename}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary,JSON.stringify(data,null,2)+'\n');
  for(let attempt=0;;attempt++) {
    try {await fs.rename(temporary,filename);return;}
    catch(error) {
      if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=20)throw error;
      await new Promise(r=>setTimeout(r,250));
    }
  }
}
