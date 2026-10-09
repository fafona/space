// Pure/static fixture contracts only. Actual155 validation is run by root.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyPeriodTimezoneResumeNative} from './attendance-period-timezone-resume-native.mjs';
const text=readFileSync(new URL('./attendance-period-timezone-resume-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>{for(const part of parts)assert(text.includes(part),part);};

test('inert155 helper rejects unowned/non-synthetic invocation before connection',async()=>{
  assert.equal(typeof verifyPeriodTimezoneResumeNative,'function');
  await assert.rejects(verifyPeriodTimezoneResumeNative({d:{syntheticOnly:false}}));
  has('assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    'h.syntheticHistoricalRows===10',"name='merchant_attendance_period_fixed_boundaries'","'resume_unique_synthetic_site'","'resume_guards_enabled'");
  assert.doesNotMatch(text,/child_process|spawn\(|execFile|process\.env|process\.argv|statement_timeout|lock_timeout|disable trigger|session_replication_role|pg_sleep|boundClockMigrationBody/i);
});
test('existing064 event-bearing history remains protected from alias and actual offset changes',()=>{
  has('public.faolla_attendance_admin_v1(', "'resume_original_history_required'", "['Etc/UTC','Europe/Madrid'].map",
    'admin(d.site,d.owner,zone,','attendance_history_protected','actual064HistoryStillProtected:true');
  assert.doesNotMatch(text,/update public\.merchant_attendance_settings|insert into public\.merchant_attendance_events|delete from public\./i);
});
test('new source is service-only and all saved-frame report forks remain private',()=>{
  has('faolla_attendance_period_closure_source_v1(jsonb,uuid)',"'resume_service_only_source'",
    'faolla_attendance_period_closure_report_v1(text,uuid,jsonb,jsonb)',
    'faolla_attendance_period_closure_scoped_report_v1(text,uuid,jsonb,jsonb)',
    'faolla_attendance_period_closure_unified_report_v1(text,uuid,jsonb,jsonb)',
    "not has_function_privilege('service_role',fn,'EXECUTE')", "'resume_private_fixed_report'",
    "not has_function_privilege('anon'", "not has_function_privilege('authenticated'");
});
test('only isolated synthetic site rows may change, with full restoration and bounded connections',()=>{
  has("emptySite='98400185'","name==='merchants'?'id':'merchant_id'",'<>${quote(emptySite)}',
    'd.fingerprint(),baseline','d.definitions(),definitions','d.tableCatalog(),catalog',
    'assert(++steps<=40',"'set constraints all immediate;rollback;'",'finally{await connection.close();restore(zone);}',
    "'resume_original_rows_changed'",'outerRollbackTransactions:4');
  assert.doesNotMatch(text,/\bcommit;|grant\s|revoke\s|alter table|create(?: or replace)? function|truncate table/i);
});
test('all old two-day boundaries survive actual064 change while unknown/null references use current settings',()=>{
  has('oldRange={fromDate:day(h.slot.workDate,-1),throughDate:h.slot.workDate}',
    'artifact.dayBoundaries.length,2','fixed.parsed.preview.artifact.period,artifact.period',
    'fixed.parsed.preview.artifact.dayBoundaries,artifact.dayBoundaries','fixedSelf.artifact.dayBoundaries,artifact.dayBoundaries',
    'const unknown=await collect(sq(fid(900)))','unknown.artifact.period.timeZone,zone','const nullId=await collect(sq(null))',
    'nullId.raw.sourceCanonical,unknown.raw.sourceCanonical','unknownPeriodUsesCurrentSettings:true');
});
test('saved-frame query refuses cross-worker/date, extra frame and current identity rebinding',()=>{
  has("await fail('wrong_worker'",'sq(fid(100),\'owner\',oldRange,otherWorker)',"'attendance_access_denied'",
    "await fail('wrong_date'","await fail('untrusted_frame',source({...sq(),frame:{timeZone:zone}}),'attendance_invalid_request')",
    'savepoint rebound;update public.merchant_enterprise_employees set auth_user_id=',
    'where merchant_id=${site} and id=${quote(employee)}',"await fail('rebound_owner'","await fail('rebound_self'",
    "'attendance_period_identity_changed'",'rollback to savepoint rebound;release savepoint rebound;');
});
test('same-content alias send stays v1, reopened old period creates v2 but reuses immutable body',()=>{
  has("{zone:'Etc/UTC',reopened:false,withMissing:false}","{zone:'Europe/Madrid',reopened:true,withMissing:false}",
    "command('reopen',104,revision,1,null)",'await invoke(q(),c,null,false)',
    "command('send',120,revision,1,resumeFp)",'logicalVersion=reopened||withMissing?2:1',
    "'resume_reuses_original_immutable_body'","command('confirm',121,revision,logicalVersion,resumeFp)",
    "command('seal',122,revision,logicalVersion,resumeFp)",'s.parsed.period.sealed,true');
});
test('actual103 approved declaration lies in saved UTC but outside current Madrid same-date range',()=>{
  has("{zone:'Europe/Madrid',reopened:false,withMissing:true}","oldRange.throughDate+'T23:30:00.000000Z'", "oldRange.throughDate+'T23:45:00.000000Z'",
    'public.faolla_attendance_correction_controls_v2(', 'public.faolla_attendance_missing_v1(',
    "action:'submit',operationId:fid(300)","review->'detail'->>'canApprove'='true'", "'action','approve'",
    'fixed.parsed.preview.artifact.report.missing.map(x=>x.requestId),[fid(300)]',
    'fixed.parsed.preview.artifact.report.totals.missingSelected.workedUs,900000000',
    'unknown.artifact.report.missing,[]','Date.parse(missingProposal.startAt)>=Date.parse(unknown.artifact.period.endAt)',
    'Date.parse(missingProposal.endAt)<=Date.parse(artifact.period.endAt)',
    'assert.notEqual(newSent.raw.artifactText,saved.raw.artifactText)','actual103BoundaryDeclaration:true');
  assert.doesNotMatch(text,/insert into public\.merchant_attendance_missing_(requests|entries)/i);
});
test('new nonoverlapping period uses current zone and genuine Node source projection',()=>{
  has('newRange={fromDate:day(h.slot.workDate,-4),throughDate:day(h.slot.workDate,-4)}',
    'projectPeriodClosureSource(r.source,query)','projectPeriodClosureSource(raw,',
    "q('owner','preview',null,null,null,newRange)",'next.period.timeZone,zone','next.dayBoundaries.length,1',
    'Date.parse(next.period.endAt)<Date.parse(artifact.period.startAt)',
    "command('send',201,0,0,next.sourceFingerprint,fid(200))",'nextResult.parsed.artifact.dayBoundaries,next.dayBoundaries');
  assert.doesNotMatch(text,/fakeArtifact|mockResult|sourceCanonical\s*=/);
});
test('old receipt recovery/export retain v1 bytes even when head has later logical version',()=>{
  has('recovered.parsed.operation,receipt','recovered.parsed.artifactVersion,1','recovered.raw.artifactText,saved.raw.artifactText',
    'await invoke(q(),send,null,false,true)',"q(access,'export',fid(100),1)",
    'exported.raw.artifactSha256,saved.raw.artifactSha256','exported.parsed.artifact,artifact',
    'sha(r.artifactText),r.artifactSha256','JSON.parse(r.artifactText),r.artifact',
    "'resume_exact_immutable_body_count'");
});
test('every actual read/failure/recovery uses service_role and per-call zero-write hashes',()=>{
  has('set local role service_role;do $resume_reject$',"'resume_failed_read_wrote'","'resume_read_or_recovery_wrote'",
    'assert.equal(readChecks,42);assert.equal(failedChecks,17);assert.equal(sourceReads,9)',
    'assert.equal(periodWrites,20);assert.equal(adminWrites,3);assert.equal(policyWrites,1);assert.equal(missingWrites,2)',
    'actualMissingReviewReads:1', 'No original settings/membership write, deleted event, changed deadline, production or deployment.');
});
