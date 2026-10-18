import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {merchantLoginReleaseProbeFetch,LOGIN_PROBE_LIMITS} from './merchant-login-release-probe.mjs';
const path='/api/auth/merchant-session',options=()=>({redirect:'manual',headers:{Host:'launch.faolla.com',Connection:'close'}});
test('login probe only permits unauthenticated loopback GET for the exact session path',async()=>{
 const valid='http://127.0.0.1:3110'+path;
 for(const [address,change] of [['https://127.0.0.1:3110'+path,{}],['http://localhost:3110'+path,{}],['http://example.com:3110'+path,{}],[valid+'?accountSwitch=1',{}],[valid+'/extra',{}],[valid,{method:'POST'}],[valid,{body:'payload'}],[valid,{redirect:'follow'}],[valid,{headers:{Host:'www.faolla.com'}}],[valid,{headers:{Host:'launch.faolla.com',Cookie:'synthetic'}}],[valid,{headers:{Host:'launch.faolla.com',Authorization:'synthetic'}}]])await assert.rejects(merchantLoginReleaseProbeFetch(address,{...options(),...change}),/scope_invalid/);
 assert.deepEqual(LOGIN_PROBE_LIMITS,{milliseconds:20000,bodyBytes:65536});
});
test('native session probe preserves Host, buffers response and refuses oversized or aborted reads',async()=>{
 let mode='normal';const calls=[];
 const server=http.createServer((request,response)=>{
  calls.push({host:request.headers.host,method:request.method,path:request.url,cookie:request.headers.cookie,authorization:request.headers.authorization});
  if(mode==='oversized')return response.end(Buffer.alloc(LOGIN_PROBE_LIMITS.bodyBytes+1));
  if(mode==='pending'){response.writeHead(401);response.flushHeaders();return;}
  response.writeHead(401,{'Content-Type':'application/json'});response.end('{"authenticated":false}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=`http://127.0.0.1:${server.address().port}${path}`;
  const response=await merchantLoginReleaseProbeFetch(address,options());assert.equal(response.status,401);assert.deepEqual(await response.json(),{authenticated:false});
  assert.deepEqual(calls[0],{host:'launch.faolla.com',method:'GET',path,cookie:undefined,authorization:undefined});
  mode='oversized';await assert.rejects(merchantLoginReleaseProbeFetch(address,options()),/body_limit/);
  mode='pending';const controller=new AbortController(),task=merchantLoginReleaseProbeFetch(address,{...options(),signal:controller.signal});setTimeout(()=>controller.abort(),20);await assert.rejects(task,/aborted/);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
