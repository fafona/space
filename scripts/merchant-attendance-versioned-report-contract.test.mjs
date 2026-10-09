import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replaceAll('\r\n','\n');
const migration=read('scripts/supabase-migrations/202610010093_merchant_attendance_versioned_reports.sql');
const previous={owner:'202609300087_merchant_attendance_period_report.sql',scoped:'202610010088_merchant_attendance_scoped_period_report.sql',export:'202610010090_merchant_attendance_period_export.sql',self:'202610010091_merchant_attendance_revision_requests.sql',review:'202610010092_merchant_attendance_revision_review.sql',decision:'202609300086_merchant_attendance_correction_decisions.sql'};
const old=k=>read('scripts/supabase-migrations/'+previous[k]);
function definition(text,name){
  const start=text.search(new RegExp('create (?:or replace )?function public\\.'+name+'\\('));assert(start>=0,name);
  const end=text.indexOf('$$;',start);assert(end>start,name);return text.slice(start,end+3);
}
const normalize=s=>s.replace(/create or replace function/g,'create function').replace(/--[^\n]*/g,'').replace(/\s/g,'');
test('v2 report readers change only effective-source selection/evidence, keeping authorization, bounds and original events intact',()=>{
  for(const [key,name] of [['owner','faolla_attendance_period_report_v1'],['scoped','faolla_attendance_scoped_period_report_v1']]){
    let expected=definition(old(key),name).replace(name,name.replace('_v1','_v2')).replaceAll('merchant_attendance_correction_effects','merchant_attendance_effect_current_v2')
      .replace(/\s*d public\.merchant_attendance_correction_decisions%rowtype;r public\.merchant_attendance_correction_entries%rowtype;/,'')
      .replaceAll("'raw-and-approved-v1'","'raw-and-approved-v2'");
    const start=expected.indexOf('    if eff.request_id is not null then'),end=expected.indexOf('    items:=items',start);assert(start>0&&end>start);
    const selfGuard=key==='scoped'?"      if access='self' and eff.employee_id is distinct from viewer.id then continue;end if;\n":'';
    if(key==='scoped')assert(expected.includes("if access='self' and r.employee_id is distinct from viewer.id then continue;end if;"));
    expected=expected.slice(0,start)+'    if eff.request_id is not null then\n'+selfGuard+'      effect_json:=public.faolla_attendance_effect_evidence_v2(eff,now_at);\n    end if;\n'+expected.slice(end);
    assert.equal(normalize(definition(migration,name.replace('_v1','_v2'))),normalize(expected));
  }
});
test('v2 export changes only reader names, retaining independent permissions, source hash, bounded receipts and replay rules',()=>{
  const expected=definition(old('export'),'faolla_attendance_period_export_v1').replaceAll('faolla_attendance_period_export_v1','faolla_attendance_period_export_v2')
    .replaceAll('faolla_attendance_period_report_v1','faolla_attendance_period_report_v2').replaceAll('faolla_attendance_scoped_period_report_v1','faolla_attendance_scoped_period_report_v2');
  assert.equal(normalize(definition(migration,'faolla_attendance_period_export_v2')),normalize(expected));
});
test('legacy SQL bodies gain only compatibility refusal, no changed approval permissions or silently stale reads',()=>{
  for(const [key,name] of [['owner','faolla_attendance_period_report_v1'],['scoped','faolla_attendance_scoped_period_report_v1'],['self','faolla_attendance_revision_self_v1'],['review','faolla_attendance_revision_owner_review_v1'],['decision','faolla_attendance_correction_decide_v1']]){
    let guarded=definition(migration,name);assert(guarded.includes('attendance_report_version_required'));
    if(key==='scoped')guarded=guarded.replace(/  -- Compatibility refusal[\s\S]*?then raise exception 'attendance_report_version_required';end if;\n/,'');
    else guarded=guarded.replace(/^.*attendance_report_version_required.*\n/m,'');
    assert.equal(normalize(guarded),normalize(definition(old(key),name)),name);
  }
  const scoped=definition(migration,'faolla_attendance_scoped_period_report_v1');
  assert(scoped.indexOf('if not granted')<scoped.indexOf('Compatibility refusal'));
  assert.match(scoped,/ev\.actor_employee_id is distinct from viewer\.id else ev\.location_id is distinct from target_location/);
  const self=definition(migration,'faolla_attendance_revision_self_v1');
  assert(self.indexOf('original.actor_auth_user_id is distinct from p_auth_user_id')<self.indexOf('attendance_report_version_required'));
});
test('journal is minimal append-only storage; report consumers migrate without granting revision writers',()=>{
  assert.equal([...migration.matchAll(/create table public\./g)].length,1);
  assert.match(migration,/alter table public\.merchant_attendance_effect_versions enable row level security/);
  assert.match(migration,/revoke all on public\.merchant_attendance_effect_versions from public,anon,authenticated,service_role/);
  assert.match(migration,/before update or delete[\s\S]*before truncate/);
  assert.match(migration,/unique\(merchant_id,root_request_id,previous_operation_id\)/);
  assert.match(migration,/new\.previous_operation_id<>expected_operation/);
  const table=migration.slice(migration.indexOf('create table'),migration.indexOf('create index'));
  assert(!/proposal jsonb|snapshot|csv|basis jsonb|latitude/.test(table));
  assert.deepEqual([...migration.matchAll(/grant execute on function public\.(\w+)/g)].map(m=>m[1]),['faolla_attendance_period_report_v2','faolla_attendance_scoped_period_report_v2','faolla_attendance_period_export_v2']);
  for(const [file,rpc] of [['merchantAttendanceTimesheet.server.ts','faolla_attendance_period_report_v2'],['merchantAttendanceScopedTimesheet.server.ts','faolla_attendance_scoped_period_report_v2'],['merchantAttendanceTimesheetExport.server.ts','faolla_attendance_period_export_v2']]){
    const source=read('src/lib/'+file);assert(source.includes('"'+rpc+'"'),file);assert(source.includes('currentAttendanceReportVersion'),file);assert(!/report_v1|export_v1/.test(source),file);
  }
});
test('current consumers retain v2 RPCs and validate explicit v2/v3 source markers without a legacy fallback',()=>{
  // Migration 195 introduced a v3 report body without changing the v2 RPCs.
  // The old literal-constant assertion described the 093 implementation, not
  // this stricter current dispatcher. Keep the SQL/ACL proofs above unchanged.
  const dispatcher=read('src/lib/merchantAttendanceCurrentReportVersion.ts');
  assert.match(dispatcher,/Object\.hasOwn\(raw,\s*"sourceVersion"\)/);
  assert.match(dispatcher,/version === "raw-and-approved-v2" \|\| version === "raw-and-approved-v3"/);
  assert.match(dispatcher,/throw new MerchantAttendanceError\("attendance_report_invalid_data"\)/);
  assert(!dispatcher.includes('raw-and-approved-v1'));
  for(const [file,parser] of [['merchantAttendanceTimesheet.server.ts','parseAttendanceTimesheetResult'],['merchantAttendanceScopedTimesheet.server.ts','parseAttendanceScopedTimesheetResult']]){
    const source=read('src/lib/'+file);
    assert(source.includes(parser+'(response.data,q,currentAttendanceReportVersion(response.data))'),file);
  }
  const exporter=read('src/lib/merchantAttendanceTimesheetExport.server.ts');
  assert(exporter.includes('raw?.replayed===true?ATTENDANCE_REPORT_SOURCE_VERSION:currentAttendanceReportVersion(raw?.report)'));
  assert(exporter.includes('parseTimesheetExportSource(response.data,command,version)'));
});
