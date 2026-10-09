// Static fixture contracts only: actual PostgreSQL acceptance belongs to root.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyPeriodSourceRangesNative} from './attendance-period-source-ranges-native.mjs';
const text=readFileSync(new URL('./attendance-period-source-ranges-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>{for(const p of parts)assert(text.includes(p),p);};

test('import is inert and helper requires caller-owned synthetic scope',()=>{
  assert.equal(typeof verifyPeriodSourceRangesNative,'function');
  has('assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    'h.syntheticHistoricalRows===10',"'range_probe_before_period_creation'",'indisvalid and indisready');
  assert.doesNotMatch(text,/child_process|spawn\(|execFile|process\.env|process\.argv|statement_timeout|lock_timeout|disable trigger|session_replication_role/);
});
test('every scenario is bounded and rolls back all facts, function and catalog fingerprints',()=>{
  has("['begin;'+prefix+entryGuard+mark('protected_before')", "mark('protected_after')+'rollback;'",
    'statements.length<=80','first+=10','d.fingerprint(),baseline','d.definitions(),definitions','d.tableCatalog(),catalog',
    "assert.equal(rows[i-1].hash,rows[i+1].hash", "'range_failed_read_wrote_rows'");
  assert.doesNotMatch(text,/\bcommit;|create(?: or replace)? function|drop table|truncate table|delete from public\./i);
});
test('dense unrelated histories lie inside coarse leave/calendar windows but outside precise period',()=>{
  has("run('unrelated_coarse_window_history'",'...batches(100,(a,b)=>copyHistory(\'correction\',a,b))',
    "copyHistory('revision',a,b)","copyContext('leave',a,b)","copyContext('calendar',a,b)",
    'shift(h.slot.startAt,-86400000)','calendarTemplate(dayBefore,dayBefore)',
    'assert.equal(rows[0].raw.sourceFingerprint,rows[1].raw.sourceFingerprint)');
});
test('latest stream head, withdrawal and decision plus both moved-proposal arms are checked',()=>{
  has("run('latest_head_and_moved_proposal'","read('original_inside_proposal_outside')","read('original_outside_proposal_inside')",
    "read('latest_decision')","run('in_period_revision_latest_head'","read('revision_latest_withdrawal')","read('revision_latest_decision')",
    'assert.deepEqual(count,[0,1,1,0,0])','[0,1,0,0]');
});
test('true candidate limits distinguish 100 readable from 101 refused, without silent truncation',()=>{
  has("run('pending_exact_100_101'","read('pending_100')", "reject('pending_101','attendance_period_source_too_large')",
    "for(const kind of ['leave','calendar'])",'batches(99,(a,b)=>copyContext(kind,a,b))',
    "reject(kind+'_101','attendance_period_source_too_large')",'raw.context.pendingCorrections.length,100','raw.context[kind].length,100');
});
test('real owner/self canonical identity and related historical identity refusal are retained',()=>{
  has('assert.equal(a.sourceFingerprint,b.sourceFingerprint','assert.deepEqual(a.sourceCanonical,b.sourceCanonical)',
    'digest(raw.sourceText)','JSON.parse(raw.sourceText)',"run('pending_historical_identity'",
    "reject('old_actor','attendance_period_source_identity_changed')");
});
test('templates use actual RPCs, dense copies disclose synthetic history with enabled storage checks',()=>{
  for(const rpc of ['correction_self_v3','correction_decide_v2','revision_self_v2','revision_decide_v2','leave_v1','calendar_v1'])has('faolla_attendance_'+rpc+'(');
  has("t.tgenabled<>'O'",'faolla_attendance_correction_basis_v1(',"NOT evidence of 101 actual user submissions",
    'No claim of 101 actual user operations or production EXPLAIN performance');
});
test('actual moved-arm EXPLAIN is collected in dense transaction without artificial index-favoring sort',()=>{
  has('explain(format json)',"set_config('enable_seqscan','off',true)","set_config('enable_seqscan',prior_setting,true)",
    "dataset:'dense_unrelated_withdrawn_history'","query:'actual_151_moved_arm'",'forcedSelectedNewIndex:',
    'attendance_correction_proposal_period_idx','attendance_revision_proposal_period_idx','natural:planSummary(row.natural)',
    'order by x.request_id limit 101',"read('dense_excluded'),...explainSteps",'newer.revision>x.revision',
    'decided.request_id=x.request_id','productionPerformanceProven:false');
  assert.doesNotMatch(text,/order by public\.faolla_attendance_instant|index_not_viable/);
});
