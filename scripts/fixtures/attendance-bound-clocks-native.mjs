// Minimal owned-namespace fixture; no connection, process or clock starts on import.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {prepareGroupsNativeFixture,groupsQueryInput,groupsNativeSave,groupsNativeAssign} from '../merchant-attendance-groups-native.mjs';
import {rulesQueryInput,rulesNativeSave,rulesNativePublish} from '../merchant-attendance-rules-native.mjs';
import {personalRulesQueryInput,personalRulesNativeApprove,personalRulesNativeWithdraw} from '../merchant-attendance-personal-rules-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';

export const boundClockFixtureMigrations=Object.freeze([
  '202609300071_merchant_attendance_location_precheck.sql','202609300072_merchant_attendance_location_clock.sql',
  '202609300073_merchant_attendance_location_policy_drafts.sql','202609300076_merchant_attendance_location_notices.sql',
  '202609300077_merchant_attendance_location_clock_notice_guard.sql','202610010104_merchant_attendance_terminals.sql',
  '202610010106_merchant_attendance_pin_credentials.sql','202610010107_merchant_attendance_pin_clock.sql',
  '202610010108_merchant_attendance_onsite_qr.sql','202610020111_merchant_attendance_self_clock_identity.sql',
  '202610020112_merchant_attendance_pin_clock_identity.sql','202610020113_merchant_attendance_location_receipt_identity.sql',
  '202610040127_merchant_attendance_rule_versions.sql','202610040129_merchant_attendance_personal_rules.sql','202610040130_merchant_attendance_rule_sources.sql',
]);
export const boundClockIdentity=Object.freeze({site:'99990001',owner:id(99),worker:id(201),employee:id(101),auth:id(1),
  geoWorker:id(202),geoEmployee:id(102),geoAuth:id(2),plainLocation:id(301),geoLocation:id(302),terminal:id(70),group:id(7001)});
export const quote=value=>value===null?'null':"'"+String(value).replaceAll("'","''")+"'";
export function boundClockMigrationBody(root,name){
  assert(path.isAbsolute(root));assert(/^2026\d{8}_merchant_attendance_[a-z_]+\.sql$/.test(name));
  return readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
}
export function boundClockRpcExpression(name,a){
  let args;
  if(['faolla_attendance_self_v1','faolla_attendance_self_bound_v1'].includes(name))args=[quote(a.p_site_id),quote(a.p_auth_user_id),json(a.p_command),quote(a.p_operation_id)];
  else if(['faolla_attendance_location_clock_v2','faolla_attendance_location_clock_bound_v1'].includes(name))args=[quote(a.p_site_id),quote(a.p_auth_user_id),quote(a.p_expected_worker_id),json(a.p_command),quote(a.p_operation_id),json(a.p_assertion),String(a.p_allow_new_sessions===true),String(a.p_require_clock===true)];
  else if(['faolla_attendance_pin_clock_v1','faolla_attendance_pin_clock_bound_v1'].includes(name))args=[quote(a.p_site),quote(a.p_terminal),quote(a.p_secret_hash),quote(a.p_no),quote(a.p_lease),String(a.p_verified===true),json(a.p_request),String(a.p_allow_new===true)];
  else if(name==='faolla_attendance_pin_begin_v1')args=[quote(a.p_site),quote(a.p_terminal),quote(a.p_secret_hash),quote(a.p_no),quote(a.p_lease),String(a.p_allow===true)];
  else if(['faolla_attendance_onsite_clock_v1','faolla_attendance_onsite_clock_bound_v1'].includes(name))args=[quote(a.p_site),quote(a.p_auth),json(a.p_claims),json(a.p_command),quote(a.p_operation),String(a.p_allow_new===true)];
  else if(name==='faolla_attendance_onsite_issue_v1')args=[quote(a.p_site),quote(a.p_terminal),quote(a.p_secret_hash)];
  else if(name==='faolla_attendance_pin_admin_v1')args=[quote(a.p_site),quote(a.p_auth),quote(a.p_no),quote(a.p_operation),json(a.p_command),String(a.p_allow_set===true)];
  else throw Error('bound_clock_unexpected_rpc');
  return `public.${name}(${args.join(',')})`;
}

