import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8").replaceAll("\r\n","\n");
const sql=read("scripts/supabase-migrations/202609300086_merchant_attendance_correction_decisions.sql");
const functionBody=(text,name)=>{const start=text.indexOf(`function public.${name}(`);assert.ok(start>=0);const end=text.indexOf("end; $$;",start);assert.ok(end>start);return text.slice(start,end+8);};
const decide=functionBody(sql,"faolla_attendance_correction_decide_v1");
test("both independent ledgers are tenant-keyed, immutable, private and never rewrite punches",()=>{
  for(const name of ["decisions","effects"]){const table=`public.merchant_attendance_correction_${name}`;
    assert.ok(sql.includes(`alter table ${table} enable row level security`));
    assert.ok(sql.includes(`before update or delete on ${table}`));assert.ok(sql.includes(`before truncate on ${table}`));
    assert.doesNotMatch(sql,new RegExp(`grant (?:select|insert|update|delete|all).*on ${table}`));
  }
  assert.match(sql,/primary key\(merchant_id,request_id\), unique\(merchant_id,operation_id\)/);
  assert.match(sql,/primary key\(merchant_id,worker_id,start_event_id\), unique\(merchant_id,request_id\)/);
  assert.doesNotMatch(sql,/(?:insert into|update|delete from) public\.merchant_attendance_events/);
});
test("current owner and serialization precede review, raw and employment validation",()=>{
  assert.ok(decide.indexOf("and user_id=p_auth_user_id for share")<decide.indexOf("for update"));
  assert.ok(decide.indexOf("for update")<decide.indexOf("r:=public.faolla_attendance_correction_owner_review_v2"));
  assert.match(decide,/p_allow_write boolean default false/);
  for(const label of ["binding_changed","self_review","basis_changed","open_session","overlap_previous","overlap_next","employment_gap","employment_ambiguous","effective_overlap"])
    assert.ok(sql.includes(`'${label}'`));
});
test("old exact actor-bound receipt precedes pause, evidence and eligibility guards",()=>{
  assert.ok(decide.indexOf("receipt.command<>p_command")<decide.indexOf("attendance_platform_paused"));
  assert.ok(decide.indexOf("receipt.actor_auth_user_id<>p_auth_user_id")<decide.indexOf("attendance_platform_paused"));
  assert.ok(decide.indexOf("attendance_correction_evidence_changed")<decide.indexOf("insert into public.merchant_attendance_correction_decisions"));
  assert.ok(decide.indexOf("attendance_correction_decision_blocked")<decide.indexOf("insert into public.merchant_attendance_correction_decisions"));
  assert.match(decide,/receipt:=null/);
});
test("decision, original command, snapshot and microsecond effect share one all-or-nothing transaction",()=>{
  assert.match(decide,/reason,command,review_snapshot,recorded_at/);
  assert.match(decide,/if receipt.action='approve' then/);
  assert.match(decide,/elapsed_us-break_us,now_at/);assert.match(sql,/worked_us\+break_us=elapsed_us and paid_break_us<=break_us/);
  assert.doesNotMatch(decide,/exception when others|when sqlstate|commit;|rollback;/);
  assert.match(decide,/'timesheetIntegrated',false/);
});
test("evidence comparison excludes volatile observation times but includes rule/raw/effect watermarks",()=>{
  for(const fragment of ["e-'currentBasis'","(a->'rules')-'checkedAt'","'controlsRevision',controls_revision","'tailId',tail_id","'effectId',effect_id"])
    assert.ok(sql.includes(fragment));
  assert.match(sql,/left_at<to_at and right_at>from_at/);
  assert.match(sql,/start_at<to_at order by start_at desc limit 1/);
  assert.match(sql,/recorded_at<=\(r->>'asOf'\)::timestamptz/);
});
test("original self core changes only the three explicit terminal-state guards",()=>{
  const old=read("scripts/supabase-migrations/202609300082_merchant_attendance_correction_requests.sql");
  let expected=functionBody(old,"faolla_attendance_correction_self_v1");
  const noRejected=" and not exists(select 1 from public.merchant_attendance_correction_decisions d where d.merchant_id=p_site_id and d.request_id=head.request_id and d.action='reject')";
  expected=expected.replace("case when head.action='submit' then head.request_id",`case when head.action='submit'${noRejected} then head.request_id`)
    .replace("if head.action='submit' then raise exception 'attendance_correction_pending'",`if head.action='submit'${noRejected} then raise exception 'attendance_correction_pending'`)
    .replace("        if head.action is distinct from 'submit' or head.request_id<>v_request", "        if exists(select 1 from public.merchant_attendance_correction_decisions d where d.merchant_id=p_site_id and d.request_id=v_request) then raise exception 'attendance_correction_decided';end if;\n        if head.action is distinct from 'submit' or head.request_id<>v_request");
  assert.equal(functionBody(sql,"faolla_attendance_correction_self_v1"),expected);
  assert.doesNotMatch(sql,/pg_get_functiondef/);
});
test("v2 bypasses and internal helpers are private; live readers require terminal metadata",()=>{
  for(const signature of ["faolla_attendance_correction_self_v2(text,uuid,jsonb,jsonb,boolean)","faolla_attendance_correction_owner_review_v2(text,uuid,jsonb)",
    "faolla_attendance_decision_checks_v1(text,jsonb)","faolla_attendance_decision_decorate_v1(text,jsonb)"])
    assert.ok(sql.includes(`revoke all on function public.${signature} from public,anon,authenticated,service_role`));
  for(const name of ["merchantAttendanceCorrection","merchantAttendanceCorrectionReview"]){
    assert.match(read(`src/lib/${name}.server.ts`),/_v3/);
    assert.match(read(`src/lib/${name}.server.ts`),/true,\s*true/);
    assert.match(read(`src/lib/${name}Client.ts`),/true,\s*true/);
  }
});
test("readonly UI states decisions and limitations without opening unverified approval controls",()=>{
  const notice=read("src/components/enterprise/MerchantAttendanceCorrectionDecisionNotice.tsx");
  for(const label of ["原始打卡","工资","决定编号"])assert.ok(notice.includes(label));
  for(const name of ["MerchantAttendanceCorrectionWorkspace","MerchantAttendanceCorrectionReviewPanel"])
    assert.match(read(`src/components/enterprise/${name}.tsx`),/<DecisionNotice/);
  assert.match(read("src/components/enterprise/MerchantAttendanceCorrectionWorkspace.tsx"),/按当前规则重新准备申请/);
  assert.doesNotMatch(read("src/components/enterprise/MerchantAttendanceCorrectionReviewPanel.tsx"),/\/correction-decisions/);
});
