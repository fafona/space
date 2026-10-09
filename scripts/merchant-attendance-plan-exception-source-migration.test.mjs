// Static/source contracts only. ActualSQL and concurrency are root-owned probes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050146_merchant_attendance_plan_exception_source.sql';
const read=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const source=read(filename),clean=source.replace(/--[^\n]*/g,'');
const contract=JSON.parse(readFileSync(new URL('./fixtures/attendance-plan-exception-contract.json',import.meta.url),'utf8'));
const helper='faolla_attendance_plan_exception_session_v1',rpc='faolla_attendance_plan_exception_source_v1';
const fn=name=>{const start=clean.indexOf(`create or replace function public.${name}(`);assert(start>=0);return clean.slice(start,clean.indexOf('$$;',start)+3);};
const compact=fn(helper),body=fn(rpc);
const contains=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const ordered=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};

test('146 adds exactly two functions and registry, no old schema/index/ACL or business write',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),[helper,rpc]);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(x=>x[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/create\s+(?:table|index|trigger)|alter\s+table|update\s+public\.|delete\s+from|truncate|drop\s+(?:table|function|index)/i);
  assert.doesNotMatch(clean,/statement_timeout|pg_advisory|lock\s+table|session_replication_role|disable trigger/i);
});

test('atomic installation prerequisites cover latest effects, missing revisions, pending worker index and both context ledgers',()=>{
  assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
  contains(clean,"set local lock_timeout='3s'","202610010095::bigint,'merchant_attendance_revision_cycles'",
    "202610010103::bigint,'merchant_attendance_missing_revisions'","202610030116::bigint,'merchant_attendance_self_revision_history'",
    "202610030122::bigint,'merchant_attendance_leave_requests'","202610030123::bigint,'merchant_attendance_calendar'",
    "202610050145::bigint,'merchant_attendance_plan_adoption_view'",'installed<>(to_regprocedure(signature) is not null)',
    "version=202610050146 and name<>'merchant_attendance_plan_exception_source'");
  for(const block of clean.matchAll(/do \$(\w+)\$([\s\S]*?)\$\1\$;/g)){
    for(const variable of block[2].slice(0,block[2].indexOf('begin')).matchAll(/\b(\w+)\s+record\b/g))
      assert.doesNotMatch(block[2],new RegExp('\\b(?:from|join)\\s+[\\w.]+\\s+(?:as\\s+)?'+variable[1]+'\\b','i'));
  }
});