// Actual future-only writers supply the templates inside a rolled-back owned
// transaction. Small past fixtures are then appended with all FK/CHECK/immutable
// triggers enabled. This is NOT a claim that wall time advanced or publication
// naturally became effective. No stored operation/event is updated or backfilled.
export function boundClockPastSeed(templates,today){
  assert(/^20\d\d-\d\d-\d\d$/.test(today));
  return `do $seed$ declare v jsonb;r public.merchant_attendance_rule_operations%rowtype;
    s public.merchant_attendance_rule_streams%rowtype;p public.merchant_attendance_personal_rule_operations%rowtype;
    ps public.merchant_attendance_personal_rule_streams%rowtype;stamp timestamptz:=(${quote(today)}::date-2)::timestamp at time zone 'UTC';
    start_day text:=(${quote(today)}::date-1)::text;end_day text:=(${quote(today)}::date+2)::text;
  begin
    assert not exists(select 1 from public.merchant_attendance_rule_operations),'bound_clock_empty_rules_required';
    assert not exists(select 1 from public.merchant_attendance_personal_rule_operations),'bound_clock_empty_personal_required';
    for v in select value from jsonb_array_elements(${json(templates.streams)}) loop
      s:=jsonb_populate_record(null::public.merchant_attendance_rule_streams,v);s.created_at:=stamp;s.updated_at:=stamp+interval '1 microsecond';
      insert into public.merchant_attendance_rule_streams select(s).*;
    end loop;
    for v in select value from jsonb_array_elements(${json(templates.operations)}) order by (value->>'revision')::bigint loop
      r:=jsonb_populate_record(null::public.merchant_attendance_rule_operations,v);r.recorded_at:=stamp+(r.revision-1)*interval '1 microsecond';
      if r.action='publish' then r.effective_on:=start_day::date;r.effective_at:=public.faolla_attendance_rule_day_start_v1(start_day,r.time_zone);
        r.command:=jsonb_set(r.command,'{effectiveOn}',to_jsonb(start_day));end if;
      r.snapshot:=public.faolla_attendance_rule_item_v1(r);insert into public.merchant_attendance_rule_operations select(r).*;
    end loop;
    ps:=jsonb_populate_record(null::public.merchant_attendance_personal_rule_streams,${json(templates.personalStream)});ps.created_at:=stamp;ps.updated_at:=stamp;
    insert into public.merchant_attendance_personal_rule_streams select(ps).*;
    p:=jsonb_populate_record(null::public.merchant_attendance_personal_rule_operations,${json(templates.personalOperation)});
    p.recorded_at:=stamp;p.starts_on:=start_day::date;p.ends_on:=end_day::date;
    p.from_at:=public.faolla_attendance_rule_day_start_v1(start_day,p.time_zone);p.to_at:=public.faolla_attendance_personal_rule_end_v1(end_day,p.time_zone);
    p.command:=jsonb_set(jsonb_set(p.command,'{startsOn}',to_jsonb(start_day)),'{endsOn}',to_jsonb(end_day));
    p.snapshot:=public.faolla_attendance_personal_rule_item_v1(p);insert into public.merchant_attendance_personal_rule_operations select(p).*;
    perform public.faolla_attendance_rule_stream_checked_v1(x) from public.merchant_attendance_rule_streams x;
    perform public.faolla_attendance_personal_rule_receipt_v1(x) from public.merchant_attendance_personal_rule_operations x;
  end;$seed$;`;
}

// Quota-only synthetic artifacts, never stored operations/events or runtime
// employee/worker identity. Caller MUST keep this inside its owned rollback
// connection. CHECK validators, hashes, FK and append-only triggers stay enabled.
export function boundClockQuotaSeed(sourceId){
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sourceId));
  return `do $quota$ declare seed public.merchant_attendance_shift_rule_sources%rowtype;body text;n integer;i integer;
    begin select * into strict seed from public.merchant_attendance_shift_rule_sources where source_id='${sourceId}';
      select count(*) into n from public.merchant_attendance_shift_rule_sources where merchant_id=seed.merchant_id and worker_id=seed.worker_id;
      assert n between 1 and 255,'bound_clock_quota_seed_count';
      for i in 1..(256-n) loop
        body:=jsonb_set(seed.source_text::jsonb,'{workerVersion}',to_jsonb(1000+i))::text;
        insert into public.merchant_attendance_shift_rule_sources(merchant_id,source_id,worker_id,source_text,source_sha256,source_bytes,created_at)
          values(seed.merchant_id,md5('bound-clock-quota-only-'||i)::uuid,seed.worker_id,body,encode(sha256(convert_to(body,'UTF8')),'hex'),octet_length(convert_to(body,'UTF8')),clock_timestamp());
      end loop;
      assert (select count(*) from public.merchant_attendance_shift_rule_sources where merchant_id=seed.merchant_id and worker_id=seed.worker_id)=256,'bound_clock_quota_seed_failed';
    end;$quota$;`;
}

