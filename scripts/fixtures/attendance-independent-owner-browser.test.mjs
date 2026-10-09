// SOURCE/model tests only. Import never launches browser, PostgreSQL or Auth.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createIndependentOwnerBrowserModel,independentOwnerBrowserLimits} from './attendance-independent-owner-browser.mjs';
const require=createRequire(import.meta.url),p=require('../../src/lib/merchantAttendanceIndependent.ts'),f=require('./attendance-independent-ui-model.ts');
const api='http://127.0.0.1/api/merchant-enterprise/attendance/independent';
const get=async(m,query)=>JSON.parse((await m.respond(api+'?'+p.independentQueryString(query),'GET','',m.seed.owner)).text).data;
const detail=subjectId=>({siteId:f.independentUiSite,mode:'detail',subjectId});
async function create(m){const command=f.independentUiCommand(),query=detail(command.subjectId);const response=await m.respond(api,'POST',JSON.stringify({query,command}),m.seed.owner);
 assert.throws(()=>JSON.parse(response.text));return command;}
function change(m,subjectId,action,n){
 const e=m.subjects.get(subjectId),s=e.subject,c=e.credential;
 const command={operationId:f.independentUiId(n),subjectId,expectedSettingsVersion:1,expectedSubjectRevision:s.revision,expectedGeneration:s.generation,expectedWorkerVersion:s.workerVersion,reason:'Synthetic196 exact model change',action};
 if(action==='issue_pin'||action==='revoke_pin'||action==='bind_member')command.expectedCredentialRevision=c.revision;
 if(action==='bind_member')Object.assign(command,{targetEmployeeId:m.seed.member,targetAuthUserId:m.seed.memberAuth,expectedLastEventId:e.head.lastEventId,expectedSequence:e.head.sequence});
 return command;
}
async function send(m,c){return m.respond(api,'POST',JSON.stringify({query:detail(c.subjectId),command:c,...(c.action==='issue_pin'?{pin:'12345678'}:{})}),m.seed.owner);}
async function issued(m){const c=await create(m);await send(m,change(m,c.subjectId,'enable',101));await send(m,change(m,c.subjectId,'issue_pin',102));return c;}

