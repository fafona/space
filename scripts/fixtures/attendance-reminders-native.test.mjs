//Pure owned-session doubles only: no processes, database, timers or clock edits.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {reminderNativeCloseTransaction,reminderNativeCleanupPreservingFailure,reminderNativeTimings,reminderNativeInitialSegmentStatistics} from './attendance-reminders-native.mjs';

test('201 pending SQL is closed and settled without dispatching a second rollback',async()=>{
 const calls=[],late=new Error('statement_timeout:57014');let rejectPending;
 const pending=new Promise((_,reject)=>{rejectPending=reject;});
 const session={step:()=>{calls.push('unexpected step');throw new Error('one_command_per_session');},
  close:async()=>{calls.push('close');rejectPending(late);}};
 assert.equal(await reminderNativeCloseTransaction(session,pending,false),late);
 assert.deepEqual(calls,['close']);
});
test('201 idle uncommitted session rolls back before close and still closes on rollback error',async()=>{
 const calls=[];
 assert.equal(await reminderNativeCloseTransaction({step:async sql=>{calls.push(sql);},close:async()=>{calls.push('close');}},null,false),null);
 assert.deepEqual(calls,['rollback;','close']);
 const failure=new Error('rollback_transport_failed');calls.length=0;
 await assert.rejects(()=>reminderNativeCloseTransaction({step:async sql=>{calls.push(sql);throw failure;},close:async()=>{calls.push('close');}},null,false),error=>error===failure);
 assert.deepEqual(calls,['rollback;','close']);
});
test('201 committed session is closed without adding a rollback or another business command',async()=>{
 const calls=[];assert.equal(await reminderNativeCloseTransaction({step:async()=>{calls.push('unexpected');},close:async()=>{calls.push('close');}},null,true),null);
 assert.deepEqual(calls,['close']);
});
test('201 original stage and cause survive late SQL settlement and all baseline checks still run',async()=>{
 const original=new Error('reminder201_native:{"stage":"rpc_run","lastRpc":{"operationId":"00000000-0000-4000-8000-000201901043"},"transportPending":true}:Node deadline');
 const calls=[],late=new Error('statement_timeout:57014');let rejectPending;
 const pending=new Promise((_,reject)=>{rejectPending=reject;});
 await reminderNativeCleanupPreservingFailure(original,async()=>{
  const failure=await reminderNativeCloseTransaction({step:()=>assert.fail('pending rollback forbidden'),close:async()=>{calls.push('close');rejectPending(late);}},pending,false);
  calls.push('outside exact','all facts exact');if(failure)throw failure;
 });
 assert.deepEqual(calls,['close','outside exact','all facts exact']);
 assert.match(original.stack,/reminder201_native:.*rpc_run/);assert.match(original.stack,/000201901043/);
 assert.match(original.stack,/reminder201_cleanup_secondary:Error: statement_timeout:57014/);
 const bounded=new Error('original');await reminderNativeCleanupPreservingFailure(bounded,async()=>{throw new Error('x'.repeat(10000));});
 assert(bounded.message.length<2100);
});
test('201 cleanup failure without an original error is never reported as acceptance',async()=>{
 const failure=new Error('baseline_mismatch');await assert.rejects(()=>reminderNativeCleanupPreservingFailure(null,async()=>{throw failure;}),error=>error===failure);
 assert.equal(await reminderNativeCleanupPreservingFailure(null,async()=>42),42);
});
test('201 actual fixture tracks only existing SQL and retains deadlines and full protection',()=>{
 const source=readFileSync(new URL('./attendance-reminders-native.mjs',import.meta.url),'utf8');
 assert.match(source,/const dispatched=connection\.step\(scope\.sql\(text\)\);pendingStep=dispatched/);
 assert.match(source,/transportPending:pendingStep!==null/);assert.match(source,/lastRpc=\{name,operationId:args\.p_command\?\.operationId\?\?args\.p_query\?\.operationId\?\?null\}/);
 for(const text of ["set local statement_timeout='10s'","native.connect({lifetimeMs:180000})","outsideCheck('finally')",'audit.fingerprint(names),baseline','reminder201_cleanup_unknown'])assert(source.includes(text));
 assert.equal(source.split('setTimeout(resolve,waitMs)').length-1,1);
});
test('201 monotonic timing diagnostics are bounded and separate the sole wait, protection and undispatched deadline stage',()=>{
 let now=100;const timing=reminderNativeTimings(()=>now);
 for(let n=0;n<179;n++){const from=now;now+=n+1;assert.equal(timing.sql('sql_'+n,from),true);}
 assert.equal(timing.sql('restore_reminder201_finish',now,false),true);assert.equal(timing.sql('over_limit',now),false);
 for(let n=0;n<10;n++){const from=now;now+=2;assert.equal(timing.outside('outside_'+n,from),true);}
 assert.equal(timing.outside('outside_over_limit',now),false);
 const waitFrom=now;now+=60003;timing.wait(60000,waitFrom);
 const summary=timing.summary(),records=timing.records();
 assert.equal(summary.mainSqlRecorded,180);assert.equal(summary.outsideRecorded,10);
 assert.equal(summary.waitMs,60000);assert.equal(summary.waitElapsedMs,60003);
 assert.equal(summary.sqlElapsedMs,16110);assert.equal(summary.outsideElapsedMs,20);assert.equal(summary.totalElapsedMs,76133);
 assert.equal(summary.slowestSql.length,8);assert.equal(summary.slowestSql[0].stage,'sql_178');assert.equal(summary.slowestOutside.length,8);
 assert.deepEqual(records.sql.at(-1),{stage:'restore_reminder201_finish',elapsedMs:0,dispatched:false});
 for(const item of [...records.sql,...records.outside])assert.deepEqual(Object.keys(item),['stage','elapsedMs','dispatched']);
 records.sql[0].stage='mutated';assert.equal(timing.records().sql[0].stage,'sql_0');
 assert.throws(()=>timing.wait(0,now));
 const fresh=reminderNativeTimings(()=>0);assert.throws(()=>fresh.sql('select private_body;',0));
 const source=readFileSync(new URL('./attendance-reminders-native.mjs',import.meta.url),'utf8');
 assert.match(source,/Date\.now\(\)\+caps\.milliseconds,timing=reminderNativeTimings\(\)/);
 assert.match(source,/timing\.sql\(label,from,sent\)/);assert.match(source,/timings:timing\.summary\(\)/);
 assert.equal(source.split('setTimeout(resolve,waitMs)').length-1,1);
});

