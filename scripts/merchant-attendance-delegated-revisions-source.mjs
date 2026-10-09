//208 inert exact SOURCE renderer; --write only renders this new candidate SQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {managementDelegationInstallRecipe,managementDelegationForwardRecipes,managementDelegationMigration} from './merchant-attendance-management-delegation-source.mjs';
import {delegatedCredentialsInstallRecipe,delegatedCredentialsForwardRecipes,delegatedCredentialsMigration} from './merchant-attendance-delegated-credentials-source.mjs';
export const delegatedRevisionsMigration='202610080208_merchant_attendance_delegated_revisions.sql';
export const delegatedRevisionsActions=Object.freeze(['revision_approve','revision_reject']);
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n'),'utf8').digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const meta=f=>{const {body,oldBody,newBody,oldHash,newHash,core,coreName,coreArgs,anchor,boundary,nestedOriginal,nestedBoundary,...m}=f;void body;void oldBody;void newBody;void oldHash;void newHash;void core;void coreName;void coreArgs;void anchor;void boundary;void nestedOriginal;void nestedBoundary;return m;};
const ownerFile='202610010095_merchant_attendance_revision_cycles.sql';
const ownerAnchor="  perform 1 from public.merchants where id=p_site_id and user_id=p_auth_user_id for share;\n  if not found then raise exception 'attendance_access_denied';end if;";
const ownerSpecs=Object.freeze([
 {name:'faolla_attendance_revision_owner_review_v3',hash:'13c636b9a8a240dd72be9c62f3971d00ef2fa2706a9d7de531ed336873509387',coreName:'faolla_attendance_delegated_revisions_review_core_v1',
  args:'p_site_id text,p_auth_user_id uuid,p_request_id uuid,p_grant_id uuid',call:'p_site_id,p_auth_user_id,p_request_id,null',command:'null'},
 {name:'faolla_attendance_revision_decide_v2',hash:'de1d32befdc98d2a6c622a0cb9e4f7f93a1d5d00b1d56996a4e5d50720634283',coreName:'faolla_attendance_delegated_revisions_decide_core_v1',
  args:'p_site_id text,p_auth_user_id uuid,p_request_id uuid,p_command jsonb,p_operation_id uuid,p_allow_write boolean,p_grant_id uuid',call:'p_site_id,p_auth_user_id,p_request_id,p_command,p_operation_id,p_allow_write,null',command:'p_command'},
]);
export function delegatedRevisionsForwardRecipes(migrations){
 const get=name=>{const f=migrations.find(m=>m.name===name);assert(f,name);return f.text;};
 const cores=ownerSpecs.map(s=>{const f=dayReviewSqlFunctions(get(ownerFile)).find(f=>f.name===s.name);assert(f);assert.equal(f.hash,s.hash);assert.equal(f.body.split(ownerAnchor).length-1,1);
  const boundary=' if p_grant_id is null then\n'+ownerAnchor+'\n else\n  perform public.faolla_attendance_delegated_revisions_core_authorize_v1(p_site_id,p_auth_user_id,p_grant_id,p_request_id,'+s.command+');\n end if;';
  let core=f.body.replace(ownerAnchor,boundary),nestedOriginal=null,nestedBoundary=null;
  if(s.command==='p_command'){
   nestedOriginal='  r:=public.faolla_attendance_revision_owner_review_v3(p_site_id,p_auth_user_id,p_request_id);';assert.equal(core.split(nestedOriginal).length-1,1);
   nestedBoundary=' if p_grant_id is null then\n'+nestedOriginal+'\n else\n  r:=public.faolla_attendance_delegated_revisions_review_core_v1(p_site_id,p_auth_user_id,p_request_id,p_grant_id);\n end if;';
   core=core.replace(nestedOriginal,nestedBoundary);
  }
  let restored=core.replace(boundary,ownerAnchor);if(nestedBoundary)restored=restored.replace(nestedBoundary,nestedOriginal);assert.equal(restored,f.body);
  const newBody=`\nbegin\n return public.${s.coreName}(${s.call});\nend;\n`;
  return {...meta(f),isRpc:true,coreName:s.coreName,coreArgs:s.args,anchor:ownerAnchor,boundary,nestedOriginal,nestedBoundary,core,oldBody:f.body,newBody,oldHash:f.hash,newHash:sha(newBody)};
 });
 const previous=delegatedCredentialsForwardRecipes(migrations).guard;assert.equal(previous.newHash,'c46a7ada6f8cbe703bd11496d71d4b97ac2ab7e7bb19152b48c3aa0835c3cc57');
 const anchor="  if new.delegated_action in('terminal_prepare','terminal_revoke','pin_issue','pin_revoke') then perform public.faolla_attendance_delegated_credentials_authority_v1(new);return new;end if;";
 assert.equal(previous.newBody.split(anchor).length-1,1);const newBody=previous.newBody.replace(anchor,anchor+"\n  if new.delegated_action in('revision_approve','revision_reject') then perform public.faolla_attendance_delegated_revisions_authority_v1(new);return new;end if;");
 return {cores,guard:{...meta(previous),isRpc:false,oldBody:previous.newBody,newBody,oldHash:previous.newHash,newHash:sha(newBody)}};
}
export function delegatedRevisionsOwnManifest(sql){return dayReviewSqlFunctions(sql).filter(f=>f.name.startsWith('faolla_attendance_delegated_revisions_'))
 .map(f=>({...meta(f),isRpc:f.name==='faolla_attendance_delegated_revisions_v1'}));}
