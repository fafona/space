import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attendanceRecoveryCoverageTables as tables,attendanceRecoveryCoverageMigrations as migrations,
 attendanceRecoveryCoveragePlan,attendanceRecoveryCoverageProtectedSql,attendanceRecoveryCoverageSeedSql,
 prepareAttendanceRecoveryCoverage} from './attendance-recovery-coverage-native.mjs';
const source=readFileSync(new URL('./attendance-recovery-coverage-native.mjs',import.meta.url),'utf8');
const plan=()=>attendanceRecoveryCoveragePlan('2026-10-06');

test('inert coverage module has only owned-schema preparation and caller-provided target executor',()=>{
 assert.doesNotMatch(source,/node:(?:child_process|net)|pg_ctl|initdb|createdb|writeFile|mkdir|process\.env|\.env.local/);
 assert.match(source,/export async function prepareAttendanceRecoveryCoverage/);assert.match(source,/verifyRestored:async restoredExec/);
 assert.match(source,/assertLifecycleSandbox/);assert.match(source,/outageRelationsRacesFoundation\?\.phase,223/);
 assert(!/\.period\([^)]*,/.test(source),'no new period command');
});
test('six unchanged real migrations create exactly the eight missing table names',()=>{
 assert.equal(migrations.length,6);assert.equal(tables.length,8);assert.equal(new Set(tables).size,8);
 const actual=[];
 for(const name of migrations){
  const body=readFileSync(new URL('../supabase-migrations/'+name,import.meta.url),'utf8');
  for(const match of body.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(merchant_attendance_[a-z0-9_]+)/gi))actual.push(match[1]);
 }
 assert.deepEqual(actual.sort(),[...tables].sort());assert.match(source,/boundClockMigrationBody\(native.root,name\)/);
 assert.doesNotMatch(source,/\.replace\([^\n]*migration/);
});
test('078 column delta is explicit, checks old column values and does not rewrite legacy definitions',()=>{
 assert.match(source,/settingsColumnAdded:'location_channel_version DEFAULT 1'/);
 assert.match(source,/bool_and\(location_channel_version=1\)/);assert.match(source,/coverage_078_column_expected_absent/);
 assert.match(source,/coverage_replaced_old_function/);assert.match(source,/p\.oid=any/);
 const sql=attendanceRecoveryCoverageProtectedSql(['merchants','merchant_attendance_settings','faolla_schema_migrations']);
 assert.match(sql,/to_jsonb\(r\)-'location_channel_version'/);assert.doesNotMatch(sql,/-'version'|-'updated_at'/);
 assert.match(sql,/202609300078/);assert.match(sql,/202610040131/);
});
test('exact fresh tenant and identity range do not overlap security agent or previous history',()=>{
 const p=plan();assert.equal(p.site,'99990227');
 for(const key of ['owner','auth','employee','role','worker','location','event'])assert.match(p[key],/^00000000-0000-4000-8000-000226700\d{3}$/);
 assert.equal(new Set(['owner','auth','employee','role','worker','location','event'].map(key=>p[key])).size,7);
 const sql=attendanceRecoveryCoverageSeedSql(p);assert.match(sql,/coverage_new_merchant_required/);
 assert(!sql.includes('99990226'));assert(!sql.includes('000223'));assert(!sql.includes('000204'));
});
test('historical source seed is explicit, bounded and cannot alter an old event or use disabled triggers',()=>{
 const sql=attendanceRecoveryCoverageSeedSql(plan());
 assert.match(sql,/Two explicit historical fixtures, NOT successful past clock requests or real GPS evidence/);
 assert.match(sql,/2026-10-06T10:00:00Z/);assert.match(sql,/2026-10-06T12:00:00Z/);
 assert.match(sql,/'denied',true,null,null,null/);
 assert.doesNotMatch(sql,/update|delete from|truncate|disable trigger|session_replication_role|insert into public\.merchant_attendance_period_/i);
 assert.throws(()=>attendanceRecoveryCoverageSeedSql({...plan(),site:'99990001'}));
 assert.throws(()=>attendanceRecoveryCoverageSeedSql({...plan(),event:'00000000-0000-4000-8000-000000204710'}));
});
test('bounded civil day plan refuses invalid or injection-bearing labels',()=>{
 for(const day of ['2026-02-30','2026-10-06;select 1','1999-01-01','2100-01-01',''])assert.throws(()=>attendanceRecoveryCoveragePlan(day));
 assert.equal(attendanceRecoveryCoveragePlan('2024-02-29').day,'2024-02-29');
});
test('new annotations keep private owner note and actual self explanation separate',()=>{
 const p=plan();assert.equal(p.reviewCommand.outcome,'follow_up');assert.equal(p.reviewCommand.expectedRevision,0);
 assert.match(p.reviewCommand.note,/private owner/);
 assert.deepEqual(p.discussionCommands.map(c=>c.expectedRevision),[0,1]);
 assert.equal(p.discussionQuery('self').expectedWorkerId,p.worker);assert.equal(p.discussionQuery('owner').expectedWorkerId,null);
 assert(p.discussionCommands.every(c=>c.eventId===p.event&&c.operationId!==p.reviewCommand.operationId));
});
test('setup pause and template archive exercise actual saved state, not copied success DTOs',()=>{
 const p=plan();assert.equal(p.setupCommand.action,'pause');assert.equal(p.setupCommand.expectedChannelVersion,1);assert.equal(p.setupCommand.draftRevision,null);
 const [save,archive]=p.templateCommands;assert.equal(save.templateId,save.operationId);assert.equal(save.expectedRevision,0);
 assert.deepEqual(save.template.segments,[{start:'22:00',end:'06:00',nextDay:true}]);
 assert.equal(archive.templateId,save.templateId);assert.equal(archive.expectedRevision,1);assert.equal(archive.action,'archive');assert.equal(archive.template,null);
 assert.match(source,/assert\(archived.saved.item.archived\)/);assert.match(source,/setup.saved.after.channelVersion,2/);
});
test('source RPC writes explicitly scope service_role inside their own transaction',()=>{
 const write=source.slice(source.indexOf('const write=(kind,q,c=null)=>'),source.indexOf("write('review'"));
 assert.match(write,/d\.exec\(`begin;set local role service_role;/);
 assert.match(write,/assert current_user='service_role','coverage_write_service_role_required'/);
 assert.match(write,/select \$\{callExpression\(p,kind,q,c\)\};commit;/);
 assert.doesNotMatch(write,/reset role|set role postgres|native\.query/);
});
test('two captures retain original source text with SHA proof and explicitly do not claim application',()=>{
 const p=plan();assert.equal(p.captureCommands.length,2);assert.notEqual(p.captureCommands[0].operationId,p.captureCommands[1].operationId);
 assert(p.captureCommands.every(c=>c.employeeId===p.employee&&c.employeeAuthUserId===p.auth&&c.fromDate===c.throughDate));
 assert.match(source,/captures\[0\]\.sourceId,captures\[1\]\.sourceId/);
 assert.match(source,/captures\[0\]\.sourceText,captures\[1\]\.sourceText/);
 assert.match(source,/r\.applied,false/);assert.match(source,/r\.historicalApplicationProven,false/);assert.match(source,/createHash\('sha256'\)/);
});
test('protected facts keep every other merchant and permit only exact migration registrations and new event summary',()=>{
 const sql=attendanceRecoveryCoverageProtectedSql(['merchants','faolla_schema_migrations','merchant_attendance_settings','merchant_attendance_events','merchant_attendance_location_results']);
 assert.match(sql,/r\.id<>'99990227'/);assert.match(sql,/event_id<>'00000000-0000-4000-8000-000226700010'::uuid/);
 assert.match(sql,/coalesce\(to_jsonb\(r\)->>'merchant_id',''\)<>'99990227'/);
 assert.match(sql,/r\.version not in\(202609300074,202609300075,202609300078,202610010102,202610030119,202610040131\)/);
 assert.throws(()=>attendanceRecoveryCoverageProtectedSql(['merchants','merchants']));
 assert.throws(()=>attendanceRecoveryCoverageProtectedSql(['merchants;delete from x']));
});
test('restored verification uses injected executor and real legacy parsers with no source closure calls',()=>{
 const verify=source.slice(source.indexOf('verifyRestored:async restoredExec'));
 assert.match(verify,/read\(restoredExec,probes\[i\]\)/);assert.match(verify,/runAttendanceRecoveryReadProbe\(restoredExec/);
 assert.doesNotMatch(verify,/d\.exec|native\.query|sourceExec|archive\(|periodArchive\(/);
 for(const parser of ['parseAttendanceLocationReviewResult','parseDiscussionResult','parseLocationSetupResult','parseShiftTemplatesResult','parseRuleCapturesResult','parseUnifiedExportSource'])assert(source.includes(parser),parser);
 assert.match(source,/packet.value.replayed,true/);assert.match(source,/packet.value.report,null/);
 assert.match(source,/parsedExport.report.totals.selected.workedUs,7200000000/);
 assert.match(source,/current.sourceChanged,false/);assert.match(source,/actual.artifactText,expected.artifactText/);
});
test('non-synthetic and pre223 callers cannot install or write anything',async()=>{
 let calls=0;const native={query:()=>{calls++;throw Error('must not execute');}};
 await assert.rejects(prepareAttendanceRecoveryCoverage({d:{syntheticOnly:false},h:{syntheticOnly:true},native}));
 await assert.rejects(prepareAttendanceRecoveryCoverage({d:{syntheticOnly:true},h:{syntheticOnly:true},native}));
 assert.equal(calls,0);
});
