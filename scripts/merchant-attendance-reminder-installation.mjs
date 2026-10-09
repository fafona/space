//201 SOURCE-only manifest: no process, network, database or file writes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {independentFunctionManifest,independentSplit,independentPermissionAclConflictSql} from './merchant-attendance-independent-installation.mjs';
import {cycleApply,cycleForwardRecipes,cycleForwardSql} from './merchant-attendance-cycle-forward.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
export const reminderSqlSha='f7e6961da28d6629d83682c7f3a9080b139c079e85d105408d88f8e7fcad3be1';
const own=n=>/^faolla_attendance_reminders?_/.test(n);
const read=(root,n)=>readFileSync(path.join(root,'scripts/supabase-migrations',n),'utf8').replaceAll('\r\n','\n');
export function reminderForwardRecipe(root){
 const old=cycleForwardRecipes(root).find(r=>r.name==='faolla_attendance_operational_consumer_activation_v1');assert(old);
 const changes=[{from:"kind not in('application_window','review_routing','timesheet_cycle')",to:"kind not in('application_window','review_routing','timesheet_cycle','reminders')",count:1},
  {from:"kind in('application_window','review_routing','timesheet_cycle')",to:"kind in('application_window','review_routing','timesheet_cycle','reminders')",count:1}];
 const wrapper=cycleApply(old.wrapper,changes,old.name);return {...old,oldHash:old.newHash,newHash:sha(wrapper),changes,wrapper};
}
export function reminderTableManifest(sql){
 return [...sql.matchAll(/create table if not exists public\.(merchant_attendance_reminder_\w+)\(([\s\S]*?)\n\);/g)].map(m=>{
  const columns=[],constraints=[];
  for(const clause of independentSplit(m[2])){
   if(clause.startsWith('constraint ')){const [,name,definition]=clause.match(/^constraint (\w+) ([\s\S]+)$/);assert(name.length<=63);
    if(definition.startsWith('check(')){constraints.push({name,kind:'c',expression:definition.slice(6,-1)});continue;}
    const c=definition.match(/^(primary key|unique|foreign key)\(([^)]+)\)(?: references public\.(\w+)\(([^)]+)\))?([\s\S]*)$/);assert(c,clause);assert(!c[5].trim());
    constraints.push({name,kind:c[1]==='primary key'?'p':c[1]==='unique'?'u':'f',keys:c[2].split(','),reference:c[3]??null,referenceKeys:c[4]?.split(',')??null});
   }else{const [,name,type,rest]=clause.match(/^(\w+) (\w+)([\s\S]*)$/);assert(!/\b(?:default|references|primary key|unique|check)\b/.test(rest));columns.push({name,type,nullable:!/\bnot null\b/.test(rest)});}
  }return {name:m[1],columns,constraints};
 });
}
function defaults(sql,f){
 const args=sql.match(new RegExp(`create(?: or replace)? function public\\.${f.name}\\s*\\(([\\s\\S]*?)\\)\\s*returns`,'i'))?.[1];assert.notEqual(args,undefined,f.name);
 const d=independentSplit(args).filter(a=>/\bdefault\b/i.test(a)).map(a=>{const v=a.match(/\bdefault\s+(.+)$/i)[1];return /^null$/i.test(v)?'NULL::'+a.split(/\s+/)[1]:v;});
 assert.equal(d.length,f.defaults);return d.length?d.join(', '):null;
}
function meta(sql,f){const {body,...value}=f;assert(body);return {...value,defaultExpression:defaults(sql,f),serviceExecute:false};}
export function reminderInstallationManifest(root,sql){
 const functions=independentFunctionManifest(sql).filter(f=>own(f.name)).map(f=>({...meta(sql,f),serviceExecute:['faolla_attendance_reminders_v1','faolla_attendance_reminders_run_v1'].includes(f.name)}));
 const tables=reminderTableManifest(sql);assert.equal(tables.length,5);assert.equal(functions.length,20);
 const history=new Map();
 for(const file of readdirSync(path.join(root,'scripts/supabase-migrations')).filter(n=>/^\d+_/.test(n)&&n<'202610080201').sort()){
  const text=read(root,file);for(const f of independentFunctionManifest(text))history.set(f.name,{...meta(text,f),body:f.body,source:file,
   serviceExecute:new RegExp(`grant execute on function public\\.${f.name}\\([\\s\\S]*?\\) to service_role;`).test(text)});
 }
 const recipe=reminderForwardRecipe(root),activation=history.get(recipe.name);assert(activation);
 const forward=[{...activation,body:undefined,...recipe,hash:undefined,serviceExecute:true}];
 const names=new Set(independentFunctionManifest(sql).filter(f=>own(f.name)).flatMap(f=>[...f.body.matchAll(/public\.(faolla_\w+)\s*\(/g)].map(m=>m[1])).filter(n=>!own(n)&&n!==recipe.name));
 const dependencies=[...names].sort().map(n=>{const f=history.get(n);assert(f,'reminder_dependency_required:'+n);const {body,...value}=f;assert(body);return value;});
 const permission=dependencies.find(f=>f.name==='faolla_valid_merchant_enterprise_permissions_v1');assert(permission);assert.equal(permission.source,'202610080190_merchant_attendance_correction_delegation_permission.sql');
 permission.legacyHash=independentFunctionManifest(read(root,'202610080185_merchant_attendance_period_delegations.sql')).find(f=>f.name===permission.name).hash;
 //195 is an exact recipe forward rather than a textual CREATE FUNCTION.
 const administrative=JSON.parse(read(root,'202610080195_merchant_attendance_administrative_closure.sql').match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/)[1]);
 for(const f of dependencies){const r=administrative.find(r=>r.name===f.name);if(r){assert.equal(f.hash,r.oldHash,f.name);f.hash=r.newHash;f.serviceExecute=r.serviceExecute;}}
 const indexes=[...sql.matchAll(/^create (unique )?index if not exists (\w+) on public\.(\w+)\(([^)]+)\)(?: where ([^;]+))?;/gm)].map(m=>({name:m[2],table:m[3],keys:m[4].split(','),unique:!!m[1],predicate:m[5]??null}));assert.equal(indexes.length,7);
 // A source request is inserted before its complete submit ledger. Validate
 // responsibility capture only at the transaction boundary, like cycle facts;
 // never weaken the original complete-source/entry proof to read a half-write.
 const captures=[{table:'merchant_attendance_operational_punch_sessions',type:5,deferred:false},{table:'merchant_attendance_review_responsibility_heads',type:21,deferred:true},{table:'merchant_attendance_cycle_operations',type:5,deferred:true}];
 return {functions,tables,indexes,forward,dependencies,captures};
}
const json=v=>JSON.stringify(v);
const norm=e=>`(select string_agg((case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\\[\\])?|::name(?![[:alnum:]_\\[])','','g'),'[[:space:]()\\[\\]"]','','g')) end),'' order by z.ord) from regexp_matches(regexp_replace(${e},'''([0-9]+)''::bigint','\\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord))`;
const expression=s=>s.replace(/\b(\w+) in\(([^)]+)\)/g,'$1=any(array[$2])').replace(/interval '1 hour'/g,"'01:00:00'::interval");
const functionCheck=`
  if f.oid is null or f.proowner<>owner_id or f.prosecdef<>(spec->>'securityDefiner')::boolean or f.provolatile::text<>spec->>'volatility'
   or (select lanname from pg_language where oid=f.prolang)<>spec->>'language' or f.prorettype<>to_regtype(replace(spec->>'resultType','public.',ns||'.'))
   or f.proretset or f.proisstrict or f.proleakproof or f.prokind<>'f' or f.proparallel<>'u' or f.provariadic<>0 or f.proargmodes is not null or f.proallargtypes is not null
   or f.pronargs<>jsonb_array_length(spec->'argumentNames') or f.procost<>100 or f.prorows<>0 or f.proconfig is distinct from array(select jsonb_array_elements_text(spec->'config'))
   or f.pronargdefaults<>(spec->>'defaults')::integer or pg_get_expr(f.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames'))
   or encode(sha256(convert_to(replace(replace(f.prosrc,E'\\r\\n',E'\\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected_hash then raise exception 'merchant_attendance_reminder_installation_conflict:function:%',spec->>'name';end if;
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then
   if ${independentPermissionAclConflictSql('f','owner_id')} then raise exception 'merchant_attendance_reminder_installation_conflict:function_acl:%',spec->>'name';end if;
  elsif exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantor<>owner_id or a.privilege_type<>'EXECUTE' or a.is_grantable
    or a.grantee<>owner_id and (not(spec->>'serviceExecute')::boolean or a.grantee<>(select oid from pg_roles where rolname='service_role')))
   or (select count(*) from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))))<>(case when (spec->>'serviceExecute')::boolean then 2 else 1 end)
   or not has_function_privilege(owner_id,f.oid,'EXECUTE') or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
   or has_function_privilege('service_role',f.oid,'EXECUTE') is distinct from (spec->>'serviceExecute')::boolean then raise exception 'merchant_attendance_reminder_installation_conflict:function_acl:%',spec->>'name';end if;`;
