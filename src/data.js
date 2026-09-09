export const complex = {
  id: 'sinchon-prugio', name: '신촌푸르지오 2단지',
  address: '서울특별시 서대문구 북아현로1길 50',
  aliases: ['신촌푸르지오', '신촌푸르지오2단지', '북아현동1011', '북아현로1길50'],
  buildings: Array.from({ length: 10 }, (_, i) => String(201 + i)),
};

export const plans = [
  { id: '59D', area: 59.88, supply: 81.2, kind: '기본형 · 라인 연결 추정', model: true },
  { id: '84A', area: 84.9892, supply: 114.5488, kind: '확장형', model: true },
  { id: '84B', area: 84.9572, supply: 114.8961, kind: '확장형' },
  { id: '84C', area: 84.9559, supply: 113.6891, kind: '확장형' },
  { id: '84D', area: 84.9738, supply: 115.3325, kind: '확장형' },
  { id: '84E', area: 84.9953, supply: 114.7307, kind: '확장형', model: true },
  { id: '109A', area: 109.0901, supply: 146.6313, kind: '확장형' },
  { id: '109B', area: 109.0901, supply: 146.6313, kind: '임대수익형' },
];

// Only numbered cells visually read from the archived sales allocation chart.
// These are historical plan associations, not a current cadastral unit registry.
export const units = [
  ...[5, 10].map(floor => ({ building: '206', unit: `${floor}04`, type: '59D', floor, scenario: true })),
  { building: '201', unit: '1404', type: '84A', floor: 14 },
  ...Array.from({ length: 8 }, (_, i) => i + 1).flatMap(floor => [2, 3].map(line => ({
    building: '204', unit: `${floor}0${line}`, type: '84E', floor,
  }))),
  { building: '205', unit: '802', type: '84E', floor: 8 },
  { building: '205', unit: '803', type: '84E', floor: 8 },
  { building: '205', unit: '1502', type: '84E', floor: 15 },
  { building: '206', unit: '1502', type: '84E', floor: 15 },
  { building: '206', unit: '1503', type: '84E', floor: 15 },
];

export function lookup(address, building, unit) {
  const normalized = address.replace(/\s/g, '').replace(/^서울특별시서대문구|^서울서대문구|^서대문구/, '');
  if (!complex.aliases.includes(normalized)) return { error: '이번 시범 대상은 북아현로1길 50, 신촌푸르지오 2단지입니다.' };
  const b = building.trim().replace(/동$/, '');
  const u = unit.trim().replace(/호$/, '');
  if (!complex.buildings.includes(b)) return { error: '2단지의 201~210동 중에서 선택해 주세요.' };
  if (!/^[1-9]\d{2,3}$/.test(u)) return { error: '호수를 확인해 주세요. 예: 802' };
  const match = units.find(row => row.building === b && row.unit === u);
  if (!match) return { error: `${b}동 ${u}호는 아직 도면 연결이 확인되지 않았습니다.`, unverified: true };
  return { ...match, evidence: match.scenario ? '분양표 4호 라인 타입 추정 + 사용자 지정 층 시나리오; 해당 호수 존재 미확인' : '분양 당시 동호수 배치표', orientation: null, mirrored: null, terrainElevation: null };
}

export const imagePath = id => `/research/sinchon-prugio/images/${id}.jpg`;
