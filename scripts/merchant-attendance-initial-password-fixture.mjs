// Local initial-password diagnostic infrastructure, not an Auth service or a
// simulated successful setup. Original SQL alone changes setup/employee facts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {prepareInvitationBrowser} from './merchant-attendance-invitation-browser-fixture.mjs';
import {assertLifecycleSandbox,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const files={identity:'202608190033_merchant_enterprise_invitation_delivery_outbox.sql',
  password:'202608310043_merchant_employee_initial_password_setup.sql'};
const identityTable='merchant_enterprise_staff_identities';
const rpcNames=Object.freeze(['claim','complete','release'].map(action=>`faolla_${action}_merchant_employee_initial_password_setup_v1`));
const actors=new Set([id(1),id(2),id(3)]),roles=new Set([id(30),id(31),id(32)]),site='99990001';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const hex=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const v4=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const exact=(value,keys)=>{
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
};
const knownErrors=new Set(['invalid_employee_initial_password_setup_payload','invalid_employee_initial_password_setup',
  'merchant_employee_not_invited','employee_invitation_not_pending','employee_invitation_revoked','employee_invitation_expired',
  'employee_invitation_superseded','employee_initial_password_not_required','merchant_access_denied',
  'employee_initial_password_setup_in_progress','employee_password_already_initialized',
  'employee_initial_password_setup_claim_invalid','employee_initial_password_setup_conflict']);
const invitationColumns='id,merchant_id,auth_user_id,email,role_id,status,accepted_at,invitation_version,invitation_token_hash,invitation_expires_at,invitation_revoked_at';

export function initialPasswordFixturePlan(root){
  assert.equal(typeof root,'string');assert(path.isAbsolute(root),'initial_password_fixture_absolute_root_required');
  const sources=Object.entries(files).map(([key,file])=>({key,file,source:readFileSync(path.join(root,'scripts/supabase-migrations',file),'utf8')}));
  const definitions=[];
  const select=(key,name,pattern)=>{
    const source=sources.find(item=>item.key===key),matches=[...source.source.matchAll(new RegExp(pattern,'g'))];
    assert.equal(matches.length,1,'initial_password_fixture_exact_source_required');
    const original=matches[0][0];definitions.push({name,file:source.file,original,statement:original});return original;
  };
  const statements=[select('identity',identityTable,`create table if not exists public\\.${identityTable} \\([\\s\\S]*?\\n\\);`)];
  for(const name of rpcNames)statements.push(select('password',name,`create or replace function\\s+public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
  for(const name of rpcNames){
    statements.push(`revoke all on function public.${name}(jsonb) from public,anon,authenticated,service_role;`);
    statements.push(`grant execute on function public.${name}(jsonb) to service_role;`);
  }
  statements.push(`alter table public.${identityTable} enable row level security;`);
  statements.push(`revoke all on table public.${identityTable} from public,anon,authenticated,service_role;`);
  return {sources,definitions,statements,rpcNames,identityTable,sourceMigrations:sources.map(item=>item.file)};
}

export function validateInitialPasswordRpcInput(name,args){
  assert(rpcNames.includes(name));exact(args,['p_input']);const input=args.p_input;
  exact(input,['merchant_id','auth_user_id','invitation_version','token_hash','operation_id','password_fingerprint']);
  assert.equal(input.merchant_id,site);assert(actors.has(input.auth_user_id));assert.equal(input.invitation_version,7);
  assert(hex(input.token_hash)&&hex(input.password_fingerprint)&&v4(input.operation_id));return input;
}

export function createInitialPasswordFixtureTransport(prepared){
  assert.equal(typeof prepared.exec,'function');
  const owned=assertLifecycleSandbox(prepared.exec);assert.deepEqual(owned,prepared.owned,'initial_password_fixture_namespace_changed');
  const initialPasswordRpcCalls=[],initialPasswordReadCalls=[],initialPasswordErrors=[];
  const checked=source=>{
    assert.deepEqual(assertLifecycleSandbox(prepared.exec),owned,'initial_password_fixture_namespace_changed');
    return prepared.exec(source);
  };
  const initialPasswordRpc=async(name,args)=>{
    let input;
    try{input=validateInitialPasswordRpcInput(name,args);}catch{throw Error('initial_password_fixture_rpc_forbidden');}
    const call={name,error:null};initialPasswordRpcCalls.push(call);
    try{
      const result=JSON.parse(checked(`begin;reset role;set local role service_role;
        select jsonb_build_object('role',current_user,'data',public.${name}(${quote(JSON.stringify(input))}::jsonb));commit;`));
      assert.equal(result.role,'service_role');return {data:result.data,error:null};
    }catch(error){
      const code=String(error).match(/ERROR:\s+([a-z_]+)/)?.[1];
      if(code&&knownErrors.has(code)){call.error=code;return {data:null,error:{message:code}};}
      initialPasswordErrors.push('initial_password_fixture_rpc_failed');throw Error('initial_password_fixture_rpc_failed');
    }
  };
  const read=(kind,input)=>{
    let query;
    try{
      if(kind==='invitation'){
        exact(input,['siteId','authUserId','invitationVersion','tokenHash','nowIso']);
        assert.equal(input.siteId,site);assert(actors.has(input.authUserId));assert.equal(input.invitationVersion,7);assert(hex(input.tokenHash));
        assert.equal(typeof input.nowIso,'string');assert.equal(new Date(input.nowIso).toISOString(),input.nowIso);
        query=`select ${invitationColumns} from public.merchant_enterprise_employees where merchant_id='${site}'
          and auth_user_id=${quote(input.authUserId)} and invitation_version=7 and invitation_token_hash=${quote(input.tokenHash)}
          and status='invited' and accepted_at is null and invitation_revoked_at is null
          and invitation_expires_at>${quote(input.nowIso)}::timestamptz limit 1`;
      }else if(kind==='role'){
        exact(input,['siteId','roleId']);assert.equal(input.siteId,site);assert(roles.has(input.roleId));
        query=`select id,merchant_id,status from public.merchant_enterprise_roles
          where merchant_id='${site}' and id=${quote(input.roleId)} and status='active' limit 1`;
      }else if(kind==='identity'){
        exact(input,['authUserId','emailHash']);assert(actors.has(input.authUserId));assert(hex(input.emailHash));
        query=`select auth_user_id,email_hash,principal_type from public.${identityTable}
          where auth_user_id=${quote(input.authUserId)} and email_hash=${quote(input.emailHash)} and principal_type='merchant_staff' limit 1`;
      }else throw Error('unknown read');
    }catch{throw Error('initial_password_fixture_read_forbidden');}
    initialPasswordReadCalls.push({kind});
    try{
      // Factory-injected SQL reads intentionally use the owned diagnostic role.
      // They do not claim to exercise service REST/RLS; no table grant is added.
      const result=JSON.parse(checked(`begin read only;reset role;
        select jsonb_build_object('role',current_user,'data',(select to_jsonb(t) from (${query}) t));commit;`));
      assert.equal(result.role,'postgres');return {data:result.data,error:null};
    }catch{
      initialPasswordErrors.push('initial_password_fixture_read_failed');throw Error('initial_password_fixture_read_failed');
    }
  };
  return {initialPasswordRpc,initialPasswordRpcCalls,initialPasswordReadCalls,initialPasswordErrors,
    loadInvitation:input=>read('invitation',input),loadRole:input=>read('role',input),loadStaffIdentity:input=>read('identity',input)};
}

export async function prepareAttendanceInitialPasswordFixture(native,scope){
  const prepared=await prepareInvitationBrowser(native,scope),owned=prepared.owned;
  const plan=initialPasswordFixturePlan(native.root),before=prepared.facts(),protectedBefore=prepared.protectedFingerprint();
  const scoped=source=>{
    const result=scope.sql(source.replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`));
    assert(!/\bpublic\./.test(result)&&!/set search_path\s*=\s*public\b/.test(result),'initial_password_fixture_qualification_required');return result;
  };
  const absent=`do $absent$ begin
    if to_regclass('public.${identityTable}') is not null
      or exists(select 1 from unnest(array[${rpcNames.map(name=>quote(name+'(jsonb)')).join(',')}]) f(signature)
        where to_regprocedure('public.'||f.signature) is not null)
      then raise exception 'initial_password_fixture_already_present';end if;
    if to_regclass('public.merchant_employee_initial_password_setups') is null
      then raise exception 'initial_password_fixture_setup_prerequisite_required';end if;
    end;$absent$;`;
  // One ownership-guarded transaction installs only the exact source subset.
  prepared.exec(scoped(`${absent}\n${plan.statements.join('\n')}`));
  assert.deepEqual(prepared.facts(),before,'initial_password_fixture_install_changed_facts');
  assert.equal(prepared.protectedFingerprint(),protectedBefore,'initial_password_fixture_install_changed_protected_facts');
  prepared.exec(`insert into public.${identityTable}(auth_user_id,email_hash,principal_type) values
    ${prepared.actors.map(actor=>`(${quote(actor.id)},${quote(createHash('sha256').update(actor.email.trim().toLowerCase(),'utf8').digest('hex'))},'merchant_staff')`).join(',')};`);
  assert.deepEqual(prepared.facts(),before,'initial_password_fixture_seed_changed_facts');
  assert.equal(prepared.protectedFingerprint(),protectedBefore,'initial_password_fixture_seed_changed_protected_facts');
  const catalog=JSON.parse(prepared.exec(`select jsonb_build_object(
    'functions',(select count(*) from pg_proc p where p.pronamespace=${owned.oid}
      and p.oid=any(array[${rpcNames.map(name=>quote('public.'+name+'(jsonb)')+'::regprocedure').join(',')}])
      and p.prosecdef and p.proowner='postgres'::regrole and p.proconfig=array[${quote('search_path='+owned.schema)}]),
    'serviceCallable',(select count(*) from unnest(array[${rpcNames.map(name=>quote('public.'+name+'(jsonb)')).join(',')}]) f(signature)
      where has_function_privilege('service_role',f.signature,'EXECUTE')),
    'browserCallable',(select count(*) from unnest(array[${rpcNames.map(name=>quote('public.'+name+'(jsonb)')).join(',')}]) f(signature)
      where has_function_privilege('anon',f.signature,'EXECUTE') or has_function_privilege('authenticated',f.signature,'EXECUTE')),
    'identityRls',(select relrowsecurity from pg_class where oid='public.${identityTable}'::regclass),
    'identityDirectPrivileges',(select count(*) from unnest(array['anon','authenticated','service_role']) r(name)
      where has_table_privilege(r.name,'public.${identityTable}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
    'identities',(select count(*) from public.${identityTable}));`));
  assert.deepEqual(catalog,{functions:3,serviceCallable:3,browserCallable:0,identityRls:true,identityDirectPrivileges:0,identities:3},'initial_password_fixture_catalog_mismatch');
  const transport=createInitialPasswordFixtureTransport(prepared),originalFingerprint=prepared.protectedFingerprint;
  return Object.assign(prepared,transport,{
    initialPasswordRpcNames:rpcNames,
    // Include the new immutable synthetic identity prestate in every protection
    // comparison; facts() still contains original employee/setup/audit rows.
    protectedFingerprint:()=>originalFingerprint()+':'+prepared.exec(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by auth_user_id)::text,'[]')) from public.${identityTable} t;`),
    installation:{sourceMigrations:plan.sourceMigrations,rpcNames,identityTable,catalog,
      injectedReadRole:'postgres',defaultRestDependencies:false,seededIdentities:3,seededSetups:0,seededActiveEmployees:0},
  });
}

/** Apply the full candidate only inside the already-owned synthetic namespace. */
export function applyInitialPasswordReplayFixture(native,scope,prepared){
  assert.deepEqual(assertLifecycleSandbox(prepared.exec),prepared.owned,'initial_password_replay_namespace_changed');
  assert.equal(scope.schema,prepared.owned.schema);
  const name='202610030114_merchant_employee_initial_password_replay.sql';
  const source=readFileSync(path.join(native.root,'scripts/supabase-migrations',name),'utf8');
  const before=prepared.facts();
  const claim='faolla_claim_merchant_employee_initial_password_setup_v1';
  const catalog=()=>JSON.parse(prepared.exec(`select jsonb_build_object(
    'owner',(select proowner::regrole::text from pg_proc where oid='public.${claim}(jsonb)'::regprocedure),
    'service',has_function_privilege('service_role','public.${claim}(jsonb)','EXECUTE'),
    'anon',has_function_privilege('anon','public.${claim}(jsonb)','EXECUTE'),
    'authenticated',has_function_privilege('authenticated','public.${claim}(jsonb)','EXECUTE'),
    'security',(select prosecdef from pg_proc where oid='public.${claim}(jsonb)'::regprocedure));`));
  const previousCatalog=catalog();
  // Explicit prerequisite ledger for this source-subset fixture, NOT evidence
  // that the entire043 migration (password recovery/outbox/etc.) was installed.
  prepared.exec(`do $prior$ begin if exists(select 1 from public.faolla_schema_migrations where version in(202608310043,202610030114))
    then raise exception 'initial_password_replay_fresh_registry_required';end if;end;$prior$;
    insert into public.faolla_schema_migrations(version,name) values(202608310043,'merchant_employee_initial_password_setup');`);
  const scoped=scope.sql(source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')
    .replace(/(set search_path\s*=\s*)public\b/g,`$1${scope.schema}`));
  assert(!/\bpublic\./.test(scoped)&&!/set search_path\s*=\s*public\b/.test(scoped));
  prepared.exec(scoped);
  assert.deepEqual(prepared.facts(),before,'initial_password_replay_migration_changed_facts');
  assert.deepEqual(catalog(),previousCatalog,'initial_password_replay_migration_changed_acl_or_owner');
  assert.equal(prepared.exec("select count(*) from public.faolla_schema_migrations where version=202610030114 and name='merchant_employee_initial_password_replay';"),'1');
  // Reapplication must not replace the function owner, mutate facts or add a
  // second ledger row; production installation remains separately authorized.
  prepared.exec(scoped);
  assert.deepEqual(prepared.facts(),before);assert.deepEqual(catalog(),previousCatalog);
  return {migration:name,reapplied:true,ownerPreserved:true,defaultSetupDependencies:false};
}
