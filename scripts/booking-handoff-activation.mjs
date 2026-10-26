// SQL construction only; no client, process, file write or auto-retry. The host
// must hold deployment + migration locks and collect fresh drain/gate evidence.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {assertBookingAtomicActivationTransition} from './booking-handoff-policy.mjs';
import {BOOKING_PROTECTED_SLUGS} from './booking-publication-database.mjs';
const fail=code=>{throw Error('booking_handoff_activation_'+code);};
const need=(v,code)=>{if(!v)fail(code);};
const hex=/^[a-f0-9]{64}(?![\s\S])/,uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/;
const PRODUCTION_SYSTEM='7612049595342295079';
const savedRows=`(select encode(sha256(convert_to(count(*)::text||':'||coalesce(string_agg(h,'' order by h collate "C"),''),'UTF8')),'hex') from
 (select encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') h from public.pages p where slug in
 (${BOOKING_PROTECTED_SLUGS.map(slug=>`'${slug}'`).join(',')})) saved)`;
const registry=`(select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(m)::text,'' order by version),''),'UTF8')),'hex') from public.faolla_schema_migrations m)`;
const state=`(select jsonb_build_object('systemIdentifier',(select system_identifier::text from pg_control_system()),
 'databaseOid',(select oid::text from pg_database where datname=current_database()),'serverVersionNum',current_setting('server_version_num'),
 'generation',generation::text,'revision',revision::text,'protocol',protocol,'active',active,'savedBookingRowsSha256',${savedRows},
 'commands',(select count(*) from public.faolla_booking_atomic_commands),'mailJobs',(select count(*) from public.faolla_booking_mail_jobs))
 from public.faolla_booking_atomic_control)`;
