import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assertLeaveShellFacts,leaveShellBrowserRecord,createLeaveShellResponseHolds} from './merchant-attendance-leave-shell-browser-check.mjs';

const source=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const harness=source('./attendance-self-browser-harness.mjs');
const shell=source('./fixtures/attendance-merchant-shell-browser.tsx');
const portal=source('./fixtures/attendance-portal-browser.tsx');

test('leave shell QA requires actual merchant shell and rejects unrelated fixture flags',()=>{
  assert(harness.includes("const withLeaveShell=withMerchantShell&&process.argv.includes('--leave-shell')"));
  assert(harness.includes("if(process.argv.includes('--leave-shell')&&!withMerchantShell)throw Error('attendance_leave_shell_requires_merchant_shell')"));
  assert(harness.includes("!['--merchant-shell','--leave-shell','--check-only'].includes(flag)"));
  assert(harness.includes("throw Error('attendance_leave_shell_conflicting_entry_flags')"));
  assert(harness.includes("withMerchantShell?'merchant-shell':"));
  assert(!harness.includes("withLeaveShell?'leave':"));
  assert.match(harness,/\|\|withLeaveShell\)&&\["\/enterprise","\/enterprise\/99990001"\]\.includes\(pathname\)/);
});

test('leave shell enables only the two existing leave features without changing standalone modes',()=>{
  assert(harness.includes("if(withLeaveShell)for(const feature of ['LEAVE','LEAVE_NOTIFICATIONS'])portalFeatureDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_'+feature+'_ENABLED']='\"1\"'"));
  assert(harness.includes("NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED']=withLeaveReview?'\"1\"':'\"0\"'"));
  assert(harness.includes("withLeave||withLeaveReview||withLeaveParentBoundary?'\"1\"':'\"0\"'"));
  assert(harness.includes("withLeaveNotifications||withLeaveParentBoundary?'\"1\"':'\"0\"'"));
});

test('existing shell mounts actual AdminClient and employee selector/Portal, not replacement attendance parents',()=>{
  assert(shell.includes('import AdminClient from "../../src/app/admin/AdminClient"'));
  assert(shell.includes('void import("./attendance-portal-browser")'));
  assert(shell.includes('<AdminClient forcedScope="site-99990001"'));
  assert(portal.includes('EnterpriseSelectorClient'));
  assert(portal.includes('EnterprisePortalClient'));
  assert(!/import .*MerchantAttendance(?:Self|Admin|Leave)/.test(shell));
});

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const site='99990001',leave='/api/merchant-enterprise/attendance/leave',notice='/api/merchant-enterprise/attendance/leave-notifications';
const identities={employeeId:id(101),workerId:id(201),authUserId:id(1),ownerId:id(99),submissionId:id(1001),approvalId:id(1002),marked:true};
const proof=()=>({
  requests:[{merchant_id:site,request_id:id(1001),employee_id:id(101),worker_id:id(201),actor_auth_user_id:id(1)}],
  entries:[{merchant_id:site,request_id:id(1001),operation_id:id(1001),revision:1,action:'submit',actor_auth_user_id:id(1)},
    {merchant_id:site,request_id:id(1001),operation_id:id(1002),revision:2,action:'approve',actor_auth_user_id:id(99)}],
  notifications:[{merchant_id:site,notification_id:id(1002),request_id:id(1001),worker_id:id(201),employee_id:id(101),recipient_auth_user_id:id(1),action:'approve',revision:2}],
  reads:[{merchant_id:site,notification_id:id(1002),worker_id:id(201),employee_id:id(101),recipient_auth_user_id:id(1),read_at:'2026-10-04T10:00:00.000001Z'}],
});

test('fact oracle validates each real-flow checkpoint without mutating the evidence',()=>{
  const facts=proof(),before=structuredClone(facts);
  assert.doesNotThrow(()=>assertLeaveShellFacts(facts,identities));
  assert.doesNotThrow(()=>assertLeaveShellFacts({...facts,reads:[]},{...identities,marked:false}));
  assert.doesNotThrow(()=>assertLeaveShellFacts({...facts,entries:facts.entries.slice(0,1),notifications:[],reads:[]},{...identities,approvalId:undefined,marked:false}));
  assert.deepEqual(facts,before);
});