test('201 A and F actual counts use five disjoint segments without borrowing RPCs or moving the deadline',()=>{
 const counts=[['A_sources',48,39],['F_preparation',8,7],['A_due_wait_query',1,0],['F_due_scan_restore',3,2],['A_activation_probe',6,4]];
 let previous={sqlSteps:0,rpcCalls:0};const segments=counts.map(([name,sqlSteps,rpcCalls])=>{
  const segment={name,from:previous,to:{sqlSteps:previous.sqlSteps+sqlSteps,rpcCalls:previous.rpcCalls+rpcCalls}};previous=segment.to;return segment;
 });
 const actual=reminderNativeInitialSegmentStatistics(segments);
 assert.deepEqual({sqlSteps:actual.A.sqlSteps,rpcCalls:actual.A.rpcCalls},{sqlSteps:55,rpcCalls:43});
 assert.deepEqual({sqlSteps:actual.F.sqlSteps,rpcCalls:actual.F.rpcCalls},{sqlSteps:11,rpcCalls:9});
 assert.deepEqual(actual.A.segments.map(x=>x.name),['A_sources','A_due_wait_query','A_activation_probe']);
 assert.deepEqual(actual.F.segments.map(x=>x.name),['F_preparation','F_due_scan_restore']);
 for(const changed of[
  segments.slice(0,4),
  segments.map((item,n)=>n===2?{...item,from:segments[0].from}:item),
  segments.map((item,n)=>n===1?{...item,name:'A_sources'}:item),
  segments.map((item,n)=>n===1?{...item,to:{...item.to,rpcCalls:item.to.rpcCalls+1}}:item),
  segments.map((item,n)=>n===3?{...item,to:{...item.to,sqlSteps:NaN}}:item),
 ])assert.throws(()=>reminderNativeInitialSegmentStatistics(changed));
 const source=readFileSync(new URL('./attendance-reminders-native.mjs',import.meta.url),'utf8');
 assert(source.includes('Date.now()+caps.milliseconds,timing=reminderNativeTimings()'));
 assert(source.includes('sqlSteps:176,rpcCalls:78'));assert(source.includes('rpcHardCap:120'));
 assert(source.includes('mark(0,initialStatistics.A);outsideCheck(\'a\');mark(5,initialStatistics.F)'));
 assert(!source.includes('rpcCalls-groupStart.rpcCalls-'));
});