// An owned rollback-only, chronological dense ledger. Withdraw each still-future
// approval before replacing it with the same choice, avoiding even historical
// simultaneous approvals. Raw templates originate from actual129 RPCs; this
// synthetic append is NOT represented as repeated successful owner writes.
export function boundClockPersonalDensitySeed(withdrawal,pairs){
  assert(withdrawal?.action==='withdraw'&&withdrawal.command?.action==='withdraw');
  assert(Number.isSafeInteger(pairs)&&pairs>=1&&pairs<=100);
  return `do $density$ declare original public.merchant_attendance_personal_rule_operations%rowtype;
    current_approval public.merchant_attendance_personal_rule_operations%rowtype;next_approval public.merchant_attendance_personal_rule_operations%rowtype;
    withdrawn public.merchant_attendance_personal_rule_operations%rowtype;head public.merchant_attendance_personal_rule_streams%rowtype;i integer;
    begin
      select * into strict head from public.merchant_attendance_personal_rule_streams where merchant_id='${boundClockIdentity.site}' and worker_id='${boundClockIdentity.worker}';
      select * into strict original from public.merchant_attendance_personal_rule_operations where merchant_id=head.merchant_id and worker_id=head.worker_id and revision=1;
      select * into strict current_approval from public.merchant_attendance_personal_rule_operations where merchant_id=head.merchant_id and worker_id=head.worker_id and revision=head.revision;
      assert original.action='approve' and current_approval.action='approve' and head.revision%2=1 and head.revision<=193,'bound_clock_density_head_changed';
      for i in 1..${pairs} loop
        withdrawn:=current_approval;withdrawn.action:='withdraw';withdrawn.revision:=current_approval.revision+1;withdrawn.approved_revision:=current_approval.revision;
        withdrawn.operation_id:=('00000000-0000-4000-8000-'||lpad((20000+withdrawn.revision)::text,12,'0'))::uuid;
        withdrawn.recorded_at:=original.recorded_at+(withdrawn.revision-1)*interval '1 microsecond';
        withdrawn.command:=${json(withdrawal.command)}||jsonb_build_object('operationId',withdrawn.operation_id,'expectedRevision',withdrawn.revision-1,
          'approvedRevision',withdrawn.approved_revision,'reason','Synthetic dense rollback withdrawal, not owner RPC');
        withdrawn.snapshot:=public.faolla_attendance_personal_rule_item_v1(withdrawn);
        insert into public.merchant_attendance_personal_rule_operations select(withdrawn).*;
        next_approval:=original;next_approval.revision:=withdrawn.revision+1;
        next_approval.operation_id:=('00000000-0000-4000-8000-'||lpad((20000+next_approval.revision)::text,12,'0'))::uuid;
        next_approval.recorded_at:=original.recorded_at+(next_approval.revision-1)*interval '1 microsecond';
        next_approval.command:=original.command||jsonb_build_object('operationId',next_approval.operation_id,'expectedRevision',next_approval.revision-1,
          'reason','Synthetic dense rollback approval, not owner RPC');
        next_approval.snapshot:=public.faolla_attendance_personal_rule_item_v1(next_approval);
        insert into public.merchant_attendance_personal_rule_operations select(next_approval).*;
        current_approval:=next_approval;
      end loop;
      update public.merchant_attendance_personal_rule_streams set revision=current_approval.revision,updated_at=current_approval.recorded_at
        where merchant_id=head.merchant_id and worker_id=head.worker_id returning * into head;
      perform public.faolla_attendance_personal_rule_stream_checked_v1(head);
    end;$density$;`;
}

