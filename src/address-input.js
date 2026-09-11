export const normalizeAddress = value => String(value ?? '').normalize('NFKC').replace(/서울특별시|서울시/g,'서울').replace(/[\s·(),]/g,'').toLowerCase();

export function splitAddressInput(input){
  const text=String(input??'').normalize('NFKC').trim();
  if(!text||text.length>200||/[\x00-\x1f]/.test(text))throw new Error('주소는 1~200자의 한 줄로 입력해 주세요.');
  const match=text.match(/^(.*?)\s+(\d+)동\s*(?:(\d{3,5})호)?\s*$/);
  return match?{address:match[1].trim(),building:match[2],...(match[3]?{unit:match[3]}:{})}:{address:text};
}

// Short forms come only from stored Seoul addresses, not arbitrary substring matches.
export function addressKeys(value){
  const text=String(value??'').normalize('NFKC').trim(),keys=new Set([normalizeAddress(text)]);
  const plain=text.replace(/(\d)\s*\([^()]*\)\s*$/,'$1');
  keys.add(normalizeAddress(plain));
  const seoul=plain.match(/^(?:서울특별시|서울시|서울)\s*([^\s]+구)\s+(.+)$/);
  if(seoul){keys.add(normalizeAddress(`${seoul[1]} ${seoul[2]}`));keys.add(normalizeAddress(seoul[2]));}
  return [...keys].filter(Boolean);
}
