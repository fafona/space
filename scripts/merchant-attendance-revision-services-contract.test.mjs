import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('v2 executors remain private candidates; only explicit gated self and owner HTTP routes are connected',()=>{
  for(const directory of ['src/app/','src/components/'])for(const name of readdirSync(new URL('../'+directory,import.meta.url),{recursive:true})){
    if(!/\.tsx?$/.test(name)||/\.test\./.test(name))continue;
    const source=read(directory+name.replaceAll('\\','/'));
    if(directory+name.replaceAll('\\','/')==='src/app/api/merchant-enterprise/attendance/revision-requests/route-handler.ts'){
      assert(source.includes('FAOLLA_ATTENDANCE_REVISION_CYCLES_ENABLED==="1"'));assert(source.includes('executeRevisionCycle'));continue;
    }
    if(['revision-decisions','revision-reviews'].some(route=>directory+name.replaceAll('\\','/')===`src/app/api/merchant-enterprise/attendance/${route}/route-handler.ts`)){
      assert(source.includes('FAOLLA_ATTENDANCE_REVISION_DECISIONS_ENABLED==="1"'));assert(/executeRevision(?:Decision|ApprovalReview)/.test(source));continue;
    }
    assert(!/merchantAttendanceRevision(?:Decision|Cycle)\.server/.test(source),name);
  }
  for(const [file,name] of [['src/lib/merchantAttendanceRevisionDecision.server.ts','faolla_attendance_revision_decide_v2'],['src/lib/merchantAttendanceRevisionCycle.server.ts','faolla_attendance_revision_self_v2']]){
    const s=read(file);assert(s.includes(name));assert(!/setTimeout|setInterval|while\s*\(|for\s*\(/.test(s));
    assert(s.includes('attendance_unavailable'));assert(!s.includes('p_auth_user_id:input.command'));
  }
});
test('owner v2 parses real version/state evidence and never fabricates revision 1 to call a legacy parser',()=>{
  const protocol=read('src/lib/merchantAttendanceRevisionApproval.ts');
  assert(protocol.includes('parseCorrectionReviewResult(v.review'));assert(protocol.includes('inspectCorrectionReview(review)'));
  assert(!protocol.includes('parseAttendanceRevisionReviewResult'));assert(!/revision\s*:\s*1\b|revision\s*%/.test(protocol));
  for(const marker of ['revision-review-v2','revision-decision-v2','previousOperationId','requestState','previewCorrection','receipt','fresh'])assert(protocol.includes(marker));
  assert(protocol.includes('current.revision===b.revision+1'));assert(protocol.includes('current.recordedAt<=decision.recordedAt'));
});
test('revision execution remains revoked while unchanged v2 RPCs strictly dispatch explicit v2/v3 sources in server and browser consumers',()=>{
  const sql=read('scripts/supabase-migrations/202610010095_merchant_attendance_revision_cycles.sql');assert(!/grant execute/i.test(sql));
  for(const name of ['faolla_attendance_revision_self_v2','faolla_attendance_revision_owner_review_v3','faolla_attendance_revision_decide_v2'])assert(new RegExp('revoke all on function public\\.'+name+'[^;]+from public,anon,authenticated,service_role;').test(sql));
  for(const [file,rpc] of [['merchantAttendanceTimesheet.server.ts','faolla_attendance_period_report_v2'],['merchantAttendanceScopedTimesheet.server.ts','faolla_attendance_scoped_period_report_v2'],['merchantAttendanceTimesheetExport.server.ts','faolla_attendance_period_export_v2']]){
    const s=read('src/lib/'+file);assert(s.includes('"'+rpc+'"'));assert(s.includes('currentAttendanceReportVersion'));assert(!s.includes(rpc.replace('_v2','_v1')));
  }
  for(const [file,call] of [
    ['merchantAttendanceTimesheet.server.ts','parseAttendanceTimesheetResult(response.data,q,currentAttendanceReportVersion(response.data))'],
    ['merchantAttendanceScopedTimesheet.server.ts','parseAttendanceScopedTimesheetResult(response.data,q,currentAttendanceReportVersion(response.data))'],
    ['merchantAttendanceTimesheetClient.ts','parseAttendanceTimesheetResponse(raw,query,currentAttendanceReportVersion(raw))'],
    ['merchantAttendanceScopedTimesheetClient.ts','parseScopedTimesheetResponse(raw,query,this.options.actorId,currentAttendanceReportVersion(raw))'],
  ])assert(read('src/lib/'+file).includes(call),file);
  const dispatcher=read('src/lib/merchantAttendanceCurrentReportVersion.ts');
  assert.match(dispatcher,/Object\.hasOwn\(raw,\s*"sourceVersion"\)/);
  assert.match(dispatcher,/version === "raw-and-approved-v2" \|\| version === "raw-and-approved-v3"/);
  assert.match(dispatcher,/throw new MerchantAttendanceError\("attendance_report_invalid_data"\)/);
  assert(!dispatcher.includes('raw-and-approved-v1'));
  const exporter=read('src/lib/merchantAttendanceTimesheetExport.server.ts');
  assert(exporter.includes('raw?.replayed===true?ATTENDANCE_REPORT_SOURCE_VERSION:currentAttendanceReportVersion(raw?.report)'));
  assert(exporter.includes('parseTimesheetExportSource(response.data,command,version)'));
});