export function reminderInstallationGuard(m,tag,post=false){
 const tables=m.tables.map(t=>({...t,constraints:t.constraints.map(c=>c.expression?{...c,expression:expression(c.expression)}:c)}));
 const dependencies=m.dependencies.concat(m.forward.map(({changes,wrapper,file,core,coreHash,...f})=>{assert(changes&&wrapper&&file&&core===null&&coreHash===null);return {...f,hash:post?f.newHash:null};}));
 return `do $${tag}$
declare installed boolean;ns text;owner_id oid;has190 boolean;spec jsonb;col jsonb;c jsonb;ix jsonb;f pg_proc%rowtype;t regclass;con pg_constraint%rowtype;idx pg_index%rowtype;tr pg_trigger%rowtype;expected_hash text;keys text[];refkeys text[];n integer;
begin
 select n.nspname,v.relowner into ns,owner_id from pg_class v join pg_namespace n on n.oid=v.relnamespace where v.oid='public.merchant_attendance_settings'::regclass;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080201 and name='merchant_attendance_reminders');
 if exists(select 1 from public.faolla_schema_migrations where version=202610080201 and name<>'merchant_attendance_reminders') ${post?'or not installed':''}
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080193 and name='merchant_attendance_operational_punch')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name='merchant_attendance_review_routing')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080200 and name='merchant_attendance_operational_cycle')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations')
  or exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name<>'merchant_attendance_correction_delegation_permission') then raise exception 'merchant_attendance_reminder_prerequisite_required';end if;
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 for spec in select value from jsonb_array_elements($${tag}_dependencies$${json(dependencies)}$${tag}_dependencies$::jsonb) loop
  select * into f from pg_proc where oid=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));
  expected_hash:=coalesce(spec->>'hash',(case when installed then spec->>'newHash' else spec->>'oldHash' end));
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and not has190 then expected_hash:=spec->>'legacyHash';end if;${functionCheck}
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns) and (proname like 'faolla_attendance_reminder_%' or proname like 'faolla_attendance_reminders_%'))<>(case when installed then ${m.functions.length} else 0 end) then raise exception 'merchant_attendance_reminder_installation_conflict:function_inventory';end if;
 if (select count(*) from pg_class where relnamespace=(select oid from pg_namespace where nspname=ns) and relname like 'merchant_attendance_reminder_%' and relkind not in('i','I'))<>(case when installed then 5 else 0 end) then raise exception 'merchant_attendance_reminder_installation_conflict:relation_inventory';end if;
 for spec in select value from jsonb_array_elements($${tag}_tables$${json(tables)}$${tag}_tables$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'name'));if installed<>(t is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:table:%',spec->>'name';end if;if not installed then continue;end if;
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=owner_id and relrowsecurity and not relforcerowsecurity and relpersistence='p' and not relispartition)
   or exists(select 1 from pg_policy where polrelid=t) or exists(select 1 from pg_class z cross join lateral aclexplode(coalesce(z.relacl,acldefault('r',z.relowner))) a where z.oid=t and (a.grantor<>owner_id or a.grantee<>owner_id))
   or exists(select 1 from pg_attribute z cross join lateral aclexplode(z.attacl) a where z.attrelid=t and (a.grantor<>owner_id or a.grantee<>owner_id)) then raise exception 'merchant_attendance_reminder_installation_conflict:table_acl:%',spec->>'name';end if;
  if (select count(*) from pg_attribute where attrelid=t and attnum>0)<>jsonb_array_length(spec->'columns') then raise exception 'merchant_attendance_reminder_installation_conflict:columns:%',spec->>'name';end if;n:=0;
  for col in select value from jsonb_array_elements(spec->'columns') loop n:=n+1;
   if not exists(select 1 from pg_attribute a join pg_type y on y.oid=a.atttypid where a.attrelid=t and a.attnum=n and a.attname=col->>'name' and a.atttypid=to_regtype(col->>'type') and a.atttypmod=-1 and not a.attisdropped and a.attnotnull=(not(col->>'nullable')::boolean) and not a.atthasdef and a.attidentity='' and a.attgenerated='' and a.attndims=0 and a.attcollation=y.typcollation) then raise exception 'merchant_attendance_reminder_installation_conflict:column:%.%',spec->>'name',col->>'name';end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid=t and contype<>'t')<>jsonb_array_length(spec->'constraints') then raise exception 'merchant_attendance_reminder_installation_conflict:constraints:%',spec->>'name';end if;
  for c in select value from jsonb_array_elements(spec->'constraints') loop
   select * into con from pg_constraint where conrelid=t and conname=c->>'name';
   if coalesce(c->>'kind','') not in('c','p','u','f') or con.oid is null or con.contype::text<>c->>'kind' or not con.convalidated or con.connoinherit is distinct from ((c->>'kind') in('p','u','f')) or not con.conislocal or con.coninhcount<>0 or con.condeferrable or con.condeferred then raise exception 'merchant_attendance_reminder_installation_conflict:constraint:%',c->>'name';end if;
   if con.contype='c' then
    if ${norm('pg_get_expr(con.conbin,t)')} is distinct from ${norm("c->>'expression'")} then raise exception 'merchant_attendance_reminder_installation_conflict:check:%',c->>'name';end if;
   else
    select array_agg(a.attname::text order by z.ord) into keys from unnest(con.conkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=t and a.attnum=z.n;
    if keys is distinct from array(select jsonb_array_elements_text(c->'keys')) then raise exception 'merchant_attendance_reminder_installation_conflict:keys:%',c->>'name';end if;
    if con.contype='f' then
     select array_agg(a.attname::text order by z.ord) into refkeys from unnest(con.confkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=z.n;
     if con.confrelid is distinct from to_regclass(format('%I.%I',ns,c->>'reference')) or refkeys is distinct from array(select jsonb_array_elements_text(c->'referenceKeys')) or con.confmatchtype<>'s' or con.confupdtype<>'a' or con.confdeltype<>'a' then raise exception 'merchant_attendance_reminder_installation_conflict:foreign_key:%',c->>'name';end if;
    else
     select * into idx from pg_index where indexrelid=con.conindid;
     if idx.indexrelid is null or not(idx.indisvalid and idx.indisready and idx.indislive and idx.indisunique) or idx.indpred is not null or idx.indexprs is not null or idx.indnullsnotdistinct or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys) or idx.indisprimary<>(con.contype='p')
      or not exists(select 1 from pg_class v join pg_am a on a.oid=v.relam where v.oid=idx.indexrelid and v.relowner=owner_id and a.amname='btree')
      or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=t and a.attname=keys[z] join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indkey[z-1]<>a.attnum or idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_reminder_installation_conflict:constraint_index:%',c->>'name';end if;
    end if;
   end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3 then raise exception 'merchant_attendance_reminder_installation_conflict:trigger_inventory:%',spec->>'name';end if;
  for tr in select * from pg_trigger where tgrelid=t and not tgisinternal loop
   if tr.tgname not in('reminder_immutable','reminder_no_truncate','reminder_proof') or tr.tgenabled<>'O' or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgargs<>''::bytea or tr.tgoldtable is not null or tr.tgnewtable is not null
    or tr.tgfoid is distinct from to_regprocedure(format('%I.%I()',ns,(case when tr.tgname='reminder_proof' then 'faolla_attendance_reminder_deferred_v1' else 'faolla_attendance_reminder_guard_v1' end)))
    or tr.tgtype<>(case when tr.tgname='reminder_no_truncate' then 34 when tr.tgname='reminder_immutable' then 31 when spec->>'name'='merchant_attendance_reminder_heads' then 21 else 5 end)
    or tr.tgdeferrable<>(tr.tgname='reminder_proof') or tr.tginitdeferred<>(tr.tgname='reminder_proof') or (tr.tgconstraint<>0)<>(tr.tgname='reminder_proof') then raise exception 'merchant_attendance_reminder_installation_conflict:trigger:%',tr.tgname;end if;
  end loop;
  if (select count(*) from pg_index where indrelid=t)<>(select count(*) from jsonb_array_elements(spec->'constraints') constraint_item where constraint_item->>'kind' in('p','u'))+(select count(*) from jsonb_array_elements($${tag}_indexes$${json(m.indexes)}$${tag}_indexes$::jsonb) index_item where index_item->>'table'=spec->>'name') then raise exception 'merchant_attendance_reminder_installation_conflict:index_inventory:%',spec->>'name';end if;
 end loop;
 for ix in select value from jsonb_array_elements($${tag}_indexes$${json(m.indexes)}$${tag}_indexes$::jsonb) loop
  select * into idx from pg_index where indexrelid=to_regclass(format('%I.%I',ns,ix->>'name'));if installed<>(idx.indexrelid is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:index:%',ix->>'name';end if;if not installed then continue;end if;
  t:=to_regclass(format('%I.%I',ns,ix->>'table'));keys:=array(select jsonb_array_elements_text(ix->'keys'));
  if idx.indrelid<>t or not(idx.indisvalid and idx.indisready and idx.indislive) or idx.indisunique<>(ix->>'unique')::boolean or idx.indisprimary or idx.indisexclusion or idx.indnullsnotdistinct or idx.indexprs is not null or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys)
   or ${norm('pg_get_expr(idx.indpred,t)')} is distinct from ${norm("ix->>'predicate'")}
   or not exists(select 1 from pg_class v join pg_am a on a.oid=v.relam where v.oid=idx.indexrelid and v.relowner=owner_id and a.amname='btree')
   or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=t and a.attname=keys[z] join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indkey[z-1]<>a.attnum or idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_reminder_installation_conflict:index:%',ix->>'name';end if;
 end loop;
 if installed then
  for spec in select value from jsonb_array_elements($${tag}_functions$${json(m.functions)}$${tag}_functions$::jsonb) loop
   select * into f from pg_proc where oid=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));expected_hash:=spec->>'hash';${functionCheck}
  end loop;
 end if;
 for spec in select value from jsonb_array_elements($${tag}_captures$${json(m.captures)}$${tag}_captures$::jsonb) loop
  select * into tr from pg_trigger where tgrelid=to_regclass(format('%I.%I',ns,spec->>'table')) and tgname='reminder_capture';
  if installed<>(tr.oid is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:capture:%',spec->>'table';end if;
  if installed and (tr.tgfoid is distinct from to_regprocedure(format('%I.faolla_attendance_reminder_capture_v1()',ns)) or tr.tgtype<>(spec->>'type')::integer or tr.tgenabled<>'O' or tr.tgdeferrable<>(spec->>'deferred')::boolean or tr.tginitdeferred<>(spec->>'deferred')::boolean or (tr.tgconstraint<>0)<>(spec->>'deferred')::boolean or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgargs<>''::bytea or tr.tgoldtable is not null or tr.tgnewtable is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:capture:%',spec->>'table';end if;
 end loop;
end;
$${tag}$;`;
}
export function reminderFinalizeSql(m){return `do $reminder_finalize$
declare ns text;owner_id oid;spec jsonb;t regclass;f regprocedure;
begin
 select n.nspname,v.relowner into ns,owner_id from pg_class v join pg_namespace n on n.oid=v.relnamespace where v.oid='public.merchant_attendance_settings'::regclass;
 for spec in select value from jsonb_array_elements($reminder_finalize_functions$${json(m.functions)}$reminder_finalize_functions$::jsonb) loop
  f:=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));execute format('alter function %s owner to %I',f,pg_get_userbyid(owner_id));execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  if (spec->>'serviceExecute')::boolean then execute format('grant execute on function %s to service_role',f);end if;
 end loop;
 for spec in select value from jsonb_array_elements($reminder_finalize_tables$${json(m.tables.map(t=>({name:t.name})))}$reminder_finalize_tables$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'name'));execute format('alter table %s owner to %I',t,pg_get_userbyid(owner_id));execute format('alter table %s enable row level security',t);execute format('revoke all on table %s from public,anon,authenticated,service_role',t);
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='reminder_immutable') then
   execute format('create trigger reminder_immutable before insert or update or delete on %s for each row execute function %I.faolla_attendance_reminder_guard_v1()',t,ns);
   execute format('create trigger reminder_no_truncate before truncate on %s for each statement execute function %I.faolla_attendance_reminder_guard_v1()',t,ns);
   execute format('create constraint trigger reminder_proof after insert %s on %s deferrable initially deferred for each row execute function %I.faolla_attendance_reminder_deferred_v1()',case when spec->>'name'='merchant_attendance_reminder_heads' then 'or update' else '' end,t,ns);
  end if;
 end loop;
 for spec in select value from jsonb_array_elements($reminder_finalize_captures$${json(m.captures)}$reminder_finalize_captures$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'table'));
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='reminder_capture') then
   execute format('create %s trigger reminder_capture after insert %s on %s %s for each row execute function %I.faolla_attendance_reminder_capture_v1()',case when (spec->>'deferred')::boolean then 'constraint' else '' end,case when (spec->>'type')::integer=21 then 'or update' else '' end,t,case when (spec->>'deferred')::boolean then 'deferrable initially deferred' else '' end,ns);
  end if;
 end loop;
end;
$reminder_finalize$;
insert into public.faolla_schema_migrations(version,name) values(202610080201,'merchant_attendance_reminders') on conflict(version) do nothing;`;}
export function reminderRenderSections(root,sql){
 const m=reminderInstallationManifest(root,sql);
 return {preflight:reminderInstallationGuard(m,'reminder_preflight'),forward:cycleForwardSql(m.forward).replaceAll('cycle_forward','reminder_forward').replaceAll('cycle_recipes','reminder_recipes').replaceAll('merchant_attendance_cycle_installation_conflict','merchant_attendance_reminder_installation_conflict'),
  finalize:reminderFinalizeSql(m)+'\n'+reminderInstallationGuard(m,'reminder_postconditions',true)};
}
