//209 inert exact SOURCE renderer; --write only renders this new candidate SQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {managementDelegationInstallRecipe,managementDelegationForwardRecipes,managementDelegationMigration} from './merchant-attendance-management-delegation-source.mjs';
import {delegatedRevisionsInstallRecipe,delegatedRevisionsForwardRecipes,delegatedRevisionsMigration} from './merchant-attendance-delegated-revisions-source.mjs';
export const delegatedPlanExceptionsMigration='202610090209_merchant_attendance_delegated_plan_exceptions.sql';
export const delegatedPlanExceptionsActions=Object.freeze(['plan_exception_decide']);
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n'),'utf8').digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const meta=f=>{const {body,oldBody,newBody,oldHash,newHash,core,coreName,coreArgs,anchor,boundary,replacements,...m}=f;void body;void oldBody;void newBody;void oldHash;void newHash;void core;void coreName;void coreArgs;void anchor;void boundary;void replacements;return m;};
const ownerAnchor="  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;\n  if not found then raise exception 'attendance_access_denied';end if;";
const administrativeMigration='202610080195_merchant_attendance_administrative_closure.sql';
const administrativeMigrationSha='cc16feeda1702f79a40cd26cded84ac2535af879b725b6b3d5ff24c68f4d2ecc';
const administrativeRecipesSha='b978a9bf64edfe37a766ff27aef747b1d456a56748fb5536bb4fa3e7546d878f';
const ownerSpecs=Object.freeze([
 {file:'202610060170_merchant_attendance_plan_clearance.sql',name:'faolla_attendance_plan_exception_clearance_execute_v1',hash:'449701832073245222b442d7d5fbb13d80b123bb80dbcc7076c0299d4d683412',coreName:'faolla_attendance_delegated_plan_exceptions_clearance_core_v1',
  args:'p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean,p_allow_clearance boolean,p_capture_notifications boolean,p_grant_id uuid',call:'p_query,p_auth_user_id,p_command,p_allow_write,p_allow_clearance,p_capture_notifications,null',source:'faolla_attendance_plan_exception_source_v1',mirror:'faolla_attendance_pd_exception_v1'},
 {file:'202610060174_merchant_attendance_plan_posthoc_reviews.sql',name:'faolla_attendance_plan_exception_posthoc_execute_v1',hash:'a28df0ec556702b0e4fb30e434dc089d853c358a14ab907eab23b6b3a287be5f',coreName:'faolla_attendance_delegated_plan_exceptions_posthoc_core_v1',
  args:'p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean,p_allow_posthoc boolean,p_allow_clearance boolean,p_capture_notifications boolean,p_grant_id uuid',call:'p_query,p_auth_user_id,p_command,p_allow_write,p_allow_posthoc,p_allow_clearance,p_capture_notifications,null',source:'faolla_attendance_plan_posthoc_formal_source_v1',mirror:'faolla_attendance_pd_formal_source_v1'},
]);
export function delegatedPlanExceptionsForwardRecipes(migrations){
 const get=name=>{const f=migrations.find(m=>m.name===name);assert(f,name);return f.text;};
 const cores=ownerSpecs.map(s=>{const f=dayReviewSqlFunctions(get(s.file)).find(f=>f.name===s.name);assert(f);assert.equal(f.hash,s.hash);assert.equal(f.body.split(ownerAnchor).length-1,1);
  const boundary=' if p_grant_id is null then\n'+ownerAnchor+'\n else\n  perform public.faolla_attendance_delegated_plan_exceptions_core_authorize_v1(site,p_auth_user_id,p_grant_id,wid,sid,access_name,mode_name);\n end if;';
  let core=f.body.replace(ownerAnchor,boundary);const replacements=[];
  const sourceOriginal='    source_result:=public.'+s.source+"(jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid),p_auth_user_id);";
  const sourceBoundary=' if p_grant_id is null then\n'+sourceOriginal+'\n else\n'+sourceOriginal.replace(s.source,s.mirror)+'\n end if;';
  assert.equal(core.split(sourceOriginal).length-1,1);core=core.replace(sourceOriginal,sourceBoundary);replacements.push({original:sourceOriginal,boundary:sourceBoundary});
  if(s.name==='faolla_attendance_plan_exception_posthoc_execute_v1'){
   const original='    return public.faolla_attendance_plan_exception_clearance_execute_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_clearance,p_capture_notifications);';
   const boundary=' if p_grant_id is null then\n'+original+'\n else\n    return public.faolla_attendance_delegated_plan_exceptions_clearance_core_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_clearance,p_capture_notifications,p_grant_id);\n end if;';
   assert.equal(core.split(original).length-1,1);core=core.replace(original,boundary);replacements.push({original,boundary});
  }
  let restored=core.replace(boundary,ownerAnchor);for(const r of replacements)restored=restored.replace(r.boundary,r.original);assert.equal(restored,f.body);
  const newBody=`\nbegin\n return public.${s.coreName}(${s.call});\nend;\n`;
  return {...meta(f),isRpc:false,coreName:s.coreName,coreArgs:s.args,anchor:ownerAnchor,boundary,replacements,core,oldBody:f.body,newBody,oldHash:f.hash,newHash:sha(newBody)};
 });
 const previous=delegatedRevisionsForwardRecipes(migrations).guard;assert.equal(previous.newHash,'284e4388128f1bd0984fb5995a0f34cc9f23e2d1d67dfb4f5286cc46c1e006e6');
 const anchor="  if new.delegated_action in('revision_approve','revision_reject') then perform public.faolla_attendance_delegated_revisions_authority_v1(new);return new;end if;";
 assert.equal(previous.newBody.split(anchor).length-1,1);const newBody=previous.newBody.replace(anchor,anchor+"\n  if new.delegated_action='plan_exception_decide' then perform public.faolla_attendance_delegated_plan_exceptions_authority_v1(new);return new;end if;");
 return {cores,guard:{...meta(previous),isRpc:false,oldBody:previous.newBody,newBody,oldHash:previous.newHash,newHash:sha(newBody)}};
}
export function delegatedPlanExceptionsOwnManifest(sql){return dayReviewSqlFunctions(sql).filter(f=>f.name.startsWith('faolla_attendance_delegated_plan_exceptions_'))
 .map(f=>({...meta(f),isRpc:f.name==='faolla_attendance_delegated_plan_exceptions_v1'}));}
