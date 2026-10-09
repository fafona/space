// Pure/static contracts, not claims that SQL or a browser has run.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
import {checkAttendanceSelfSchedule,prepareSelfScheduleNativeFixture,selfScheduleNativeLabels,selfScheduleNativeFailure} from './merchant-attendance-self-schedule-native.mjs';
import {selfScheduleExpression,selfScheduleRequest,selfScheduleMigration,selfScheduleRpc,selfScheduleIdentity} from './fixtures/attendance-self-schedule-native.mjs';

const source=readFileSync(new URL('./merchant-attendance-self-schedule-native.mjs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/attendance-self-schedule-native.mjs',import.meta.url),'utf8');
const markers=(text,values)=>{for(const value of values)assert(text.includes(value),value);};

test('inert entry exports one owned-namespace checker and reusable same-fixture browser callback',()=>{
  assert.equal(typeof checkAttendanceSelfSchedule,'function');assert.equal(typeof prepareSelfScheduleNativeFixture,'function');
  assert.equal(selfScheduleNativeLabels.length,9);assert(Object.isFrozen(selfScheduleNativeLabels));assert.equal(new Set(selfScheduleNativeLabels).size,9);
  markers(source,['withAttendanceConcurrencySandbox(native,async scope','browser=await browserCheck(native,scope,d)',"phase='bounded-101-choice-list'",
    'browser_must_finish_owned_clock','if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))']);
  assert(source.indexOf('browser=await browserCheck')<source.indexOf("phase='bounded-101-choice-list'"));
  assert.doesNotMatch(source+fixture,/\b(?:spawn|spawnSync|execSync|createServer|listen)\s*\(|prepareBoundClocksNativeFixture\(|checkAttendanceBoundClocks/);
});

test('minimal dependencies retain136 concurrent phases and install137 only after111134136',()=>{
  assert.equal(selfScheduleMigration,'202610050137_merchant_attendance_self_schedule.sql');
  markers(fixture,['prepareGroupsNativeFixture(native,scope)','boundClockFixtureMigrations',
    '202610010099_merchant_attendance_schedule.sql','202610040133_merchant_attendance_shift_rule_bindings.sql','202610040134_merchant_attendance_bound_clocks.sql',
    "native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610050136_merchant_attendance_schedule_publication_evidence.sql'),'utf8')))",
    'exec(boundClockMigrationBody(native.root,selfScheduleMigration))']);
  assert.doesNotMatch(fixture,/boundClockMigrationBody\([^\n]*136|terminalHash|randomBytes|terminal_admin_v1|pin_admin_v1|boundClockPastSeed\(/);
});

test('exact RPC argument expression rejects unknown fields names booleans or identity injection',()=>{
  const args={p_site_id:'99990001',p_auth_user_id:id(1),p_command:{reason:"O'Hara"},p_selection:null,p_operation_id:null,p_allow_write:true,p_bind_rules:false};
  assert.equal(selfScheduleRpc,'faolla_attendance_self_schedule_v1');
  assert.equal(selfScheduleExpression(args),`public.faolla_attendance_self_schedule_v1('99990001','${id(1)}','{"reason":"O''Hara"}'::jsonb,null,null,true,false)`);
  assert.throws(()=>selfScheduleExpression({...args,extra:true}));assert.throws(()=>selfScheduleExpression({...args,p_bind_rules:'true'}));
  assert.throws(()=>selfScheduleExpression({...args,p_allow_write:null}));assert.throws(()=>selfScheduleExpression({...args,p_auth_user_id:"';select 1;--"}));
  assert.throws(()=>selfScheduleExpression({...args,p_site_id:'not-a-site'}));
});

test('canonical requests distinguish body-only POST and original-ID GET without an injected identity',async()=>{
  const c={expectedWorkerId:id(201),operationId:id(8000),locationId:id(301),action:'clock_in',expectedSequence:0};
  const body={siteId:'99990001',command:c,selection:{slotId:id(400),revision:1}},post=selfScheduleRequest('POST',body);
  assert.equal(post.url,'https://www.faolla.com/api/merchant-enterprise/attendance/self-schedule');assert.equal(post.headers.get('origin'),'https://www.faolla.com');
  assert.equal(post.headers.get('content-type'),'application/json');assert.deepEqual(await post.json(),body);
  const get=selfScheduleRequest('GET',{siteId:'99990001',operationId:null});assert.equal(get.url,'https://www.faolla.com/api/merchant-enterprise/attendance/self-schedule?siteId=99990001');
  assert.equal(get.body,null);assert(selfScheduleRequest('GET',{siteId:'99990001',operationId:c.operationId}).url.endsWith('operationId='+c.operationId));
  assert.throws(()=>selfScheduleRequest('DELETE',{}));
});

test('future schedules use actual099136 publications including old absence of evidence and saved overnight UTC',()=>{
  assert(Object.isFrozen(selfScheduleIdentity));assert.equal(selfScheduleIdentity.foreign,'99990002');
  markers(fixture,["evidenced?'faolla_attendance_schedule_evidenced_v1':'faolla_attendance_schedule_v1'",'expectedRevision:scheduleRevision(siteId)',
    'T23:30:00.000Z','T00:30:00.000Z','{evidenced:false}','workerId:d.otherWorker','siteId:d.foreign',
    'slots:result.entries.filter(s=>s.revision===command.expectedRevision+1)']);
  assert.doesNotMatch(fixture,/insert into public\.merchant_attendance_schedule_(?:commands|slots|publication_evidence)|update public\.merchant_attendance_events/i);
});

test('successful native checks invoke actual HTTP handler service strict decoder and audited RPCs',()=>{
  markers(fixture,["require('../../src/lib/merchantAttendanceSelfSchedule.server.ts')","require('../../src/app/api/merchant-enterprise/attendance/self-schedule/route-handler.ts')",
    'executeAttendanceSelfSchedule(requestInput,service)','handleAttendanceSelfSchedule(request',
    'name===selfScheduleRpc?selfScheduleExpression(args):boundClockRpcExpression(name,args)',
    'parseSelfScheduleHttpResult(body,{siteId:d.site,command:c,operationId,...(c?{selection}:{})})',"response.headers.get('cache-control'),'private, no-store'"]);
  markers(source,["await fresh(null,'unselected')","await fresh(slots.legacy,'unverified','publication_missing')","await fresh(slots.cancelBefore,'unverified','cancelled')",
    "assert.equal(later.association.status,'linked')","assert.equal(later.association.currentCancelled,true)","assert.equal(later.association.slot.cancelled,false)"]);
});

test('same-slot work sessions remain distinct and old operations cannot acquire new selection',()=>{
  markers(source,['assert.notEqual(second.result.clock.receipt.id,linked.result.clock.receipt.id)',"status='linked';`),'2'",
    'assert.deepEqual(replay.association,linked.result.association)',"await bad(linked.command,null,409,'attendance_operation_conflict')",
    'assert.equal(original.association,null)','assert.equal(legacyRead.association,null)','assert.deepEqual(counts(),{events:14,relations:6,bindings:0,sources:0})']);
  assert.doesNotMatch(source,/update public\.merchant_attendance_events|set\s+occurred_at|set\s+received_at/i);
});

test('authorization probes leave no event and local interval warnings are not normalized into punctuality',()=>{
  markers(source,[["slots.other,slots.foreign",'id(999991)','attendance_access_denied','attendance_invalid_request'],
    ["set auth_user_id='${id(3)}'",'[slots.main,slots.legacy].map(slot=>deny','p_auth_user_id:d.otherAuth',"'outside_window'","'location_changed'",'slot.startAt','slot.endAt'],
    ['self_schedule_rollback_probe_changed_facts','actualCrossMidnightWait:false','automaticMatchingClaimed:false']].flat());
  assert.doesNotMatch(source+fixture,/disable\s+trigger|session_replication_role|drop\s+constraint|update\s+pg_/i);
});

test('independent rule flag records only enabled start and relation failure proves atomicity before cleanup',()=>{
  markers(source,["FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED='1'","FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED='0'",
    "assert.equal(binding.status,'verified')","value->>'state'='unconfigured'",'qa_self_schedule_required_failure check(false) not valid',
    'exception when check_violation','relation_failure_left_clock','relation_failure_event_count','relation_failure_left_relation','relation_failure_left_binding','relation_failure_left_source']);
  const atomic=source.slice(source.indexOf("phase='independent-rule-flag-and-atomic-fault'"),source.indexOf("phase='two-connection-ordering'"));
  assert(atomic.indexOf('relation_failure_left_clock')>atomic.indexOf('exception when check_violation'));
  markers(source,['assert.deepEqual(counts(),{events:18,relations:8,bindings:1,sources:1})','assert.deepEqual(counts(),{events:26,relations:12,bindings:1,sources:1})']);
});

test('four bounded two-connection races use actual backend blocker evidence with both cancellation orders',()=>{
  markers(source,['lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql}','assert(r.witnessed)',
    'd.cancelExpression(cancelFirst)','cancelRace.right.output',"cancelledRace.association.reason,'cancelled'",'clockRace.left',
    "firstClock.association.status,'linked'","afterRace.association.currentCancelled,true",'duplicated.right.output',
    'assert.deepEqual(right.association,left.association)','attendance_sequence_conflict','actualConnectionRaces:4']);
  assert.doesNotMatch(source,/setTimeout|pg_sleep/);
});

test('feature rollback and paused reads differ from total self off; 101 cap preserves known receipt',()=>{
  markers(source,['flagRead.selectionEnabled,false','flagRead.choices.entries,[]','attendance_self_schedule_disabled','pausedRead.moduleEnabled,false',
    'attendance_platform_paused','baseEnabled:()=>false','attendance_not_available','d.calls.length,called',
    'needed=101-existing','batch=Math.min(32,needed)','limited.choices.limited,true','limited.choices.entries,[]','stillKnown.association,linked.result.association']);
});

test('private ACL append-only reapply and protected fingerprints preserve all nontarget facts and restore flags',()=>{
  markers(source,['has_table_privilege','has_function_privilege','relation_direct_insert_accepted','private_slot_helper_accepted',
    'relation_rewrite_accepted','attendance_events_append_only','137_reapply_changed_relations','d.definitions(true),d.oldDefinitions',
    'd.tableCatalog(),d.installedCatalog','fingerprint(protectedTables),protectedBefore','stored(linked.result.clock.receipt.id),linked.stored',
    'finally{for(const [key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;']);
  markers(fixture,['self_schedule_changed_old_functions','self_schedule_changed_old_table_catalog','oldRows=fingerprint(oldTables.filter',
    'assert.equal(fingerprint(),beforeReapply)']);
  assert.doesNotMatch(source+fixture,/drop\s+(?:table|schema|database)|initdb|process\.env\.(?:DATABASE|SUPABASE)/i);
});

test('diagnostics remain redacted and synthetic scope does not promise real auth other channels or production',()=>{
  assert.deepEqual(selfScheduleNativeFailure(Error('secret SQL text')),{error:'self_schedule_native_failed',phase:'entry',code:'local_check_failed'});
  assert.equal(selfScheduleNativeFailure(Error('ERROR: attendance_self_schedule_invalid\nDETAIL private')).code,'attendance_self_schedule_invalid');
  markers(source,['syntheticAuthAndEntitlement:true','otherClockChannelsRetested:false','newCluster:false','productionAccess:false','ownedNamespaceCleanup:true']);
});

test('new browser harness only wraps actual parent and same native handlers with a bounded in-memory bundle',()=>{
  const browser=readFileSync(new URL('./merchant-attendance-self-schedule-browser-check.mjs',import.meta.url),'utf8');
  const ui=readFileSync(new URL('./fixtures/attendance-self-schedule-browser.tsx',import.meta.url),'utf8');
  markers(browser,['checkAttendanceSelfScheduleBrowser(native,scope,d,options={})','scope.schema===d.owned.schema','write:false,metafile:true',
    "platform:'browser'",'d.handle:d.handleOld','new Request(canonical+url.pathname+url.search','requests.length<90',"url.origin,origin,'self_schedule_external_request'",
    "self_schedule_browser_imported_server",'runAttendanceCleanupSteps','browser?.close()','server.closeAllConnections()']);
  markers(ui,['import SelfPanel','<SelfPanel siteId={seed.siteId}','employeeId={seed.employeeId}','credentials: "omit"']);
  assert.doesNotMatch(ui,/new AttendanceSelfScheduleClient|fetch\([^u]|sourceText|\.server/);
  assert.doesNotMatch(browser,/writeFile|spawn\(|runAttendanceLabelsReuse|withAttendanceConcurrencySandbox\(|prepareSelfScheduleNativeFixture\(/);
});

test('browser loss scenarios distinguish a real committed response loss from an explicitly undelivered attempt',()=>{
  const browser=readFileSync(new URL('./merchant-attendance-self-schedule-browser-check.mjs',import.meta.url),'utf8');
  markers(browser,["drop==='before'","transport-abort-before-handler","drop==='after'","assert.equal(response.status,200)",
    "await page.reload()",'query.operationId===saved.command.operationId','newPosts().filter(r=>r.body.command.operationId===saved.command.operationId).length,1',
    "featureEnabled=false;await page.goto(origin+'/off')",'requests.slice(changeAt).every(r=>r.method',"retry[0].method,'GET'",
    'assert.deepEqual(retry.find(r=>r.method',"name:'上班打卡',exact:true}).isDisabled(),true",
    'events:before.events+8,relations:before.relations+4','actualNewClockIns:4','oldClockOuts:4']);
});
