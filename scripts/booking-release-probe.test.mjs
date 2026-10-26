import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {bookingReleaseProbeFetch as probe,BOOKING_PROBE_LIMITS} from './booking-release-probe.mjs';
const options=host=>({redirect:'manual',headers:{Host:host,Connection:'close'}});
test('actual native transport preserves each fixed Host and HTTPS metadata without following redirects',async()=>{
 const requests=[];const server=http.createServer((req,res)=>{requests.push({url:req.url,host:req.headers.host,proto:req.headers['x-forwarded-proto'],connection:req.headers.connection});
  res.writeHead(req.url==='/booking-manage'?307:401,{Location:'/must-not-follow','Content-Type':'application/json'});res.end('{"authenticated":false}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
  const origin='http://127.0.0.1:'+server.address().port;
  for(const [path,host,status]of [['/booking-manage','launch.faolla.com',307],['/api/bookings?siteId=10000000','launch.faolla.com',401],['/api/super-admin/data-backups','console.faolla.com',401]]){
   const response=await probe(origin+path,options(host));assert.equal(response.status,status);assert.deepEqual(await response.json(),{authenticated:false});
   assert.deepEqual(requests.at(-1),{url:path,host,proto:'https',connection:'close'});
  }assert.equal(requests.length,3);
 }finally{await new Promise(r=>server.close(r));}
});
test('rejects external/credentialed hosts, writes, arbitrary paths, headers and wrong route ownership',async()=>{
 for(const url of ['https://127.0.0.1:123/booking-manage','http://localhost:123/booking-manage','http://user@127.0.0.1:123/booking-manage','http://127.0.0.1:123/api/bookings?siteId=99999999','http://127.0.0.1:123/booking-manage#x','http://127.0.0.1:123/api/orders'])await assert.rejects(probe(url,options('launch.faolla.com')),/scope_invalid/);
 for(const patch of [{method:'POST'},{body:''},{redirect:'follow'},{headers:{Host:'console.faolla.com'}},{headers:{Host:'launch.faolla.com',Authorization:'not-allowed'}}])await assert.rejects(probe('http://127.0.0.1:123/booking-manage',{...options('launch.faolla.com'),...patch}),/scope_invalid/);
});
test('aborted and oversized responses fail closed; limits remain bounded',async()=>{
 assert.deepEqual(BOOKING_PROBE_LIMITS,{milliseconds:20000,bodyBytes:2*1024**2});
 const controller=new AbortController();controller.abort();await assert.rejects(probe('http://127.0.0.1:123/booking-manage',{...options('launch.faolla.com'),signal:controller.signal}),/aborted/);
 const server=http.createServer((req,res)=>{res.writeHead(200);res.end('x'.repeat(BOOKING_PROBE_LIMITS.bodyBytes+1));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await assert.rejects(probe('http://127.0.0.1:'+server.address().port+'/booking-manage',options('launch.faolla.com')),/body_limit/);}finally{await new Promise(r=>server.close(r));}
});