test('201 original26 true max due governs the only wait and F is fully restored before the unchanged A and delivery probes',()=>{
 const source=readFileSync(new URL('./attendance-reminders-native.mjs',import.meta.url),'utf8');
 const initial=source.indexOf("step('initial_sources_savepoint'"),snapshot=source.indexOf("'maxDueAt',",initial);
 const finishSave=source.indexOf("const finishBefore=await save('reminder201_finish')"),send=source.indexOf('const sent=await executeCycleSend(');
 const waitQuery=source.indexOf("step('real_due_wait_duration'"),wait=source.indexOf('await new Promise(resolve=>setTimeout(resolve,waitMs))');
 const scan=source.indexOf('const finished=await runner.run('),restore=source.indexOf("await restore('reminder201_finish',finishBefore");
 const activation=source.indexOf("const probe=await save('reminder201_activation')"),delivery=source.indexOf('const b=await executeReminderRunner(');
 assert(initial>=0&&snapshot>initial&&finishSave>snapshot&&send>finishSave&&waitQuery>send&&wait>waitQuery&&scan>wait&&restore>scan&&activation>restore&&delivery>activation);
 assert.match(source.slice(snapshot,finishSave),/max\(next_due_at\).*state='active'/s);
 assert.match(source.slice(waitQuery,wait),/quote\(sourceState\.maxDueAt\).*::timestamptz-clock_timestamp\(\)/s);
 assert.doesNotMatch(source.slice(waitQuery,wait),/merchant_attendance_reminder_heads|min\(next_due_at\)/);
 assert.equal(source.split('real_due_wait_duration').length-1,1);assert.equal(source.split('setTimeout(resolve,waitMs)').length-1,1);
 assert.match(source,/release savepoint \$\{name\};\$\{restoredAssertions\}select \$\{small\}/);
 const restored=source.slice(restore,activation);
 assert(restored.includes("p.category='period_due')='stopped'"));assert(restored.includes("state='active' and delivered_count=0 and next_due_at<=clock_timestamp()"));
 assert(restored.includes('reminder201_original26_not_all_due'));assert(restored.includes('reminder201_original26_due_max_changed'));
 assert(restored.includes('quote(sourceState.maxDueAt)'));assert(restored.includes("segment('F_due_scan_restore');outsideCheck('f')"));
 for(const text of ['assert.equal(pr.receipt.result.deliveredCount,0)','assert.equal(pr.receipt.result.stoppedCount,25)',
  'assert.equal(finished.receipt.result.stoppedCount,2)','assert.equal(br.checkedCount,25)','assert.equal(br.deliveredCount,25)',
  'assert.equal(br.deferredCount,0)','assert.equal(br.stoppedCount,0)','assert(br.nextCursor)',"outsideCheck('finally')",'audit.fingerprint(names),baseline'])assert(source.includes(text),text);
 assert.equal(source.split('await reminderNativePidRace(raceEnv').length-1,2);
 assert.doesNotMatch(source,/update public\.merchant_attendance_(?:events|reminder_heads).*?(?:occurred_at|next_due_at)\s*=/);
});