test('fact oracle rejects duplicates, cross-identity facts, wrong original operations and premature read markers',()=>{
  const edits=[f=>f.requests.push(structuredClone(f.requests[0])),f=>f.entries.push(structuredClone(f.entries[1])),
    f=>f.notifications.push(structuredClone(f.notifications[0])),f=>f.reads.push(structuredClone(f.reads[0])),
    f=>f.requests[0].merchant_id='99990002',f=>f.requests[0].employee_id=id(102),f=>f.requests[0].worker_id=id(202),
    f=>f.requests[0].actor_auth_user_id=id(2),f=>f.requests[0].request_id=id(555),f=>f.entries[0].merchant_id='99990002',
    f=>f.entries[0].operation_id=id(555),f=>f.entries[0].actor_auth_user_id=id(99),f=>f.entries[1].revision=3,
    f=>f.entries[1].action='reject',f=>f.entries[1].actor_auth_user_id=id(1),f=>f.entries[1].operation_id=id(1001),
    f=>f.notifications[0].request_id=id(555),f=>f.notifications[0].recipient_auth_user_id=id(2),
    f=>f.notifications[0].notification_id=id(555),f=>f.reads[0].recipient_auth_user_id=id(2),
    f=>f.reads[0].worker_id=id(202),f=>f.reads[0].read_at='invalid'];
  for(const edit of edits){const facts=proof();edit(facts);assert.throws(()=>assertLeaveShellFacts(facts,identities));}
  assert.throws(()=>assertLeaveShellFacts(proof(),{...identities,marked:false}));
});

test('safe request projection reads original query/command envelopes without retaining reasons or credentials',()=>{
  const secret='NEVER-LOG-THIS-REASON-OR-TOKEN';
  const record=leaveShellBrowserRecord(leave,'POST',200,{ok:true,password:secret},{query:{siteId:site,access:'self'},command:{action:'submit',operationId:id(1001),reason:secret},access_token:secret});
  assert.equal(record.action,'submit');assert.equal(record.operationId,id(1001));assert(!JSON.stringify(record).includes(secret));
  const noticeRecord=leaveShellBrowserRecord(notice,'POST',200,{ok:true},{query:{siteId:site},command:{action:'mark_read',notificationId:id(1002),reason:secret}});
  assert.equal(noticeRecord.action,'mark_read');assert.equal(noticeRecord.notificationId,id(1002));assert(!JSON.stringify(noticeRecord).includes(secret));
  const login=leaveShellBrowserRecord('/api/merchant-enterprise/employees/accept','POST',200,{ok:true,access_token:secret},{password:secret});
  assert.deepEqual(login,{path:'/api/merchant-enterprise/employees/accept',method:'POST',status:200,error:null});
});

test('diagnostic projection does not admit arbitrary actions or identifier-shaped secrets',()=>{
  for(const bad of ['NEVER-LOG-SECRET',{reason:'NEVER-LOG-SECRET'},['NEVER-LOG-SECRET'],null]){
    const projected=leaveShellBrowserRecord(leave,'POST',403,{error:{password:bad}},{command:{action:bad,operationId:bad}},{operationId:bad});
    assert.equal(projected.action,null);assert.equal(projected.operationId,null);assert.equal(projected.error,null);
    const projectedNotice=leaveShellBrowserRecord(notice,'GET',200,{ok:true},null,{notificationId:bad});
    assert.equal(projectedNotice.notificationId,null);
  }
  assert.equal(leaveShellBrowserRecord(leave,'GET',200,{ok:true},null,{operationId:id(1001)}).operationId,id(1001));
});

test('runner keeps actual handlers, owned current SQL, strict confirmations and explicit synthetic boundaries',()=>{
  const runner=source('./merchant-attendance-leave-shell-browser-check.mjs');
  for(const text of ['prepareLeaveNotificationsNativeFixture','202610020111_merchant_attendance_self_clock_identity.sql',
    'withAttendanceConcurrencySandbox','createAttendanceLeaveShellTransport(data.exec)',"'--merchant-shell','--leave-shell'",
    'dialogState.expected===dialog.message()',"route.abort('connectionreset')",'originalPending','submittedFacts','protectedBefore',
    'realOuterEnterpriseHandlers:false','realAuthService:false','realPhone:false','productionAccess:false'])assert(runner.includes(text),text);
  assert(!/initdb|mkdtemp|writeFile|DATABASE_URL|dotenv/.test(runner));
  assert(runner.indexOf('data.exec(currentSelf)')<runner.indexOf('const protectedBefore='));
});

