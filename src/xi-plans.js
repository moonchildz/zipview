const plan59=new URL('../research/gyeonghuigung-xi/images/reference-0.png',import.meta.url).href;
const plan84=new URL('../research/gyeonghuigung-xi/images/84A-reference.jpg',import.meta.url).href;

export const XI_PLANS={
  '59A':{id:'59A',source:'research/gyeonghuigung-xi/images/reference-0.png',image:plan59,imageSize:[1440,634],crop:{x:850,y:90,width:560,height:545},
    scale:{left:898,right:1365,widthMeters:10.525},bounds:{left:898,right:1365,top:134,bottom:572},
    entrance:{center:[1131.5,353],entrance:[1259,243],tolerance:12},
    presets:{near:[1142,548],living:[1142,430],back:[1142,405]},
    partitions:[[1052,180,1052,250],[1052,295,1052,315],[898,315,1010,315],[898,380,1052,380],[1052,380,1052,465],[1052,515,1052,572],[1225,365,1225,390],[1225,435,1225,572],[1225,245,1365,245],[1225,245,1225,315],[1225,365,1250,365],[1300,365,1365,365]],
    openings:[
      {id:'living',name:'거실',side:'front',pixel:[1142,572],segment:[1078,572,1206,572]},
      {id:'bedroom-front',name:'침실 · 전면',side:'front',pixel:[996,540],segment:[957,540,1035,540]},
      {id:'balcony',name:'침실 앞 발코니',side:'front',pixel:[1270,572],segment:[1240,572,1300,572]},
      {id:'bedroom-rear',name:'침실 · 후면',side:'rear',pixel:[983.5,180],segment:[938,180,1029,180]},
      {id:'kitchen',name:'주방',side:'rear',pixel:[1127,134],segment:[1103,134,1151,134]},
    ]},
  '84A':{id:'84A',source:'research/gyeonghuigung-xi/images/84A-reference.jpg',image:plan84,imageSize:[752,831],crop:{x:140,y:290,width:590,height:530},
    scale:{left:198,right:661,widthMeters:12.325},bounds:{left:198,right:661,top:343,bottom:750},
    entrance:{center:[430,545],entrance:[550,486],tolerance:12},
    presets:{near:[436,725],living:[436,640],back:[436,590]},
    partitions:[[344,570,344,750],[268,393,268,520],[268,520,305,520],[385,393,385,475],[385,510,385,525],[530,575,530,620],[530,665,530,750],[594,466,594,578],[594,578,620,578],[646,578,661,578],[510,466,510,525],[198,574,300,574]],
    openings:[
      {id:'living',name:'거실',side:'front',pixel:[436,750],segment:[365,750,509,750]},
      {id:'bedroom-front',name:'안방 · 전면',side:'front',pixel:[288,716],segment:[249,716,328,716]},
      {id:'balcony',name:'침실 앞 발코니',side:'front',pixel:[578,750],segment:[550,750,606,750]},
      {id:'bedroom-rear',name:'침실 · 후면',side:'rear',pixel:[311,392],segment:[279,392,344,392]},
      {id:'kitchen',name:'주방',side:'rear',pixel:[465,343],segment:[442,343,485,343]},
    ]},
};
export function getXiPlan(building){const plan=XI_PLANS[building?.xiPlanId??(building?.id===608374573?'84A':'59A')];if(!plan)throw new Error('등록되지 않은 평면 타입');return plan;}
