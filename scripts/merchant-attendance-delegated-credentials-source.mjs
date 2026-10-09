//207 inert exact SOURCE recipe. --write touches only the new candidate SQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {managementDelegationInstallRecipe,managementDelegationForwardRecipes,managementDelegationMigration} from './merchant-attendance-management-delegation-source.mjs';
import {delegatedRulesForwardRecipes,delegatedRulesInstallRecipe,delegatedRulesMigration} from './merchant-attendance-delegated-rules-source.mjs';
export const delegatedCredentialsMigration='202610080207_merchant_attendance_delegated_credentials.sql';
export const delegatedCredentialsActions=Object.freeze(['terminal_prepare','terminal_revoke','pin_issue','pin_revoke']);
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n'),'utf8').digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const meta=f=>{const {body,oldBody,newBody,oldHash,newHash,core,coreName,anchor,family,...m}=f;void body;void oldBody;void newBody;void oldHash;void newHash;void core;void coreName;void anchor;void family;return m;};
const sourceSpecs=Object.freeze([
 {file:'202610010104_merchant_attendance_terminals.sql',name:'faolla_attendance_terminal_admin_v1',coreName:'faolla_attendance_delegated_credentials_terminal_core_v1',
  hash:'55c20b87de72d6bb5d5ac6465cffa72c7dd1e725cfb34ca871ff8ad5c4703d17',
  start:'  select * into m from public.merchants where id=p_site for share;',end:'  -- Consistent lock order:',
  boundary:"  perform public.faolla_attendance_delegated_credentials_core_authorize_v1(p_site,p_auth,p_grant_id,'terminal',target::text,p_command);",
  args:'p_site text,p_auth uuid,p_query jsonb,p_command jsonb,p_allow_create boolean,p_grant_id uuid',call:'p_site,p_auth,p_query,p_command,p_allow_create,null'},
 {file:'202610010106_merchant_attendance_pin_credentials.sql',name:'faolla_attendance_pin_admin_v1',coreName:'faolla_attendance_delegated_credentials_member_core_v1',
  hash:'5576a8f69dbf2af7b3e6171aca170f1109791ea6aa267961e0e3618adaa59bf2',
  start:'  select * into m from public.merchants where id=p_site for share;',end:'  -- Serialize credential edits',
  boundary:"  perform public.faolla_attendance_delegated_credentials_core_authorize_v1(p_site,p_auth,p_grant_id,'member_pin',p_no,p_command);",
  args:'p_site text,p_auth uuid,p_no text,p_operation uuid,p_command jsonb,p_allow_set boolean,p_grant_id uuid',call:'p_site,p_auth,p_no,p_operation,p_command,p_allow_set,null'},
 {file:'202610080196_merchant_attendance_independent_workers.sql',name:'faolla_attendance_independent_admin_v1',coreName:'faolla_attendance_delegated_credentials_independent_core_v1',
  hash:'95f6be0160c2b667dae62536b9c94c0abc4d76edc573c0eb7f747e0042e529bb',
  start:' select * into m from public.merchants where id=p_site for share;',end:' if p_command is null then select * into config',
  boundary:" if mode_name<>'detail' then raise exception 'attendance_invalid_request';end if;\n perform public.faolla_attendance_delegated_credentials_core_authorize_v1(p_site,p_auth,p_grant_id,'independent_pin',target_subject::text,p_command);",
  args:'p_site text,p_auth uuid,p_query jsonb,p_command jsonb,p_material jsonb,p_allow_new boolean,p_grant_id uuid',call:'p_site=>p_site,p_auth=>p_auth,p_query=>p_query,p_command=>p_command,p_material=>p_material,p_allow_new=>p_allow_new,p_grant_id=>null'},
]);
export function delegatedCredentialsForwardRecipes(migrations){
 const get=name=>{const f=migrations.find(m=>m.name===name);assert(f,name);return f.text;};
 const cores=sourceSpecs.map(s=>{const f=dayReviewSqlFunctions(get(s.file)).find(f=>f.name===s.name);assert(f);assert.equal(f.hash,s.hash);
  assert.equal(f.body.split(s.start).length-1,1);assert.equal(f.body.split(s.end).length-1,1);
  const start=f.body.indexOf(s.start),end=f.body.indexOf(s.end);assert(end>start);const anchor=f.body.slice(start,end);
  const core=f.body.replace(anchor,' if p_grant_id is null then\n'+anchor+' else\n'+s.boundary+'\n end if;\n');
  assert.equal(core.replace(' if p_grant_id is null then\n'+anchor+' else\n'+s.boundary+'\n end if;\n',anchor),f.body);
  const newBody=`\nbegin\n return public.${s.coreName}(${s.call});\nend;\n`;
  return {...meta(f),isRpc:true,coreName:s.coreName,coreArgs:s.args,anchor,core,oldBody:f.body,newBody,oldHash:f.hash,newHash:sha(newBody)};
 });
 const snapshot=dayReviewSqlFunctions(get(sourceSpecs[0].file)).find(f=>f.name==='faolla_attendance_terminal_snapshot_v1');assert(snapshot);assert.equal(snapshot.hash,'eeffc89f77cba9000046a15c7c95bfade2664c8543b419c77f6d45b53c2d70ac');
 const issuer="coalesce(t.created_by=any(array[\n        m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false)";
 assert.equal(snapshot.body.split(issuer).length-1,1);const snapshotBody=snapshot.body.replace(issuer,'('+issuer+' or public.faolla_attendance_delegated_credentials_issuer_v1(t.merchant_id,t.id))');
 const previous=delegatedRulesForwardRecipes(migrations).guard;assert.equal(previous.newHash,'37216d21b66510291fb3833781951ffeef20218594879bfcb4729fea7496c4be');
 const anchor="  if new.delegated_action in('rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw') then perform public.faolla_attendance_delegated_rules_authority_v1(new);return new;end if;";
 assert.equal(previous.newBody.split(anchor).length-1,1);const guardBody=previous.newBody.replace(anchor,anchor+`\n  if new.delegated_action in(${delegatedCredentialsActions.map(quote).join(',')}) then perform public.faolla_attendance_delegated_credentials_authority_v1(new);return new;end if;`);
 return {cores,snapshot:{...meta(snapshot),isRpc:false,oldBody:snapshot.body,newBody:snapshotBody,oldHash:snapshot.hash,newHash:sha(snapshotBody)},
  guard:{...meta(previous),isRpc:false,oldBody:previous.newBody,newBody:guardBody,oldHash:previous.newHash,newHash:sha(guardBody)}};
}
export function delegatedCredentialsOwnManifest(sql){return dayReviewSqlFunctions(sql).filter(f=>f.name.startsWith('faolla_attendance_delegated_credentials_')||['faolla_attendance_delegated_terminals_v1','faolla_attendance_delegated_pin_v1'].includes(f.name))
 .map(f=>({...meta(f),isRpc:['faolla_attendance_delegated_terminals_v1','faolla_attendance_delegated_pin_v1'].includes(f.name)}));}