test('response holds are inert, actor-scoped and reject invalid or ambiguous gates',async()=>{
  const holds=createLeaveShellResponseHolds();assert.equal(holds.pendingCount(),0);
  for(const patch of [{actorId:id(99)},{path:'/api/orders'},{method:'DELETE'},{extra:true}])
    assert.throws(()=>holds.holdResponse({actorId:id(1),path:leave,method:'POST',...patch}));
  const gate=holds.holdResponse({actorId:id(1),path:leave,method:'POST'});
  assert.throws(()=>holds.holdResponse({actorId:id(1),path:leave,method:'POST'}));
  await assert.rejects(gate.release(),/leave_shell_release_before_sql/);
  let delivered=false;
  assert.equal(await holds.deliver({actorId:id(2),path:leave,method:'POST',status:200},{},()=>{delivered=true;}),false);
  await assert.rejects(holds.deliver({actorId:id(1),path:leave,method:'POST',status:403},{},()=>{}),/leave_shell_hold_requires_success/);
  assert.equal(delivered,false);holds.close();assert.throws(()=>holds.holdResponse({actorId:id(1),path:leave,method:'GET'}));
});

test('ABA response gates independently hold old POST and fresh GET until explicit release',async()=>{
  const holds=createLeaveShellResponseHolds(),order=[],post=holds.holdResponse({actorId:id(1),path:notice,method:'POST'});
  const original={notificationId:id(2001),detail:{readAt:'2026-10-04T10:00:00Z'}};
  const old=holds.deliver({actorId:id(1),path:notice,method:'POST',status:200},original,()=>{order.push('old');});
  const payload=await post.ready();payload.detail.readAt='changed-in-test';assert.equal(original.detail.readAt,'2026-10-04T10:00:00Z');
  const get=holds.holdResponse({actorId:id(1),path:notice,method:'GET'});
  const fresh=holds.deliver({actorId:id(1),path:notice,method:'GET',status:200},original,()=>{order.push('fresh');});
  await get.ready();assert.deepEqual(order,[]);assert.equal(holds.pendingCount(),2);
  await post.release();assert.deepEqual(order,['old']);assert.equal(holds.pendingCount(),1);
  await get.release();assert.deepEqual(order,['old','fresh']);assert.equal(holds.pendingCount(),0);
  assert.equal(await old,true);assert.equal(await fresh,true);holds.close();
});

test('held delivery errors propagate and cleanup releases claimed responses without inventing output',async()=>{
  const holds=createLeaveShellResponseHolds(),gate=holds.holdResponse({actorId:id(1),path:leave,method:'GET'});
  const work=holds.deliver({actorId:id(1),path:leave,method:'GET',status:200},{receipt:null},()=>{throw Error('delivery_failed');});
  const rejected=assert.rejects(work,/delivery_failed/);await gate.ready();holds.close();await rejected;
  assert.equal(holds.pendingCount(),0);
});

test('account scenario preserves validated principals, strict writes and bounded UUID-only projections',()=>{
  const runner=source('./merchant-attendance-leave-shell-browser-check.mjs');
  assert(runner.includes('actorId=identity.user.id'));
  assert(runner.includes("'leave_shell_other_employee_write_forbidden'"));
  assert(runner.includes("r.failure()?.errorText!=='net::ERR_ABORTED'"));
  assert(runner.includes('closing=true;holds.close()'));
  const secret='NEVER-LOG-COMMAND-REASON';
  assert.equal(leaveShellBrowserRecord(leave,'GET',200,{},null,{requestId:id(1001)}).requestId,id(1001));
  const record=leaveShellBrowserRecord(notice,'GET',200,{},null,{expectedEmployeeId:id(101),expectedWorkerId:secret,notificationId:id(2001)});
  assert.equal(record.expectedEmployeeId,id(101));assert.equal(record.expectedWorkerId,null);assert(!JSON.stringify(record).includes(secret));
});
