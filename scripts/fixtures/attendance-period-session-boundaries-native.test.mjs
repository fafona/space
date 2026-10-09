//Pure/static fixture contract. Root separately executes actual owned PostgreSQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyPeriodSessionBoundariesNative} from './attendance-period-session-boundaries-native.mjs';
const source=readFileSync(new URL('./attendance-period-session-boundaries-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>{for(const part of parts)assert(source.includes(part),part);};

test('inert helper rejects non-synthetic inputs before runtime access',async()=>{
  assert.equal(typeof verifyPeriodSessionBoundariesNative,'function');
  let used=false;await assert.rejects(verifyPeriodSessionBoundariesNative({d:{syntheticOnly:false},native:{query:()=>{used=true;}}}));assert.equal(used,false);
  has('assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',"'boundary_requires153'","'boundary_guards_enabled'");
  assert.doesNotMatch(source,/child_process|spawn\(|execFile|process\.env|process\.argv|statement_timeout|lock_timeout|disable trigger|session_replication_role|pg_sleep/i);
});
test('seven small rollback scenarios protect all original rows and each successful/failed read',()=>{
  has("'begin;'+prefix+initial+mark('old_before')+setup","'set constraints all immediate;rollback;'",'statements.length<=24',
    'd.fingerprint(),baseline','d.definitions(),definitions','d.tableCatalog(),catalog',"position(${quote(ownPrefix)} in to_jsonb(r)::text)=0",
    "'boundary_original_facts_untouched'","'boundary_reader_or_failure_wrote_rows'",'assert.equal(checks.length,7)',
    'assert.equal(positiveReads,30)','assert.equal(rejectedReads,8)');
  assert.doesNotMatch(source,/\bcommit;|create(?: or replace)? function|alter table|drop table|truncate table|delete from public\./i);
  const updates=source.match(/update public\.[^;]+;/g);assert.equal(updates.length,3);
  assert(updates[0].includes('id=${employee}'));assert(updates.slice(1).every(x=>x.includes('employee_id=${quote(manager)} and id=${quote(grant)}')));
});
test('half-open, cross-boundary and forty-five-day open anchors retain exact totals and IDs',()=>{
  has("'cross_boundary_preceding'","'closed_exactly_at_period_start'","'very_old_still_open'","dayOffset(day,-45)",
    'originalUs:3600000000,selectedUs:3600000000','count:0,originalUs:0,selectedUs:0','originalUs:0,selectedUs:0,open:true',
    "computed.base.openSessionCount,open?1:0","projected.blockers.includes('open_session'),open",'item.events.length,open?1:2');
});
test('real086/095 writers prove both movement directions and ignore superseded approved effect',()=>{
  has('faolla_attendance_correction_self_v3(', 'faolla_attendance_correction_decide_v2(', 'faolla_attendance_revision_self_v2(', 'faolla_attendance_revision_decide_v2(',
    "'expectedEvidence',r->>'evidenceToken'","'expectedBaseOperationId',r->'current'->>'operationId'",
    "'original_inside_current_outside'","'original_outside_current_inside'","'latest_revision_inside'","'superseded_effect_ignored'",
    'effect.revision,2','effect.lineage.previousOperationId,approvalId','actualClockRpcs:0');
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_(correction_effects|effect_versions|correction_decisions|revision_decisions)/);
});
test('revision approval reads the nested owner-review revision, unlike initial correction approval',()=>{
  const start=source.indexOf('const approveRevision='),end=source.indexOf('const nextRange=',start);
  assert(start>=0&&end>start);const revision=source.slice(start,end);
  assert(revision.includes("'expectedRevision',(r->'review'->>'submittedRevision')::bigint"));
  assert(revision.includes("r->'review'->'submittedRevision'=r->'review'->'review'->'item'->'revision'"));
  assert(revision.includes("'boundary_revision_preflight_shape'"));
  assert(!revision.includes("'expectedRevision',(r->'review'->'item'->>'revision')"));
  const initial=source.slice(source.indexOf('const approve='),source.indexOf('const revQuery='));
  assert(initial.includes("'expectedRevision',(r->'review'->'item'->>'revision')::bigint"));
});
test('revision proposal remains canonical UTC6 because095 persists the original command',()=>{
  has("const at=(day,time)=>day+'T'+time+':00.000000Z'",
    "const proposal=(date)=>({startAt:at(date,'09:00'),endAt:at(date,'11:00'),breaks:[]})",
    "assert public.faolla_attendance_correction_proposal_v1(c->'proposal',clock_timestamp())=c->'proposal','boundary_revision_proposal_not_canonical'");
  assert.doesNotMatch(source,/\bmillis\b/);
  const revision=readFileSync(new URL('../supabase-migrations/202610010095_merchant_attendance_revision_cycles.sql',import.meta.url),'utf8');
  assert(revision.includes('base.operation_id,p_command,now_at) returning * into receipt'));
  const guard=readFileSync(new URL('../supabase-migrations/202610010093_merchant_attendance_versioned_reports.sql',import.meta.url),'utf8');
  assert(guard.includes("if proposal is distinct from request.command->'proposal' then raise exception 'attendance_effect_version_invalid'"));
});
test('seed flush restores deferred paired-write timing and final rollback still checks all constraints',()=>{
  const seed=source.slice(source.indexOf('const seed='),source.indexOf('const sourceQuery='));
  assert(seed.includes('set constraints all immediate;set constraints all deferred;'));
  assert.equal((source.match(/set constraints all immediate;/g)??[]).length,2);
  assert.equal((source.match(/set constraints all deferred;/g)??[]).length,1);
  assert(source.includes("mark('old_after')+'set constraints all immediate;rollback;'"));
  const migration=readFileSync(new URL('../supabase-migrations/202610010094_merchant_attendance_revision_decision_core.sql',import.meta.url),'utf8');
  for(const name of ['attendance_revision_decision_effect_link','attendance_effect_version_decision_link']){
    const start=migration.indexOf('create constraint trigger '+name),end=migration.indexOf(';',start);
    assert(start>=0&&end>start);assert(migration.slice(start,end).includes('deferrable initially deferred'));
  }
  assert.doesNotMatch(source,/disable trigger|session_replication_role|alter\s+(?:table|constraint)/i);
});
test('self dual-history failures and manager complete-location/live-grant checks use actual readers',()=>{
  has('faolla_attendance_unified_report_v1(', 'faolla_attendance_period_source_v1(', 'faolla_attendance_scopes_v1(',
    "'mixed_historical_employee_fails_closed'","'changed_auth_does_not_reassign_history'","'attendance_period_source_identity_changed'",
    "'manager_complete_location_and_live_grant'","'manager_ungranted_location'","'manager_expired_grant'","'manager_future_grant'",
    "raw.base.coverage,'authorized-complete-sessions-v1'",'!JSON.stringify(raw).includes(otherLocation)',
    'hash(raw.sourceText),raw.sourceFingerprint','grouped.ownersource.sourceCanonical,grouped.selfsource.sourceCanonical');
  assert.doesNotMatch(source,/rpc:\s*async|set system|set_config\(/);
});
