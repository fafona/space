// Test infrastructure only. Original033 lookup plus its original042 digest
// qualification is retained. Its Auth fallback uses a private synthetic table;
// a private SHA256-only wrapper delegates exact bytes to PG15's real SHA256.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {assertLifecycleSandbox,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const rpcName='faolla_lookup_merchant_enterprise_staff_identity_v1';
const registry='merchant_enterprise_staff_identities',authTable='merchant_enterprise_fixture_auth_users';
const sourceFile='202608190033_merchant_enterprise_invitation_delivery_outbox.sql';
const repairFile='202608300042_merchant_enterprise_pgcrypto_schema_repair.sql';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const same=(actual,expected,message)=>assert(isDeepStrictEqual(actual,expected),message);
const safeActors=prepared=>{
  assert(Array.isArray(prepared.actors)&&prepared.actors.length===3,'initial_password_lookup_actors_required');
  const actors=prepared.actors.map(actor=>{
    assert(actor&&[id(1),id(2),id(3)].includes(actor.id)&&typeof actor.email==='string'&&/^[^@]+@example\.test$/.test(actor.email));
    assert.equal(actor.email,actor.email.trim().toLowerCase());return {id:actor.id,email:actor.email,emailHash:hash(actor.email)};
  });
  assert.equal(new Set(actors.map(actor=>actor.id)).size,3);assert.equal(new Set(actors.map(actor=>actor.emailHash)).size,3);
  return actors;
};

