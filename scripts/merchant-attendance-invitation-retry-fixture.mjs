// Installation only, inside the caller's existing owned synthetic namespace.
// No invitation/employee seeds, Auth mutations or fabricated business replies.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';

const files={lifecycle:'202607310003_merchant_enterprise_invitation_lifecycle.sql',audit:'202608020019_merchant_enterprise_audit.sql',
  password:'202608310043_merchant_employee_initial_password_setup.sql'};
const accept='faolla_accept_merchant_employee_invitation_v1',waive='faolla_waive_employee_initial_password_v1';
const setup='merchant_employee_initial_password_setups';
const rpcNames=Object.freeze([waive,accept]);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export function invitationRetryFixturePlan(root){
  assert.equal(typeof root,'string');assert(path.isAbsolute(root),'invitation_retry_absolute_root_required');
  const sources=Object.entries(files).map(([key,file])=>({key,file,source:readFileSync(path.join(root,'scripts/supabase-migrations',file),'utf8')}));
  const definitions=[];
  const select=(key,name,pattern)=>{
    const file=sources.find(item=>item.key===key),matches=[...file.source.matchAll(new RegExp(pattern,'g'))];
    assert.equal(matches.length,1,`invitation_retry_exact_source_required:${name}`);return matches[0][0];
  };
  const ddl=(name,pattern)=>{
    const original=select('password',name,pattern);definitions.push({file:files.password,name,kind:'ddl',original,statement:original});return original;
  };
  const fn=(key,name,renamed=name)=>{
    const original=select(key,name,`create or replace function\\s+public\\.${escape(name)}\\([\\s\\S]*?\\n\\$\\$;`);
    const statement=renamed===name?original:original.replace(`public.${name}(`,`public.${renamed}(`);
    definitions.push({file:files[key],name:renamed,kind:'function',original,statement,signature:renamed+'(jsonb)'});return statement;
  };
  const statements=[
    // Original migration prefix. The guard requires an absent column, so its
    // nullable-policy repair UPDATE is a no-op after ADD COLUMN fills 'waived'.
    ddl('initial-password-policy','alter table public\\.merchant_enterprise_employees\\s+add column if not exists initial_password_policy[\\s\\S]*?\\n\\$initial_password_policy_constraint\\$;'),
    ddl(setup,`create table if not exists public\\.${setup} \\([\\s\\S]*?\\n\\);`),
    ddl('merchant_employee_initial_password_claim_auth_uidx','create unique index if not exists\\s+merchant_employee_initial_password_claim_auth_uidx[\\s\\S]*?;'),
    fn('lifecycle',accept,accept+'_preaudit_019'),
    fn('audit',accept,'faolla_accept_employee_invite_pre043'),
    fn('password',waive),fn('password',accept),
  ];
  const functions=definitions.filter(item=>item.kind==='function').map(item=>item.signature);
  for(const signature of functions)statements.push(`revoke all on function public.${signature} from public,anon,authenticated,service_role;`);
  for(const name of rpcNames)statements.push(`grant execute on function public.${name}(jsonb) to service_role;`);
  statements.push(`alter table public.${setup} enable row level security;`);
  statements.push(`revoke all on table public.${setup} from public,anon,authenticated,service_role;`);
  return {sources,definitions,statements,functions,rpcNames,setupTable:setup,sourceMigrations:sources.map(item=>item.file)};
}