export async function prepareBoundClocksNativeFixture(native,scope){
  const foundation=await prepareGroupsNativeFixture(native,scope),{exec,owned}=foundation,{site,owner,worker,geoWorker,geoAuth,plainLocation,geoLocation,terminal,group}=boundClockIdentity;
  for(const name of boundClockFixtureMigrations)exec(boundClockMigrationBody(native.root,name));
  exec(`update public.merchant_attendance_settings set enabled=true,web_clock_enabled=true,location_clock_enabled=true where merchant_id='${site}';
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.clock'] where merchant_id='${site}';
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active,latitude,longitude,radius_meters) values
      ('${plainLocation}','${site}','Synthetic plain location','UTC',true,null,null,null),('${geoLocation}','${site}','Synthetic geo location','Europe/Madrid',true,37.3,-5.9,100);
    update public.merchant_attendance_workers set default_location_id=case id when '${worker}'::uuid then '${plainLocation}'::uuid else '${geoLocation}'::uuid end where id in('${worker}','${geoWorker}');
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2020-01-01'),('${site}','${geoWorker}','2020-01-01');`);
  const today=exec("select (clock_timestamp() at time zone 'UTC')::date::text;"),day=n=>new Date(Date.parse(today+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
  foundation.call(groupsQueryInput(),groupsNativeSave(7001),true);
  foundation.call(groupsQueryInput({groupId:group,workerId:worker}),groupsNativeAssign(7101,group,worker,{startsOn:day(-1),endsOn:null}),true);
  const rules={lateGraceMinutes:{mode:'value',minutes:12},earlyGraceMinutes:{mode:'value',minutes:3},openSpanWarningMinutes:{mode:'value',minutes:120},completedBreakMinimumMinutes:{mode:'disabled'}};
  const groupRules={lateGraceMinutes:{mode:'inherit'},earlyGraceMinutes:{mode:'disabled'},openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'value',minutes:1}};
  const personal={lateGraceMinutes:{mode:'value',minutes:0},earlyGraceMinutes:{mode:'inherit'},openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'inherit'}};
  const connection=native.connect();let templates;
  try{
    await connection.step(scope.sql(`begin;${foundation.plan.guard}`));
    for(const [gid,choices,base] of [[null,rules,7500],[group,groupRules,7700]])for(const command of [rulesNativeSave(base+1,0,{rules:choices,expectedGroupRevision:gid?1:null}),rulesNativePublish(base+2,1,day(2),{expectedGroupRevision:gid?1:null})])
      await connection.step(scope.sql(`set local role service_role;select public.faolla_attendance_rules_v1(${json(rulesQueryInput({groupId:gid}))},'${owner}',${json(command)},true);reset role;`));
    await connection.step(scope.sql(`set local role service_role;select public.faolla_attendance_personal_rules_v1(${json(personalRulesQueryInput())},'${owner}',${json(personalRulesNativeApprove(8001,0,day(2),day(5),{rules:personal}))},true);reset role;`));
    templates=JSON.parse(await connection.step(scope.sql(`select jsonb_build_object('streams',(select jsonb_agg(to_jsonb(s)) from public.merchant_attendance_rule_streams s),
      'operations',(select jsonb_agg(to_jsonb(o) order by revision) from public.merchant_attendance_rule_operations o),
      'personalStream',(select to_jsonb(s) from public.merchant_attendance_personal_rule_streams s),
      'personalOperation',(select to_jsonb(o) from public.merchant_attendance_personal_rule_operations o));`)));
    await connection.step(scope.sql(`set local role service_role;select public.faolla_attendance_personal_rules_v1(${json(personalRulesQueryInput())},'${owner}',${json(personalRulesNativeWithdraw(8003,1,1))},true);reset role;`));
    templates.personalWithdrawal=JSON.parse(await connection.step(scope.sql("select to_jsonb(o) from public.merchant_attendance_personal_rule_operations o where action='withdraw';")));
  }finally{await connection.close();}
  exec(boundClockPastSeed(templates,today));
  const require=createRequire(import.meta.url),{terminalHash}=require('../../src/lib/merchantAttendanceTerminal.server.ts');
  const secret=randomBytes(32).toString('base64url'),pairSecret=randomBytes(32).toString('base64url'),pin='01738264';
  exec(`set local role service_role;select public.faolla_attendance_terminal_admin_v1('${site}','${owner}','{"terminalId":null,"cursor":null}',${json({action:'create',terminalId:terminal,locationId:plainLocation,label:'Synthetic binding terminal',pairHash:terminalHash(pairSecret)})},true);`);
  exec(`set local role service_role;select public.faolla_attendance_terminal_device_v1('${site}','${terminal}','${terminalHash(pairSecret)}','${terminalHash(secret)}',true);`);
  const values={purpose:'Synthetic binding check',notice:'Synthetic location notice',contact:'Synthetic owner',alternative:'Manual review',retentionDays:90,latitude:37.3,longitude:-5.9,radiusMeters:100};
  const noticeQuery=access=>({access,locationId:geoLocation,expectedWorkerId:access==='self'?geoWorker:null,operationId:null});
  exec(`set local role service_role;select public.faolla_attendance_location_policy_draft_v1('${site}','${owner}','${geoLocation}',${json({operationId:id(9001),expectedRevision:0,expectedSettingsVersion:1,expectedLocationVersion:1,values})},null,true);`);
  exec(`set local role service_role;select public.faolla_attendance_location_notice_v1('${site}','${owner}',${json(noticeQuery('owner'))},${json({action:'publish',operationId:id(9002),expectedRevision:0,draftRevision:1,expectedSettingsVersion:1,expectedLocationVersion:1,reason:'Synthetic publication'})},true);`);
  exec(`set local role service_role;select public.faolla_attendance_location_notice_v1('${site}','${geoAuth}',${json(noticeQuery('self'))},${json({action:'acknowledge',operationId:id(9003),expectedRevision:1})},true);`);
  return {...boundClockIdentity,exec,owned,foundation,day,today,secret,pin,templates,syntheticPastRules:true};
}