test('owner exact145 call is first and retains existing authorization/mutex order without worker impersonation',()=>{
  ordered(body,'envelope:=public.faolla_attendance_plan_coverage_adoptions_v1(p_query,p_auth_user_id)',
    "coverage:=envelope->'coverage'",'from public.merchant_attendance_plan_rule_artifacts');
  assert.equal((body.match(/public\.faolla_attendance_plan_coverage_adoptions_v1\(/g)||[]).length,1);
  assert.doesNotMatch(body,/for\s+(?:update|share)|p_command|p_allow_write|p_module_enabled|public\.faolla_attendance_.*\(.*member_auth\)/);
  const coverage=read('202610050139_merchant_attendance_plan_coverage.sql');
  ordered(coverage,'from public.merchants where id=site and user_id=p_auth_user_id for share',
    'from public.merchant_attendance_settings where merchant_id=site for share',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for share',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share','candidates:=array(');
});

test('published raw exact fields and fixed blocker ordering match shared contract',()=>{
  assert.deepEqual(Object.keys(contract.raw),['protocol','siteId','actorId','worker','slot','readAt','source','sourceText','fingerprint','eligible','blockers','candidate']);
  const orderedBlockers=body.match(/from unnest\(array\[([\s\S]*?)\]\)\s+with ordinality/);
  assert(orderedBlockers);assert.deepEqual([...orderedBlockers[1].matchAll(/'([^']+)'/g)].map(x=>x[1]),contract.blockers);
  for(const key of Object.keys(contract.raw))contains(body,`'${key}'`);
  contains(body,"'protocol','plan-exception-evidence-v1','policy','owner-confirmed-plan-edges-v1'",
    "'unassociated',jsonb_build_object(","'pendingCorrections',jsonb_build_object(");
});

test('fixed140 sources follow immutable saved adoption, verify hash and bytes, and never read the current approval head',()=>{
  contains(body,"adoption->>'status'<>'adopted'","adoption='null'::jsonb",'approval_id:=(adoption->\'approval\'->>\'operationId\')::uuid',
    "x.source_id=(adoption->'approval'->>'sourceId')::uuid",
    "artifact.source_sha256 is distinct from encode(sha256(convert_to(artifact.source::text,'UTF8')),'hex')",
    "artifact.source_bytes is distinct from octet_length(convert_to(artifact.source::text,'UTF8'))",
    'public.faolla_attendance_plan_rule_source_v1(artifact.source) is distinct from true',
    "adoption->'approval' is distinct from (approval-'source')");
  assert.doesNotMatch(body,/merchant_attendance_plan_rule_streams|faolla_attendance_plan_rule_approvals_v1|faolla_attendance_rule_sources_v1|faolla_attendance_sources_v1/);
});

test('original and latest approved edges are separate, open never acquires an asOf clockout, and effect lineage is compact',()=>{
  contains(compact,"case when last_event->>'action'='clock_out' then last_event->'occurredAt' else 'null'::jsonb end",
    "selected:=original", "'startAt',effect->'proposal'->'startAt','endAt',effect->'proposal'->'endAt'",
    "'rootRequestId',effect->'lineage'->'rootRequestId','previousOperationId',effect->'lineage'->'previousOperationId'");
  assert.doesNotMatch(compact,/asOf|readAt|clock_timestamp|sourceText|source_text|breaks|reason/);
  contains(body,'if not all_closed then original_end:=null;selected_end:=null;end if;');
});

test('associated set is unchanged, 10 sessions and2002 events, safe half-open edge/overlap checks do not reject early arrival or late departure',()=>{
  contains(body,"jsonb_array_length(coverage->'sessions')>10",'if event_count>2002 then raise exception',
    "elsif b=a then flags:=array_append(flags,'session_zero_duration')",
    "elsif a>=plan_end or b<=plan_begin then flags:=array_append(flags,'session_outside_plan')",
    "if prior_end is not null and a<prior_end then flags:=array_append(flags,'session_overlap')",
    "if b is null then all_closed:=false;flags:=array_append(flags,'session_open')");
  assert.doesNotMatch(body,/least\(selected_end,plan_end\)|greatest\(selected_start,plan_begin\)|a<plan_begin or b>plan_end/);
});

test('raw context includes no-lookback preceding anchor plus inside indexed101 before filtering association membership',()=>{
  contains(body,"x.action='clock_in'",'x.occurred_at>=plan_begin and x.occurred_at<plan_end order by x.occurred_at,x.sequence limit 101',
    'x.occurred_at<plan_begin order by x.occurred_at desc,x.sequence desc limit 1',
    'select distinct x from unnest(candidate_ids) x where not(x=any(associated_ids)) order by x limit 101');
  const preceding=body.slice(body.indexOf('select x.id into target_id'),body.indexOf('candidate_ids:=array_append'));
  assert.doesNotMatch(preceding,/interval|clock_timestamp|24|744/);
  contains(body,'public.faolla_attendance_shift_check_v1(jsonb_build_object(\'siteId\',site,\'workerId\',wid,\'startEventId\',target_id),p_auth_user_id)');
});

test('approved effects moved into plan are separately scanned by original/revised indexed starts with actual744hour bound',()=>{
  contains(body,'from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.worker_id=wid',
    "x.start_at>=plan_begin-interval '744 hours' and x.start_at<plan_end order by x.start_at desc limit 101",
    'from public.merchant_attendance_effect_versions x where x.merchant_id=site and x.worker_id=wid',
    "x.start_at>=plan_begin-interval '744 hours' and x.start_at<plan_end order by x.start_at,x.start_event_id limit 101");
  assert.doesNotMatch(body,/from public\.merchant_attendance_effect_current_v2|interval '31 days'/);
  contains(body,'event_count:=event_count+jsonb_array_length(child->\'events\')','if event_count>2002 then extra_limited:=true;exit;',
    "if extra_limited then extra_items:='[]';end if;");
});

test('leave fully bounded before overlap/helper and retains rejected/withdrawn/cancelled without free text',()=>{
  ordered(body,"x.start_at>=plan_begin-interval '8784 hours'",'leave_limited:=cardinality(ids)>100','if not leave_limited then',
    'if leave_row.end_at<=plan_begin then continue;end if;','public.faolla_attendance_leave_summary_v1(leave_row)');
  contains(body,'leave_row.employee_id<>employee or leave_row.actor_auth_user_id<>member_auth',
    "'revision',summary->'revision','status',summary->'status','startAt',summary->'startAt','endAt',summary->'endAt'");
  assert.doesNotMatch(body,/leave_row\.reason|leave_op\.command|summary->'reason'/);
});

test('calendar uses separate enterprise/original-slot scope ranges and cached saved-zone boundaries, not current default',()=>{
  contains(body,"place:=(slot->>'locationId')::uuid",'x.location_id is null', 'x.location_id=place',
    "from_day:=(plan_begin at time zone 'UTC')::date-367",'calendar_limited:=cardinality(calendar_ids)>100',
    'foreach boundary_date in array array[calendar_row.from_date,calendar_row.through_date+1]',
    'if not(bounds ? cache_key) then','public.faolla_attendance_control_day_boundary_v1(boundary_date,calendar_row.time_zone)',
    'if a>=plan_end or b<=plan_begin then continue;end if;');
  assert.doesNotMatch(body,/default_location|calendar_row\.reason|calendar_row\.title|where .*location_id is null or/);
});

test('missing includes pending revisions and current-approved status with bounded root101; never scans unbounded lineage/current helper',()=>{
  contains(body,"x.start_at>=plan_begin-interval '24 hours'",'missing_limited:=cardinality(ids)>100',
    'missing_first.command->\'proposal\' is distinct from missing_row.proposal',
    'coalesce(x.root_request_id,x.request_id)=coalesce(missing_row.root_request_id,missing_row.request_id) limit 101',
    'if cardinality(root_ids)>100 then missing_limited:=true;exit;end if;',
    "'isCurrentApproved',status_name='approved' and not exists",'x.supersedes_request_id=missing_row.request_id',
    "if missing_limited then missing_items:='[]';end if;");
  assert.doesNotMatch(body,/faolla_attendance_missing_lineage_v1|from public\.merchant_attendance_missing_current_v1|missing_row\.reason/);
});

test('pending correction and revision scans cap whole worker history before terminal/overlap filters; associated proposals moved out still block',()=>{
  ordered(body,'ids:=array(select x.request_id from public.merchant_attendance_correction_entries',
    'other_ids:=array(select x.request_id from public.merchant_attendance_revision_requests',
    'pending_limited:=cardinality(ids)>100 or cardinality(other_ids)>100', 'if not pending_limited then',
    'if correction_tail.action<>\'submit\' or decision.operation_id is not null then continue;end if;');
  contains(body,'order by x.recorded_at desc,x.request_id desc limit 101',
    'order by x.employee_id,x.actor_auth_user_id,x.recorded_at desc,x.request_id desc limit 101',
    'if not(correction_row.start_event_id=any(associated_ids)) and (a>=plan_end or b<=plan_begin) then continue;end if;',
    'if not(root_effect.start_event_id=any(associated_ids)) and (a>=plan_end or b<=plan_begin) then continue;end if;',
    "if pending_limited then pending_items:='[]';end if;");
  const index=read('202610030116_merchant_attendance_self_revision_history.sql');
  contains(index,'(merchant_id,worker_id,employee_id,actor_auth_user_id,recorded_at desc,request_id desc)');
});

test('unknown completeness and contextual conflicts block independently of any apparent delta; no evidence is an absence verdict',()=>{
  contains(body,"if extra_limited or leave_limited or calendar_limited or missing_limited or pending_limited then flags:=array_append(flags,'context_unknown')",
    "if jsonb_array_length(extra_items)>0 then flags:=array_append(flags,'unassociated_session')",
    "then flags:=array_append(flags,'leave_pending')", "then flags:=array_append(flags,'leave_approved')",
    "then flags:=array_append(flags,'calendar_entry')", "then flags:=array_append(flags,'missing_request')",
    "if jsonb_array_length(pending_items)>0 then flags:=array_append(flags,'pending_correction')",
    "if jsonb_array_length(blockers)>0 then field_result:=jsonb_build_object('state','blocked','minutes',null,'rawDeltaUs',null,'excessUs',null)");
  assert.doesNotMatch(body,/'absent'|'absence'|'auto_assign'|'excused'/);
});

test('candidate states preserve inherit/disabled/zero and strict greater-than grace with exact integer microseconds and no rounding',()=>{
  contains(body,"field->>'state'='unconfigured'", "field->>'state'='disabled'", "field->>'state'='value'",
    "extract(epoch from selected_start-plan_begin)*1000000", "extract(epoch from plan_end-selected_end)*1000000",
    'excess:=greatest(0,raw_delta-grace::numeric*60000000)',
    "case when raw_delta>grace::numeric*60000000 then 'triggered' else 'not_triggered' end",
    "'minutes',grace,'rawDeltaUs',raw_delta::bigint::text,'excessUs',excess::bigint::text");
  assert.doesNotMatch(body,/round\(|ceil\(|floor\(|grace\s*>\s*0|raw_delta\s*>=/);
});

test('stable canonical fingerprint excludes observation time; phase is explicit and the1MiB source cap is real UTF8',()=>{
  const built=body.slice(body.indexOf("source:=jsonb_build_object('protocol'"),body.indexOf('source_text:=source::text'));
  assert.doesNotMatch(built,/'readAt'|'asOf'|clock_timestamp|read_at/);
  contains(built,"'phase',phase");
  contains(body,'source_text:=source::text',"octet_length(convert_to(source_text,'UTF8'))>1048576",
    "'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex')",
    "'eligible',jsonb_array_length(blockers)=0", "if phase<>'ended' then flags:=array_append(flags,'plan_not_ended')");
  assert.equal(contract.limits.sourceUtf8Bytes,1048576);
});

test('no swallowed source failures or identity bypass: only known extra-size errors become unknown',()=>{
  assert.equal((body.match(/exception when/g)||[]).length,1);
  contains(body,"if failure in('attendance_shift_check_too_large','attendance_plan_adoption_view_too_large') then extra_limited:=true;exit;end if;\n        raise;");
  assert.doesNotMatch(body,/when others|exception when.*then\s*return|auth_user_id\s*=\s*p_auth_user_id/);
  for(const row of ['leave_row','missing_row','correction_row','revision_row'])
    contains(body,`${row}.employee_id<>employee or ${row}.actor_auth_user_id<>member_auth`);
});

test('only public newRPC service execute; helper private invoker, catalog shape and public ACL audited after registry',()=>{
  contains(compact,'returns jsonb language plpgsql set search_path=pg_catalog');
  contains(body,'returns jsonb language plpgsql security definer set search_path=pg_catalog');
  contains(clean,`grant execute on function public.${rpc}(jsonb,uuid) to service_role;`,
    'from public,anon,authenticated,service_role;',"x.prosecdef=is_rpc and x.provolatile='v'",
    "x.prorettype='jsonb'::regtype and x.proconfig=array['search_path=pg_catalog']",
    "has_function_privilege(role_name,signature,'EXECUTE') is distinct from (is_rpc and role_name='service_role')",
    "acl.grantee=0 and acl.privilege_type='EXECUTE'");
});
