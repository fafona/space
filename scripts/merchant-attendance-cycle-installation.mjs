//200 finite SOURCE manifest. Does not start PostgreSQL, execute RPCs or write files.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {cycleApply,cycleForwardRecipes} from './merchant-attendance-cycle-forward.mjs';
import {independentFunctionManifest,independentSplit} from './merchant-attendance-independent-installation.mjs';
const read=(root,name)=>readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8').replaceAll('\r\n','\n');
const ownName=n=>n.startsWith('faolla_attendance_cycle_')||n.startsWith('faolla_attendance_operational_cycle_');
export function cycleTableManifest(sql){
 return [...sql.matchAll(/create table if not exists public\.(merchant_attendance_(?:cycle_\w+|period_cycle_adoptions))\(([\s\S]*?)\n\);/g)].map(m=>{
  const columns=[],constraints=[];
  for(const c of independentSplit(m[2])){
   if(c.startsWith('constraint ')){const [,name,definition]=c.match(/^constraint (\w+) ([\s\S]+)$/);assert(name.length<=63);
    if(definition.startsWith('check(')){constraints.push({name,kind:'c',expression:definition.slice(6,-1)});continue;}
    const v=definition.match(/^(primary key|unique|foreign key)\(([^)]+)\)(?: references public\.(\w+)\(([^)]+)\))?([\s\S]*)$/);assert(v,c);
    constraints.push({name,kind:v[1]==='primary key'?'p':v[1]==='unique'?'u':'f',keys:v[2].split(','),reference:v[3]??null,referenceKeys:v[4]?.split(',')??null,deferred:/deferrable/.test(v[5]),initiallyDeferred:/initially deferred/.test(v[5])});
   }else {const [,name,type,rest]=c.match(/^(\w+) (\w+)([\s\S]*)$/);assert(!/\b(?:default|references|unique|primary key|check)\b/.test(rest));columns.push({name,type,nullable:!/\bnot null\b/.test(rest)});}
  }
  return {name:m[1],columns,constraints};
 });
}
function metadata(f){const {body,...m}=f;assert(body);
 const defaults=f.defaults===0?null:f.name==='faolla_attendance_period_delegation_guard_v1'?'NULL::uuid, false':f.name==='faolla_attendance_period_delegated_source_v1'?'NULL::uuid'
  :f.defaults===3?'NULL::jsonb, NULL::jsonb, false':f.defaults===2?'NULL::jsonb, false':f.defaults===1?'false':assert.fail('cycle exact defaults:'+f.name);
 return {...m,defaultExpression:defaults,serviceExecute:false};}
