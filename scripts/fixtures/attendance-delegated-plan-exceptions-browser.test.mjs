// Pure model/script evidence only. This test never launches a browser/listener.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createDelegatedPlanExceptionsBrowserModel,delegatedPlanExceptionsBrowserPaths as paths} from './attendance-delegated-plan-exceptions-browser-model.mjs';
import {delegatedPlanExceptionsBrowserLimits as limits} from './attendance-delegated-plan-exceptions-browser.mjs';
const require=createRequire(import.meta.url),p=require('../../src/lib/merchantAttendanceDelegatedPlanExceptions.ts'),
 {delegatedPlanExceptionsFixtureCommand,delegatedPlanExceptionsModel}=require('./attendance-delegated-plan-exceptions-model.ts');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('209 synthetic browser model preserves actual delegate/full target/full7SHA and GET-only original receipt',async()=>{
 const model=createDelegatedPlanExceptionsBrowserModel(),headers={'x-synthetic-actor':model.seed.delegate},url='http://127.0.0.1:1'+paths.exceptions;
 for(const eligible of [true,false]){model.eligible(eligible);const context=await model.respond(url+'?'+p.delegatedPlanExceptionsQueryString(model.seed.query),'GET','',headers),data=JSON.parse(context.text).data,
   command=await delegatedPlanExceptionsFixtureCommand(data,model.seed.query,model.seed.delegate,eligible?'confirmed':'follow_up',id(209100+(eligible?1:2)));
  assert.equal(data.context.canConclude,eligible);assert.equal(data.context.review.detail.current.eligible,eligible);
  if(!eligible){assert(data.context.review.detail.current.blockers.length>0);for(const outcome of ['confirmed','excused'])
   await assert.rejects(delegatedPlanExceptionsFixtureCommand(data,model.seed.query,model.seed.delegate,outcome,id(209199)));}
  assert.deepEqual(command,{...delegatedPlanExceptionsModel(eligible).command,operationId:command.operationId});
  const post=await model.respond(url,'POST',JSON.stringify({query:model.seed.query,command}),headers),receipt=JSON.parse(post.text).data;
  const recover={siteId:model.seed.siteId,grantId:model.seed.query.grantId,mode:'recover',operationId:command.operationId};
  await p.parseDelegatedPlanExceptionsResult(receipt,recover,model.seed.delegate,command);
  for(const value of ['null','wrong-sha','valid']){model.recovery(value);const result=await model.respond(url+'?'+p.delegatedPlanExceptionsQueryString(recover),'GET','',headers);
   const payload=JSON.parse(result.text).data;if(value==='null')assert.equal(payload.receipt,null);else if(value==='wrong-sha')await assert.rejects(p.parseDelegatedPlanExceptionsResult(payload,recover,model.seed.delegate,command));else assert.deepEqual(payload,receipt);}
 }
 assert.equal(model.writes.length,2);await assert.rejects(model.respond(url+'?'+p.delegatedPlanExceptionsQueryString(model.seed.query),'GET','',{'x-synthetic-actor':model.seed.owner}));
});
test('209 finite browser script is inert, localhost-only, memory-bundled and owns cleanup without production claims',()=>{
 assert.deepEqual(limits,{groups:4,api:30,http:45,posts:3,ttlMs:90000,mobileWidth:390});
 const source=readFileSync(new URL('./attendance-delegated-plan-exceptions-browser.mjs',import.meta.url),'utf8');
 for(const token of ['write:false','127.0.0.1','--run-local','runAttendanceCleanupSteps','server?.closeAllConnections()','context.close()','browser.close()',"actualAdminParent:false","actualSql:false","realAuthority:false","dirty_target_cancel","wrong-sha"])
  assert(source.includes(token),token);
 assert.doesNotMatch(source,/writeFile|execFile|spawn\(|\.screenshot\(|download\.saveAs|https:\/\/faolla/);
});