function tableTemplates(sql,migrations){
 const get=name=>migrations.find(m=>m.name===name).text;
 const texts=[get(sourceSpecs[0].file),get(sourceSpecs[1].file),get(sourceSpecs[2].file),get(managementDelegationMigration),sql];
 const statements=[],tables=[],indexes=[];
 for(const text of texts){
  for(const m of text.matchAll(/^create table (?:if not exists )?public\.(merchant_attendance_(?:terminals|terminal_audit|pin_credentials|pin_audit|pin_attempts|independent_\w+|management_delegations|management_delegation_revocations|management_delegation_operations|delegated_credential_proofs))\s*\([\s\S]*?^\);/gm)){
   tables.push(m[1]);statements.push(m[0].replace(/^create table (?:if not exists )?public\./,'create temp table ').replaceAll('references public.','references pg_temp.').replace(/\);$/,' ) on commit drop;'));
  }
  for(const m of text.matchAll(/^create (?:unique )?index (?:if not exists )?[^\n]+;/gm))if(tables.some(t=>new RegExp('on public\\.'+t+'\\(').test(m[0])))indexes.push(m[0].replace(' if not exists','').replace('on public.','on pg_temp.'));
 }
 //203 adds exactly these two read indexes to the already-owned202 ledgers.
 //Do not scan unrelated audit tables or accept arbitrary later DDL.
 const audit=get('202610080203_merchant_attendance_delegated_audit.sql');
 for(const [name,table] of [['management_audit_grant_time_idx','merchant_attendance_management_delegations'],['management_audit_revoke_time_idx','merchant_attendance_management_delegation_revocations']]){
  const matches=[...audit.matchAll(new RegExp('^create index if not exists '+name+' on public\\.'+table+'\\([^\\n]+\\);$','gm'))];
  assert.equal(matches.length,1,'credentials207_exact203_index_'+name);
  indexes.push(matches[0][0].replace(' if not exists','').replace('on public.','on pg_temp.'));
 }
 assert.equal(tables.length,15);assert.equal(new Set(tables).size,15);assert.equal(indexes.length,10);
 const parents=`create temp table merchant_attendance_settings(merchant_id text primary key) on commit drop;
create temp table merchant_attendance_locations(merchant_id text,id uuid,primary key(merchant_id,id)) on commit drop;
create temp table merchant_attendance_workers(merchant_id text,id uuid,primary key(merchant_id,id)) on commit drop;
create temp table merchant_enterprise_employees(merchant_id text,id uuid,primary key(merchant_id,id)) on commit drop;
create temp table merchant_attendance_events(id uuid primary key) on commit drop;`;
 return {tables,sql:parents+'\n'+[...statements,...indexes].join('\n')};
}
export function delegatedCredentialsInstallRecipe(sql,migrations){
 const forward=delegatedCredentialsForwardRecipes(migrations),allForward=[...forward.cores,forward.snapshot,forward.guard],own=delegatedCredentialsOwnManifest(sql);assert.equal(own.length,19);
 const get=name=>migrations.find(m=>m.name===name).text;
 const foundation=managementDelegationInstallRecipe(get(managementDelegationMigration),migrations.filter(m=>m.name<managementDelegationMigration));
 const previous=delegatedRulesInstallRecipe(get(delegatedRulesMigration),migrations.filter(m=>m.name<delegatedRulesMigration));
 const checks=foundation.preflight.match(/for spec in select value from jsonb_array_elements\(own_spec\) loop[\s\S]*?\n end loop;/)?.[0];assert(checks);
 const latest=new Map();const serviceNames=new Set();
 for(const file of migrations){for(const f of dayReviewSqlFunctions(file.text))latest.set(f.name,f);
  for(const m of file.text.matchAll(/grant execute on function public\.(faolla_[a-z0-9_]+)\([^;]*?\) to service_role;/g))serviceNames.add(m[1]);}
 const byPrefix=prefix=>{const file=migrations.find(f=>f.name.startsWith(prefix));assert(file,prefix);return file.text;};
 const captures=managementDelegationForwardRecipes({legacyCatalog:byPrefix('202610080185_'),currentCatalog:byPrefix('202610080190_'),capture:byPrefix('202610080189_')});
 latest.set(captures.capture.name,{...meta(captures.capture),body:captures.capture.newBody,hash:captures.capture.newHash});
 //202 has exactly two legal permission-catalog predecessors. Keep its selected
 //canonical body, not the old source-file body or an old/new wildcard.
 const catalogName=captures.catalog190.name;
 const selectedBodies=new Map([[catalogName,captures.catalog190.newBody]]);
 const roots=new Set(['faolla_attendance_terminal_device_v1','faolla_attendance_independent_guard_v1','faolla_attendance_management_insert_v1',captures.capture.name,'faolla_attendance_account_activation_guard_v1']);
 for(const f of [...dayReviewSqlFunctions(sql),...forward.cores.map(f=>({body:f.core}))])for(const m of f.body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g))roots.add(m[1]);
 latest.set(forward.guard.name,{...meta(forward.guard),body:forward.guard.oldBody,hash:forward.guard.oldHash});
 const excluded=new Set([...own.map(f=>f.name),...allForward.map(f=>f.name)]),seen=new Set(),dependencies=[];
 const visit=name=>{if(seen.has(name)||excluded.has(name))return;seen.add(name);const f=latest.get(name);assert(f||name===catalogName,'missing exact dependency '+name);
  const body=selectedBodies.get(name)??f.body;
  if(name!==catalogName)dependencies.push({...meta(f),isRpc:serviceNames.has(name)});
  for(const m of body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g))visit(m[1]);};
 for(const name of roots)visit(name);
 const templates=tableTemplates(sql,migrations);
 //The full proven column/FK/index comparison, including PG's PK/UQ/FK
 //connoinherit, is reused; only the finite table set and trigger manifest differ.
 const generic=previous.tableChecks.slice(0,previous.tableChecks.indexOf(" if table_name like '%operational%'"));assert(generic.endsWith('\n'));
 const triggerManifest=[];
 for(const table of templates.tables){
  const add=(name,type,fn,deferred=false)=>triggerManifest.push({table,name,type,fn,deferred});
  if(table==='merchant_attendance_terminal_audit'){add('merchant_attendance_terminal_audit_no_rewrite',27,'faolla_attendance_events_append_only_v1');add('merchant_attendance_terminal_audit_no_truncate',34,'faolla_attendance_events_append_only_v1');}
  if(table==='merchant_attendance_pin_audit'){add('attendance_pin_audit_no_rewrite',27,'faolla_attendance_events_append_only_v1');add('attendance_pin_audit_no_truncate',34,'faolla_attendance_events_append_only_v1');}
  if(table==='merchant_attendance_pin_credentials')add('attendance_account_activation_guard',23,'faolla_attendance_account_activation_guard_v1');
  if(['merchant_attendance_independent_entries','merchant_attendance_independent_event_sources','merchant_attendance_independent_member_bindings'].includes(table)){add('independent_immutable',31,'faolla_attendance_independent_guard_v1');add('independent_no_truncate',34,'faolla_attendance_independent_guard_v1');}
  if(table.startsWith('merchant_attendance_management_')){add('management_immutable',27,'faolla_attendance_events_append_only_v1');add('management_no_truncate',34,'faolla_attendance_events_append_only_v1');add('management_insert_guard',7,'faolla_attendance_management_insert_v1');}
  if(table==='merchant_attendance_delegated_credential_proofs'){add('credentials207_proof_insert',7,'faolla_attendance_delegated_credentials_proof_insert_v1');add('credentials207_proof_immutable',27,'faolla_attendance_events_append_only_v1');add('credentials207_proof_no_truncate',34,'faolla_attendance_events_append_only_v1');add('credentials207_proof_pair',5,'faolla_attendance_delegated_credentials_pair_v1',true);}
 }
 const tableChecks=generic.replace(/foreach table_name in array array\[[\s\S]*?\] loop/,'foreach table_name in array array['+templates.tables.map(quote).join(',')+'] loop')
  .replaceAll('merchant_attendance_delegated_rules_','merchant_attendance_delegated_credentials_')+`
 if (select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal)<>(select count(*) from jsonb_array_elements($credentials207_triggers$${JSON.stringify(triggerManifest)}$credentials207_triggers$::jsonb) expected where expected->>'table'=table_name) then
  raise exception 'merchant_attendance_delegated_credentials_trigger_conflict' using detail=(select jsonb_build_object(
   'table',table_name,'actualCount',(select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal),
   'expectedCount',(select count(*) from jsonb_array_elements($credentials207_triggers$${JSON.stringify(triggerManifest)}$credentials207_triggers$::jsonb) expected where expected->>'table'=table_name),
   'triggers',coalesce((select jsonb_agg(jsonb_build_object('name',limited.tgname,'function',limited.function_identity) order by limited.tgname,limited.oid)
    from(select actual.oid,actual.tgname,left(actual.tgfoid::regprocedure::text,180) function_identity from pg_trigger actual
     where actual.tgrelid=actual_table and not actual.tgisinternal order by actual.tgname,actual.oid limit 8) limited),'[]'::jsonb)))::text;
 end if;
 for trigger_spec in select value from jsonb_array_elements($credentials207_triggers$${JSON.stringify(triggerManifest)}$credentials207_triggers$::jsonb) where value->>'table'=table_name loop
  if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=(trigger_spec->>'name')::name and actual.tgtype=(trigger_spec->>'type')::integer
   and actual.tgfoid=to_regprocedure(ns||'.'||(trigger_spec->>'fn')||'()') and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgparentid=0
   and actual.tgdeferrable=(trigger_spec->>'deferred')::boolean and actual.tginitdeferred=(trigger_spec->>'deferred')::boolean) then raise exception 'merchant_attendance_delegated_credentials_trigger_conflict';end if;
 end loop;
end loop;`;
 const declarations='declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;forward_spec jsonb;own_spec jsonb;f regprocedure;meta record;actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec jsonb;reference_keys smallint[];';
 const common=`select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_credentials_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name='merchant_attendance_delegated_credentials');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');`;
 const fm=(f,post)=>({...meta(f),hash:post?f.newHash:f.oldHash});
 const deps=post=>`own_spec:=$credentials207_dependencies$${JSON.stringify(dependencies)}$credentials207_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array(case when has190 then $credentials207_catalog190$${JSON.stringify({...fm(captures.catalog190,true),isRpc:false})}$credentials207_catalog190$::jsonb else $credentials207_catalog185$${JSON.stringify({...fm(captures.catalog185,true),isRpc:false})}$credentials207_catalog185$::jsonb end);
 own_spec:=own_spec||$credentials207_forwards$${JSON.stringify(allForward.map(f=>({...fm(f,false),oldHash:f.oldHash,newHash:f.newHash})))}$credentials207_forwards$::jsonb;
 for forward_spec in select value from jsonb_array_elements(own_spec) loop
  if forward_spec ? 'newHash' then forward_spec:=forward_spec||jsonb_build_object('hash',forward_spec->>(case when ${post?'true':'installed'} then 'newHash' else 'oldHash' end));end if;
  own_spec:=jsonb_build_array(forward_spec);${checks}
 end loop;`;
 const oldTables=tableChecks.replace("foreach table_name in array array["+templates.tables.map(quote).join(',')+"] loop","foreach table_name in array array["+templates.tables.filter(t=>t!=='merchant_attendance_delegated_credential_proofs').map(quote).join(',')+"] loop");
 const preflight=`do $credentials207_prerequisites$ begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name='merchant_attendance_delegated_rules')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name='merchant_attendance_independent_workers') then raise exception 'merchant_attendance_delegated_credentials_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name<>'merchant_attendance_delegated_credentials') then raise exception 'merchant_attendance_delegated_credentials_installation_conflict';end if;
 end;$credentials207_prerequisites$;
 ${templates.sql}
 create temp table credentials207_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression from pg_proc proc where proc.oid in(${allForward.map(f=>quote(f.signature)+'::regprocedure').join(',')});
 do $credentials207_preflight$ ${declarations} begin ${common}${deps(false)}
 if (to_regclass(ns||'.merchant_attendance_delegated_credential_proofs') is not null)<>installed
  or (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and proc.proname=any(array[${own.map(f=>quote(f.name)).join(',')}]))<>(case when installed then ${own.length} else 0 end) then raise exception 'merchant_attendance_delegated_credentials_installation_conflict';end if;
 if installed then own_spec:=$credentials207_own$${JSON.stringify(own)}$credentials207_own$::jsonb;${checks}${tableChecks}else ${oldTables}end if;
 end;$credentials207_preflight$;`;
 const forwardSql=allForward.map((f,i)=>`do $credentials207_forward_${i}$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name='merchant_attendance_delegated_credentials') then return;end if;
 select replace(proc.prosrc,E'\\r\\n',E'\\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='${f.signature}'::regprocedure;
 if old_body is distinct from $credentials207_old_${i}$${f.oldBody}$credentials207_old_${i}$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_credentials_forward_drift';end if;
 execute replace(definition,old_body,$credentials207_new_${i}$${f.newBody}$credentials207_new_${i}$);
 end;$credentials207_forward_${i}$;`).join('\n');
 const final=own.map(f=>`revoke all on function ${f.signature} from public,anon,authenticated,service_role;${f.isRpc?'\ngrant execute on function '+f.signature+' to service_role;':''}`).join('\n')+`
 do $credentials207_postconditions$ ${declarations} begin ${common}${deps(true)}own_spec:=$credentials207_post_own$${JSON.stringify(own)}$credentials207_post_own$::jsonb;${checks}${tableChecks}
 if (select count(*) from credentials207_forward_metadata)<>5 or exists(select 1 from credentials207_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata or pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression) then raise exception 'merchant_attendance_delegated_credentials_forward_metadata_changed';end if;
 end;$credentials207_postconditions$;
 drop table pg_temp.credentials207_forward_metadata,${[...templates.tables].reverse().map(t=>'pg_temp.'+t).join(',')},pg_temp.merchant_attendance_events,pg_temp.merchant_enterprise_employees,pg_temp.merchant_attendance_workers,pg_temp.merchant_attendance_locations,pg_temp.merchant_attendance_settings;`;
 return {forward,own,dependencies,templates,triggerManifest,preflight,forwardSql,final,tableChecks};
}
export function delegatedCredentialsFreezeSql(sql,migrations){
 let text=sql.replaceAll('\r\n','\n');const forward=delegatedCredentialsForwardRecipes(migrations);
 const cores=forward.cores.map(f=>`create or replace function public.${f.coreName}(${f.coreArgs})\nreturns jsonb language plpgsql set search_path=pg_catalog as $$${f.core}$$;`).join('\n');
 const replace=(name,value)=>{const pattern=new RegExp('--BEGIN GENERATED DELEGATED CREDENTIALS '+name+'[\\s\\S]*?--END GENERATED DELEGATED CREDENTIALS '+name);assert(pattern.test(text));text=text.replace(pattern,()=>`--BEGIN GENERATED DELEGATED CREDENTIALS ${name}\n${value}\n--END GENERATED DELEGATED CREDENTIALS ${name}`);};
 replace('CORES',cores);const r=delegatedCredentialsInstallRecipe(text,migrations);for(const[name,value]of[['PREFLIGHT',r.preflight],['FORWARD',r.forwardSql],['POSTCONDITIONS',r.final]])replace(name,value);return text;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--write']);const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'supabase-migrations');
 const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedCredentialsMigration).sort().map(name=>({name,text:readFileSync(path.join(dir,name),'utf8')}));
 const file=path.join(dir,delegatedCredentialsMigration),output=delegatedCredentialsFreezeSql(readFileSync(file,'utf8'),migrations);writeFileSync(file,output,'utf8');console.log(JSON.stringify({sourceOnly:true,migration:delegatedCredentialsMigration,sha256:sha(output)}));
}
