"""Verify XML identity, RGB PS TIFF headers and expected raw file sizes; no pixel reads."""
import json, sys, struct
from pathlib import Path
import xml.etree.ElementTree as ET

def tiff_header(path):
    with path.open('rb') as f:
        order=f.read(2)
        endian={'II':'<','MM':'>'}.get(order.decode('ascii','ignore'))
        if not endian or struct.unpack(endian+'H',f.read(2))[0]!=42:
            raise ValueError('Expected classic TIFF')
        offset=struct.unpack(endian+'I',f.read(4))[0];f.seek(offset)
        n=struct.unpack(endian+'H',f.read(2))[0]
        if n>1024:raise ValueError('Unreasonable TIFF tag count')
        tags={};arrays={}
        for _ in range(n):
            tag,kind,count,value=struct.unpack(endian+'HHI4s',f.read(12))
            if count==1 and kind in [3,4]:tags[tag]=struct.unpack(endian+('H' if kind==3 else 'I'),value[:2] if kind==3 else value)[0]
            if tag in [273,279] and kind in [3,4]:
                if not 0<count<=1000000:raise ValueError('Invalid strip count')
                size=2 if kind==3 else 4
                if count*size<=4:data=value[:count*size]
                else:
                    pos=f.tell();f.seek(struct.unpack(endian+'I',value)[0]);data=f.read(count*size);f.seek(pos)
                arrays[tag]=struct.unpack(endian+str(count)+('H' if kind==3 else 'I'),data)
        if 273 not in arrays or 279 not in arrays or len(arrays[273])!=len(arrays[279]):raise ValueError('Missing strip layout')
        tags['requiredLength']=max(a+b for a,b in zip(arrays[273],arrays[279]))
        return tags

def verify(root, scene):
    prefix=scene+'_L2G_';found={}
    for p in Path(root).rglob(prefix+'*'):
        if p.name in [prefix+b+'.tif' for b in ['R_PS','G_PS','B_PS']]+[prefix+'Aux.xml']:
            if p.name in found:raise ValueError('Duplicate filename; choose a specific inbox folder')
            found[p.name]=p
    xml=found.get(prefix+'Aux.xml')
    if not xml:return {'status':'pending','missing':['Aux.xml']}
    if xml.stat().st_size>10_000_000:raise ValueError('XML too large')
    tree=ET.parse(xml);files=[];missing=[]
    for group,band in [('PS3','R_PS'),('PS2','G_PS'),('PS1','B_PS')]:
        e=tree.getroot().find('Image/'+group)
        if e is None:raise ValueError('Missing PS metadata '+group)
        name=e.findtext('ImageFilename') or e.findtext('ImageFileName')
        if name!=prefix+band+'.tif':raise ValueError('XML scene/band identity mismatch')
        p=found.get(name)
        if not p:missing.append(name);continue
        tags=tiff_header(p);w=int(e.findtext('ImageSize/Width'));h=int(e.findtext('ImageSize/Height'))
        if tags.get(256)!=w or tags.get(257)!=h or tags.get(258)!=16 or tags.get(277,1)!=1 or tags.get(259)!=1:
            raise ValueError('TIFF dimensions/encoding mismatch')
        if p.stat().st_size<max(w*h*2,tags['requiredLength']):missing.append(name+':incomplete');continue
        files.append({'band':band,'path':str(p.resolve()),'bytes':p.stat().st_size,'width':w,'height':h})
    return {'status':'partial' if missing else 'downloaded-header-checked','missing':missing,'files':files,
            'xml':str(xml.resolve()),'pixelIntegrity':'not-checked','geographicAlignment':'not-checked'}

if __name__=='__main__':
    try:print(json.dumps(verify(sys.argv[1],sys.argv[2])))
    except Exception as e:print(json.dumps({'status':'review','reason':str(e)}));sys.exit(1)
