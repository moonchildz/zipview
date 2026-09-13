// Source-specific dimensional readings. Raster drawings are not uniformly
// scaled, so horizontal and vertical dimension chains are kept separately.
// These are approximate wall-line readings, not as-built measurements.
const source='https://foodmaker.toesoon.com/entry/신촌푸르지오-공공임대';
export const planCalibrations={
  'sinchon-prugio/kb-29616-basic':{
    buildings:['207','208'],
    source,file:'research/linkage/downloads/evidence/sinchon-rental-plans/03-bb2cc7845ddb.jpg',sha256:'bb2cc7845ddb8ed10c15db8bc900c5a2b855f3c579299a5bdb6534f43407d3eb',
    axes:[{axis:0,pixels:[42,409],meters:7.9,chainMm:[2700,2200,3000],feature:'bedroom west wall to living/balcony partition'},
      {axis:1,pixels:[130,320],meters:4.3,chainMm:[4300],feature:'main front/rear wall lines'}],
    review:'34AT,34.250sqm,15 households; same entrance, bathroom, living and right terrace topology. Dimension endpoints read approximately on the KB image.',
  },
  'sinchon-prugio/kb-75982-basic':{
    buildings:[],
    source,file:'research/linkage/downloads/evidence/sinchon-rental-plans/04-9379d0dec5ef.jpg',sha256:'9379d0dec5ef0b3cba64508ae28b5451bb6e55351afc449636ab0f9af035ac25',
    axes:[{axis:1,pixels:[67,385],meters:5.2,chainMm:[2400,2800],feature:'living and bedroom front/rear wall lines'}],
    review:'34B,34.752sqm,4 households; same entrance, bathroom and dual-balcony topology. Horizontal 6620 and 2100+3600 labels have ambiguous endpoints; not used. Vertical scale is applied uniformly as an estimate.',
  },
  'sinchon-prugio/kb-179187-extended':{
    buildings:['209','210'],
    source,file:'research/linkage/downloads/evidence/sinchon-rental-plans/05-15367c8d2f23.jpg',sha256:'15367c8d2f23a685f10e3e05dbc0767400bc1c7bc215734d5eb67ff44d4a3ca1',
    axes:[{axis:0,pixels:[50,511],meters:7.8,chainMm:[2700,2100,3000],feature:'bedroom west wall to bedroom/balcony partition'},
      {axis:1,pixels:[48,400],meters:5.4,chainMm:[2200,3200],feature:'main front/rear wall lines'}],
    review:'49AT(A),49.020sqm,4 households; source is basic/terrace variant, KB extended variant. Only shared outer depth and bedroom/balcony partition dimension chain transferred; living expansion preserved from the KB drawing.',
  },
};
