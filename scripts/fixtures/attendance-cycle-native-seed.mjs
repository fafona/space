//200 disclosed LOCAL SOURCE template. This is not a historical publish RPC.
//Only the owned new site is populated. Real private191 tuple/item/relation
//validators independently recheck every saved byte before192 consumes it.
import assert from 'node:assert/strict';
import {lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
export const cycleNativeSite='99990200';
export const cycleNativeId=n=>id(200900000+n);
export const cycleNativePeople=Object.freeze(Object.fromEntries(['main','cancel','handoff','delegateTarget','fault','race'].map((name,n)=>[name,Object.freeze({
 worker:cycleNativeId(20+n*3),employee:cycleNativeId(21+n*3),auth:cycleNativeId(22+n*3),workerNo:'SYNTHETIC200-'+name.toUpperCase()})])));
export const cycleNativeIds=Object.freeze({selfRole:cycleNativeId(1),delegateRole:cycleNativeId(2),location:cycleNativeId(3),
 delegate:cycleNativeId(4),delegateAuth:cycleNativeId(5),otherOwner:cycleNativeId(6),draft:cycleNativeId(7),publication:cycleNativeId(8)});
export const cycleNativeFixedUuids=Object.freeze([...Object.values(cycleNativeIds),...Object.values(cycleNativePeople).flatMap(p=>[p.worker,p.employee,p.auth])]);
export function cycleNativeRules(kind='weekly'){
 assert(['weekly','monthly'].includes(kind));
 return {...Object.fromEntries(['allowedChannels','locationScope','shiftSource','breakTypes','correctionWindow','reviewRouting','reminders'].map(k=>[k,{mode:'inherit'}])),
  timesheetCycle:{mode:'value',value:kind==='weekly'?{kind,weekStartsOn:1}:{kind}}};
}
export function cycleNativeIdentitySeed(owner,names,schema){
 assert.match(owner,/^[a-f0-9-]{36}$/);assert.match(schema,/^attendance_race_[a-f0-9]{32}$/);
 assert.equal(new Set(cycleNativeFixedUuids).size,cycleNativeFixedUuids.length);
 names.forEach(n=>assert.match(n,/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/));
 const site=quote(cycleNativeSite),p=cycleNativeIds;
 return `do $cycle200_unused$ declare n text;found_uuid boolean;begin assert current_user='postgres';
  assert not exists(select 1 from public.merchants where id=${site}),'cycle200_unused_site_required';
  for n in select unnest(array[${names.map(quote).join(',')}]) loop
   execute format('select exists(select 1 from %I.%I x where to_jsonb(x)::text ~ $1)',${quote(schema)},n) into found_uuid using ${quote(cycleNativeFixedUuids.join('|'))};
   assert not found_uuid,'cycle200_all_fixed_UUIDs_unused';
  end loop;end;$cycle200_unused$;
 insert into public.merchants(id,user_id,name,email) values(${site},${quote(owner)},'Synthetic200 owned cycle','synthetic200@example.test');
 insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
  (${quote(p.selfRole)},${site},'Synthetic200 explicit self',array['enterprise.view','attendance.self.view','attendance.self.clock','attendance.self.request']),
  (${quote(p.delegateRole)},${site},'Synthetic200 explicit supervisor',array['enterprise.view','attendance.period.view','attendance.period.send','attendance.period.respond','attendance.period.seal','attendance.period.reopen']);
 insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
 ${Object.entries(cycleNativePeople).map(([name,v])=>`(${quote(v.employee)},${site},${quote(v.auth)},${quote('synthetic200-'+name+'@example.test')},${quote('Synthetic200 '+name)},${quote(p.selfRole)},'active',clock_timestamp(),1)`).join(',')},
 (${quote(p.delegate)},${site},${quote(p.delegateAuth)},'synthetic200-supervisor@example.test','Synthetic200 supervisor',${quote(p.delegateRole)},'active',clock_timestamp(),1);select 1;`;
}
export function cycleNativeHistoricalRuleSeed(owner){
 assert.match(owner,/^[a-f0-9-]{36}$/);const p=cycleNativeIds,site=quote(cycleNativeSite);
 return `do $cycle200_disclosed_historical_source$ declare sc jsonb:='{"kind":"enterprise"}';key_value text;info jsonb;refs jsonb;rules jsonb:=${json(cycleNativeRules())};
  ctx jsonb;shared jsonb;cmd jsonb;item jsonb;fp text;rules_fp text;refs_fp text;preview_fp text;
  effective_day text;effective_at timestamptz;draft_at timestamptz;publish_at timestamptz;
  op public.merchant_attendance_operational_rule_operations%rowtype;begin
  assert current_user='postgres';assert exists(select 1 from public.merchants where id=${site} and user_id=${quote(owner)});
  assert not exists(select 1 from public.merchant_attendance_operational_rule_streams where merchant_id=${site});
  key_value:=public.faolla_attendance_operational_rule_scope_v1(sc)::text;
  info:=public.faolla_attendance_operational_rule_context_v1(${site},sc);assert info->'usable'='true'::jsonb;
  ctx:=info->'context';assert ctx->>'timeZone'='UTC';refs:=public.faolla_attendance_operational_rule_references_v1(${site},sc,rules,info->'subject');
  effective_day:=((clock_timestamp() at time zone 'UTC')::date-14)::text;
  effective_at:=public.faolla_attendance_rule_day_start_v1(effective_day,'UTC');
  draft_at:=effective_at-interval '12 hours';publish_at:=draft_at+interval '1 microsecond';
  rules_fp:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-values-v1',public.faolla_attendance_operational_rule_values_v1(rules)));
  refs_fp:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-references-v1',${site},public.faolla_attendance_operational_rule_scope_v1(sc),
   public.faolla_attendance_operational_rule_context_tuple_v1(ctx,sc),public.faolla_attendance_operational_rule_references_tuple_v1(refs,sc,rules)));
  shared:=jsonb_build_object('context',ctx,'rules',rules,'references',refs,'rulesFingerprint',rules_fp,'referenceFingerprint',refs_fp);
  cmd:=jsonb_build_object('siteId',${site},'scope',sc,'action','save_draft','operationId',${quote(p.draft)},'expectedRevision',0,
   'reason','Synthetic200 disclosed historical SOURCE template; not a past publish RPC','expectedContext',ctx,'rules',rules);
  fp:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-command-v1',${quote(owner)},public.faolla_attendance_operational_rule_command_v1(cmd)));
  item:=shared||jsonb_build_object('scope',sc,'operationId',${quote(p.draft)},'actorId',${quote(owner)},'revision',1,'action','save_draft',
   'reason',cmd->>'reason','recordedAt',to_char(draft_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',fp);
  op.merchant_id:=${site};op.stream_key:=key_value;op.scope:=sc;op.operation_id:=${quote(p.draft)};op.revision:=1;op.actor_auth_user_id:=${quote(owner)};
  op.action:='save_draft';op.command:=cmd;op.command_fingerprint:=fp;op.item:=item;op.recorded_at:=draft_at;op.draft_revision_after:=1;
  perform public.faolla_attendance_operational_rule_item_v1(op);insert into public.merchant_attendance_operational_rule_operations select(op).*;
  insert into public.merchant_attendance_operational_rule_streams(merchant_id,stream_key,scope,revision,draft_revision,created_at,updated_at)
   values(${site},key_value,sc,1,1,draft_at,draft_at);
  preview_fp:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-publish-preview-v1',${site},public.faolla_attendance_operational_rule_scope_v1(sc),
   1,1,rules_fp,refs_fp,effective_day,null,to_char(effective_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),null));
  cmd:=jsonb_build_object('siteId',${site},'scope',sc,'action','publish','operationId',${quote(p.publication)},'expectedRevision',1,
   'reason','Synthetic200 disclosed historical SOURCE template; not a past publish RPC','sourceDraftRevision',1,'effectiveOn',effective_day,'endsOn',null,'previewFingerprint',preview_fp);
  fp:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-command-v1',${quote(owner)},public.faolla_attendance_operational_rule_command_v1(cmd)));
  item:=shared||jsonb_build_object('scope',sc,'operationId',${quote(p.publication)},'actorId',${quote(owner)},'revision',2,'action','publish','reason',cmd->>'reason',
   'recordedAt',to_char(publish_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',fp,'sourceDraftRevision',1,'effectiveOn',effective_day,'endsOn',null,
   'effectiveAt',to_char(effective_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endsAt',null,'previewFingerprint',preview_fp);
  op.operation_id:=${quote(p.publication)};op.revision:=2;op.action:='publish';op.command:=cmd;op.command_fingerprint:=fp;op.item:=item;op.recorded_at:=publish_at;op.draft_revision_after:=null;
  perform public.faolla_attendance_operational_rule_item_v1(op);insert into public.merchant_attendance_operational_rule_operations select(op).*;
  update public.merchant_attendance_operational_rule_streams set revision=2,draft_revision=null,updated_at=publish_at where merchant_id=${site} and stream_key=key_value;
  insert into public.merchant_attendance_operational_rule_publications(merchant_id,stream_key,published_revision,operation_id,effective_at,ends_at)
   values(${site},key_value,2,${quote(p.publication)},effective_at,null);
  perform public.faolla_attendance_operational_rule_check_v1(${site},key_value,1);perform public.faolla_attendance_operational_rule_check_v1(${site},key_value,2);
 end;$cycle200_disclosed_historical_source$;set constraints all immediate;set constraints all deferred;select 1;`;
}
