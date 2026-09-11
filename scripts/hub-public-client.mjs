import {load} from 'cheerio';

export async function hubPublicSession(page,fetchImpl=fetch){
  const origin='https://www.hub.go.kr',cookies=new Map();
  const remember=r=>{for(const value of r.headers.getSetCookie()){const pair=value.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}};
  const initial=await fetchImpl(origin+page,{signal:AbortSignal.timeout(20000)});remember(initial);
  if(!initial.ok)throw new Error(`Public form HTTP ${initial.status}`);
  const html=await initial.text(),dom=load(html),header=dom('meta[name="_csrf_header"]').attr('content'),token=dom('meta[name="_csrf"]').attr('content');
  if(!header||!token)throw new Error('Public form CSRF metadata missing');
  return {html,async post(path,params,{json=false,html=false}={}){
    if(!path.startsWith('/')||path.startsWith('//'))throw new Error('Only same-origin public requests are allowed');
    const r=await fetchImpl(origin+path,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),
      headers:{[header]:token,Accept:html?'text/html':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest',
        'Content-Type':json?'application/json;charset=UTF-8':'application/x-www-form-urlencoded; charset=UTF-8',Referer:origin+page,
        Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')},body:json?JSON.stringify(params):new URLSearchParams(params)});
    remember(r);if(!r.ok)throw new Error(`Public request HTTP ${r.status} at ${path}`);
    const text=await r.text();if(html)return text;
    try{return JSON.parse(text);}catch{throw new Error(`Public request did not return JSON at ${path}`);}
  }};
}
