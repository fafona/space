//207 static scope proof; native SQL, permissions and lock races are root-owned.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateMigrationSource } from "./check-supabase-migrations.mjs";
const filename="202610060175_merchant_attendance_plan_posthoc_periods.sql";
const read=name=>readFileSync(new URL("./supabase-migrations/"+name,import.meta.url),"utf8").replaceAll("\r\n","\n");
const sql=read(filename), clean=sql.replace(/--[^\n]*/g,"");
const names=["faolla_attendance_period_source_v1","faolla_attendance_period_closure_source_base_v1","faolla_attendance_period_closure_source_v1","faolla_attendance_period_closure_v1"];
const originals={
 faolla_attendance_period_source_v1:"202610050154_merchant_attendance_period_missing_root_capacity.sql",
 faolla_attendance_period_closure_source_base_v1:"202610060158_merchant_attendance_work_arrangement_periods.sql",
 faolla_attendance_period_closure_source_v1:"202610060158_merchant_attendance_work_arrangement_periods.sql",
 faolla_attendance_period_closure_v1:"202610050155_merchant_attendance_period_fixed_boundaries.sql"
};
const edits={
  "faolla_attendance_period_source_v1": [
    {
      "before": "  fmt constant text:='YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"';",
      "after": "  --175 posthoc declarations begin.\n  posthoc_head public.merchant_attendance_plan_posthoc_operations%rowtype;posthoc_context jsonb:='[]';posthoc_snapshot jsonb;has_posthoc boolean:=false;\n  --175 posthoc declarations end.\n  fmt constant text:='YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"';"
    },
    {
      "before": "  select * into s from public.merchant_attendance_settings where merchant_id=site for share;",
      "after": "  --175 acquire the eventual173 lock level before worker/case reads.\n  select * into s from public.merchant_attendance_settings where merchant_id=site for update;"
    },
    {
      "before": "    item:=public.faolla_attendance_plan_exception_review_entry_v1(decision_row);",
      "after": "    --175 posthoc snapshot begins. Point-read the current head without filtering\n    --historical identities away; self sees saved facts, never owner observations.\n    select * into posthoc_head from public.merchant_attendance_plan_posthoc_operations x\n      where x.merchant_id=site and x.slot_id=case_row.slot_id order by x.revision desc limit 1;\n    if posthoc_head.operation_id is not null then\n      if row(posthoc_head.case_id,posthoc_head.worker_id,posthoc_head.employee_id,posthoc_head.employee_auth_user_id)\n        is distinct from row(case_row.case_id,wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;\n      posthoc_snapshot:=public.faolla_attendance_plan_posthoc_operation_v1(posthoc_head);\n      posthoc_context:=posthoc_context||jsonb_build_array(jsonb_build_object('slotId',case_row.slot_id,'revision',posthoc_head.revision,\n        'current',posthoc_snapshot,'selected',posthoc_head.selected,'approval',posthoc_head.approval));\n      has_posthoc:=true;\n    elsif decision_row.evidence->>'policy'='owner-confirmed-plan-edges-posthoc-v3' then\n      --A v3 decision cannot legitimately outlive its append-only171 ledger.\n      raise exception 'attendance_period_source_invalid';\n    end if;\n    --175 posthoc snapshot ends.\n    item:=public.faolla_attendance_plan_exception_review_entry_v1(decision_row);"
    },
    {
      "before": "      current_source:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);",
      "after": "      --175 formal dispatch begins. A new171 head also invalidates an OLD saved\n      --decision; dispatch cannot depend only on the saved evidence policy.\n      if posthoc_head.operation_id is not null or decision_row.evidence->>'policy'='owner-confirmed-plan-edges-posthoc-v3' then\n        current_source:=public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);\n      else\n      current_source:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);\n      end if;\n      --175 formal dispatch ends."
    },
    {
      "before": "  context:=jsonb_build_object('pendingCorrections',pending,'missing',missing,'leave',leaves,'calendar',calendars,'plans',jsonb_build_object('items',plans,'sessions',sessions),'reviews',reviews);",
      "after": "  context:=jsonb_build_object('pendingCorrections',pending,'missing',missing,'leave',leaves,'calendar',calendars,'plans',jsonb_build_object('items',plans,'sessions',sessions),'reviews',reviews);\n  --175 canonical posthoc begins. Only opted-in related facts add this key.\n  if has_posthoc then\n    select jsonb_agg(head_rows.value order by head_rows.value->>'slotId') into posthoc_context\n      from jsonb_array_elements(posthoc_context) head_rows(value);\n    context:=context||jsonb_build_object('posthoc',posthoc_context);\n  end if;\n  --175 canonical posthoc ends."
    },
    {
      "before": "  result:=jsonb_build_object('sourceVersion','attendance-period-source-v1',",
      "after": "  result:=jsonb_build_object('sourceVersion',case when has_posthoc then 'attendance-period-source-v3' else 'attendance-period-source-v1' end,"
    },
    {
      "before": "        current_source:=public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);",
      "after": "        --175 translate only known source failures; authorization and unknown failures propagate.\n        begin\n        current_source:=public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);\n        exception when raise_exception then\n          if sqlerrm=any(array['attendance_plan_posthoc_formal_invalid','attendance_plan_posthoc_evaluation_invalid',\n            'attendance_plan_posthoc_adoption_invalid','attendance_plan_posthoc_adoption_changed']) then raise exception 'attendance_period_source_invalid';\n          elsif sqlerrm=any(array['attendance_plan_posthoc_formal_too_large','attendance_plan_posthoc_evaluation_too_large',\n            'attendance_plan_posthoc_adoption_too_large']) then raise exception 'attendance_period_source_too_large';\n          elsif sqlerrm='attendance_worker_changed' then raise exception 'attendance_period_source_identity_changed';\n          else raise;end if;\n        end;"
    }
  ],
  "faolla_attendance_period_closure_source_base_v1": [
    {
      "before": "  fmt constant text:='YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"';",
      "after": "  --175 posthoc declarations begin.\n  posthoc_head public.merchant_attendance_plan_posthoc_operations%rowtype;posthoc_context jsonb:='[]';posthoc_snapshot jsonb;has_posthoc boolean:=false;\n  --175 posthoc declarations end.\n  fmt constant text:='YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"';"
    },
    {
      "before": "  select * into s from public.merchant_attendance_settings where merchant_id=site for share;",
      "after": "  --175 acquire the eventual173 lock level before worker/case reads.\n  select * into s from public.merchant_attendance_settings where merchant_id=site for update;"
    },
    {
      "before": "    item:=public.faolla_attendance_plan_exception_review_entry_v1(decision_row);",
      "after": "    --175 posthoc snapshot begins. Point-read the current head without filtering\n    --historical identities away; self sees saved facts, never owner observations.\n    select * into posthoc_head from public.merchant_attendance_plan_posthoc_operations x\n      where x.merchant_id=site and x.slot_id=case_row.slot_id order by x.revision desc limit 1;\n    if posthoc_head.operation_id is not null then\n      if row(posthoc_head.case_id,posthoc_head.worker_id,posthoc_head.employee_id,posthoc_head.employee_auth_user_id)\n        is distinct from row(case_row.case_id,wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;\n      posthoc_snapshot:=public.faolla_attendance_plan_posthoc_operation_v1(posthoc_head);\n      posthoc_context:=posthoc_context||jsonb_build_array(jsonb_build_object('slotId',case_row.slot_id,'revision',posthoc_head.revision,\n        'current',posthoc_snapshot,'selected',posthoc_head.selected,'approval',posthoc_head.approval));\n      has_posthoc:=true;\n    elsif decision_row.evidence->>'policy'='owner-confirmed-plan-edges-posthoc-v3' then\n      --A v3 decision cannot legitimately outlive its append-only171 ledger.\n      raise exception 'attendance_period_source_invalid';\n    end if;\n    --175 posthoc snapshot ends.\n    item:=public.faolla_attendance_plan_exception_review_entry_v1(decision_row);"
    },
    {
      "before": "      current_source:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);",
      "after": "      --175 formal dispatch begins. A new171 head also invalidates an OLD saved\n      --decision; dispatch cannot depend only on the saved evidence policy.\n      if posthoc_head.operation_id is not null or decision_row.evidence->>'policy'='owner-confirmed-plan-edges-posthoc-v3' then\n        current_source:=public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);\n      else\n      current_source:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);\n      end if;\n      --175 formal dispatch ends."
    },
    {
      "before": "  context:=jsonb_build_object('pendingCorrections',pending,'missing',missing,'leave',leaves,'calendar',calendars,'plans',jsonb_build_object('items',plans,'sessions',sessions),'reviews',reviews);",
      "after": "  context:=jsonb_build_object('pendingCorrections',pending,'missing',missing,'leave',leaves,'calendar',calendars,'plans',jsonb_build_object('items',plans,'sessions',sessions),'reviews',reviews);\n  --175 canonical posthoc begins. Only opted-in related facts add this key.\n  if has_posthoc then\n    select jsonb_agg(head_rows.value order by head_rows.value->>'slotId') into posthoc_context\n      from jsonb_array_elements(posthoc_context) head_rows(value);\n    context:=context||jsonb_build_object('posthoc',posthoc_context);\n  end if;\n  --175 canonical posthoc ends."
    },
    {
      "before": "  result:=jsonb_build_object('sourceVersion','attendance-period-source-v1',",
      "after": "  result:=jsonb_build_object('sourceVersion',case when has_posthoc then 'attendance-period-source-v3' else 'attendance-period-source-v1' end,"
    },
    {
      "before": "not in ('attendance-period-source-v1','attendance-period-source-v2')",
      "after": "not in ('attendance-period-source-v1','attendance-period-source-v2','attendance-period-source-v3')"
    },
    {
      "before": "        current_source:=public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);",
      "after": "        --175 translate only known source failures; authorization and unknown failures propagate.\n        begin\n        current_source:=public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);\n        exception when raise_exception then\n          if sqlerrm=any(array['attendance_plan_posthoc_formal_invalid','attendance_plan_posthoc_evaluation_invalid',\n            'attendance_plan_posthoc_adoption_invalid','attendance_plan_posthoc_adoption_changed']) then raise exception 'attendance_period_source_invalid';\n          elsif sqlerrm=any(array['attendance_plan_posthoc_formal_too_large','attendance_plan_posthoc_evaluation_too_large',\n            'attendance_plan_posthoc_adoption_too_large']) then raise exception 'attendance_period_source_too_large';\n          elsif sqlerrm='attendance_worker_changed' then raise exception 'attendance_period_source_identity_changed';\n          else raise;end if;\n        end;"
    }
  ],
  "faolla_attendance_period_closure_source_v1": [
    {
      "before": "jsonb_build_object('sourceVersion','attendance-period-source-v2')",
      "after": "jsonb_build_object('sourceVersion',case when result->>'sourceVersion'='attendance-period-source-v3' then 'attendance-period-source-v3' else 'attendance-period-source-v2' end)"
    }
  ],
  "faolla_attendance_period_closure_v1": [
    {
      "before": "  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;",
      "after": "  --175 current-source reads must take settings UPDATE before worker UPDATE.\n  --Fixed export, recovery, historical detail and list keep their old read lock.\n  if p_command is null and mode_name<>'preview' and not(mode_name='detail' and p_query->'version'='null'::jsonb) then select * into s from public.merchant_attendance_settings where merchant_id=site for share;"
    }
  ]
};
function body(text,name){const start=text.indexOf("create or replace function public."+name+"("),open=text.indexOf("$$",start),end=text.indexOf("$$;",open+2);
 assert(start>=0&&open>start&&end>open);return text.slice(start,end+3);}
