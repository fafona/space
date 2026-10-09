// Static/pure diagnostic contracts only. Actual database proof belongs to root.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyPeriodSessionCapacityNative} from './attendance-period-session-capacity-native.mjs';
const text=readFileSync(new URL('./attendance-period-session-capacity-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>{for(const part of parts)assert(text.includes(part),part);};

test('diagnostic import is inert and cannot accept non-synthetic scope',async()=>{
  assert.equal(typeof verifyPeriodSessionCapacityNative,'function');
  await assert.rejects(verifyPeriodSessionCapacityNative({d:{syntheticOnly:false}}));
  await assert.rejects(verifyPeriodSessionCapacityNative({expected:'154'}),/session_capacity_expected_version/);
  has('assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    "'session_capacity_requires152'","'session_capacity_before_period_creation'",'h.syntheticHistoricalRows===10');
  assert.doesNotMatch(text,/child_process|spawn\(|execFile|process\.env|process\.argv|statement_timeout|lock_timeout|disable trigger|session_replication_role|pg_sleep/i);
});
test('one bounded transaction retains152 and adds153 fifth cap stage with exact restoration',()=>{
  has("'99_relevant_plus_closed_preceding'","'100_relevant_no_preceding'","'100_relevant_plus_closed_preceding'","'101_truly_relevant'",
    "['begin;'+prefix+initial+marker('protected_before')",'first<=99;first+=10','prefix+seed(100,100)',
    "'101_relevant_plus_closed_preceding'",'prefix+seed(101,101)',
    "'set constraints all immediate;rollback;'",'steps.length<=24','outerRollbackTransactions:1',
    'd.fingerprint(),baseline','d.definitions(),definitions','d.tableCatalog(),catalog');
  assert.doesNotMatch(text,/\bcommit;|create(?: or replace)? function|alter table|drop table|truncate table|delete from public\./i);
});
test('existing historical h pair supplies a truly closed irrelevant preceding shift',()=>{
  has("'session_capacity_exact_original_pair'","'session_capacity_preceding_closed_before_period'",'id=${quote(h.lastEventId)} and sequence=2',
    "day+'T06:00:00.000000Z'","interval '2 minutes'","interval '1 minute'",'i*2+1',"'session_capacity_ended_historical_day'");
});
test('independent oracle proves exact99/100/101 without reusing the buggy candidate CTE',()=>{
  has("'session_capacity_no_correction_or_missing'",'cross join lateral(select finish.occurred_at',
    'endpoint.occurred_at>${from}',"'session_capacity_exact_relevance_oracle'",
    '[[stages[0],99,1],[stages[1],100,0],[stages[2],100,1],[stages[3],101,0]]');
  assert.doesNotMatch(text,/with inside as|candidate_count:=|limit 101/);
});
test('four actual entrypoints have per-call hashes and exact oldreport error, never expected source-cap error',()=>{
  has('faolla_attendance_unified_report_v1(', 'faolla_attendance_period_source_v1(',
    "['owner','self'].flatMap(access=>['report','source'].map(kind=>", "'before_read'","'after_read'",
    "'session_capacity_successful_read_wrote_rows'","sqlerrm<>'attendance_report_too_large'",
    "'before_failure'","'after_failure'",'set local role service_role;do $session_capacity_reject$',
    "'session_capacity_failed_read_wrote_rows'",'assert.equal(rejected.length,8)',"assert.equal(positiveReads,expected==='153'?12:8)");
  assert.doesNotMatch(text,/attendance_period_source_too_large|rpc:\s*async/);
});
test('synthetic unverified binding proves saved dual IDs without claiming historical rule verification',()=>{
  has('insert into public.merchant_attendance_events(', 'insert into public.merchant_attendance_shift_rule_bindings(',
    "'UTC','self',${auth},${employee},${auth}","'unverified','source_unavailable',null", "'personal-group-enterprise-point-v1','clock-in-whole-shift-v1',a",
    'assert.equal(session.ruleBinding.status,\'unverified\')','assert.equal(session.adoption,null)','actualClockRpcs:0');
  assert.doesNotMatch(text,/update public\.merchant_attendance_|faolla_attendance_bind_shift_rules_v1\(/);
});
test('owner/self unchanged source projection, totals and byte budgets remain checked',()=>{
  has("require('../../src/lib/merchantAttendancePeriodClosure.server.ts')",'withoutObservation(raw.report),withoutObservation(direct)',
    'hash(raw.sourceText),raw.sourceFingerprint','JSON.parse(raw.sourceText),raw.sourceCanonical',
    'row.ownerSource.sourceFingerprint,row.selfSource.sourceFingerprint','bytes<=1048576','rawBytes<=4194304',
    'expectedUs=seededCount*60000000','report.totals.original.workedUs,expectedUs','report.totals.selected.workedUs,expectedUs',
    'sourceSizes:sizes',"readerFixed:expected==='153'","diagnosticOnly:expected==='152'");
});
test('152 default remains compatible while153 accepts100 plus preceding and refuses both101 sets',()=>{
  has("{d,native,scope,h,expected='152'}","'session_capacity_exact_reader_version'",
    "expected==='153'?success(stages[2],narrow,100,1):failure(stages[2],narrow,100,1)",
    'failure(stages[3],wide,101,0)','failure(stages[4],narrow,101,1)',
    "expected==='153'?[stages[3],stages[4]]:[stages[2],stages[3]]",'expectedOracles.push([stages[4],101,1])');
});
test('normal-case hashes are low-volume and exact IDs/totals do not confuse the two100 datasets',()=>{
  has('canonicalFingerprints[row.label]=row.ownerSource.sourceFingerprint','sourceSizes:sizes,canonicalFingerprints',
    'includesPrior=range.fromDate===h.slot.workDate','seededCount=count-(includesPrior?1:0)',
    'assert.equal(prior!==undefined,includesPrior)','Array.from({length:seededCount}',
    "syntheticAdditionalEvents:expected==='153'?202:200");
});
