import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),"utf8");
const sql=read("scripts/supabase-migrations/202609300084_merchant_attendance_correction_controls.sql");
test("independent controls keep append-only history and private projection without modifying original attendance",()=>{
  assert.equal((sql.match(/enable row level security/g)||[]).length,2);assert.equal((sql.match(/grant execute/g)||[]).length,1);
  assert.match(sql,/before update or delete on public.merchant_attendance_correction_controls/);assert.match(sql,/before truncate/);
  assert.doesNotMatch(sql,/update public\.(?:merchants|merchant_attendance_settings|merchant_attendance_events|merchant_enterprise_)|insert into public\.merchant_attendance_events|delete from/i);
  assert.match(sql,/security definer set search_path=pg_catalog/);assert.match(sql,/user_id=p_auth_user_id for share/);
});
test("receipt check precedes current revision/pause fences and policy/lock scans are bounded",()=>{
  assert.ok(sql.indexOf("if receipt.command<>p_command")<sql.indexOf("if not p_allow_write"));
  assert.ok(sql.indexOf("if receipt.command<>p_command")<sql.indexOf("(p_command->>'expectedRevision')::bigint<>"));
  for(const pattern of [/limit 201/,/limit 200/,/limit 26/,/rn<=25/,/locked=false,last_revision=expected/,/'rulesEnforced',false/,/recorded_at<=p_submitted_at/,/p_submitted_at>=deadline/])assert.match(sql,pattern);
  assert.match(sql,/p_original_end is not null and start_at<p_original_end and end_at>p_original_start/);
});
test("server/client entry is opt-in, same-origin and never exposes an approval mutation",()=>{
  const handler=read("src/app/api/merchant-enterprise/attendance/correction-controls/route-handler.ts"),admin=read("src/components/enterprise/MerchantAttendanceAdminPanel.tsx");
  assert.match(handler,/FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_CORRECTION_CONTROLS_ENABLED === "1"/);
  assert.match(handler,/isTrustedSameOriginMutationRequest/);assert.match(admin,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_CONTROLS_ENABLED === "1"/);
  assert.match(admin,/hidden=\{missingOpen \|\| exceptionOpen \|\| correctionReviewOpen \|\| correctionControlsOpen \|\| revisionApprovalOpen \|\| \(timesheetEnabled && timesheetOpen\)\}/);
});
test("actual page distinguishes new-request rules from unimplemented effective-hours locks and asks for explicit reason/confirmation",()=>{
  const s=read("src/components/enterprise/MerchantAttendanceCorrectionControlsPanel.tsx");
  for(const text of ["新版员工补正入口按规则核验新申请", "不能将“已配置锁定”当作工时已冻结", "beforeunload", "同一账号和标签页", "用原编号明确重试", "变更理由", "setAck(false)", "e.stopPropagation()", "这里保存规则与锁定配置"] )assert.ok(s.includes(text),text);
  assert.doesNotMatch(s,/setInterval|localStorage|navigator.geolocation|dangerouslySetInnerHTML/);
});