test('196 owner real parent GET and candidate models satisfy the exact existing parsers, with no membership endpoint',async()=>{
 const m=await createIndependentOwnerBrowserModel(),ap=require('../../src/lib/merchantAttendanceAdmin.ts');
 const url='http://127.0.0.1/api/merchant-enterprise/attendance/admin?siteId='+m.seed.siteId+'&view=settings',reply=await m.respond(url,'GET','',m.seed.owner);
 ap.parseAttendanceAdminResult(JSON.parse(reply.text),ap.parseAttendanceAdminQuery(url));
 for(const mode of ['list','locations','members']){
  const q=mode==='list'?{siteId:m.seed.siteId,mode,cursor:null,search:'',state:'all'}:{siteId:m.seed.siteId,mode,cursor:null,search:''};
  const r=await get(m,q);await p.parseIndependentAdminResult(r,q,m.seed.owner);assert.equal(r.data.kind,mode);
  if(mode==='members'){assert.equal(r.data.items[0].authUserId,m.seed.memberAuth);assert.equal(r.data.items[0].employeeId,m.seed.member);}
 }
 assert.equal(m.records.size,0);await assert.rejects(m.respond(api,'GET','',m.seed.other),/synthetic_original_owner_only/);
});
test('196 unknown create has one saved original, null recovery remains distinguishable, exact receipt uses strict command hash',async()=>{
 const m=await createIndependentOwnerBrowserModel(),c=await create(m),q={siteId:m.seed.siteId,mode:'recover',subjectId:c.subjectId,operationId:c.operationId};
 assert.equal(m.records.size,1);assert.equal(m.subjects.get(c.subjectId).subject.enabled,false);m.hideReceipt(true);assert.equal((await get(m,q)).receipt,null);
 m.hideReceipt(false);const r=await get(m,q);await p.parseIndependentAdminResult(r,q,m.seed.owner,c);
 assert(p.independentAdminReceiptMatches(r.receipt,c,m.seed.owner,await p.independentAdminCommandFingerprint(m.seed.siteId,m.seed.owner,c)));
 await assert.rejects(send(m,c),/unexpected_duplicate_owner_POST/);assert.equal(m.records.size,1);
});
test('196 enable, transient issue and closedhead binding preserve52 synthetic historical receipts without relabelling',async()=>{
 const m=await createIndependentOwnerBrowserModel(),c=await issued(m),e=m.subjects.get(c.subjectId);assert(e.subject.enabled&&e.credential.enabled);
 assert.equal(e.head.status,'off');assert.equal(e.head.sequence,52);assert.equal(m.history.length,26);const original=JSON.stringify(m.history);
 const bind=change(m,c.subjectId,'bind_member',103);await send(m,bind);const r=await get(m,detail(c.subjectId));assert.equal(r.data.subject.state,'bound');assert.equal(r.data.credential.enabled,false);
 assert.equal(r.data.binding.employeeAuthUserId,m.seed.memberAuth);assert.equal(r.data.binding.lastIndependentEventId,m.history.at(-1).endEventId);
 assert.equal(JSON.stringify(m.history),original);assert.equal(m.history.flatMap(h=>h.events).length,52);assert(m.history.flatMap(h=>h.events).every(r=>r.event.actorEmployeeId===null&&r.command.generation===0));
 assert.doesNotMatch(JSON.stringify([...m.records.values()]),/12345678|"pin"|verifier|salt/);
});
test('196 raw history has strict chronological complete pages25+1 and is never called payroll or fixed-period eligible',async()=>{
 const m=await createIndependentOwnerBrowserModel(),c=await issued(m),q={siteId:m.seed.siteId,mode:'history',subjectId:c.subjectId,fromDate:'2026-10-08',throughDate:'2026-10-08',cursor:null};
 const first=await get(m,q);assert.equal(first.data.report.items.length,25);assert.equal(first.data.report.nextCursor,m.history[24].startEventId);assert.equal(first.data.report.rangeComplete,false);
 const last=await get(m,{...q,cursor:first.data.report.nextCursor});assert.equal(last.data.report.items.length,1);assert.equal(last.data.report.nextCursor,null);assert.equal(last.data.report.rangeComplete,false);
 assert.equal(first.data.report.rulesAssessment,'unassessed');assert.equal(first.data.report.fixedPeriodEligible,false);
 assert.equal(last.data.report.items[0].startEventId,m.history[25].startEventId);
});
test('196 disable and revoke use different explicit preseed subjects and never undo a real prior disable/binding',async()=>{
 const m=await createIndependentOwnerBrowserModel(),disabled=m.seed.disableSubject,revoked=m.seed.revokeSubject;assert.notEqual(disabled,revoked);
 await send(m,change(m,disabled,'disable',104));assert.equal(m.subjects.get(disabled).subject.enabled,false);assert.equal(m.subjects.get(disabled).credential.enabled,false);
 assert.equal(m.subjects.get(revoked).credential.enabled,true);await send(m,change(m,revoked,'revoke_pin',105));assert.equal(m.subjects.get(revoked).subject.enabled,true);assert.equal(m.subjects.get(revoked).credential.enabled,false);
 assert.equal(m.subjects.get(disabled).credential.revision,2);assert.equal(m.subjects.get(revoked).credential.revision,2);assert.equal(m.records.size,2);
});
test('196 owner runner is finite memory-only with actual parent/Launcher, six distinct writes and owned cleanup',async()=>{
 assert.deepEqual(independentOwnerBrowserLimits,{groups:4,ttlMs:180000,http:60,api:35,posts:6,mobileWidth:390});
 const runner=await readFile(new URL('./attendance-independent-owner-browser.mjs',import.meta.url),'utf8'),entry=await readFile(new URL('./attendance-independent-owner-browser-entry.tsx',import.meta.url),'utf8');
 for(const value of ['write:false',"server.listen(0,'127.0.0.1'",'serviceWorkers:\'block\'','acceptDownloads:false','actualAuth:false','actualSql:false','syntheticHistoryReceipts:52',
  "process.argv[2]==='--run-local'",'runAttendanceCleanupSteps','assert(!browser?.isConnected()&&!server?.listening)',"stage='actual_parent_guard_and_inert_child'"])assert(runner.includes(value),value);
 for(const value of ['MerchantAttendanceAdminPanel','MerchantAttendanceIndependentAdminLauncher','registerLeaveGuard={register}','isCurrentAuth={current}',
  'new ReadableStream','config.requester','authValid: value','flushSync','pagehide: ()'])assert(entry.includes(value),value);
 assert(!/writeFile|screenshot\(|download\.saveAs|initdb|\.server\.ts'/.test(runner));assert(!runner.includes('memberships'));
 for(const action of ['create','enable','issue_pin','bind_member','disable','撤销 PIN'])assert(runner.includes(action),action);
 assert(runner.includes("await click('读取档案');await click((await dialog()"));assert(runner.includes('setDefaultTimeout(10000)'));
 assert(runner.includes('assert.equal(requests.length,35)'));assert(runner.includes('assert.equal(posts,6)'));
});
test('196 dirty close diagnostic preserves native confirm and only records nonsecret lifecycle/DOM booleans',async()=>{
 const runner=await readFile(new URL('./attendance-independent-owner-browser.mjs',import.meta.url),'utf8'),entry=await readFile(new URL('./attendance-independent-owner-browser-entry.tsx',import.meta.url),'utf8');
 for(const value of ['const nativeConfirm = window.confirm.bind(window)','const result = nativeConfirm(message)','events.confirms.push','modalCloses','modalCancels','reasonPresent','reasonNonempty','pinPresent','pinNonempty','pauseStatus'])assert(entry.includes(value),value);
 assert(runner.includes("closeObservation.confirms,[{kind:'leave',result:false}]"));assert(runner.includes('JSON.stringify(closeObservation)'));assert(runner.includes('beforeClose.modalOpen&&beforeClose.reasonNonempty&&beforeClose.pinNonempty'));
 assert(!runner.includes("inputValue(),'Synthetic196 private draft'"));
 const body=entry.slice(entry.indexOf('function observations()'),entry.indexOf('window.fetch ='));
 assert(!/value\s*:\s*.*\.value|reason\s*:\s*|pin\s*:\s*/.test(body));assert(!body.includes('textContent:'));
});