const body=`lock table public.pages,public.faolla_schema_migrations,public.faolla_booking_atomic_control,
 public.faolla_booking_atomic_commands,public.faolla_booking_mail_jobs in share row exclusive mode;
create temporary table faolla_booking_activation_result(value jsonb) on commit drop;
do $booking_handoff_activate$
declare v_before jsonb;v_after jsonb;v_registry text;v_updated integer;
begin
 if current_user<>'supabase_admin' or pg_is_in_recovery() then raise exception 'booking_activation_role';end if;
 if (select count(*) from public.faolla_booking_atomic_control)<>1 or
  exists(select 1 from public.faolla_booking_atomic_control where not singleton or active or protocol<>2 or revision<>0) or
  exists(select 1 from public.faolla_booking_atomic_commands) or exists(select 1 from public.faolla_booking_mail_jobs)
  then raise exception 'booking_activation_not_inactive';end if;
 if (select count(*) from public.faolla_schema_migrations)<>211 or
  (select max(version) from public.faolla_schema_migrations)<>202610250212 or
  (select name from public.faolla_schema_migrations where version=202610250211) is distinct from 'booking_atomic_preparation' or
  (select name from public.faolla_schema_migrations where version=202610250212) is distinct from 'booking_atomic_runtime'
  then raise exception 'booking_activation_registry';end if;
 if exists(select 1 from pg_class where oid=any(array['public.pages'::regclass,'public.faolla_schema_migrations'::regclass,
  'public.faolla_booking_atomic_control'::regclass,'public.faolla_booking_atomic_commands'::regclass,'public.faolla_booking_mail_jobs'::regclass])
  and pg_get_userbyid(relowner)<>'supabase_admin') then raise exception 'booking_activation_owner';end if;
 if exists(select 1 from pg_class where oid=any(array['public.faolla_booking_atomic_control'::regclass,
  'public.faolla_booking_atomic_commands'::regclass,'public.faolla_booking_mail_jobs'::regclass]) and not relrowsecurity) or
  exists(select 1 from unnest(array['anon','authenticated','service_role']) r cross join
   unnest(array['faolla_booking_atomic_control','faolla_booking_atomic_commands','faolla_booking_mail_jobs']) t
   where has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  then raise exception 'booking_activation_private_tables';end if;
 if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'faolla_booking_%')<>11 or
  exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'faolla_booking_%' and
   (pg_get_userbyid(p.proowner)<>'supabase_admin' or not p.prosecdef or
    has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or
    has_function_privilege('service_role',p.oid,'EXECUTE') is distinct from
      (p.proname=any(array['faolla_booking_atomic_snapshot_v1','faolla_booking_atomic_read_v2','faolla_booking_atomic_commit_v1',
       'faolla_booking_command_result_v2','faolla_booking_mail_claim_v1','faolla_booking_mail_settle_v2','faolla_booking_mail_states_v2']))))
  then raise exception 'booking_activation_private_rpcs';end if;
 v_before:=${state};v_registry:=${registry};
 if v_before is distinct from current_setting('faolla.booking_handoff_expected',true)::jsonb then raise exception 'booking_activation_snapshot_changed';end if;
 update public.faolla_booking_atomic_control set active=true where singleton and not active and protocol=2 and revision=0;
 get diagnostics v_updated=row_count;
 v_after:=${state};
 if v_updated<>1 or v_after is distinct from jsonb_set(v_before,'{active}','true'::jsonb) or ${registry} is distinct from v_registry
  then raise exception 'booking_activation_changed_saved_data';end if;
 insert into pg_temp.faolla_booking_activation_result(value) values(jsonb_build_object('before',v_before,'after',v_after));
end;$booking_handoff_activate$;
select value from pg_temp.faolla_booking_activation_result;
commit;`;
export const BOOKING_ACTIVATION_BODY_SHA256=createHash('sha256').update(body).digest('hex');
export const bookingHandoffActivationSnapshotSql=`begin read only;set local lock_timeout='2s';set local statement_timeout='8s';select ${state} as snapshot;rollback;`;
function validateBefore(before){
  const expected=['systemIdentifier','databaseOid','serverVersionNum','generation','revision','protocol','active','savedBookingRowsSha256','commands','mailJobs'];
  need(before&&typeof before==='object'&&!Array.isArray(before)&&isDeepStrictEqual(Object.keys(before).sort(),expected.sort()),'snapshot_shape');
  need(/^[1-9][0-9]{0,19}(?![\s\S])/.test(before.systemIdentifier)&&/^[1-9][0-9]{0,9}(?![\s\S])/.test(before.databaseOid)&&
    /^(?:15|16|17)[0-9]{4}(?![\s\S])/.test(before.serverVersionNum)&&uuid.test(before.generation)&&before.revision==='0'&&
    before.protocol===2&&before.active===false&&hex.test(before.savedBookingRowsSha256)&&before.commands===0&&before.mailJobs===0,'snapshot');
}
function build(before,{databaseName,isolated}){
  validateBefore(before);
  const name=databaseName.replaceAll("'","''"),expected=JSON.stringify(before).replaceAll("'","''");
  return `begin;set local lock_timeout='2s';set local statement_timeout='20s';
do $booking_handoff_identity$ begin
 if current_database()<>'${name}' or (select system_identifier::text from pg_control_system())<>'${before.systemIdentifier}'
  or (select oid::text from pg_database where datname=current_database())<>'${before.databaseOid}'
  or current_setting('server_version_num')<>'${before.serverVersionNum}'
  ${isolated?`or (select system_identifier::text from pg_control_system())='${PRODUCTION_SYSTEM}'`:''}
  then raise exception 'booking_activation_database_identity';end if;
end;$booking_handoff_identity$;
set local faolla.booking_handoff_expected='${expected}';
${body}`;
}
export function guardedProductionBookingActivationSql(before){
  assertBookingAtomicActivationTransition(before,{...before,active:true});
  return build(before,{databaseName:'postgres',isolated:false});
}
/** Same transaction BODY with only the actual isolated identity binding changed.
 * This entrypoint cannot target the real production cluster: SQL itself rejects
 * its system identifier, independently of any caller-supplied fixture facts.
 * The isolated runner must separately verify container ownership/network-none. */
export function isolatedBookingActivationAcceptanceSql({before,databaseName}){
  need(typeof databaseName==='string'&&/^faolla_booking_activation_[a-f0-9]{16}(?![\s\S])/.test(databaseName)&&
    before?.systemIdentifier!==PRODUCTION_SYSTEM,'isolated_identity');
  return build(before,{databaseName,isolated:true});
}