export function initialPasswordLookupFixturePlan(root,scope){
  assert.equal(typeof root,'string');assert(path.isAbsolute(root));
  assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);assert.equal(typeof scope.sql,'function');
  const originalSource=readFileSync(path.join(root,'scripts/supabase-migrations',sourceFile),'utf8');
  const repairSource=readFileSync(path.join(root,'scripts/supabase-migrations',repairFile),'utf8');
  const extract=pattern=>{
    const matches=[...originalSource.matchAll(new RegExp(pattern,'g'))];assert.equal(matches.length,1,'initial_password_lookup_exact_source_required');return matches[0][0];
  };
  const original=extract(`create or replace function\\s+public\\.${rpcName}\\([\\s\\S]*?\\n\\$\\$;`);
  const revoke=extract(`revoke all on function\\s+public\\.${rpcName}\\(text\\)\\s+from public, anon, authenticated, service_role;`);
  const grant=extract(`grant execute on function\\s+public\\.${rpcName}\\(text\\)\\s+to service_role;`);
  assert.match(repairSource,new RegExp(`'public\\.${rpcName}\\(text\\)'`));
  assert.match(repairSource,/v_repaired_definition\s*:=\s*pg_catalog\.replace\(\s*v_before_definition,\s*'digest\(',\s*'extensions\.digest\('\s*\)/);
  assert.equal((original.match(/\bdigest\(/g)||[]).length,1);assert.equal((original.match(/\bauth\.users\b/g)||[]).length,1);
  const latest=original.replace('digest(','extensions.digest(');
  const adapted=latest.replace('auth.users','public.'+authTable).replace('extensions.digest(','public.digest(')
    .replace(/(set search_path\s*=\s*)public\b/g,`$1${scope.schema}`);
  const wrapper=`create function public.digest(p_data bytea,p_algorithm text)
    returns bytea language plpgsql immutable strict security invoker set search_path=pg_catalog as $digest$
    begin
      if p_algorithm is distinct from 'sha256' then raise exception 'initial_password_lookup_algorithm_forbidden';end if;
      return pg_catalog.sha256(p_data);
    end;$digest$;
    revoke all on function public.digest(bytea,text) from public,anon,authenticated,service_role;`;
  const statements=[`create table public.${authTable}(id uuid primary key,email text not null,raw_app_meta_data jsonb not null);
    alter table public.${authTable} enable row level security;
    revoke all on table public.${authTable} from public,anon,authenticated,service_role;`,wrapper,adapted,revoke,grant].map(scope.sql);
  assert(statements.every(statement=>!(/\bauth\.users\b|\bpublic\.|\bextensions\.digest\(/.test(statement))),'initial_password_lookup_private_qualification_required');
  return {sourceMigrations:[sourceFile,repairFile],originalSource,repairSource,original,latest,revoke,grant,wrapper,statements,
    rpcName,authTable,digestAdaptation:'owned SHA256-only security-invoker wrapper -> pg_catalog.sha256(bytea)'};
}

export function createInitialPasswordLookupTransport(prepared){
  same(assertLifecycleSandbox(prepared.exec),prepared.owned,'initial_password_lookup_namespace_changed');
  const actors=safeActors(prepared),hashes=new Set(actors.map(actor=>actor.emailHash));
  const lookupCalls=[],lookupErrors=[];
  const checked=source=>{
    same(assertLifecycleSandbox(prepared.exec),prepared.owned,'initial_password_lookup_namespace_changed');return prepared.exec(source);
  };
  const lookupRpc=async(name,args)=>{
    try{
      assert.equal(name,rpcName);assert(args&&typeof args==='object'&&!Array.isArray(args));
      assert.deepEqual(Object.keys(args),['p_email_hash']);assert(typeof args.p_email_hash==='string'&&hashes.has(args.p_email_hash));
    }catch{lookupErrors.push('initial_password_lookup_rpc_forbidden');throw Error('initial_password_lookup_rpc_forbidden');}
    const call={name,error:null,source:null};lookupCalls.push(call);
    try{
      const result=JSON.parse(checked(`begin read only;reset role;set local role service_role;
        select jsonb_build_object('role',current_user,'data',public.${rpcName}(${quote(args.p_email_hash)}));commit;`));
      assert.equal(result.role,'service_role');
      if(['registry','auth_recovery','none'].includes(result.data?.source))call.source=result.data.source;
      return {data:result.data,error:null};
    }catch(error){
      const code=String(error).match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
      if(['invalid_merchant_enterprise_staff_identity_hash','merchant_enterprise_staff_identity_conflict'].includes(code)){
        call.error=code;return {data:null,error:{message:code}};
      }
      lookupErrors.push('initial_password_lookup_rpc_failed');throw Error('initial_password_lookup_rpc_failed');
    }
  };
  const registryRows=()=>JSON.parse(checked(`reset role;select coalesce(jsonb_agg(to_jsonb(t) order by auth_user_id),'[]'::jsonb) from public.${registry} t;`));
  const extraFingerprint=()=>checked(`reset role;select md5(jsonb_build_object(
    'users',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.${authTable} t),
    'acl',(select jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity) order by c.oid) from pg_class c
      where c.oid in('public.${registry}'::regclass,'public.${authTable}'::regclass)),
    'functions',(select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.proconfig,pg_get_functiondef(p.oid)) order by p.oid) from pg_proc p
      where p.oid in('public.${rpcName}(text)'::regprocedure,'public.digest(bytea,text)'::regprocedure)))::text);`);
  let missingInProgress=false;
  const withMissingRegistry=async(actor,callback)=>{
    assert(!missingInProgress,'initial_password_lookup_case_already_running');assert.equal(typeof callback,'function');
    const target=actors.find(item=>item.id===actor?.id&&item.email===actor?.email);assert(target,'initial_password_lookup_case_actor_forbidden');
    missingInProgress=true;
    let removed=false,original,beforeRows,beforeFacts,beforeProtected,beforeExtra;
    try{
      beforeRows=registryRows();original=beforeRows.find(row=>row.auth_user_id===target.id);
      assert(original&&original.email_hash===target.emailHash&&original.principal_type==='merchant_staff','initial_password_lookup_original_registry_required');
      beforeFacts=prepared.facts();beforeProtected=prepared.protectedFingerprint();beforeExtra=extraFingerprint();
      const count=checked(`with removed as(delete from public.${registry}
        where auth_user_id=${quote(target.id)} and email_hash=${quote(target.emailHash)}
          and to_jsonb(${registry})=${quote(JSON.stringify(original))}::jsonb returning 1) select count(*) from removed;`);
      assert.equal(count,'1','initial_password_lookup_exact_removal_required');removed=true;
      same(registryRows(),beforeRows.filter(row=>row.auth_user_id!==target.id),'initial_password_lookup_removal_scope_changed');
      return await callback();
    }finally{
      try{
        if(removed){
          // Never overwrite a row created during callback, and never reconstruct
          // timestamps/defaults. Restore the complete original row exactly.
          checked(`do $restore$ begin
            if exists(select 1 from public.${registry} where auth_user_id=${quote(target.id)} or email_hash=${quote(target.emailHash)})
              then raise exception 'initial_password_lookup_restore_conflict';end if;
            insert into public.${registry} select * from jsonb_populate_record(null::public.${registry},${quote(JSON.stringify(original))}::jsonb);
          end;$restore$;`);
          same(registryRows(),beforeRows,'initial_password_lookup_registry_not_restored');
          same(prepared.facts(),beforeFacts,'initial_password_lookup_case_changed_facts');
          assert.equal(prepared.protectedFingerprint(),beforeProtected,'initial_password_lookup_case_changed_protected_facts');
          assert.equal(extraFingerprint(),beforeExtra,'initial_password_lookup_case_changed_auth_or_acl');
        }
      }finally{missingInProgress=false;}
    }
  };
  return {lookupRpc,lookupCalls,lookupErrors,withMissingRegistry,lookupProtectedFingerprint:extraFingerprint};
}

export function installInitialPasswordLookupFixture(native,scope,prepared){
  same(assertLifecycleSandbox(prepared.exec),prepared.owned,'initial_password_lookup_namespace_changed');
  assert.equal(scope.schema,prepared.owned.schema);const actors=safeActors(prepared);
  const plan=initialPasswordLookupFixturePlan(native.root,scope),before=prepared.facts(),beforeProtected=prepared.protectedFingerprint();
  const prerequisite=`do $prerequisite$ begin
    if to_regclass('public.${registry}') is null or to_regclass('public.${authTable}') is not null
      or to_regprocedure('public.${rpcName}(text)') is not null or to_regprocedure('public.digest(bytea,text)') is not null
      then raise exception 'initial_password_lookup_fresh_objects_required';end if;
    if not exists(select 1 from pg_proc where oid=to_regprocedure('pg_catalog.sha256(bytea)')
      and pronamespace='pg_catalog'::regnamespace and provolatile='i' and proisstrict and not prosecdef and prorettype='bytea'::regtype)
      then raise exception 'initial_password_lookup_real_sha256_required';end if;
    if exists(select 1 from unnest(array['anon','authenticated','service_role']) r(name)
      where has_table_privilege(r.name,'public.${registry}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
      then raise exception 'initial_password_lookup_private_registry_required';end if;
    end;$prerequisite$;`;
  const seed=`insert into public.${authTable}(id,email,raw_app_meta_data) values ${actors.map(actor=>
    `(${quote(actor.id)},${quote(actor.email)},${quote(JSON.stringify({principal_type:'merchant_staff',merchant_staff_email_hash:actor.emailHash}))}::jsonb)`).join(',')};`;
  prepared.exec(`${scope.sql(prerequisite)}\n${plan.statements.join('\n')}\n${scope.sql(seed)}`);
  same(prepared.facts(),before,'initial_password_lookup_install_changed_facts');
  assert.equal(prepared.protectedFingerprint(),beforeProtected,'initial_password_lookup_install_changed_protected_facts');
  const catalog=JSON.parse(prepared.exec(`reset role;select jsonb_build_object(
    'lookup',(select jsonb_build_object('stable',provolatile='s','definer',prosecdef,'owner',proowner::regrole::text,
      'path',proconfig) from pg_proc where oid='public.${rpcName}(text)'::regprocedure),
    'service',has_function_privilege('service_role','public.${rpcName}(text)','EXECUTE'),
    'browser',(select count(*) from unnest(array['anon','authenticated']) r(name) where has_function_privilege(r.name,'public.${rpcName}(text)','EXECUTE')),
    'digest',(select jsonb_build_object('immutable',provolatile='i','strict',proisstrict,'invoker',not prosecdef,'owner',proowner::regrole::text)
      from pg_proc where oid='public.digest(bytea,text)'::regprocedure),
    'digestCallable',(select count(*) from unnest(array['anon','authenticated','service_role']) r(name) where has_function_privilege(r.name,'public.digest(bytea,text)','EXECUTE')),
    'tablesPrivate',(select count(*) from unnest(array['anon','authenticated','service_role']) r(name)
      cross join unnest(array['public.${registry}','public.${authTable}']) t(name)
      where has_table_privilege(r.name,t.name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
    'authRls',(select relrowsecurity from pg_class where oid='public.${authTable}'::regclass),
    'authRows',(select count(*) from public.${authTable}));`));
  same(catalog,{lookup:{stable:true,definer:true,owner:'postgres',path:['search_path='+scope.schema]},service:true,browser:0,
    digest:{immutable:true,strict:true,invoker:true,owner:'postgres'},digestCallable:0,tablesPrivate:0,authRls:true,authRows:3},'initial_password_lookup_catalog_mismatch');
  return {...createInitialPasswordLookupTransport(prepared),installation:{sourceMigrations:plan.sourceMigrations,rpcName,authTable,
    digestAdaptation:plan.digestAdaptation,syntheticAuthRows:3,registryChanged:false,identityDirectGrants:false,catalog}};
}