test("175 is an additive four-function transaction with no new tables/writers or report algorithms",()=>{
 assert.deepEqual(validateMigrationSource(filename,sql),[]);
 assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]).sort(),[...names].sort());
 assert.doesNotMatch(clean,/create\s+(?:table|index|trigger)|alter\s+table|truncate|drop\s+(?:table|function|index)|session_replication_role|disable trigger/i);
 assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
 assert(clean.includes("set local lock_timeout='3s'"));
});
for(const name of names)test("175 exact reverse scope: "+name,()=>{
 let current=body(sql,name);
 for(const change of [...edits[name]].reverse()){assert.equal(current.split(change.after).length,2,"unique approved edit");current=current.replace(change.after,()=>change.before);}
 assert.equal(current,body(read(originals[name]),name));
});
test("175 validates prerequisites and preserves the private fixed-frame base ACL",()=>{
 for(const id of [154,155,158,173,174])assert.match(sql,new RegExp("version=2026100[56]0"+id+" and name="));
 assert(sql.includes("version=202610060175 and name<>'merchant_attendance_plan_posthoc_periods'"));
 for(const text of ["meta.prosecdef","meta.prorettype","meta.proargnames","meta.pronargdefaults","meta.proconfig","meta.provolatile"])assert(sql.includes(text));
 assert(sql.includes("revoke all on function public.faolla_attendance_period_closure_source_base_v1(jsonb,uuid) from public,anon,authenticated,service_role;"));
 assert.doesNotMatch(clean,/grant execute on function public\.faolla_attendance_period_closure_source_base_v1/);
 assert.equal((clean.match(/grant execute on function/g)||[]).length,3);
 for(const segment of [sql.slice(0,sql.indexOf("create or replace function")),sql.slice(sql.indexOf("do $period_posthoc_postconditions$"))]){
  for(const text of ["meta.proretset","meta.proargmodes is not null","meta.proparallel<>'u'","meta.pronargs",
   "array['anon','authenticated']","aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))","a.grantee<>p.proowner",
   "has_function_privilege('service_role',signature,'EXECUTE') is distinct from service_allowed",
   "service_allowed:=signature<>'public.faolla_attendance_period_closure_source_base_v1(jsonb,uuid)'",
   "not service_allowed or a.grantee<>(select oid from pg_roles where rolname='service_role')"])assert(segment.includes(text),text);
 }
});
test("both collectors snapshot related heads, keep self observationally separate and dispatch old decisions to formal source",()=>{
 for(const name of ["faolla_attendance_period_source_v1","faolla_attendance_period_closure_source_base_v1"]){
 const text=body(sql,name);
 assert(text.includes("where x.merchant_id=site and x.slot_id=case_row.slot_id order by x.revision desc limit 1"));
 assert(text.includes("row(case_row.case_id,wid,emp.id,emp.auth_user_id)"));
 assert(text.includes("if access_name='self' then flags:=array_append(flags,'unresolved_review');"));
 assert(text.includes("if posthoc_head.operation_id is not null or decision_row.evidence->>'policy'='owner-confirmed-plan-edges-posthoc-v3' then"));
 assert(text.includes("if has_posthoc then"));assert(text.includes("order by head_rows.value->>'slotId'"));
 assert(text.includes("case when has_posthoc then 'attendance-period-source-v3' else 'attendance-period-source-v1' end"));
 assert(text.indexOf("merchant_attendance_settings where merchant_id=site for update")<text.indexOf("merchant_attendance_workers where merchant_id=site"));
 }
});
test("pre/post metadata CASE expressions are parenthesized inside PL/pgSQL IF",()=>{
 for(const segment of [sql.slice(0,sql.indexOf("create or replace function")),sql.slice(sql.indexOf("do $period_posthoc_postconditions$"))]){
  assert(segment.includes("meta.pronargs<>(case when signature like '%boolean)' then 5 else 2 end)"));
  assert(segment.includes("meta.pronargdefaults<>(case when signature like '%boolean)' then 3 else 0 end)"));
  assert(segment.includes("meta.proargnames is distinct from (case when signature like '%boolean)'"));
  assert(segment.includes("else array['p_query','p_auth_user_id']::text[] end) then"));
  assert.doesNotMatch(segment,/meta\.(?:pronargs|pronargdefaults)<>case|meta\.proargnames is distinct from case|\bend\s+then\b/i);
 }
});
test("only known formal source failures map into existing archive-detail recoverability; auth/unknown propagate",()=>{
 for(const name of ["faolla_attendance_period_source_v1","faolla_attendance_period_closure_source_base_v1"]){
 const text=body(sql,name),start=text.indexOf("--175 translate only"),end=text.indexOf("        end;",start),block=text.slice(start,end);
 const codes=[...block.matchAll(/'(attendance_[a-z_]+)'/g)].map(x=>x[1]);
 assert.deepEqual(codes,["attendance_plan_posthoc_formal_invalid","attendance_plan_posthoc_evaluation_invalid","attendance_plan_posthoc_adoption_invalid","attendance_plan_posthoc_adoption_changed","attendance_period_source_invalid",
 "attendance_plan_posthoc_formal_too_large","attendance_plan_posthoc_evaluation_too_large","attendance_plan_posthoc_adoption_too_large","attendance_period_source_too_large","attendance_worker_changed","attendance_period_source_identity_changed"]);
 assert(block.includes("exception when raise_exception then"));assert(block.includes("else raise;end if;"));
 }
});
test("outer collector reads acquire UPDATE before worker lock; fixed reads/recovery never collect current facts",()=>{
 const b=body(sql,"faolla_attendance_period_closure_v1");
 assert(b.includes("if p_command is null and mode_name<>'preview' and not(mode_name='detail' and p_query->'version'='null'::jsonb) then"));
 assert(b.indexOf("merchant_attendance_settings where merchant_id=site for update")<b.indexOf("merchant_attendance_workers where merchant_id=site"));
 assert(b.includes("if p_command is null and mode_name='detail' and p_query->'version'='null'::jsonb then"));
 assert(b.includes("changed:=null;"));assert(b.includes("else raise;end if;"));
 const wrapper=body(sql,"faolla_attendance_period_closure_source_v1");
 assert(wrapper.includes("'attendance-period-source-v3'"));
 const base=body(sql,"faolla_attendance_period_closure_source_base_v1");
 assert(base.includes("'attendance-period-source-v1','attendance-period-source-v2','attendance-period-source-v3'"));
});
