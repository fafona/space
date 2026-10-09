import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {profileReminderSourceNative,reminderSourceProfileLimits,reminderSourceProfileCallSql,
 reminderSourceProfileRpcExpression,validateReminderSourceProfileDiagnostic} from './attendance-reminder-source-profile-native.mjs';

test('201 source profile is inert, owned-context only and has unchanged finite no-wait/no-commit limits',async()=>{
 assert.deepEqual(reminderSourceProfileLimits,{sql:30,rpc:15,milliseconds:30000,statementMs:10000,sessionMs:25000,connections:1,controlledLeaves:2,functionTop:8,waits:0,microcommits:0,newClusters:0});
 await assert.rejects(profileReminderSourceNative(),/reminder_source_profile_owned_context_required/);
 const source=readFileSync(new URL('./attendance-reminder-source-profile-native.mjs',import.meta.url),'utf8');
 assert(!source.includes('setTimeout('));assert(!/\bcommit\s*;/i.test(source));assert(!source.includes('create function'));
 for(const expected of ["set local statement_timeout='10s'","set local track_functions='all'","trackFunctions:'all'","await activate('review_routing')",
  "submit('reminders_off',days[0])","await activate('reminders')","submit('reminders_active',days[1])",
  'reminder_source_profile_no_budget_for_controlled_leave','reminderNativeIdentitySeed','reminderNativeHistoricalSeed',
  'executeAttendanceAdmin','executeLeave','reminderNativeCloseTransaction','audit.fingerprint(names),oldFacts',
  'audit.definitions(),definitions','audit.catalog(),catalog',"audit.archiveBytes('155')","audit.archiveBytes('207')"])assert(source.includes(expected));
 assert(source.indexOf("submit('reminders_off',days[0])")<source.indexOf("await activate('reminders')"));
 assert(source.includes('const lateFailure=connection?await reminderNativeCloseTransaction'));
 assert(source.includes('if(lateFailure)throw lateFailure'));
 assert(source.includes('connection=native.connect();'));assert(!source.includes('lifetimeMs:30000'));
});
test('201 component clock stamps surround the exact hash/RPC/constraint/hash order and same-backend stats are delta top8',()=>{
 const sql=reminderSourceProfileCallSql({expression:'public.example_rpc()',facts:'(select md5(\'all-facts\'))',outside:'outside_facts',oid:123,write:true,profile:true});
 const positions=['t0:=clock_timestamp();before_hash:=','t1:=clock_timestamp();phase:=\'expression\'','v:=public.example_rpc();t2:=clock_timestamp()',
  'set constraints all immediate;set constraints all deferred;t3:=clock_timestamp()','reset role;if e is not null or false then assert',
  't4:=clock_timestamp()'].map(value=>sql.indexOf(value));
 assert(positions.every((n,i)=>n>=0&&(i===0||n>positions[i-1])));
 assert.match(sql,/pg_stat_xact_user_functions/g);assert(!sql.includes('pg_stat_user_functions'));
 assert(sql.includes('f.calls-coalesce((prior_functions->f.funcid::text->>0)::bigint,0)'));
 assert(sql.includes('f.total_time-coalesce'));assert(sql.includes('f.self_time-coalesce'));assert(sql.includes('limit 8'));
 assert(sql.includes('where p.pronamespace=123'));assert(sql.includes('get stacked diagnostics e=message_text,st=returned_sqlstate,cx=pg_exception_context'));
 assert(sql.includes("where line like 'PL/pgSQL function %' limit 8"));assert(sql.includes('select left(line,512) line'));
 assert(sql.includes('(select count(*) from jsonb_object_keys(prior_functions))>512'));assert(!sql.includes('jsonb_object_length'));
 assert(sql.indexOf('outside_before:=outside_facts;outside_t1:=clock_timestamp()')<sql.indexOf('into prior_functions'));
 assert(sql.indexOf('limit 8) profile_functions;')<sql.indexOf("assert outside_facts=outside_before,'reminder_source_profile_old_rows_changed'"));
 assert(sql.includes("'outsideGuardMs',extract(epoch from((outside_t1-outside_t0)+(outside_t3-outside_t2)))*1000"));
 const read=reminderSourceProfileCallSql({expression:'public.example_rpc()',facts:'full_facts',outside:'outside_facts',oid:123,write:false});
 assert(read.includes('if e is not null or true then assert full_facts=before_hash'));assert(!read.includes('pg_stat_xact_user_functions'));
});
test('201 profile metadata is finite and contains only timings and function counters, never statement/source data',()=>{
 const components={beforeHashMs:1,expressionMs:2,constraintsMs:3,afterHashMs:0,outsideGuardMs:4,failedPhase:null};
 const diagnostic={components,functions:[{name:'faolla_example_v1',calls:2,selfTime:1,totalTime:2}]};
 assert.deepEqual(validateReminderSourceProfileDiagnostic(diagnostic),diagnostic);
 for(const raw of [{...diagnostic,sql:'private'}, {...diagnostic,components:{...components,expressionMs:Infinity}},
  {...diagnostic,components:{...components,failedPhase:'unknown'}}, {...diagnostic,functions:Array(9).fill(diagnostic.functions[0])},
  {...diagnostic,functions:[{...diagnostic.functions[0],calls:0}]}, {...diagnostic,functions:[{...diagnostic.functions[0],selfTime:3}]},
  {...diagnostic,functions:[{...diagnostic.functions[0],source:'private'}]}])assert.throws(()=>validateReminderSourceProfileDiagnostic(raw));
});
test('201 actual Node admin arguments are exact, same-site and never silently replaced by fabricated actor/command',()=>{
 const args={p_site_id:'99990201',p_auth_user_id:'00000000-0000-4000-8000-000000000099',p_query:{view:'workers',cursor:null,search:''},
  p_command:{kind:'settings',operationId:'00000000-0000-4000-8000-000000000001',expectedVersion:0,values:{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false}},p_operation_id:null};
 const sql=reminderSourceProfileRpcExpression('faolla_attendance_admin_v1',args);
 assert(sql.includes('public.faolla_attendance_admin_v1'));assert(sql.includes(args.p_auth_user_id));assert(sql.includes('"expectedVersion":0'));
 assert.throws(()=>reminderSourceProfileRpcExpression('faolla_attendance_admin_v1',{...args,p_site_id:'99990001'}));
 assert.throws(()=>reminderSourceProfileRpcExpression('faolla_attendance_admin_v1',{...args,proxyOwner:true}));
 assert.throws(()=>reminderSourceProfileRpcExpression('unknown_rpc',args));
});
