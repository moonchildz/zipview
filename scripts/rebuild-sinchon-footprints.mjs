import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const local=process.platform==='win32'?'.tools/mapinfo-python/Scripts/python.exe':'.tools/mapinfo-python/bin/python';
const python=process.env.ZIPVIEW_PYTHON||(existsSync(local)?local:process.platform==='win32'?'python':'python3');
const result=spawnSync(python,['scripts/resolve-sinchon-footprints.py'],{stdio:'inherit'});
if(result.error)console.error(result.error.message);
process.exitCode=result.status??1;
