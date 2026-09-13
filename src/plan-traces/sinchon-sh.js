// SH's rental guide is a different plan family from the terrace drawings that
// the provider attaches to the same area/type labels. Keep both source identities.
const file='research/linkage/downloads/evidence/sh/70339-category-08-83544a2c9336.jpeg';
const sha256='83544a2c9336c7c1a8daf91ffc247cb030db77f2e3f4a466fbc55da6d09a24d0';
const w=(id,name,a,b,inside)=>({id,name,a,b,inside});
function trace(type,offset,outline,walls,windows,rooms,dimension){
  const point=p=>p.map((v,i)=>v+offset[i]);
  return {id:`sinchon-prugio/sh-rental-${type}`,complexId:'sinchon-prugio',type,variant:'sh-rental',
    source:{file,sha256,imageSize:[1654,2340],url:'https://www.i-sh.co.kr/houseinfo/'},
    outline:outline.map(point),walls:walls.map(path=>path.map(point)),
    windows:windows.map(w=>({...w,a:point(w.a),b:point(w.b),inside:point(w.inside)})),
    rooms:rooms.map(r=>({...r,point:point(r.point),look:point(r.look)})),
    dimension:{...dimension,pixels:dimension.pixels.map(point)},
    evidence:{method:'manual-SH-rental-guide-trace',pixelTolerance:4,allOpeningsVerified:false,verticalDimensionsVerified:false,asBuiltVerified:false,geographicPlacementVerified:false}};
}
export const sinchonShTraces=[
  trace('34A',[300,400],[[70,170],[309,170],[309,699],[70,699]],
    [[[213,170],[213,274]],[[70,326],[215,326]],[[162,326],[162,411]],[[70,450],[166,450]],[[70,623],[309,623]],[[236,623],[236,699]]],
    [w('bedroom','침실 창',[116,170],[177,170],[150,240]),w('living','거실 발코니 창',[123,623],[230,623],[175,550]),w('balcony','발코니 외부 창',[124,699],[229,699],[175,660])],
    [{name:'거실',point:[190,530],look:[190,699]},{name:'침실',point:[150,240],look:[150,170]}],
    {pixels:[[70,699],[309,699]],meters:4.52,chainMm:[3160,1360],source:file}),
  trace('34B',[900,350],[[97,280],[263,280],[263,193],[411,193],[411,739],[158,739],[158,759],[97,759]],
    [[[190,280],[190,368]],[[97,450],[207,450]],[[263,446],[263,662]],[[97,662],[411,662]],[[158,662],[158,759]],[[263,280],[411,280]]],
    [w('kitchen-outer','주방 발코니 외부 창',[285,193],[346,193],[315,230]),w('kitchen','주방 발코니 창',[276,280],[355,280],[320,345]),
      w('bedroom','침실 발코니 창',[166,662],[245,662],[200,550]),w('living','거실 발코니 창',[284,662],[378,662],[335,540]),
      w('balcony','전면 발코니 외부 창',[170,739],[378,739],[300,705])],
    [{name:'거실',point:[330,545],look:[330,739]},{name:'침실',point:[180,545],look:[180,739]}],
    {pixels:[[97,739],[411,739]],meters:5.62,chainMm:[3010,2610],source:file}),
  trace('49A',[300,1330],[[25,130],[367,130],[367,638],[25,638]],
    [[[180,130],[180,230]],[[244,130],[244,202]],[[244,254],[367,254]],[[25,279],[184,279]],[[143,279],[143,356]],[[25,400],[156,400]],[[206,400],[206,567]],[[25,567],[367,567]]],
    [w('bedroom-rear','후면 침실 창',[78,130],[139,130],[120,210]),w('bedroom','침실 발코니 창',[81,567],[174,567],[120,500]),
      w('living','거실 발코니 창',[228,567],[331,567],[290,480]),w('balcony-left','침실 앞 발코니 외부 창',[81,638],[174,638],[120,600]),w('balcony-right','거실 앞 발코니 외부 창',[228,638],[331,638],[290,600])],
    [{name:'거실',point:[290,480],look:[290,638]},{name:'침실',point:[120,500],look:[120,638]}],
    {pixels:[[25,638],[367,638]],meters:6.42,chainMm:[3410,3010],source:file}),
];
