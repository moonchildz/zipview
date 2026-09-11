import test from 'node:test';
import assert from 'node:assert/strict';
import {hubPublicSession} from '../scripts/hub-public-client.mjs';

const form='<meta name="_csrf_header" content="X-CSRF-TOKEN"><meta name="_csrf" content="public-form-token">';
test('public hub client preserves CSRF/session and uses the observed request encodings',async()=>{
  const requests=[];
  const session=await hubPublicSession('/form',async(url,options)=>{
    requests.push({url,options});
    return requests.length===1?new Response(form,{headers:{'Set-Cookie':'SESSION=test; HttpOnly'}}):new Response('{"ok":true}');
  });
  assert.deepEqual(await session.post('/search',{name:'value'}),{ok:true});
  assert.equal(requests[1].options.headers['X-CSRF-TOKEN'],'public-form-token');
  assert.equal(requests[1].options.headers.Cookie,'SESSION=test');
  assert.equal(requests[1].options.body.toString(),'name=value');
  await session.post('/details',{ids:['123']},{json:true});
  assert.equal(requests[2].options.body,'{"ids":["123"]}');
  await assert.rejects(session.post('//elsewhere.test/',{}),/same-origin/);
});
test('public hub client stops on missing CSRF, redirects, or non-JSON responses',async()=>{
  await assert.rejects(hubPublicSession('/form',async()=>new Response('<html/>')),/CSRF/);
  for(const response of [new Response('',{status:302}),new Response('<html>Sign in</html>')]){
    let calls=0;
    const session=await hubPublicSession('/form',async()=>++calls===1?new Response(form):response);
    await assert.rejects(session.post('/search',{}),/HTTP 302|did not return JSON/);
  }
});
