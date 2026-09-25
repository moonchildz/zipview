// Preserve public source attachments, including formats the image decoder cannot read.
import sharp from 'sharp';
import {execFileSync} from 'node:child_process';

export async function inspectShAsset(bytes, filename = '') {
 const head = bytes.subarray(0, 512).toString('utf8');
 const extension = /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1].toLowerCase();
 if (!bytes.length) throw Error('Empty attachment response');
 if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(head)) throw Error('HTML returned instead of attachment');
 const signature = (format) => ({format, verification:'signature-only'});
 if (/^AC10\d{2}/.test(head)) return signature('dwg');
 if (head.startsWith('AutoCAD Binary DXF') || /^\s*0\s+SECTION\s/i.test(head)) return signature('dxf');
 if (head.startsWith('%PDF')) return signature('pdf');
 if (bytes.subarray(0, 2).toString() === 'PK') return signature(['hwpx','docx','xlsx','pptx','zip'].includes(extension) ? extension : 'zip');
 if (bytes.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1') return signature(['hwp','doc','xls','ppt'].includes(extension) ? extension : 'ole');
 if (bytes.subarray(0, 6).toString('hex') === '377abcaf271c') return signature('7z');
 if (head.startsWith('Rar!')) return signature('rar');
 try {
  if (head.startsWith('BM')) return {...JSON.parse(execFileSync('.tools/aerial-python/Scripts/python.exe',['-c','import sys,io,json;from PIL import Image;im=Image.open(io.BytesIO(sys.stdin.buffer.read()));im.load();print(json.dumps(dict(format="bmp",width=im.width,height=im.height)))'],{input:bytes,windowsHide:true,timeout:30000,maxBuffer:1024*1024})),verification:'image-decoded'};
  const meta = await sharp(bytes,{failOn:'error'}).metadata();
  await sharp(bytes,{failOn:'error'}).stats();
  return {format:meta.format,width:meta.width,height:meta.height,verification:'image-decoded'};
 } catch(e) {
  return {format:extension ?? 'bin',verification:'unverified-original',validationError:e.message};
 }
}
