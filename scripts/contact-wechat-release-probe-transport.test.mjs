import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {contactWechatReleaseProbeFetch,CONTACT_WECHAT_PROBE_LIMITS} from './contact-wechat-release-probe-transport.mjs';
const path='/api/merchant-enterprise/attendance/admin?siteId=10000000',options=()=>({redirect:'manual',headers:new Headers({Host:'launch.faolla.com',Connection:'close'})});
test('only unauthenticated loopback GET attendance/read-only harness paths are allowed',async()=>{
 const valid='http://127.0.0.1:3110'+path;
 for(const [address,change] of [['https://127.0.0.1:3110'+path,{}],['http://localhost:3110'+path,{}],['http://example.com:3110'+path,{}],['http://user:secret@127.0.0.1:3110'+path,{}],['http://127.0.0.1:3110/write',{}],[valid,{method:'POST'}],[valid,{body:'payload'}],[valid,{redirect:'follow'}],[valid,{headers:{Host:'www.faolla.com'}}],[valid,{headers:{Host:'launch.faolla.com',Cookie:'session=synthetic'}}],[valid,{headers:{Host:'launch.faolla.com',Authorization:'synthetic'}}]])await assert.rejects(contactWechatReleaseProbeFetch(address,{...options(),...change}),/contact_wechat_probe_scope_invalid/);
 assert.deepEqual(CONTACT_WECHAT_PROBE_LIMITS,{milliseconds:20000,bodyBytes:2*1024**2});
});
test('real native HTTP preserves Host, never follows redirects, closes connections and fully buffers bounded bodies',async()=>{
 const calls=[];
 const server=http.createServer((request,response)=>{
  calls.push({host:request.headers.host,connection:request.headers.connection,method:request.method,path:request.url,authorization:request.headers.authorization,cookie:request.headers.cookie});
  if(request.url.startsWith('/api/merchant-enterprise/attendance/admin')){response.writeHead(401,{'Content-Type':'application/json'});response.end('{"synthetic":true}');}
  else {response.writeHead(307,{Location:'/never-follow-this'});response.end('redirect-only');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const origin=`http://127.0.0.1:${server.address().port}`;
  const response=await contactWechatReleaseProbeFetch(origin+path,options());assert.equal(response.status,401);assert.equal(await response.text(),'{"synthetic":true}');
  const redirect=await contactWechatReleaseProbeFetch(origin+'/test-harness/enterprise',options());assert.equal(redirect.status,307);assert.equal(redirect.headers.get('location'),'/never-follow-this');assert.equal(await redirect.text(),'redirect-only');
  assert.equal(calls.length,2);for(const call of calls){assert.equal(call.host,'launch.faolla.com');assert.equal(call.connection,'close');assert.equal(call.method,'GET');assert.equal(call.authorization,undefined);assert.equal(call.cookie,undefined);}
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('oversize interrupted and aborted reads reject without leaking response or credential data',async()=>{
 const server=http.createServer((request,response)=>{
  if(request.url.includes('/admin'))response.end(Buffer.alloc(CONTACT_WECHAT_PROBE_LIMITS.bodyBytes+1));
  else if(request.url.includes('/records')){response.writeHead(401);response.flushHeaders();response.destroy();}
  else {response.writeHead(401);response.flushHeaders();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const origin=`http://127.0.0.1:${server.address().port}`;
  await assert.rejects(contactWechatReleaseProbeFetch(origin+path,options()),/contact_wechat_probe_body_limit/);
  await assert.rejects(contactWechatReleaseProbeFetch(origin+path.replace('/admin','/records'),options()),/contact_wechat_probe_response_failed|contact_wechat_probe_request_failed/);
  const aborted=new AbortController();aborted.abort();await assert.rejects(contactWechatReleaseProbeFetch(origin+path,{...options(),signal:aborted.signal}),/contact_wechat_probe_aborted/);
  const pending=new AbortController(),task=contactWechatReleaseProbeFetch(origin+path.replace('/admin','/self'),{...options(),signal:pending.signal});setTimeout(()=>pending.abort(),20);await assert.rejects(task,/contact_wechat_probe_aborted/);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
