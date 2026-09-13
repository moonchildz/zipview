import { crc32 } from 'node:zlib';

export const rawSheet={num:'376082071',objectid:595361,historyNo:0,name:'서울2226',makeYer:'2025',gosiYer:'2025-3996',scale:'1000'};
export const xml=`<?xml version="1.0" encoding="UTF-8"?><메타>
<지도순번>556748</지도순번><지도이력번호>0</지도이력번호><도엽번호>376082071</도엽번호>
<지도종류코드>수치지도2.0</지도종류코드><축척코드>1:1,000</축척코드>
<도엽명>서울2226</도엽명><제작년도>2025</제작년도><고시번호>2025-3996</고시번호></메타>`;

export const isoXml=`<?xml version="1.0" encoding="UTF-8"?>
<mdb:MD_Metadata xmlns:mdb="http://standards.iso.org/iso/19115/-3/mdb/2.0"
xmlns:mri="http://standards.iso.org/iso/19115/-3/mri/1.0" xmlns:cit="http://standards.iso.org/iso/19115/-3/cit/2.0"
xmlns:gmd="http://standards.iso.org/iso/19115/-3/gmd/1.0" xmlns:gco="http://standards.iso.org/iso/19115/-3/gco/1.0">
<mdb:identificationInfo><mri:MD_DataIdentification><mri:citation><cit:CI_Citation>
<cit:title><gco:CharacterString>1/1,000 수치지형도 (구리시) - 도엽번호 : 377051353</gco:CharacterString></cit:title>
<cit:otherCitationDetails><gco:CharacterString>제작년도 : 2025</gco:CharacterString></cit:otherCitationDetails>
<cit:otherCitationDetails><gco:CharacterString>고시번호 : 2026-0189</gco:CharacterString></cit:otherCitationDetails>
</cit:CI_Citation></mri:citation></mri:MD_DataIdentification></mdb:identificationInfo>
<mdb:contentInfo><mri:MD_FeatureCatalogueDescription><gmd:featureCatalogureCitation><cit:CI_Citation>
<cit:title><gco:CharacterString>수치지도 2.0 지형지물속성목록</gco:CharacterString></cit:title>
</cit:CI_Citation></gmd:featureCatalogureCitation></mri:MD_FeatureCatalogueDescription></mdb:contentInfo>
</mdb:MD_Metadata>`;

export function zipFixture(exts=['shp','shx','dbf','prj']) {
  const entries=[], directory=[];let offset=0;
  for(const ext of exts) {
    const name=Buffer.from(`376082071/buildings.${ext}`), data=Buffer.from(`fixture ${ext}`), crc=crc32(data);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    entries.push(local,name,data);directory.push(central,name);offset+=local.length+name.length+data.length;
  }
  const dir=Buffer.concat(directory), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(exts.length,8);end.writeUInt16LE(exts.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...entries,dir,end]);
}