function revisionTemplates(migrations,previous){
 const get=name=>{const f=migrations.find(m=>m.name===name);assert(f,name);return f.text;};
 const sources=['202610010091_merchant_attendance_revision_requests.sql','202610010093_merchant_attendance_versioned_reports.sql','202610010094_merchant_attendance_revision_decision_core.sql'];
 const tables=[],statements=[],indexes=[];
 for(const file of sources){const text=get(file);
  for(const m of text.matchAll(/^create table public\.(merchant_attendance_(?:revision_requests|effect_versions|revision_decisions))\s*\([\s\S]*?^\);/gm)){
   tables.push(m[1]);statements.push(m[0].replace('create table public.','create temp table ').replaceAll('references public.','references pg_temp.').replace(/\);$/,' ) on commit drop;'));
  }
  for(const m of text.matchAll(/^create (?:unique )?index [^\n]+;/gm))if(tables.some(t=>new RegExp('on public\\.'+t+'\\(').test(m[0])))indexes.push(m[0].replace('on public.','on pg_temp.'));
 }
 assert.equal(tables.length,3);assert.equal(indexes.length,4);
 //Exact later history/range indexes. Normalize only TEMP creation syntax;
 //retain every key, expression and predicate for the full metadata comparison.
 for(const [file,name,prefix] of [
  ['202610010097_merchant_attendance_revision_history.sql','attendance_revision_owner_history_idx','create index '],
  ['202610010097_merchant_attendance_revision_history.sql','attendance_revision_root_history_idx','create index '],
  ['202610030116_merchant_attendance_self_revision_history.sql','attendance_revision_self_identity_history_idx','create index if not exists '],
  ['202610050151_merchant_attendance_period_source_ranges.sql','attendance_revision_proposal_period_idx','create index concurrently if not exists '],
 ]){
  const matches=[...get(file).matchAll(new RegExp('^'+prefix+name+'\\s+on public\\.merchant_attendance_revision_requests\\s*\\([^;]+;', 'gm'))];
  assert.equal(matches.length,1,'exact208_later_revision_index:'+name);
  indexes.push(matches[0][0].replace(prefix,'create index ').replace('on public.','on pg_temp.'));
 }
 assert.equal(indexes.length,8);
 const parents=`create temp table merchant_attendance_correction_effects(merchant_id text,request_id uuid,primary key(merchant_id,request_id)) on commit drop;
create temp table merchant_attendance_correction_decisions(merchant_id text,operation_id uuid,primary key(merchant_id,operation_id)) on commit drop;
create temp table merchant_attendance_correction_controls(merchant_id text,revision bigint,primary key(merchant_id,revision)) on commit drop;`;
 const link=`alter table pg_temp.merchant_attendance_effect_versions add constraint attendance_effect_version_decision_fk foreign key(merchant_id,operation_id)
 references pg_temp.merchant_attendance_revision_decisions(merchant_id,operation_id) deferrable initially deferred;`;
 const view=get(sources[1]).match(/create view public\.merchant_attendance_effect_current_v2 as\n([\s\S]*?);/)?.[1];assert(view);
 return {tables:[...previous.templates.tables,...tables],extraTables:tables,sql:previous.templates.sql+'\n'+parents+'\n'+[...statements,link,...indexes].join('\n')+
  '\ncreate temp view revisions208_current_template as\n'+view+';'};
}
export function delegatedRevisionsInstallRecipe(sql,migrations){
 const get=name=>{const f=migrations.find(m=>m.name===name);assert(f,name);return f.text;};
 const forward=delegatedRevisionsForwardRecipes(migrations),allForward=[...forward.cores,forward.guard],own=delegatedRevisionsOwnManifest(sql);assert.equal(own.length,13);
 const foundation=managementDelegationInstallRecipe(get(managementDelegationMigration),migrations.filter(m=>m.name<managementDelegationMigration));
 const previous=delegatedCredentialsInstallRecipe(get(delegatedCredentialsMigration),migrations.filter(m=>m.name<delegatedCredentialsMigration));
 const checks=foundation.preflight.match(/for spec in select value from jsonb_array_elements\(own_spec\) loop[\s\S]*?\n end loop;/)?.[0];assert(checks);
 const latest=new Map(),serviceNames=new Set();
 for(const file of migrations){for(const f of dayReviewSqlFunctions(file.text))latest.set(f.name,f);
  for(const m of file.text.matchAll(/grant execute on function public\.(faolla_[a-z0-9_]+)\([^;]*?\) to service_role;/g))serviceNames.add(m[1]);}
 const byPrefix=prefix=>{const f=migrations.find(f=>f.name.startsWith(prefix));assert(f,prefix);return f.text;};
 const captures=managementDelegationForwardRecipes({legacyCatalog:byPrefix('202610080185_'),currentCatalog:byPrefix('202610080190_'),capture:byPrefix('202610080189_')});
 latest.set(captures.capture.name,{...meta(captures.capture),body:captures.capture.newBody,hash:captures.capture.newHash});
 const link=latest.get('faolla_attendance_revision_decision_link_v1');assert(link);latest.set(link.name,{...link,definer:true}); //098 exact ALTER, no body change.
 latest.set(forward.guard.name,{...meta(forward.guard),body:forward.guard.oldBody,hash:forward.guard.oldHash});
 const catalogName=captures.catalog190.name,roots=new Set(['faolla_attendance_events_append_only_v1','faolla_attendance_effect_version_guard_v1','faolla_attendance_revision_decision_link_v1','faolla_attendance_missing_effect_guard_v1','faolla_attendance_period_seal_insert_guard_v1','faolla_attendance_review_routing_capture_v1',captures.capture.name]);
 for(const f of [...dayReviewSqlFunctions(sql),...forward.cores.map(f=>({body:f.core}))])for(const m of f.body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g))roots.add(m[1]);
 const excluded=new Set([...own.map(f=>f.name),...allForward.map(f=>f.name)]),seen=new Set(),dependencies=[];
 const visit=name=>{if(seen.has(name)||excluded.has(name))return;seen.add(name);const f=latest.get(name);assert(f||name===catalogName,'missing exact dependency '+name);
  const body=name===catalogName?captures.catalog190.newBody:f.body;
  if(name!==catalogName)dependencies.push({...meta(f),isRpc:serviceNames.has(name)});
  for(const m of body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g))visit(m[1]);};for(const name of roots)visit(name);
 const templates=revisionTemplates(migrations,previous),triggerManifest=[...previous.triggerManifest];
 const add=(table,name,type,fn,deferred=false)=>triggerManifest.push({table,name,type,fn,deferred});
 for(const table of templates.extraTables){
  const prefix=table==='merchant_attendance_revision_requests'?'attendance_revision':table==='merchant_attendance_effect_versions'?'attendance_effect_version':'attendance_revision_decision';
  add(table,prefix+'_no_rewrite',27,'faolla_attendance_events_append_only_v1');add(table,prefix+'_no_truncate',34,'faolla_attendance_events_append_only_v1');
  if(table!=='merchant_attendance_revision_decisions')add(table,'attendance_period_seal_guard',7,'faolla_attendance_period_seal_insert_guard_v1');
  if(table==='merchant_attendance_effect_versions'){
   add(table,'attendance_effect_version_insert_guard',7,'faolla_attendance_effect_version_guard_v1');add(table,'attendance_revision_missing_guard',5,'faolla_attendance_missing_effect_guard_v1');
   add(table,'attendance_effect_version_decision_link',5,'faolla_attendance_revision_decision_link_v1',true);
  }
  if(table==='merchant_attendance_revision_decisions')add(table,'attendance_revision_decision_effect_link',5,'faolla_attendance_revision_decision_link_v1',true);
  if(table==='merchant_attendance_revision_requests')add(table,'review_routing_capture',5,'faolla_attendance_review_routing_capture_v1');
 }
 const generic=previous.tableChecks.slice(0,previous.tableChecks.indexOf(' if (select count(*) from pg_trigger actual'));assert(generic.endsWith('\n'));
 const tableChecks=generic.replace(/foreach table_name in array array\[[\s\S]*?\] loop/,'foreach table_name in array array['+templates.tables.map(quote).join(',')+'] loop')
  .replaceAll('merchant_attendance_delegated_credentials_','merchant_attendance_delegated_revisions_')+`
 if (select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal)<>(select count(*) from jsonb_array_elements($revisions208_triggers$${JSON.stringify(triggerManifest)}$revisions208_triggers$::jsonb) expected where expected->>'table'=table_name) then raise exception 'merchant_attendance_delegated_revisions_trigger_conflict';end if;
 for trigger_spec in select value from jsonb_array_elements($revisions208_triggers$${JSON.stringify(triggerManifest)}$revisions208_triggers$::jsonb) where value->>'table'=table_name loop
  if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=(trigger_spec->>'name')::name and actual.tgtype=(trigger_spec->>'type')::integer
   and actual.tgfoid=to_regprocedure(ns||'.'||(trigger_spec->>'fn')||'()') and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgparentid=0
   and actual.tgdeferrable=(trigger_spec->>'deferred')::boolean and actual.tginitdeferred=(trigger_spec->>'deferred')::boolean) then raise exception 'merchant_attendance_delegated_revisions_trigger_conflict';end if;
 end loop;
end loop;
if not exists(select 1 from pg_class actual where actual.oid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and actual.relkind='v' and actual.relowner=expected_owner
 and actual.reloptions is null and not actual.relrowsecurity and not actual.relforcerowsecurity)
 or exists(select 1 from pg_class actual cross join lateral aclexplode(coalesce(actual.relacl,acldefault('r',actual.relowner))) acl
  where actual.oid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
 or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
 or pg_get_viewdef(to_regclass(ns||'.merchant_attendance_effect_current_v2'),true) is distinct from pg_get_viewdef('pg_temp.revisions208_current_template'::regclass,true)
 then raise exception 'merchant_attendance_delegated_revisions_view_conflict';end if;`;
 const declarations='declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;forward_spec jsonb;own_spec jsonb;f regprocedure;meta record;actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec jsonb;reference_keys smallint[];';
 const common=`select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_revisions_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080208 and name='merchant_attendance_delegated_revisions');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');`;
 const fm=(f,post)=>({...meta(f),hash:post?f.newHash:f.oldHash});
 const deps=post=>`own_spec:=$revisions208_dependencies$${JSON.stringify(dependencies)}$revisions208_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array(case when has190 then $revisions208_catalog190$${JSON.stringify({...fm(captures.catalog190,true),isRpc:false})}$revisions208_catalog190$::jsonb else $revisions208_catalog185$${JSON.stringify({...fm(captures.catalog185,true),isRpc:false})}$revisions208_catalog185$::jsonb end);
 own_spec:=own_spec||$revisions208_forwards$${JSON.stringify(allForward.map(f=>({...fm(f,false),oldHash:f.oldHash,newHash:f.newHash})))}$revisions208_forwards$::jsonb;
 for forward_spec in select value from jsonb_array_elements(own_spec) loop
  if forward_spec ? 'newHash' then forward_spec:=forward_spec||jsonb_build_object('hash',forward_spec->>(case when ${post?'true':'installed'} then 'newHash' else 'oldHash' end));end if;
  own_spec:=jsonb_build_array(forward_spec);${checks}
 end loop;`;
 const preflight=`do $revisions208_prerequisites$ begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name='merchant_attendance_delegated_credentials')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610010098 and name='merchant_attendance_revision_application_access')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610010103 and name='merchant_attendance_missing_revisions')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610050150 and name='merchant_attendance_period_seal_guards') then raise exception 'merchant_attendance_delegated_revisions_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080208 and name<>'merchant_attendance_delegated_revisions') then raise exception 'merchant_attendance_delegated_revisions_installation_conflict';end if;
 end;$revisions208_prerequisites$;
 ${templates.sql}
 create temp table revisions208_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression from pg_proc proc where proc.oid in(${allForward.map(f=>quote(f.signature)+'::regprocedure').join(',')});
 do $revisions208_preflight$ ${declarations} begin ${common}${deps(false)}${tableChecks}
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and proc.proname=any(array[${own.map(f=>quote(f.name)).join(',')}]))<>(case when installed then ${own.length} else 0 end) then raise exception 'merchant_attendance_delegated_revisions_installation_conflict';end if;
 if installed then own_spec:=$revisions208_own$${JSON.stringify(own)}$revisions208_own$::jsonb;${checks}end if;
 end;$revisions208_preflight$;`;
 const forwardSql=allForward.map((f,i)=>`do $revisions208_forward_${i}$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080208 and name='merchant_attendance_delegated_revisions') then return;end if;
 select replace(proc.prosrc,E'\\r\\n',E'\\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='${f.signature}'::regprocedure;
 if old_body is distinct from $revisions208_old_${i}$${f.oldBody}$revisions208_old_${i}$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_revisions_forward_drift';end if;
 execute replace(definition,old_body,$revisions208_new_${i}$${f.newBody}$revisions208_new_${i}$);
 end;$revisions208_forward_${i}$;`).join('\n');
 const final=own.map(f=>`revoke all on function ${f.signature} from public,anon,authenticated,service_role;${f.isRpc?'\ngrant execute on function '+f.signature+' to service_role;':''}`).join('\n')+`
 do $revisions208_postconditions$ ${declarations} begin ${common}${deps(true)}own_spec:=$revisions208_post_own$${JSON.stringify(own)}$revisions208_post_own$::jsonb;${checks}${tableChecks}
 if (select count(*) from revisions208_forward_metadata)<>3 or exists(select 1 from revisions208_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata or pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression) then raise exception 'merchant_attendance_delegated_revisions_forward_metadata_changed';end if;
 end;$revisions208_postconditions$;
 drop view pg_temp.revisions208_current_template;
 drop table pg_temp.revisions208_forward_metadata,${[...templates.extraTables].reverse().map(t=>'pg_temp.'+t).join(',')},pg_temp.merchant_attendance_correction_controls,pg_temp.merchant_attendance_correction_decisions,pg_temp.merchant_attendance_correction_effects,${[...previous.templates.tables].reverse().map(t=>'pg_temp.'+t).join(',')},pg_temp.merchant_attendance_events,pg_temp.merchant_enterprise_employees,pg_temp.merchant_attendance_workers,pg_temp.merchant_attendance_locations,pg_temp.merchant_attendance_settings;`;
 return {forward,own,dependencies,templates,triggerManifest,preflight,forwardSql,final,tableChecks};
}
export function delegatedRevisionsFreezeSql(sql,migrations){
 let text=sql.replaceAll('\r\n','\n');const forward=delegatedRevisionsForwardRecipes(migrations);
 const cores=forward.cores.map(f=>`create or replace function public.${f.coreName}(${f.coreArgs})\nreturns jsonb language plpgsql set search_path=pg_catalog as $$${f.core}$$;`).join('\n');
 const replace=(name,value)=>{const pattern=new RegExp('--BEGIN GENERATED DELEGATED REVISIONS '+name+'[\\s\\S]*?--END GENERATED DELEGATED REVISIONS '+name);assert(pattern.test(text));text=text.replace(pattern,()=>`--BEGIN GENERATED DELEGATED REVISIONS ${name}\n${value}\n--END GENERATED DELEGATED REVISIONS ${name}`);};
 replace('CORES',cores);const r=delegatedRevisionsInstallRecipe(text,migrations);for(const[name,value]of[['PREFLIGHT',r.preflight],['FORWARD',r.forwardSql],['POSTCONDITIONS',r.final]])replace(name,value);return text;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--write']);const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'supabase-migrations');
 const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedRevisionsMigration).sort().map(name=>({name,text:readFileSync(path.join(dir,name),'utf8')}));
 const file=path.join(dir,delegatedRevisionsMigration),output=delegatedRevisionsFreezeSql(readFileSync(file,'utf8'),migrations);writeFileSync(file,output,'utf8');console.log(JSON.stringify({sourceOnly:true,migration:delegatedRevisionsMigration,sha256:sha(output)}));
}