export function cycleInstallationManifest(root,sql){
 const functions=independentFunctionManifest(sql).filter(f=>ownName(f.name)).map(f=>({...metadata(f),serviceExecute:f.name.startsWith('faolla_attendance_operational_cycle_')}));
 const tables=cycleTableManifest(sql);assert.equal(tables.length,4);assert.equal(functions.length,18);
 const history=new Map(),dir=path.join(root,'scripts/supabase-migrations');
 for(const file of readdirSync(dir).filter(n=>/^\d+_/.test(n)&&n<'202610080200').sort()){
  const text=read(root,file);for(const f of independentFunctionManifest(text))history.set(f.name,{...f,serviceExecute:new RegExp(`grant execute on function public\\.${f.name}\\([\\s\\S]*?\\) to service_role;`).test(text),source:file});
 }
 const forward=cycleForwardRecipes(root).map(r=>{
  const f=history.get(r.name);assert(f);return {...r,...metadata(f),hash:undefined,serviceExecute:f.serviceExecute,oldHash:r.oldHash,newHash:r.newHash};
 });
 for(const r of forward.filter(r=>r.core))functions.push({name:r.core,types:r.types+',jsonb',argumentNames:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write','p_intent'],defaults:0,defaultExpression:null,resultType:'jsonb',volatility:'v',language:'plpgsql',securityDefiner:false,config:['search_path=pg_catalog'],serviceExecute:false,hash:r.coreHash});
 const excluded=new Set([...functions,...forward].map(f=>f.name));
 const names=new Set(independentFunctionManifest(sql).filter(f=>ownName(f.name)).flatMap(f=>[...f.body.matchAll(/public\.(faolla_\w+)\s*\(/g)].map(m=>m[1])).filter(n=>!excluded.has(n)));
 for(const n of ['faolla_attendance_disposal_artifact_refs_v1','faolla_attendance_disposal_artifact_capture_v1','faolla_attendance_period_closure_source_v1','faolla_attendance_period_delegated_source_v1'])if(!excluded.has(n))names.add(n);
 const administrative=JSON.parse(read(root,'202610080195_merchant_attendance_administrative_closure.sql').match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/)[1]);
 const dependencies=[...names].sort().map(n=>{
  const f=history.get(n);assert(f,'cycle_dependency_source_required:'+n);const r=administrative.find(r=>r.name===n);
  if(r){assert.equal(f.hash,r.oldHash,n+':195 predecessor');const body=cycleApply(f.body,r.changes,n);const changed=independentFunctionManifest(`create function public.${n}() returns jsonb language plpgsql as $$${body}$$;`)[0];assert.equal(changed.hash,r.newHash);return {...metadata(f),hash:r.newHash,serviceExecute:r.serviceExecute};}
  return {...metadata(f),serviceExecute:f.serviceExecute};
 });
 const indexes=[...sql.matchAll(/^create index if not exists (\w+) on public\.(\w+)\(([^)]+)\)(?: where ([^;]+))?;/gm)].map(m=>({name:m[1],table:m[2],keys:m[3].split(','),predicate:m[4]??null}));assert.equal(indexes.length,2);
 return {functions,tables,indexes,forward,dependencies};
}
const expression=s=>s.replace(/date ('[^']+')/g,'$1::date').replace(/([a-z_]+(?:-[a-z_]+)?) between ([a-z_0-9]+) and ([a-z_0-9]+)/g,'$1>=$2 and $1<=$3');
const norm=e=>`(select string_agg((case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\\[\\])?|::name(?![[:alnum:]_\\[])','','g'),'[[:space:]()\\[\\]"]','','g')) end),'' order by z.ord) from regexp_matches(regexp_replace(${e},'''([0-9]+)''::bigint','\\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord))`;
const compact=v=>JSON.stringify(v);
export function cycleInstallationGuard(manifest,tag,post=false){
 const tables=manifest.tables.map(t=>({...t,constraints:t.constraints.map(c=>c.expression?{...c,expression:expression(c.expression)}:c)}));
 const forwards=manifest.forward.map(({changes,wrapper,file,core,coreHash,...f})=>{assert(changes&&wrapper&&file);assert.equal(core===null,coreHash===null);return {...f,hash:post?f.newHash:null};});
 const functions=manifest.functions,dependencies=[...manifest.dependencies,...forwards];
 const functionCheck=`
  if f.oid is null or f.proowner<>owner_id or f.prosecdef<>(spec->>'securityDefiner')::boolean or f.provolatile::text<>spec->>'volatility'
   or (select lanname from pg_language where oid=f.prolang)<>spec->>'language' or f.prorettype<>to_regtype(replace(spec->>'resultType','public.',ns||'.'))
   or f.proretset or f.proisstrict or f.proleakproof or f.prokind<>'f' or f.proparallel<>'u' or f.provariadic<>0 or f.proargmodes is not null or f.proallargtypes is not null
   or f.pronargs<>jsonb_array_length(spec->'argumentNames') or f.procost<>100 or f.prorows<>0
   or f.proconfig is distinct from array(select jsonb_array_elements_text(spec->'config')) or f.pronargdefaults<>(spec->>'defaults')::integer
   or pg_get_expr(f.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames'))
   or encode(sha256(convert_to(replace(replace(f.prosrc,E'\\r\\n',E'\\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected_hash
   or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantor<>owner_id or a.privilege_type<>'EXECUTE' or a.is_grantable
    or a.grantee<>owner_id and (not(spec->>'serviceExecute')::boolean or a.grantee<>(select oid from pg_roles where rolname='service_role')))
   or (select count(*) from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))))<>(case when (spec->>'serviceExecute')::boolean then 2 else 1 end)
   or not has_function_privilege(owner_id,f.oid,'EXECUTE') or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
   or has_function_privilege('service_role',f.oid,'EXECUTE') is distinct from (spec->>'serviceExecute')::boolean then raise exception 'merchant_attendance_cycle_installation_conflict:function:%',spec->>'name';end if;`;
 return `do $${tag}$
declare installed boolean;ns text;owner_id oid;spec jsonb;col jsonb;c jsonb;ix jsonb;f pg_proc%rowtype;t regclass;con pg_constraint%rowtype;idx pg_index%rowtype;tr pg_trigger%rowtype;
 expected_hash text;keys text[];refkeys text[];n integer;count_expected integer;
begin
 select n.nspname,c.relowner into ns,owner_id from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080200 and name='merchant_attendance_operational_cycle');
 if exists(select 1 from public.faolla_schema_migrations where version=202610080200 and name<>'merchant_attendance_operational_cycle') ${post?'or not installed':''}
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080197 and name='merchant_attendance_retention_disposal')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name='merchant_attendance_review_routing') then raise exception 'merchant_attendance_cycle_prerequisite_required';end if;
 for spec in select value from jsonb_array_elements($${tag}_dependencies$${compact(dependencies)}$${tag}_dependencies$::jsonb) loop
  select * into f from pg_proc where oid=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));
  expected_hash:=coalesce(spec->>'hash',(case when installed then spec->>'newHash' else spec->>'oldHash' end));${functionCheck}
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns) and (proname like 'faolla_attendance_cycle_%' or proname like 'faolla_attendance_operational_cycle_%'))<>(case when installed then ${functions.length} else 0 end) then raise exception 'merchant_attendance_cycle_installation_conflict:function_inventory';end if;
 if (select count(*) from pg_class where relnamespace=(select oid from pg_namespace where nspname=ns) and (relname like 'merchant_attendance_cycle_%' or relname like 'merchant_attendance_period_cycle_adoptions%') and relkind not in('i','I'))<>(case when installed then 4 else 0 end) then raise exception 'merchant_attendance_cycle_installation_conflict:relation_inventory';end if;
 for spec in select value from jsonb_array_elements($${tag}_tables$${compact(tables)}$${tag}_tables$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'name'));
  if installed<>(t is not null) then raise exception 'merchant_attendance_cycle_installation_conflict:table:%',spec->>'name';end if;
  if not installed then continue;end if;
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=owner_id and relrowsecurity and not relforcerowsecurity and relpersistence='p' and not relispartition)
   or exists(select 1 from pg_policy where polrelid=t)
   or exists(select 1 from pg_class z cross join lateral aclexplode(coalesce(z.relacl,acldefault('r',z.relowner))) a where z.oid=t and (a.grantor<>owner_id or a.grantee<>owner_id))
   or exists(select 1 from pg_attribute z cross join lateral aclexplode(z.attacl) a where z.attrelid=t and (a.grantor<>owner_id or a.grantee<>owner_id)) then raise exception 'merchant_attendance_cycle_installation_conflict:table_acl:%',spec->>'name';end if;
  if (select count(*) from pg_attribute where attrelid=t and attnum>0)<>jsonb_array_length(spec->'columns') then raise exception 'merchant_attendance_cycle_installation_conflict:columns:%',spec->>'name';end if;
  n:=0;
  for col in select value from jsonb_array_elements(spec->'columns') loop
   n:=n+1;
   if not exists(select 1 from pg_attribute a join pg_type y on y.oid=a.atttypid where a.attrelid=t and a.attnum=n and a.attname=col->>'name'
    and a.atttypid=to_regtype(col->>'type') and a.atttypmod=-1 and not a.attisdropped and a.attnotnull=(not(col->>'nullable')::boolean)
    and not a.atthasdef and a.attidentity='' and a.attgenerated='' and a.attndims=0 and a.attcollation=y.typcollation) then raise exception 'merchant_attendance_cycle_installation_conflict:column:%.%',spec->>'name',col->>'name';end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid=t and contype<>'t')<>jsonb_array_length(spec->'constraints') then raise exception 'merchant_attendance_cycle_installation_conflict:constraints:%',spec->>'name';end if;
  for c in select value from jsonb_array_elements(spec->'constraints') loop
   select * into con from pg_constraint where conrelid=t and conname=c->>'name';
   if coalesce(c->>'kind','') not in('c','p','u','f') or con.oid is null or con.contype::text<>c->>'kind' or not con.convalidated
    or con.connoinherit is distinct from ((c->>'kind') in('p','u','f')) or not con.conislocal or con.coninhcount<>0
    or con.condeferrable<>coalesce((c->>'deferred')::boolean,false) or con.condeferred<>coalesce((c->>'initiallyDeferred')::boolean,false) then raise exception 'merchant_attendance_cycle_installation_conflict:constraint:%',c->>'name';end if;
   if con.contype='c' then
    if ${norm('pg_get_expr(con.conbin,t)')} is distinct from ${norm("c->>'expression'")} then raise exception 'merchant_attendance_cycle_installation_conflict:check:%',c->>'name';end if;
   else
    select array_agg(a.attname::text order by z.ord) into keys from unnest(con.conkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=t and a.attnum=z.n;
    if keys is distinct from array(select jsonb_array_elements_text(c->'keys')) then raise exception 'merchant_attendance_cycle_installation_conflict:keys:%',c->>'name';end if;
    if con.contype='f' then
     select array_agg(a.attname::text order by z.ord) into refkeys from unnest(con.confkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=z.n;
     if con.confrelid is distinct from to_regclass(format('%I.%I',ns,c->>'reference')) or refkeys is distinct from array(select jsonb_array_elements_text(c->'referenceKeys'))
      or con.confmatchtype<>'s' or con.confupdtype<>'a' or con.confdeltype<>'a' then raise exception 'merchant_attendance_cycle_installation_conflict:foreign_key:%',c->>'name';end if;
    else
     select * into idx from pg_index where indexrelid=con.conindid;
     if idx.indexrelid is null or not(idx.indisvalid and idx.indisready and idx.indislive and idx.indisunique) or idx.indpred is not null or idx.indexprs is not null or idx.indnullsnotdistinct
      or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys) or idx.indisprimary<>(con.contype='p')
      or not exists(select 1 from pg_class v join pg_am a on a.oid=v.relam where v.oid=idx.indexrelid and v.relowner=owner_id and a.amname='btree')
      or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=t and a.attname=keys[z]
       join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indkey[z-1]<>a.attnum or idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_cycle_installation_conflict:constraint_index:%',c->>'name';end if;
    end if;
   end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3 then raise exception 'merchant_attendance_cycle_installation_conflict:trigger_inventory:%',spec->>'name';end if;
  for tr in select * from pg_trigger where tgrelid=t and not tgisinternal loop
   if tr.tgname not in('cycle_immutable','cycle_no_truncate','cycle_proof') or tr.tgenabled<>'O' or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgargs<>''::bytea or tr.tgoldtable is not null or tr.tgnewtable is not null
    or tr.tgfoid is distinct from to_regprocedure(format('%I.%I()',ns,(case when tr.tgname='cycle_proof' then 'faolla_attendance_cycle_deferred_v1' else 'faolla_attendance_cycle_guard_v1' end)))
    or tr.tgtype<>(case when tr.tgname='cycle_no_truncate' then 34 when tr.tgname='cycle_immutable' then 31 when spec->>'name'='merchant_attendance_cycle_frame_heads' then 21 else 5 end)
    or tr.tgdeferrable<>(tr.tgname='cycle_proof') or tr.tginitdeferred<>(tr.tgname='cycle_proof') or (tr.tgconstraint<>0)<>(tr.tgname='cycle_proof') then raise exception 'merchant_attendance_cycle_installation_conflict:trigger:%',tr.tgname;end if;
  end loop;
  if (select count(*) from pg_index where indrelid=t)<>(select count(*) from jsonb_array_elements(spec->'constraints') constraint_item where constraint_item->>'kind' in('p','u'))+(case when spec->>'name' in('merchant_attendance_cycle_frame_heads','merchant_attendance_cycle_intents') then 1 else 0 end) then raise exception 'merchant_attendance_cycle_installation_conflict:index_inventory:%',spec->>'name';end if;
 end loop;
 if installed then
  for spec in select value from jsonb_array_elements($${tag}_functions$${compact(functions)}$${tag}_functions$::jsonb) loop
   select * into f from pg_proc where oid=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));expected_hash:=spec->>'hash';${functionCheck}
  end loop;
  for ix in select value from jsonb_array_elements($${tag}_indexes$${compact(manifest.indexes)}$${tag}_indexes$::jsonb) loop
   t:=to_regclass(format('%I.%I',ns,ix->>'table'));select * into idx from pg_index where indexrelid=to_regclass(format('%I.%I',ns,ix->>'name'));
   keys:=array(select jsonb_array_elements_text(ix->'keys'));
   if idx.indexrelid is null or idx.indrelid<>t or not(idx.indisvalid and idx.indisready and idx.indislive) or idx.indisunique or idx.indisprimary or idx.indisexclusion or idx.indnullsnotdistinct
    or idx.indexprs is not null or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys) or ${norm('pg_get_expr(idx.indpred,t)')} is distinct from ${norm("ix->>'predicate'")}
    or not exists(select 1 from pg_class v join pg_am a on a.oid=v.relam where v.oid=idx.indexrelid and v.relowner=owner_id and a.amname='btree')
    or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=t and a.attname=keys[z]
     join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indkey[z-1]<>a.attnum or idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_cycle_installation_conflict:index:%',ix->>'name';end if;
  end loop;
 end if;
 select * into tr from pg_trigger where tgrelid='public.merchant_attendance_period_artifacts'::regclass and tgname='disposal_artifact_capture';
 if tr.oid is null or tr.tgfoid<>'public.faolla_attendance_disposal_artifact_capture_v1()'::regprocedure or tr.tgtype<>5 or tr.tgenabled<>'O' or not tr.tgdeferrable or not tr.tginitdeferred or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgargs<>''::bytea then raise exception 'merchant_attendance_cycle_installation_conflict:197_capture';end if;
end;
$${tag}$;`;
}
export function cycleFinalizeSql(manifest){return `do $cycle_finalize$
declare ns text;owner_id oid;spec jsonb;t regclass;f regprocedure;
begin
 select n.nspname,c.relowner into ns,owner_id from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 for spec in select value from jsonb_array_elements($cycle_finalize_functions$${compact(manifest.functions)}$cycle_finalize_functions$::jsonb) loop
  f:=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));
  execute format('alter function %s owner to %I',f,pg_get_userbyid(owner_id));execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  if (spec->>'serviceExecute')::boolean then execute format('grant execute on function %s to service_role',f);end if;
 end loop;
 for spec in select value from jsonb_array_elements($cycle_finalize_tables$${compact(manifest.tables.map(t=>({name:t.name})))}$cycle_finalize_tables$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'name'));execute format('alter table %s owner to %I',t,pg_get_userbyid(owner_id));
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='cycle_immutable') then
   execute format('create trigger cycle_immutable before insert or update or delete on %s for each row execute function %I.faolla_attendance_cycle_guard_v1()',t,ns);
   execute format('create trigger cycle_no_truncate before truncate on %s for each statement execute function %I.faolla_attendance_cycle_guard_v1()',t,ns);
   execute format('create constraint trigger cycle_proof after insert %s on %s deferrable initially deferred for each row execute function %I.faolla_attendance_cycle_deferred_v1()',case when spec->>'name'='merchant_attendance_cycle_frame_heads' then 'or update' else '' end,t,ns);
  end if;
 end loop;
end;
$cycle_finalize$;
insert into public.faolla_schema_migrations(version,name) values(202610080200,'merchant_attendance_operational_cycle') on conflict(version) do nothing;`;}

export function cycleRenderSections(root,sql){
 const manifest=cycleInstallationManifest(root,sql);
 return {preflight:cycleInstallationGuard(manifest,'cycle_preflight'),forward:cycleForwardSqlForManifest(manifest),finalize:cycleFinalizeSql(manifest)+'\n'+cycleInstallationGuard(manifest,'cycle_postconditions',true)};
}
// Keep the recipe module as the sole exact substitution implementation.
import {cycleForwardSql as cycleForwardSqlForManifestRecipes} from './merchant-attendance-cycle-forward.mjs';
const cycleForwardSqlForManifest=m=>cycleForwardSqlForManifestRecipes(m.forward.map(({file,name,types,oldHash,core,coreHash,newHash,changes,wrapper})=>({file,name,types,oldHash,core,coreHash,newHash,changes,wrapper})));
