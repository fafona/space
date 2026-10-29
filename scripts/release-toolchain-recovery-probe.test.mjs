import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';
const target='a'.repeat(40),operationId='10000000-0000-4000-8000-000000000001';
const response=v=>new Response(JSON.stringify(v),{status:200});
function fixture(overrides={}){let clock=0,checks=0;return{options:{origins:['https://example.invalid'],target,operationId,verify:async()=>{checks++;},now:()=>clock,deadlineAtMs:30000,pause:async ms=>{clock+=ms;},fetchImpl:async()=>response({ok:true,buildId:target}),...overrides},checks:()=>checks,setClock:v=>{clock=v;}};}
test('proof requires exact expected build, status and ok flag under fresh ownership checks',async()=>{
 const f=fixture();assert.deepEqual(await proveRecoveryTargets(f.options),[{origin:'https://example.invalid',status:200,buildId:target,attempts:1}]);assert.equal(f.checks(),3);
});
for(const value of [{ok:false,buildId:target},{ok:true,buildId:'b'.repeat(40)},{ok:true},{buildId:target},null])test('wrong or incomplete response cannot prove the expected recovery target',async()=>{
 const f=fixture({fetchImpl:async()=>response(value)});await assert.rejects(proveRecoveryTargets(f.options),/target_unconfirmed/);
});
test('redirects are never followed or accepted and bodies are bounded',async()=>{
 let redirects=0;const f=fixture({fetchImpl:async(_url,options)=>{assert.equal(options.redirect,'manual');redirects++;return new Response('redirect',{status:302,headers:{Location:'https://foreign.invalid'}});}});
 await assert.rejects(proveRecoveryTargets(f.options));assert.equal(redirects,6);
 const huge=fixture({fetchImpl:async()=>new Response('x'.repeat(4097),{status:200})});await assert.rejects(proveRecoveryTargets(huge.options));
});
test('read-only retry can resolve a transient response but never extends the original deadline',async()=>{
 let attempts=0;const f=fixture({fetchImpl:async()=>response(++attempts===1?{ok:false}:{ok:true,buildId:target})});assert.equal((await proveRecoveryTargets(f.options))[0].attempts,2);
 const expired=fixture();expired.options.fetchImpl=async()=>{expired.setClock(30000);return response({ok:true,buildId:target});};await assert.rejects(proveRecoveryTargets(expired.options),/deadline/);
});
test('lost ownership is not swallowed as an HTTP failure or retried',async()=>{
 let count=0,requests=0;const original=Error('ownership-changed'),f=fixture({verify:async()=>{if(++count===2)throw original;},fetchImpl:async()=>{requests++;return response({ok:true,buildId:target});}});
 await assert.rejects(proveRecoveryTargets(f.options),e=>e===original);assert.equal(requests,1);
});
test('all probes settle before a sibling failure is returned',async()=>{
 let finished=false;const original=Error('ownership'),f=fixture({origins:['https://one.invalid','https://two.invalid'],verify:async()=>{},fetchImpl:async url=>{if(url.startsWith('https://one'))throw original;await new Promise(r=>setTimeout(r,30));finished=true;return response({ok:true,buildId:target});}});
 await assert.rejects(proveRecoveryTargets(f.options));assert.equal(finished,true);
});
test('invalid origins, context and expanding budgets are refused before any request',async()=>{
 for(const patch of [{origins:['https://example.invalid/']},{origins:['https://user:password@example.invalid']},{origins:['https://one.invalid','https://one.invalid']},{origins:[]},{target:'other'},{operationId:'other'},{deadlineAtMs:30001},{deadlineAtMs:0}])await assert.rejects(proveRecoveryTargets(fixture(patch).options));
});
async function withServer(handler,work){const sockets=new Set(),server=createServer(handler);server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{return await work('http://127.0.0.1:'+server.address().port);}finally{for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}}
test('real HTTP response slower than the previous one-second limit succeeds within the bounded budget',async()=>{
 await withServer((_req,res)=>{const timer=setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,buildId:target}));},1250);res.once('close',()=>clearTimeout(timer));},async origin=>{
  let checks=0;const start=Date.now(),proof=await proveRecoveryTargets({origins:[origin],target,operationId,verify:async()=>{checks++;},deadlineAtMs:start+5000});
  assert.equal(proof[0].status,200);assert.ok(Date.now()-start>=1200);assert.equal(checks,3);
 });
});
test('real HTTP body stalling after headers is cancelled at the overall deadline',async()=>{
 await withServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');},async origin=>{
  const start=Date.now();await assert.rejects(proveRecoveryTargets({origins:[origin],target,operationId,verify:async()=>{},deadlineAtMs:start+200}),/deadline/);assert.ok(Date.now()-start<2500);
 });
});
