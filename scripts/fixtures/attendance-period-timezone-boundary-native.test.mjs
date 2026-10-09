// Static/pure fixture contracts only. Root alone supplies runtime evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyPeriodTimezoneBoundaryNative} from './attendance-period-timezone-boundary-native.mjs';
const text=readFileSync(new URL('./attendance-period-timezone-boundary-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>{for(const part of parts)assert(text.includes(part),part);};

test('inert entry rejects non-synthetic use and keeps ownership/154 guards',async()=>{
  assert.equal(typeof verifyPeriodTimezoneBoundaryNative,'function');
  await assert.rejects(verifyPeriodTimezoneBoundaryNative({d:{syntheticOnly:false}}));
  has('assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    'h.syntheticHistoricalRows===10',"'timezone_requires154'","'timezone_unique_synthetic_site'","'timezone_live_guards'");
  assert.doesNotMatch(text,/child_process|spawn\(|execFile|process\.env|process\.argv|statement_timeout|lock_timeout|disable trigger|session_replication_role|pg_sleep/i);
});
test('event-bearing merchant uses actual064 and exact history protection for both changes',()=>{
  has('public.faolla_attendance_admin_v1(',"'timezone_real_history_required'","'timezone_settings_version_stable'",
    "['Etc/UTC','Europe/Madrid'].map",'admin(d.site,d.owner,zone,',"'attendance_history_protected'",'historyProtectedErrors:2',
    'const settings=JSON.parse(d.exec(', 'Number.isSafeInteger(settings.version)');
  assert.doesNotMatch(text,/update public\.|delete from public\.|insert into public\.merchant_attendance_events/i);
});
test('unique empty synthetic merchant has only minimal constrained membership/configuration setup',()=>{
  has("const emptySite='98400184'",'assert.notEqual(d.site,emptySite)',
    'insert into public.merchants(id,user_id)','insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)',
    'insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)',
    'insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled)',
    'insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)',
    'insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id)',
    'insert into public.merchant_attendance_employment_periods(id,merchant_id,worker_id,starts_on)',
    "'attendance.self.request','attendance.self.export'","'timezone_no_event_bypass'");
  assert.equal((text.match(/insert into public\./g)||[]).length,7);
});
test('original rows remain hashed even inside allowed setup tables, with complete rollback',()=>{
  has("name==='merchants'?'id':'merchant_id'",'ownTables.has(name)','<>${quote(emptySite)}',
    'baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog()',
    'd.fingerprint(),baseline','d.definitions(),definitions','d.tableCatalog(),catalog',
    "'timezone_changed_original_site_rows'",'finally{await connection.close();restore(label);}',
    "'set constraints all immediate;rollback;'",'outerRollbackTransactions:3');
  assert.doesNotMatch(text,/\bcommit;|create(?: or replace)? function|alter table|grant\s|revoke\s|boundClockMigrationBody/i);
});
test('real149 preview goes through existing Node projection before actual send and confirmation',()=>{
  has('public.faolla_attendance_period_closure_v1(', 'projectPeriodClosureSource(r.source,q)','parsePeriodClosureResult(',
    "const before=await invoke(query('owner','preview',null))",'const artifact=before.parsed.preview.artifact',
    'await invoke(query(),send,artifact,true)',"await invoke(query('self'),confirm,null,true)",
    'assert.deepEqual(artifact.report.base.rows,[])','assert.deepEqual(artifact.report.missing,[])');
  assert.doesNotMatch(text,/fakeArtifact|mockResult|sourceCanonical\s*=/);
});
test('equivalent alias changes semantic zone/hash despite identical saved UTC bounds',()=>{
  has("label=zone==='Etc/UTC'?'equivalent_alias':'changed_offset'",'admin(emptySite,owner,zone,fid(110),1,',
    "current.parsed.preview.period.timeZone,'UTC'",'currentArtifact.period.timeZone,zone','assert.notEqual(currentFp,fp)',
    'assert.equal(currentArtifact.period.startAt,artifact.period.startAt)','assert.equal(currentArtifact.period.endAt,artifact.period.endAt)',
    "detail.parsed.sourceChanged,true", "detail.parsed.period.timeZone,'UTC'");
});
test('fresh current-artifact writes prove head mismatch and new-period overlap instead of fake stale input',()=>{
  has("await fail('fresh_confirm'", "await fail('fresh_seal'", "'attendance_period_source_changed'",
    "await fail('send_existing_with_fresh_artifact',query(),command('send',122,revision,1,currentFp),currentArtifact",
    "await fail('send_new_overlapping_period'", "command('send',123,0,0,currentFp,fid(200)),currentArtifact,'attendance_period_overlap'",
    "'timezone_no_overlapping_head_written'","'timezone_no_failed_new_version'");
});
test('actual seal precedes Madrid change, reopen with write disabled only clears the new gate',()=>{
  has("if(sealed){const result=await invoke(query(),seal,null,true)",
    'Date.parse(currentArtifact.period.startAt)<Date.parse(artifact.period.startAt)',
    "command('reopen',104,3,1,null),reopened=await invoke(query(),reopen,null,false)",
    "reopened.parsed.period.state,'open'",'reopened.parsed.period.confirmedVersion,null',
    "await recover(reopen)","await invoke(query(),reopen,null,false,true)",
    "'timezone_location_not_settings'",'locationTimezoneChanged:false');
});
test('original operation recover/replay and fixed exports retain real text/SHA/artifact after settings changes',()=>{
  has('await recover(send);await recover(confirm)', 'if(sealed)await recover(seal)',
    'retry,null,false,true','result.parsed.operation.command,c','result.parsed.sourceChanged,null',
    "query(access,'export',fid(100),1)",'saved.raw.artifactText,beforeOwner.raw.artifactText',
    'saved.raw.artifactSha256,beforeOwner.raw.artifactSha256','saved.raw.artifactBytes,beforeOwner.raw.artifactBytes',
    'saved.parsed.artifact,artifact','sha(r.artifactText),r.artifactSha256','JSON.parse(r.artifactText),r.artifact');
});
test('each read/replay/failure is service_role and zero-write checked with bounded steps and honest counts',()=>{
  has('assert(++steps<=30',"'before_read'","'after_read'","'timezone_read_or_replay_wrote'",
    'set local role service_role;do $timezone_reject$',"'before_failure'","'after_failure'","'timezone_failed_rpc_wrote'",
    'assert.equal(readChecks,25);assert.equal(failedChecks,8);assert.equal(actualAdminWrites,2);assert.equal(actualPeriodWrites,6)',
    'diagnosticOnly:true', 'settingsUpdateBypass:false','real064TimezoneChanges:true','syntheticEmptyMerchant:true',
    'No original merchant setting change, deleted events, migration, guard bypass, tzdata-upgrade simulation, real account or deployment.');
});
