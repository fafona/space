//SOURCE and strict synthetic HTTP models only; does NOT launch a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createRemindersBrowserModel,reminderBrowserPaths as p,remindersBrowserLimits} from './attendance-reminders-browser.mjs';
const require=createRequire(import.meta.url),rh=require('../../src/lib/merchantAttendanceRemindersHttp.ts'),r=require('../../src/lib/merchantAttendanceReminders.ts'),
 rp=require('../../src/lib/merchantAttendanceReviewRouting.ts'),cp=require('../../src/lib/merchantAttendanceCycleIntent.ts'),cr=require('../../src/lib/merchantAttendanceCycleIntentResult.ts');
const origin='http://127.0.0.1',owner=m=>({'x-synthetic-actor':m.seed.review.owner}),query=(siteId,mode,batchId=null,operationId=null)=>({siteId,mode,batchId,operationId,cursor:null});
const read=async(m,q,actor=m.seed.review.owner,command=null)=>m.respond(origin+p.reminders+'?'+rh.attendanceReminderHttpQueryString({query:q,expectedCommand:command}),'GET','',{'x-synthetic-actor':actor});
test('201 inert SOURCE has four approved groups, strict caps, memory bundle and owned finally cleanup',async()=>{
 assert.deepEqual(remindersBrowserLimits,{groups:4,api:60,http:85,posts:3,ttlMs:180000,mobileWidth:390});
 const source=await readFile(new URL('./attendance-reminders-browser.mjs',import.meta.url),'utf8');
 assert.equal((source.match(/await group\('/g)??[]).length,4);assert.match(source,/write:false/);assert.match(source,/--run-local/);assert.match(source,/serviceWorkers:'block'/);
 for(const label of ['owned context','owned browser','HTTP work','owned listener','esbuild'])assert(source.includes(label));
 assert.match(source,/original_approval_POST_forbidden/);assert.match(source,/otherFiveOriginalPaths:.*safe_denial_only_not_approval_body_or_success/);
 assert.doesNotMatch(source,/writeFile|mkdir|download\(|execSync|child_process|supabase\/supabase-js/);
});
test('201 six review targets use strict full198 detail hashes; work has original legal positive detail and other five safe-denial only',async()=>{
 const m=await createRemindersBrowserModel();assert.equal(m.refs.length,6);
 for(let n=0;n<m.refs.length;n++){
  const ref=m.refs[n],q={siteId:m.seed.review.siteId,mode:'detail',family:ref.family,requestId:ref.requestId};
  const actual=await m.respond(origin+p.routing+'?'+rp.reviewRoutingQueryString(q),'GET','',owner(m));
  const parsed=await rp.parseReviewRoutingResult(JSON.parse(actual.text).data,q,m.seed.review.owner);assert.deepEqual(parsed.data.request,ref);assert.equal(parsed.data.observation.bindingCurrent,true);
  let u;if(n===0)u=p.work+'?'+new URLSearchParams({siteId:m.seed.review.siteId,access:'owner',requestId:ref.requestId});
  else if(n===1)u=p.correction+'?'+new URLSearchParams({siteId:m.seed.review.siteId,requestId:ref.requestId});
  else if(n===2)u=p.revision+'?'+new URLSearchParams({siteId:m.seed.review.siteId,requestId:ref.requestId});
  else if(n===3||n===4)u=p.missing+'?'+new URLSearchParams({siteId:m.seed.review.siteId,access:'owner',fromDate:'2026-10-08',throughDate:'2026-10-08',requestId:ref.requestId});
  else u=p.leave+'?'+new URLSearchParams({siteId:m.seed.review.siteId,access:'owner',requestId:ref.requestId});
  const original=await m.respond(origin+u,'GET','',owner(m));assert.equal(original.query.requestId,ref.requestId);
  if(n===0){assert.equal(original.status,200);assert.equal(JSON.parse(original.text).detail.reason,'Synthetic trip');assert.equal(original.positiveOriginal,true);}
  else{assert.equal(original.status,503);assert.equal(original.safeDenial,true);}
 }
});
test('201 strict reminders batch binds six ordered heads, lists exact one row and uses actual API query',async()=>{
 const m=await createRemindersBrowserModel(),q=query(m.seed.review.siteId,'detail',m.seed.review.batchId),response=await read(m,q);
 const value=await r.parseAttendanceReminderResult(JSON.parse(response.text).data,q,m.seed.review.owner);assert.equal(value.data.batch.itemCount,6);
 assert.deepEqual(value.data.batch.items.map(i=>i.target.family),m.refs.map(i=>i.family));
 const list=JSON.parse((await read(m,query(q.siteId,'list'))).text);assert.equal(list.data.data.items[0].batchId,q.batchId);assert.equal(list.data.data.nextCursor,null);
});
test('201 period_due reuses strict saved200 detail, accepted actor and original saved date frame',async()=>{
 const m=await createRemindersBrowserModel(),h={'x-synthetic-actor':m.seed.cycle.owner};
 const response=await m.respond(origin+p.cycle+'?'+cp.cycleIntentQueryString(m.cm.query),'GET','',h),v=await cr.parseCycleIntentResult(JSON.parse(response.text).data,m.cm.query,m.seed.cycle.owner);
 assert.equal(v.data.head.action,'accept');assert.equal(v.data.intent.intentFingerprint,m.cm.intent.intentFingerprint);assert.equal(v.data.intent.actorId,m.seed.cycle.owner);
 const q=query(m.seed.cycle.siteId,'detail',m.seed.cycle.batchId),b=await r.parseAttendanceReminderResult(JSON.parse((await read(m,q,m.seed.cycle.owner)).text).data,q,m.seed.cycle.owner);
 assert.equal(b.data.batch.items[0].target.intentId,v.data.intent.intentId);assert.equal(b.data.batch.items[0].target.workerId,v.data.intent.workerId);
});
test('201 complete enterprise overview has actualAuth distinct membership and workerless inbox can read without self worker',async()=>{
 const m=await createRemindersBrowserModel(),e=m.seed.enterprise;
 const response=await m.respond(origin+p.overview+'?siteId='+e.siteId,'GET','',{'x-merchant-access-token':e.tokens.employee});const actual=JSON.parse(response.text);
 assert.equal(actual.currentAuthUserId,e.authUserId);assert.equal(actual.actor.id,e.actorEmployeeId);assert.notEqual(actual.currentAuthUserId,actual.actor.id);
 assert.equal(actual.actor.permissions.includes('attendance.self.view'),false);assert.equal(actual.snapshot.employees.length,0);
 const q=query(e.siteId,'list'),reply=await m.respond(origin+p.reminders+'?'+rh.attendanceReminderHttpQueryString({query:q,expectedCommand:null}),'GET','',{'x-merchant-access-token':e.tokens.employee});
 const result=await r.parseAttendanceReminderResult(JSON.parse(reply.text).data,q,e.authUserId);assert.equal(result.data.items.length,1);
 await assert.rejects(read(m,q,e.actorEmployeeId));
});
test('201 unknown POST and null original GET retain original command; valid original GET SHA matches, flagoff still recovers',async()=>{
 const m=await createRemindersBrowserModel(),e=m.seed.enterprise,q=query(e.siteId,'detail',m.inboxBatch.batchId),c={action:'mark_read',operationId:'20100000-0000-4000-8000-000000000800',batchId:q.batchId};
 m.lose();const reply=await m.respond(origin+p.reminders,'POST',JSON.stringify({query:q,command:c}),{'x-merchant-access-token':e.tokens.employee});assert.throws(()=>JSON.parse(reply.text));assert.equal(m.receipts.size,1);
 const recovery=query(e.siteId,'recover',null,c.operationId);m.recovery('null');const absent=await read(m,recovery,e.authUserId,c);assert.equal(JSON.parse(absent.text).data.receipt,null);
 m.recovery('valid');const response=await m.respond(origin+p.reminders+'?'+rh.attendanceReminderHttpQueryString({query:recovery,expectedCommand:c}),'GET','',{'x-synthetic-actor':e.authUserId,'x-synthetic-enabled':'false'});
 const result=await r.parseAttendanceReminderResult(JSON.parse(response.text).data,recovery,e.authUserId,c);assert.equal(result.receipt.commandFingerprint,await r.attendanceReminderCommandFingerprint(q,e.authUserId,c));
 await assert.rejects(read(m,recovery,m.seed.review.owner,c));await assert.rejects(m.respond(origin+p.reminders,'POST',JSON.stringify({query:q,command:c}),{'x-merchant-access-token':e.tokens.employee}),/duplicate_POST/);
});
test('201 fixture forbids any original business POST and unknown actor/path instead of returning permissive stubs',async()=>{
 const m=await createRemindersBrowserModel();for(const key of ['work','correction','revision','missing','leave','cycle','routing'])await assert.rejects(m.respond(origin+p[key],'POST','{}',owner(m)),/original_business_POST_forbidden/);
 await assert.rejects(m.respond(origin+'/api/unknown','GET','',owner(m)));assert.equal(m.receipts.size,0);
});
test('201 entry uses actual hosts and explicit StrictMode only for new Panel; no invented original navigation or authority',async()=>{
 const source=await readFile(new URL('./attendance-reminders-browser-entry.tsx',import.meta.url),'utf8');
 for(const name of ['MerchantAttendanceAdminPanel','MerchantEnterpriseManager','MerchantAttendanceRemindersPanel','accessToken={seed.enterprise.tokens[config.identity]}','registerLeaveGuard={register}','<StrictMode>'])assert(source.includes(name));
 assert.doesNotMatch(source,/window\.open|location\.href|localStorage|setInterval|supabase\.auth|sessionStorage\.removeItem/);
});
