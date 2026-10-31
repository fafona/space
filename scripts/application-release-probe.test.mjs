import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {applicationReleaseProbeFetch,APPLICATION_PROBE_LIMITS} from './application-release-probe.mjs';

test('ordinary release probes preserve the real Host on loopback, never cookies or writes',async()=>{
 const requests=[];
 const server=http.createServer((request,response)=>{requests.push({url:request.url,method:request.method,headers:request.headers});response.writeHead(401,{'content-type':'application/json'});response.end('{"authenticated":false}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const origin='http://127.0.0.1:'+server.address().port;
  for(const path of ['/api/auth/merchant-session','/api/auth/merchant-session?reauth=1','/api/merchant-enterprise/overview?siteId=10000000','/api/bookings?siteId=10000000']){
   const response=await applicationReleaseProbeFetch(origin+path,{redirect:'manual',headers:{Host:'launch.faolla.com',Connection:'close'}});
   assert.equal(response.status,401);assert.equal((await response.json()).authenticated,false);
  }
  assert.equal(requests.length,4);
  for(const request of requests){assert.equal(request.method,'GET');assert.equal(request.headers.host,'launch.faolla.com');assert.equal(request.headers['x-forwarded-proto'],'https');assert.equal(request.headers.cookie,undefined);assert.equal(request.headers.authorization,undefined);}
  for(const [url,options]of [[origin+'/unknown',{}],[origin+'/api/auth/merchant-session',{method:'POST'}],
   [origin+'/api/auth/merchant-session',{headers:{Host:'foreign.invalid'}}],
   [origin+'/api/auth/merchant-session',{headers:{Host:'launch.faolla.com',Cookie:'private'}}],
   ['http://localhost:'+server.address().port+'/api/auth/merchant-session',{}]])
   await assert.rejects(applicationReleaseProbeFetch(url,{redirect:'manual',headers:{Host:'launch.faolla.com'},...options}),/scope_invalid/);
  assert.equal(requests.length,4);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('response-stream stalls and oversized bodies fail rather than becoming successful probe headers',async()=>{
 assert.equal(APPLICATION_PROBE_LIMITS.milliseconds,5000);
 let large=false;
 const server=http.createServer((request,response)=>{response.writeHead(200,{'content-type':'application/json'});if(large)response.end('x'.repeat(APPLICATION_PROBE_LIMITS.bodyBytes+1));else response.write('{');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address='http://127.0.0.1:'+server.address().port+'/api/auth/merchant-session',options={redirect:'manual',headers:{Host:'launch.faolla.com'}};
  await assert.rejects(applicationReleaseProbeFetch(address,{...options,signal:AbortSignal.timeout(40)}),/aborted/);
  large=true;await assert.rejects(applicationReleaseProbeFetch(address,options),/body_limit/);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
