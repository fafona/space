//SOURCE/model only; deliberately does not create esbuild/browser/listener.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createRecipientReminderModel,recipientReminderPaths as p,recipientReminderLimits} from './attendance-reminders-recipient-browser.mjs';
const require=createRequire(import.meta.url),rh=require('../../src/lib/merchantAttendanceRemindersHttp.ts'),r=require('../../src/lib/merchantAttendanceReminders.ts'),c=require('../../src/lib/merchantAttendanceCorrectionDelegation.ts');
const origin='http://127.0.0.1',headers=(m,identity)=>({'x-merchant-access-token':m.seed.tokens[identity]});
test('201 recipient runner is inert, two finite GET-only groups with memory bundle and owned cleanup',async()=>{
 assert.deepEqual(recipientReminderLimits,{groups:2,api:32,http:40,posts:0,ttlMs:120000,mobileWidth:390});const source=await readFile(new URL('./attendance-reminders-recipient-browser.mjs',import.meta.url),'utf8');
 assert.equal((source.match(/await group\('/g)??[]).length,2);for(const value of ['write:false','--run-local',"serviceWorkers:'block'",'recipient_business_POST_forbidden','self_hint_mount_is_local_only','consumed_hint_must_not_reopen',"['grants','list','detail']",'owned context','owned browser','owned listener','HTTP work','esbuild'])assert(source.includes(value),value);
 assert.doesNotMatch(source,/writeFile|mkdir|screenshot|download\(|ObjectURL|child_process|supabase\/supabase-js/);
 const entry=await readFile(new URL('./attendance-reminders-recipient-browser-entry.tsx',import.meta.url),'utf8');assert.match(entry,/MerchantEnterpriseManager/);assert.match(entry,/navigation=\{navigation\}/);assert.doesNotMatch(entry,/MerchantAttendanceRemindersPanel|MerchantAttendanceCorrectionDelegationPanel|setInterval|sessionStorage\.removeItem/);
});
test('201 self synthetic model is strict full193 current session plus a valid stale pointer, actual Auth differs membership',async()=>{
 const m=await createRecipientReminderModel(),q={siteId:m.seed.siteId,mode:'detail',batchId:m.seed.self.batchId,operationId:null,cursor:null};
 const read=()=>m.respond(origin+p.reminders+'?'+rh.attendanceReminderHttpQueryString({query:q,expectedCommand:null}),'GET','',headers(m,'self'));
 let reply=JSON.parse((await read()).text).data;await r.parseAttendanceReminderResult(reply,q,m.seed.self.authUserId);assert.notEqual(reply.data.batch.items[0].target.startEventId,m.currentSession.session.startEventId);
 m.pointer(true);reply=JSON.parse((await read()).text).data;assert.equal(reply.data.batch.items[0].target.startEventId,m.currentSession.session.startEventId);
 const prepared=JSON.parse((await m.respond(origin+p.self+'?'+new URLSearchParams({siteId:m.seed.siteId,mode:'prepare'}),'GET','',headers(m,'self'))).text).data;
 assert.equal(prepared.session.employeeId,m.seed.self.employeeId);assert.equal(prepared.session.employeeAuthUserId,m.seed.self.authUserId);assert.notEqual(m.seed.self.employeeId,m.seed.self.authUserId);assert.equal(prepared.operation,null);assert.equal(prepared.clock.receipt,null);
 await assert.rejects(m.respond(origin+p.self+'?siteId='+m.seed.siteId+'&mode=prepare','GET','',headers(m,'delegate')));await assert.rejects(m.respond(origin+p.reminders,'POST','{}',headers(m,'self')),/recipient_business_POST_forbidden/);
});
test('201 correction model uses actual old parser and exact explicit grants/list/detail, not directory/owner/automatic approval',async()=>{
 const m=await createRecipientReminderModel();assert(!m.actor('delegate').permissions.includes('attendance.self.view'));
 for(const mode of ['grants','list','detail']){const q={siteId:m.seed.siteId,access:'delegate',mode,grantId:mode==='grants'?null:m.grant.grantId,requestId:mode==='detail'?m.original.requestId:null,operationId:null,beforeAt:null,beforeId:null,afterId:null};
  const u=origin+p.correction+'?'+c.correctionDelegationQueryString(q),body=JSON.parse((await m.respond(u,'GET','',headers(m,'delegate'))).text);
  const parsed=c.parseCorrectionDelegationResponse(body,q,{authUserId:m.seed.delegate.authUserId,employeeId:m.seed.delegate.employeeId},null);assert.equal(parsed.protocol,'delegated-corrections-v1');
  if(mode==='detail'){assert.deepEqual(parsed.detail,m.original);assert.equal(parsed.detail.employeeId,m.grant.worker.employeeId);assert.equal(parsed.detail.locationId,m.grant.location.locationId);}}
 await assert.rejects(m.respond(origin+'/api/unknown','GET','',headers(m,'delegate')));await assert.rejects(m.respond(origin+p.correction+'?siteId='+m.seed.siteId+'&access=owner&mode=list','GET','',headers(m,'delegate')));
});
