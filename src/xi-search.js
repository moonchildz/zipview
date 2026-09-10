export function mountXiSearch(selection){
  const address=document.querySelector('#address'),building=document.querySelector('#building'),unit=document.querySelector('#unit');
  address.readOnly=false;address.value=new URLSearchParams(location.search).get('complex')??'경희궁자이 2단지';
  building.replaceChildren(...Array.from({length:14},(_,i)=>new Option(`${201+i}동`,String(201+i))));
  if(![...building.options].some(o=>o.value===selection.building))building.add(new Option(`${selection.building}동`,selection.building));
  building.value=selection.building;unit.readOnly=false;unit.value=selection.unit;unit.maxLength=6;
  document.querySelector('#search-form').addEventListener('submit',e=>{
    e.preventDefault();const q=new URLSearchParams({site:'catalog',address:address.value,building:building.value,unit:unit.value});location.href=`/?${q}`;
  });
}