// Replay only literal top-level privileges, by exact signature and in migration
// order. Dollar bodies/comments/quoted data cannot grant authority to this
// inert recipe. A multi-function statement applies to EVERY listed signature;
// a later explicit service_role revoke supersedes an earlier grant.
export function delegatedPlanExceptionsServiceAclHistory(migrations){
 const privileges=new Map();let previous='';
 for(const file of migrations){
  assert(file.name>previous,'exact209_acl_history_order');previous=file.name;
  const sql=file.text.replaceAll('\r\n','\n');let literal='',i=0;
  const hide=end=>{assert(end>i&&end<=sql.length,'exact209_acl_unterminated:'+file.name);literal+=' '.repeat(end-i);i=end;};
  while(i<sql.length){
   if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i+2);hide(end<0?sql.length:end);continue;}
   if(sql.startsWith('/*',i)){let depth=1,end=i+2;while(depth&&end<sql.length){if(sql.startsWith('/*',end)){depth++;end+=2;}else if(sql.startsWith('*/',end)){depth--;end+=2;}else end++;}assert.equal(depth,0,'exact209_acl_comment:'+file.name);hide(end);continue;}
   if(sql[i]==="'"||sql[i]==='"'){
    const delimiter=sql[i],escape=delimiter==="'"&&i>0&&/[eE]/.test(sql[i-1])&&(i===1||!/[a-z0-9_.$]/i.test(sql[i-2]));let end=i+1,closed=false;
    while(end<sql.length){if(sql[end]===delimiter){if(sql[end+1]===delimiter){end+=2;continue;}end++;closed=true;break;}if(escape&&sql[end]==='\\')end++;end++;}
    assert(closed,'exact209_acl_quote:'+file.name);hide(end);continue;
   }
   if(sql[i]==='$'){const tag=sql.slice(i).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i)?.[0];if(tag){const end=sql.indexOf(tag,i+tag.length);assert(end>=0,'exact209_acl_dollar:'+file.name);hide(end+tag.length);continue;}}
   literal+=sql[i++];
  }
  for(const match of literal.matchAll(/\b(grant\s+(?:execute|all(?:\s+privileges)?)|revoke\s+(?:execute|all(?:\s+privileges)?))\s+on\s+function\s+([^;]*?)\s+(to|from)\s+([^;]+);/gi)){
   const [,rawOperation,objects,rawDirection,roles]=match,operation=rawOperation.toLowerCase(),direction=rawDirection.toLowerCase();
   if(!/\bservice_role\b/i.test(roles))continue;
   if(!/public\.faolla_[a-z0-9_]+\(/.test(objects))continue;
   const roleNames=roles.split(',').map(role=>role.trim().toLowerCase());
   assert(roleNames.every(role=>['public','anon','authenticated','service_role'].includes(role))&&new Set(roleNames).size===roleNames.length,'exact209_acl_roles:'+file.name);
   assert(!operation.startsWith('grant')||roleNames.every(role=>role==='service_role'),'exact209_acl_grant_roles:'+file.name);
   assert((operation.startsWith('grant')&&direction==='to')||(operation.startsWith('revoke')&&direction==='from'),'exact209_acl_direction:'+file.name);
   // Parentheses, not commas, delimit signatures (argument lists contain commas).
   const signatures=[...objects.matchAll(/public\.(faolla_[a-z0-9_]+)\(([^()]*)\)/g)].map(m=>'public.'+m[1]+'('+m[2].split(',').map(type=>type.trim().replace(/\s+/g,' ')).join(',')+')');
   assert(signatures.length&&objects.replace(/public\.faolla_[a-z0-9_]+\([^()]*\)/g,'').replace(/[\s,]/g,'')==='','exact209_acl_signature:'+file.name);
   for(const signature of signatures)privileges.set(signature,Object.freeze({allowed:operation.startsWith('grant'),file:file.name,statementHash:sha(sql.slice(match.index,match.index+match[0].length))}));
  }
 }
 return privileges;
}
function exceptionTemplates(migrations,previous){
 const get=name=>{const f=migrations.find(m=>m.name===name);assert(f,name);return f.text;};
 const tables=[],statements=[],indexes=[];
 const schedule='202610010099_merchant_attendance_schedule.sql',publication='202610050136_merchant_attendance_schedule_publication_evidence.sql',review='202610050147_merchant_attendance_plan_exception_review.sql';
 for(const file of [schedule,publication,review]){
  for(const m of get(file).matchAll(/^create table (?:if not exists )?public\.(merchant_attendance_(?:schedule_commands|schedule_slots|schedule_cancellations|schedule_publication_evidence|plan_exception_cases|plan_exception_entries|plan_exception_reads))\s*\([\s\S]*?^\);/gm)){
   let ddl=m[0].replace(/^create table (?:if not exists )?public\./,'create temp table ').replaceAll('references public.','references pg_temp.').replace(/\);$/,' ) on commit drop;');
   if(m[1]==='merchant_attendance_schedule_publication_evidence'){
    // Same decoded136 regexp/constraint, but an explicit escape string removes
    // standard_conforming_strings ambiguity from this NEW temp template only.
    const original="'^\\d{8}$'",explicit="E'^\\\\d{8}$'";assert.equal(ddl.split(original).length-1,1);
    ddl=ddl.split(original).join(explicit);
   }
   tables.push(m[1]);statements.push(ddl);
  }
  for(const m of get(file).matchAll(/^create (?:unique )?index (?:concurrently )?(?:if not exists )?[a-z0-9_]+\s+on public\.([a-z0-9_]+)\s*\([^;]+;/gm))if(tables.includes(m[1]))indexes.push(m[0].replace(/^create (unique )?index (?:concurrently )?(?:if not exists )?/,'create $1index ').replace('on public.','on pg_temp.'));
 }
 assert.equal(tables.length,7);assert.equal(indexes.length,7);
 // No later ALTER/index drift is silently modeled. Enumerate the complete
 // migration history and reject any new structural source before rendering.
 for(const file of migrations)if(![schedule,publication,review].includes(file.name)){
  for(const table of tables){
   assert(!new RegExp('alter table public\\.'+table+'\\s+(?:add|drop|alter|rename)\\s','i').test(file.text),'exact209_unmodeled_table_alter:'+file.name+':'+table);
   assert(!new RegExp('^create (?:unique )?index [^;]+on public\\.'+table+'\\s*\\(', 'gm').test(file.text),'exact209_unmodeled_table_index:'+file.name+':'+table);
  }
 }
 const link=`alter table pg_temp.merchant_attendance_plan_exception_cases add constraint attendance_plan_exception_first_entry_fk foreign key(merchant_id,case_id)
 references pg_temp.merchant_attendance_plan_exception_entries(merchant_id,operation_id) deferrable initially deferred;`;
 return {tables:[...previous.templates.tables,...tables],extraTables:tables,sql:previous.templates.sql+'\n'+[...statements,link,...indexes].join('\n')};
}
export function delegatedPlanExceptionsInstallRecipe(sql,migrations){
 const get=name=>{const f=migrations.find(m=>m.name===name);assert(f,name);return f.text;};
 const forward=delegatedPlanExceptionsForwardRecipes(migrations),allForward=[...forward.cores,forward.guard],own=delegatedPlanExceptionsOwnManifest(sql);assert.equal(own.length,13);
 const foundation=managementDelegationInstallRecipe(get(managementDelegationMigration),migrations.filter(m=>m.name<managementDelegationMigration));
 const previous=delegatedRevisionsInstallRecipe(get(delegatedRevisionsMigration),migrations.filter(m=>m.name<delegatedRevisionsMigration));
 const checks=foundation.preflight.match(/for spec in select value from jsonb_array_elements\(own_spec\) loop[\s\S]*?\n end loop;/)?.[0];assert(checks);
 const latest=new Map(),sourceFiles=new Map(),servicePrivileges=delegatedPlanExceptionsServiceAclHistory(migrations);
 for(const file of migrations)for(const f of dayReviewSqlFunctions(file.text)){latest.set(f.name,f);sourceFiles.set(f.name,file.name);}
 //195 legitimately forwards existing collectors inside a DO recipe, not a
 //new CREATE declaration. Reconstruct its frozen source edits before walking
 //each needed body; neither observed hashes nor an old/new allowlist is proof.
 const administrative=get(administrativeMigration);assert.equal(sha(administrative),administrativeMigrationSha,'exact209_administrative_migration');
 const administrativeRecipes=JSON.parse(administrative.match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/)?.[1]??'null');
 assert.equal(administrativeRecipes.length,28);assert.equal(sha(JSON.stringify(administrativeRecipes)),administrativeRecipesSha,'exact209_administrative_recipes');
 const administrativeByName=new Map(administrativeRecipes.map(r=>[r.name,r])),administrativeForwardBodies=[];
 const currentBody=name=>{
  const f=latest.get(name),r=administrativeByName.get(name);if(!r)return f;
  assert(f,'exact209_administrative_source:'+name);assert.equal(sourceFiles.get(name),r.source,'exact209_administrative_source_file:'+name);
  assert.equal(f.hash,r.oldHash,'exact209_administrative_old_hash:'+name);
  assert.equal(f.signature,'public.'+name+'('+r.types.replaceAll('timestamp with time zone','timestamptz')+')','exact209_administrative_signature:'+name);
  assert.equal(f.definer,r.securityDefiner);assert.equal(f.volatility,r.volatility);assert.equal(f.result,r.resultType);assert.deepEqual([f.searchPath],r.config);
  assert.equal(servicePrivileges.get(f.signature)?.allowed===true,r.serviceExecute,'exact209_administrative_acl:'+name);
  let body=f.body;for(const change of r.changes){assert(Number.isInteger(change.count)&&change.count>0);assert.equal(body.split(change.from).length-1,change.count,'exact209_administrative_change_count:'+name);body=body.split(change.from).join(change.to);}
  assert.equal(sha(body),r.newHash,'exact209_administrative_new_hash:'+name);
  administrativeForwardBodies.push({name,source:r.source,oldHash:r.oldHash,newHash:r.newHash});return {...f,body,hash:r.newHash};
 };
 const byPrefix=prefix=>{const f=migrations.find(f=>f.name.startsWith(prefix));assert(f,prefix);return f.text;};
 const captures=managementDelegationForwardRecipes({legacyCatalog:byPrefix('202610080185_'),currentCatalog:byPrefix('202610080190_'),capture:byPrefix('202610080189_')});
 latest.set(captures.capture.name,{...meta(captures.capture),body:captures.capture.newBody,hash:captures.capture.newHash});
 const link=latest.get('faolla_attendance_revision_decision_link_v1');assert(link);latest.set(link.name,{...link,definer:true}); //098 exact ALTER, no body change.
 latest.set(forward.guard.name,{...meta(forward.guard),body:forward.guard.oldBody,hash:forward.guard.oldHash});
 const catalogName=captures.catalog190.name,roots=new Set(['faolla_attendance_events_append_only_v1','faolla_attendance_effect_version_guard_v1','faolla_attendance_revision_decision_link_v1','faolla_attendance_missing_effect_guard_v1','faolla_attendance_period_seal_insert_guard_v1','faolla_attendance_review_routing_capture_v1','faolla_attendance_schedule_publication_guard_v1',captures.capture.name]);
 for(const f of [...dayReviewSqlFunctions(sql),...forward.cores.map(f=>({body:f.core}))])for(const m of f.body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g))roots.add(m[1]);
 const excluded=new Set([...own.map(f=>f.name),...allForward.map(f=>f.name)]),seen=new Set(),dependencies=[];
 const visit=name=>{if(seen.has(name)||excluded.has(name))return;seen.add(name);const f=currentBody(name);assert(f||name===catalogName,'missing exact dependency '+name);
  const body=name===catalogName?captures.catalog190.newBody:f.body;
  if(name!==catalogName)dependencies.push({...meta(f),isRpc:servicePrivileges.get(f.signature)?.allowed===true});
  for(const m of body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g))visit(m[1]);};for(const name of roots)visit(name);
 assert.equal(dependencies.length,159);
 assert.deepEqual(administrativeForwardBodies.map(f=>f.name).sort(),['faolla_attendance_pd_shift_v1','faolla_attendance_period_session_v1','faolla_attendance_shift_check_v1']);
 const templates=exceptionTemplates(migrations,previous),triggerManifest=[...previous.triggerManifest];
 const add=(table,name,type,fn,deferred=false)=>triggerManifest.push({table,name,type,fn,deferred});
 for(const table of templates.extraTables){
  const prefix=table.startsWith('merchant_attendance_plan_exception_')?'attendance_plan_exception':table==='merchant_attendance_schedule_publication_evidence'?'attendance_schedule_publication':table.replace('merchant_','');
  add(table,prefix+'_immutable',27,'faolla_attendance_events_append_only_v1');add(table,prefix+'_no_truncate',34,'faolla_attendance_events_append_only_v1');
  if(table==='merchant_attendance_schedule_publication_evidence')add(table,prefix+'_insert',7,'faolla_attendance_schedule_publication_guard_v1');
 }
 const generic=previous.tableChecks.slice(0,previous.tableChecks.indexOf(' if (select count(*) from pg_trigger actual'));assert(generic.endsWith('\n'));
 const tableChecks=generic.replace(/foreach table_name in array array\[[\s\S]*?\] loop/,'foreach table_name in array array['+templates.tables.map(quote).join(',')+'] loop')
  .replaceAll('merchant_attendance_delegated_revisions_','merchant_attendance_delegated_plan_exceptions_')+`
 if (select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal)<>(select count(*) from jsonb_array_elements($exceptions209_triggers$${JSON.stringify(triggerManifest)}$exceptions209_triggers$::jsonb) expected where expected->>'table'=table_name) then raise exception 'merchant_attendance_delegated_plan_exceptions_trigger_conflict';end if;
 for trigger_spec in select value from jsonb_array_elements($exceptions209_triggers$${JSON.stringify(triggerManifest)}$exceptions209_triggers$::jsonb) where value->>'table'=table_name loop
  if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=(trigger_spec->>'name')::name and actual.tgtype=(trigger_spec->>'type')::integer
   and actual.tgfoid=to_regprocedure(ns||'.'||(trigger_spec->>'fn')||'()') and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgparentid=0
   and actual.tgdeferrable=(trigger_spec->>'deferred')::boolean and actual.tginitdeferred=(trigger_spec->>'deferred')::boolean) then raise exception 'merchant_attendance_delegated_plan_exceptions_trigger_conflict';end if;
 end loop;
end loop;
if not exists(select 1 from pg_class actual where actual.oid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and actual.relkind='v' and actual.relowner=expected_owner
 and actual.reloptions is null and not actual.relrowsecurity and not actual.relforcerowsecurity)
 or exists(select 1 from pg_class actual cross join lateral aclexplode(coalesce(actual.relacl,acldefault('r',actual.relowner))) acl
  where actual.oid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
 or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
 or pg_get_viewdef(to_regclass(ns||'.merchant_attendance_effect_current_v2'),true) is distinct from pg_get_viewdef('pg_temp.revisions208_current_template'::regclass,true)
 then raise exception 'merchant_attendance_delegated_plan_exceptions_view_conflict';end if;`;
 const declarations='declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;forward_spec jsonb;own_spec jsonb;f regprocedure;meta record;actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec jsonb;reference_keys smallint[];';
 const common=`select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_plan_exceptions_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610090209 and name='merchant_attendance_delegated_plan_exceptions');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');`;
 const fm=(f,post)=>({...meta(f),hash:post?f.newHash:f.oldHash});
 const deps=post=>`own_spec:=$exceptions209_dependencies$${JSON.stringify(dependencies)}$exceptions209_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array(case when has190 then $exceptions209_catalog190$${JSON.stringify({...fm(captures.catalog190,true),isRpc:false})}$exceptions209_catalog190$::jsonb else $exceptions209_catalog185$${JSON.stringify({...fm(captures.catalog185,true),isRpc:false})}$exceptions209_catalog185$::jsonb end);
 own_spec:=own_spec||$exceptions209_forwards$${JSON.stringify(allForward.map(f=>({...fm(f,false),oldHash:f.oldHash,newHash:f.newHash})))}$exceptions209_forwards$::jsonb;
 for forward_spec in select value from jsonb_array_elements(own_spec) loop
  if forward_spec ? 'newHash' then forward_spec:=forward_spec||jsonb_build_object('hash',forward_spec->>(case when ${post?'true':'installed'} then 'newHash' else 'oldHash' end));end if;
  own_spec:=jsonb_build_array(forward_spec);${checks}
 end loop;`;
 const preflight=`do $exceptions209_prerequisites$ begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080208 and name='merchant_attendance_delegated_revisions')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610050136 and name='merchant_attendance_schedule_publication_evidence')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610060174 and name='merchant_attendance_plan_posthoc_reviews')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080184 and name='merchant_attendance_period_delegated_source') then raise exception 'merchant_attendance_delegated_plan_exceptions_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610090209 and name<>'merchant_attendance_delegated_plan_exceptions') then raise exception 'merchant_attendance_delegated_plan_exceptions_installation_conflict';end if;
 end;$exceptions209_prerequisites$;
 ${templates.sql}
 create temp table exceptions209_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression from pg_proc proc where proc.oid in(${allForward.map(f=>quote(f.signature)+'::regprocedure').join(',')});
 do $exceptions209_preflight$ ${declarations} begin ${common}${deps(false)}${tableChecks}
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and proc.proname=any(array[${own.map(f=>quote(f.name)).join(',')}]))<>(case when installed then ${own.length} else 0 end) then raise exception 'merchant_attendance_delegated_plan_exceptions_installation_conflict';end if;
 if installed then own_spec:=$exceptions209_own$${JSON.stringify(own)}$exceptions209_own$::jsonb;${checks}end if;
 end;$exceptions209_preflight$;`;
 const forwardSql=allForward.map((f,i)=>`do $exceptions209_forward_${i}$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610090209 and name='merchant_attendance_delegated_plan_exceptions') then return;end if;
 select replace(proc.prosrc,E'\\r\\n',E'\\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='${f.signature}'::regprocedure;
 if old_body is distinct from $exceptions209_old_${i}$${f.oldBody}$exceptions209_old_${i}$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_plan_exceptions_forward_drift';end if;
 execute replace(definition,old_body,$exceptions209_new_${i}$${f.newBody}$exceptions209_new_${i}$);
 end;$exceptions209_forward_${i}$;`).join('\n');
 const final=own.map(f=>`revoke all on function ${f.signature} from public,anon,authenticated,service_role;${f.isRpc?'\ngrant execute on function '+f.signature+' to service_role;':''}`).join('\n')+`
 do $exceptions209_postconditions$ ${declarations} begin ${common}${deps(true)}own_spec:=$exceptions209_post_own$${JSON.stringify(own)}$exceptions209_post_own$::jsonb;${checks}${tableChecks}
 if (select count(*) from exceptions209_forward_metadata)<>3 or exists(select 1 from exceptions209_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata or pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression) then raise exception 'merchant_attendance_delegated_plan_exceptions_forward_metadata_changed';end if;
 end;$exceptions209_postconditions$;
 drop view pg_temp.revisions208_current_template;
 drop table pg_temp.exceptions209_forward_metadata,${[...templates.extraTables].reverse().map(t=>'pg_temp.'+t).join(',')},pg_temp.merchant_attendance_correction_controls,pg_temp.merchant_attendance_correction_decisions,pg_temp.merchant_attendance_correction_effects,${[...previous.templates.tables].reverse().map(t=>'pg_temp.'+t).join(',')},pg_temp.merchant_attendance_events,pg_temp.merchant_enterprise_employees,pg_temp.merchant_attendance_workers,pg_temp.merchant_attendance_locations,pg_temp.merchant_attendance_settings;`;
 const dependencySpecs=[...dependencies,{...fm(captures.catalog190,true),legacyHash:captures.catalog185.newHash,isRpc:false},...allForward.map(f=>fm(f,false))];
 assert.equal(dependencySpecs.length,163);
 assert.equal(new Set(dependencySpecs.map(f=>f.signature)).size,dependencySpecs.length);
 return {forward,own,dependencies,dependencySpecs,administrativeForwardBodies,templates,triggerManifest,preflight,forwardSql,final,tableChecks};
}
export function delegatedPlanExceptionsFreezeSql(sql,migrations){
 let text=sql.replaceAll('\r\n','\n');const forward=delegatedPlanExceptionsForwardRecipes(migrations);
 const cores=forward.cores.map(f=>`create or replace function public.${f.coreName}(${f.coreArgs})\nreturns jsonb language plpgsql set search_path=pg_catalog as $$${f.core}$$;`).join('\n');
 const replace=(name,value)=>{const pattern=new RegExp('--BEGIN GENERATED DELEGATED PLAN EXCEPTIONS '+name+'[\\s\\S]*?--END GENERATED DELEGATED PLAN EXCEPTIONS '+name);assert(pattern.test(text));text=text.replace(pattern,()=>`--BEGIN GENERATED DELEGATED PLAN EXCEPTIONS ${name}\n${value}\n--END GENERATED DELEGATED PLAN EXCEPTIONS ${name}`);};
 replace('CORES',cores);const r=delegatedPlanExceptionsInstallRecipe(text,migrations);for(const[name,value]of[['PREFLIGHT',r.preflight],['FORWARD',r.forwardSql],['POSTCONDITIONS',r.final]])replace(name,value);return text;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--write']);const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'supabase-migrations');
 const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedPlanExceptionsMigration).sort().map(name=>({name,text:readFileSync(path.join(dir,name),'utf8')}));
 const file=path.join(dir,delegatedPlanExceptionsMigration),output=delegatedPlanExceptionsFreezeSql(readFileSync(file,'utf8'),migrations);writeFileSync(file,output,'utf8');console.log(JSON.stringify({sourceOnly:true,migration:delegatedPlanExceptionsMigration,sha256:sha(output)}));
}