export async function prepareAttendanceInvitationRetry(native,scope){
  assert.equal(typeof native.query,'function');assert.equal(typeof scope.sql,'function');
  const exec=source=>native.query(scope.sql(source)),owned=assertLifecycleSandbox(exec);
  assert.equal(scope.schema,owned.schema,'invitation_retry_scope_mismatch');
  const plan=invitationRetryFixturePlan(native.root);
  const snapshot=`reset role;select jsonb_build_object(
    'merchants',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchants t),
    'employees',(select md5(coalesce(jsonb_agg(to_jsonb(t)-'initial_password_policy' order by id)::text,'[]')) from public.merchant_enterprise_employees t),
    'roles',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_enterprise_roles t),
    'audits',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_enterprise_audit_events t),
    'events',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_attendance_events t));`;
  const before=JSON.parse(exec(snapshot));assert.match(before.merchants,/^[a-f0-9]{32}$/,'invitation_retry_merchant_fingerprint_required');
  const ownedGuard=`do $owned$ begin
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
        and n.nspname=${quote(owned.schema)} and n.nspowner::regrole::text='postgres'
        and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)})
      then raise exception 'invitation_retry_owned_schema_required';end if;
    if (select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchants t)<>${quote(before.merchants)}
      then raise exception 'invitation_retry_merchants_changed';end if;
  end;$owned$;`;
  const precondition=`do $prerequisites$ begin
    if to_regclass('public.merchant_enterprise_audit_events') is null
      or to_regprocedure('public.faolla_capture_merchant_enterprise_audit_v1()') is null
      or to_regprocedure('public.faolla_set_merchant_enterprise_audit_context_v1(jsonb,text,text)') is null
      or (select count(*) from pg_trigger where tgrelid='public.merchant_enterprise_employees'::regclass
          and tgname in ('merchant_enterprise_employees_touch','merchant_enterprise_employees_audit') and tgenabled='O' and not tgisinternal)<>2
      then raise exception 'invitation_retry_management_prerequisite_required';end if;
    if to_regclass('public.${setup}') is not null
      or exists(select 1 from pg_attribute where attrelid='public.merchant_enterprise_employees'::regclass
        and attname='initial_password_policy' and attnum>0 and not attisdropped)
      or exists(select 1 from unnest(array[${plan.functions.map(quote).join(',')}]) f(signature)
        where to_regprocedure('public.'||f.signature) is not null)
      then raise exception 'invitation_retry_fixture_already_present';end if;
  end;$prerequisites$;`;
  const scoped=source=>{
    const result=scope.sql(source.replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`));
    assert(!/\bpublic\./.test(result),'invitation_retry_qualifier_required');
    assert(!/set search_path\s*=\s*public\b/.test(result),'invitation_retry_private_search_path_required');return result;
  };
  const steps=[scoped(`begin;reset role;${ownedGuard}${precondition}`),...plan.statements.map(scoped),scoped(ownedGuard),'commit;'];
  if(typeof native.querySteps==='function')await native.querySteps(steps);else native.query(steps.join('\n'));
  assert.deepEqual(JSON.parse(exec(snapshot)),before,'invitation_retry_install_changed_original_facts');
  const catalog=JSON.parse(exec(`reset role;select jsonb_build_object(
    'functions',(select count(*) from pg_proc p where p.pronamespace=${owned.oid}
      and p.oid=any(array[${plan.functions.map(signature=>quote('public.'+signature)+'::regprocedure').join(',')}])
      and p.prosecdef and p.proowner='postgres'::regrole and p.proconfig=array[${quote('search_path='+owned.schema)}]),
    'servicePublic',(select count(*) from unnest(array[${rpcNames.map(name=>quote(name+'(jsonb)')).join(',')}]) f(signature)
      where has_function_privilege('service_role','public.'||f.signature,'EXECUTE')),
    'servicePrivate',(select count(*) from unnest(array[${plan.functions.filter(signature=>!rpcNames.some(name=>signature===name+'(jsonb)')).map(quote).join(',')}]) f(signature)
      where has_function_privilege('service_role','public.'||f.signature,'EXECUTE')),
    'browserCallable',(select count(*) from unnest(array[${plan.functions.map(quote).join(',')}]) f(signature)
      where has_function_privilege('anon','public.'||f.signature,'EXECUTE') or has_function_privilege('authenticated','public.'||f.signature,'EXECUTE')),
    'setupRls',(select relrowsecurity from pg_class where oid='public.${setup}'::regclass),
    'setupPrivileges',(select count(*) from unnest(array['anon','authenticated','service_role']) r(name)
      where has_table_privilege(r.name,'public.${setup}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
    'setupRows',(select count(*) from public.${setup}),
    'nonWaivedExisting',(select count(*) from public.merchant_enterprise_employees where initial_password_policy is distinct from 'waived'));`));
  assert.deepEqual(catalog,{functions:4,servicePublic:2,servicePrivate:0,browserCallable:0,setupRls:true,setupPrivileges:0,setupRows:0,nonWaivedExisting:0},'invitation_retry_catalog_mismatch');
  return {rpcNames,functions:plan.functions,setupTable:setup,sourceMigrations:plan.sourceMigrations,syntheticOnly:true,seededEmployees:0};
}
