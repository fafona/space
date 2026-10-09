import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const sql=read("scripts/supabase-migrations/202609300085_merchant_attendance_correction_rule_binding.sql");
test("bindings are private append-only side evidence, never legacy backfill or raw punch rewrite",()=>{
  for(const s of ["enable row level security","before update or delete","before truncate","foreign key(merchant_id,request_id)","foreign key(merchant_id,policy_revision)"])assert.ok(sql.includes(s));
  assert.doesNotMatch(sql,/update public\.merchant_attendance_events|delete from|insert into public\.merchant_attendance_events|grant .*on public\.merchant_attendance_correction_rule_bindings/);
  assert.match(sql,/if binding.request_id is null then kind:='legacy'/);
});
test("v2 serializes before worker locks, retains v1 validation, exact replay and all-or-nothing rule binding",()=>{
  const v2=sql.slice(sql.indexOf("create function public.faolla_attendance_correction_self_v2"));
  assert.ok(v2.indexOf("for update")<v2.indexOf("r:=public.faolla_attendance_correction_self_v1"));
  assert.ok(v2.indexOf("if old_operation then")<v2.indexOf("attendance_correction_policy_changed"));
  assert.match(v2,/binding.command<>p_command/);assert.match(v2,/recorded_at<=public.faolla_attendance_instant_v1\(r->'item'->>'submittedAt'\)/);
  assert.doesNotMatch(v2,/when others|when sqlstate|exception.*null/);
  assert.match(sql,/revoke all on function public.faolla_attendance_correction_self_v1\(text,uuid,jsonb,jsonb,boolean\) from public,anon,authenticated,service_role/);
});
test("shared rule read protects both ranges, preserves microseconds and exposes only a bounded count",()=>{
  assert.match(sql,/original_end:=original_end\+interval '1 microsecond'/);
  assert.match(sql,/start_at<original_end and end_at>original_start/);assert.match(sql,/start_at<proposed_end and end_at>proposed_start/);
  assert.match(sql,/limit 201/);assert.match(sql,/'lockedPeriodCount',locked_count/);
  assert.doesNotMatch(sql,/'periodIds'|'actorAuthUserId'/);
});
test("employee and owner display the same rule notice, without claiming approval or silently creating defaults",()=>{
  for(const p of ["MerchantAttendanceCorrectionWorkspace.tsx","MerchantAttendanceCorrectionReviewPanel.tsx"])
    assert.match(read(`src/components/enterprise/${p}`),/<RulesNotice rules=/);
  const notice=read("src/components/enterprise/MerchantAttendanceCorrectionRulesNotice.tsx");
  for(const t of ["之前提交，不包含该时刻","规则更新需重新确认","不是批准凭证","精确截止 UTC"])assert.ok(notice.includes(t));
  assert.match(read("src/lib/merchantAttendanceCorrectionRules.ts"),/旧申请未绑定规则版本/);
});
