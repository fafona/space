// SOURCE-only finite manifests for migration196. No process, database or network.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {independentWorkerForwardRecipes} from './merchant-attendance-independent-forward.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function independentSplit(source){
 if(!source.trim())return [];
 const result=[];let start=0,depth=0,quoted=false;
 for(let n=0;n<source.length;n++){
  if(source[n]==="'"){if(quoted&&source[n+1]==="'"){n++;continue;}quoted=!quoted;}
  if(quoted)continue;if(source[n]==='(')depth++;if(source[n]===')')depth--;
  if(source[n]===','&&depth===0){result.push(source.slice(start,n).trim());start=n+1;}
 }
 assert.equal(depth,0);assert(!quoted);result.push(source.slice(start).trim());return result;
}
export function independentFunctionManifest(sql){
 return [...sql.replaceAll('\r\n','\n').matchAll(/create(?: or replace)? function public\.(\w+)\s*\(([\s\S]*?)\)\s*returns\s+([^\s]+)\s+([\s\S]*?)\bas\s+\$\$([\s\S]*?)\$\$;/gi)].map(m=>{
  const args=independentSplit(m[2]),header=m[4];
  return {name:m[1],types:args.map(a=>a.split(/\s+/)[1]).join(','),argumentNames:args.map(a=>a.split(/\s+/)[0]),defaults:(m[2].match(/\bdefault\b/gi)||[]).length,
   resultType:m[3],volatility:/\bimmutable\b/i.test(header)?'i':/\bstable\b/i.test(header)?'s':'v',language:header.match(/\blanguage\s+(\w+)/i)?.[1],
   securityDefiner:/\bsecurity definer\b/i.test(header),config:[header.match(/\bset search_path\s*=\s*([^\n]+)/i)?.[1]?.trim()??'pg_catalog'].map(v=>'search_path='+v),
   serviceExecute:['faolla_attendance_independent_admin_v1','faolla_attendance_independent_begin_v1','faolla_attendance_independent_finish_v1','faolla_attendance_terminal_device_v1'].includes(m[1]),hash:sha(m[5]),body:m[5]};
 });
}
export function independentTableManifest(sql){
 return [...sql.matchAll(/create table if not exists public\.(merchant_attendance_independent_\w+)\(([\s\S]*?)\n\);/g)].map(m=>{
  const columns=[],constraints=[];
  for(const clause of independentSplit(m[2])){
   if(clause.startsWith('constraint ')){
    const [,name,definition]=clause.match(/^constraint (\w+) ([\s\S]+)$/);assert(name.length<=63);
    if(definition.startsWith('check(')){constraints.push({name,kind:'c',expression:definition.slice(6,-1)});continue;}
    const match=definition.match(/^(primary key|unique|foreign key)\(([^)]+)\)(?: references public\.(\w+)\(([^)]+)\))?([\s\S]*)$/);assert(match,clause);
    constraints.push({name,kind:match[1]==='primary key'?'p':match[1]==='unique'?'u':'f',keys:match[2].split(','),reference:match[3]??null,referenceKeys:match[4]?.split(',')??null,
     deferred:/deferrable/.test(match[5]),initiallyDeferred:/initially deferred/.test(match[5]),delete:/on delete restrict/.test(match[5])?'r':'a'});
   }else{
    const [,name,type,rest]=clause.match(/^(\w+) (\w+)([\s\S]*)$/);assert(!/\b(?:check|references|primary key|unique)\b/.test(rest),clause);
    columns.push({name,type,nullable:!/\bnot null\b/.test(rest),default:rest.match(/\bdefault (.+)$/)?.[1]??null});
   }
  }
  for(const c of constraints.filter(c=>c.kind==='p'))for(const key of c.keys)columns.find(c=>c.name===key).nullable=false;
  return {name:m[1],columns,constraints};
 });
}
export function independentDependencyManifest(root,sql){
 const own=independentFunctionManifest(sql),forward=independentWorkerForwardRecipes(root),excluded=new Set([...own,...forward].map(v=>v.name));
 const names=new Set(own.flatMap(f=>[...f.body.matchAll(/public\.(faolla_\w+)\s*\(/g)].map(m=>m[1])).filter(n=>!excluded.has(n)));
 const history=new Map(),dir=path.join(root,'scripts/supabase-migrations');
 for(const name of readdirSync(dir).filter(n=>/^\d+_/.test(n)&&n<'202610080196').sort())for(const f of independentFunctionManifest(readFileSync(path.join(dir,name),'utf8')))history.set(f.name,{...f,source:name});
 return [...names].sort().map(name=>{assert(history.has(name),'independent_dependency_source_required:'+name);const {body,...f}=history.get(name);assert(body);return f;});
}
export function independentInstallationManifest(root,sql){
 const functions=independentFunctionManifest(sql).filter(f=>f.name.startsWith('faolla_attendance_independent_')).map(({body,...f})=>{assert(body);return f;});
 const tables=independentTableManifest(sql);assert.equal(tables.length,6);assert.equal(functions.length,20);
 const indexes=[...sql.matchAll(/^create index if not exists (\w+) on public\.(\w+)\(([^)]+)\);/gm)].map(m=>({name:m[1],table:m[2],keys:m[3].split(',')}));assert.equal(indexes.length,2);
 const sql193=readFileSync(path.join(root,'scripts/supabase-migrations/202610080193_merchant_attendance_operational_punch.sql'),'utf8'),sql195=readFileSync(path.join(root,'scripts/supabase-migrations/202610080195_merchant_attendance_administrative_closure.sql'),'utf8');
 const forward=independentWorkerForwardRecipes(root).map(f=>{
  let args,defaults;
  if(f.name==='faolla_attendance_operating_head_v1'){const head=independentFunctionManifest(sql195).find(x=>x.name===f.name);args=head.argumentNames;defaults=head.defaults;}
  else if(f.name==='faolla_attendance_pin_schedule_v1'){const m=sql193.match(/\('public\.faolla_attendance_pin_schedule_v1\([^']*\)','[0-9a-f]{64}','[0-9a-f]{64}',true,(\d+),array\[(.*?)\]::text\[\]/);assert(m);defaults=Number(m[1]);args=[...m[2].matchAll(/'([^']+)'/g)].map(x=>x[1]);}
  else {const m=[...sql193.matchAll(/\('public\.(faolla_\w+)\([^']*\)','[0-9a-f]{64}','jsonb','v','plpgsql',(true|false),(true|false),(\d+),array\[(.*?)\]::text\[\]/g)].find(m=>m[1]===f.name);assert(m,f.name);args=[...m[5].matchAll(/'([^']+)'/g)].map(x=>x[1]);defaults=Number(m[4]);}
  return {...f,argumentNames:args,defaults,resultType:'jsonb',volatility:f.name==='faolla_attendance_operating_head_v1'?'s':'v',language:'plpgsql',securityDefiner:f.name==='faolla_attendance_pin_schedule_v1',serviceExecute:f.name==='faolla_attendance_pin_schedule_v1',config:['search_path=pg_catalog']};
 });
 const dependencies=independentDependencyManifest(root,sql),permission=dependencies.find(f=>f.name==='faolla_valid_merchant_enterprise_permissions_v1');
 const legacy=independentFunctionManifest(readFileSync(path.join(root,'scripts/supabase-migrations/202610080185_merchant_attendance_period_delegations.sql'),'utf8')).find(f=>f.name===permission.name);
 assert.equal(permission.source,'202610080190_merchant_attendance_correction_delegation_permission.sql');permission.legacyHash=legacy.hash;
 return {functions,tables,indexes,forward,dependencies};
}

const compact=v=>JSON.stringify(v);
const list=v=>v.map(x=>"'"+x.replaceAll("'","''")+"'").join(',');
export const independentPermissionHelperName='faolla_valid_merchant_enterprise_permissions_v1';
// This one pre-existing pure validator inherits either the original enterprise
// owner-only ACL or PostgreSQL's original owner+PUBLIC default. Never repair it.
export function independentPermissionAclMatches(rows,owner,ownerExecute){
 if(!Number.isSafeInteger(owner)||owner<=0||ownerExecute!==true||!Array.isArray(rows)||rows.length<1||rows.length>2)return false;
 const normalized=[];
 for(const row of rows){
  if(!row||Object.getPrototypeOf(row)!==Object.prototype||Object.keys(row).sort().join(',')!=='grantee,grantor,is_grantable,privilege_type'
   ||row.grantor!==owner||![0,owner].includes(row.grantee)||row.privilege_type!=='EXECUTE'||row.is_grantable!==false)return false;
  normalized.push(row.grantee);
 }
 normalized.sort((a,b)=>a-b);return JSON.stringify(normalized)===JSON.stringify([owner])||JSON.stringify(normalized)===JSON.stringify([0,owner]);
}
export function independentPermissionAclConflictSql(meta='f',owner='expected_owner'){
 assert.match(meta,/^[a-z_][a-z0-9_]*$/);assert.match(owner,/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/);
 return `(has_function_privilege(${owner},${meta}.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(${meta}.proacl,acldefault('f',${meta}.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(${owner},${owner},'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(${owner},0::oid,'EXECUTE',false),jsonb_build_array(${owner},${owner},'EXECUTE',false))))`;
}
const expression=s=>s.replace(/(\w+) between (\d+) and (\d+)/g,'$1>=$2 and $1<=$3').replace(/(\w+) in\(([^)]+)\)/g,'$1=any(array[$2])').replace(/interval '30 seconds'/g,"'00:00:30'::interval");
// Keep CHECK string/regex literals byte-exact. Only syntax outside quoted tokens
// is folded; PG15's quoted bigint rendering is one explicit numeric case.
const normalize=e=>`(select string_agg(case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\\[\\])?|::name(?![[:alnum:]_\\[])','','g'),'[[:space:]()\\[\\]"]','','g')) end,'' order by z.ord) from regexp_matches(regexp_replace(${e},'''([0-9]+)''::bigint','\\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord))`;
export function independentCheckNormalize(source){
 if(source===null)return null;
 return (source.replace(/'([0-9]+)'::bigint/g,'$1').match(/'(?:[^']|'')*'|[^']+/g)||[]).map(token=>token.startsWith("'")?token:token.replace(/::(text|bigint|integer)(\[\])?|::name(?![A-Za-z0-9_\[])/g,'').replace(/[\s()[\]"]/g,'').toLowerCase()).join('');
}
export function independentInstallationGuard(manifest,tag,requiredInstalled=false){
 const {functions,tables,indexes,dependencies,forward}=manifest;
 const canonicalTables=tables.map(t=>({...t,constraints:t.constraints.map(c=>c.expression?{...c,expression:expression(c.expression)}:c)}));
 return `do $${tag}$
declare installed boolean;ns text;expected_owner oid;spec jsonb;col jsonb;c jsonb;ix jsonb;f pg_proc%rowtype;t regclass;con pg_constraint%rowtype;idx pg_index%rowtype;
 actual jsonb;keys text[];refkeys text[];expected_hash text;signature text;has190 boolean;tr record;count_expected integer;
begin
 select n.nspname into ns from pg_class v join pg_namespace n on n.oid=v.relnamespace where v.oid='public.faolla_schema_migrations'::regclass;
 expected_owner:=(select oid from pg_roles where rolname=current_user);
 if exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name<>'merchant_attendance_independent_workers') then raise exception 'merchant_attendance_independent_installation_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name='merchant_attendance_independent_workers');
 ${requiredInstalled?"if not installed then raise exception 'merchant_attendance_independent_installation_conflict';end if;":''}
 if exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name<>'merchant_attendance_correction_delegation_permission')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations') then raise exception 'merchant_attendance_independent_installation_conflict';end if;
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 for spec in select value from jsonb_array_elements($${tag}_dependencies$${compact(dependencies.concat(forward.map(({changes,...f})=>{assert(changes);return {...f,hash:requiredInstalled?f.newHash:null};})))}$${tag}_dependencies$::jsonb) loop
  signature:=format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.'));
  select * into f from pg_proc where oid=to_regprocedure(signature);
  expected_hash:=coalesce(spec->>'hash',case when installed then spec->>'newHash' else spec->>'oldHash' end);
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and not has190 then expected_hash:=spec->>'legacyHash';end if;
  ${functionCheck('expected_hash')}
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns) and left(proname,30)='faolla_attendance_independent_')<>(case when installed then ${functions.length} else 0 end) then raise exception 'merchant_attendance_independent_installation_conflict:function_inventory';end if;
 for spec in select value from jsonb_array_elements($${tag}_tables$${compact(canonicalTables)}$${tag}_tables$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'name'));
  if installed<>(t is not null) then raise exception 'merchant_attendance_independent_installation_conflict:table:%',spec->>'name';end if;
  if not installed then continue;end if;
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity and relpersistence='p' and not relispartition)
   or exists(select 1 from pg_policy where polrelid=t)
   or exists(select 1 from pg_class v cross join lateral aclexplode(coalesce(v.relacl,acldefault('r',v.relowner))) a where v.oid=t and (a.grantee<>expected_owner or a.grantor<>expected_owner))
   or exists(select 1 from pg_attribute v cross join lateral aclexplode(v.attacl) a where v.attrelid=t and (a.grantee<>expected_owner or a.grantor<>expected_owner)) then raise exception 'merchant_attendance_independent_installation_conflict:table_acl:%',spec->>'name';end if;
  if (select count(*) from pg_attribute where attrelid=t and attnum>0)<>jsonb_array_length(spec->'columns') then raise exception 'merchant_attendance_independent_installation_conflict:columns:%',spec->>'name';end if;
  count_expected:=0;
  for col in select value from jsonb_array_elements(spec->'columns') loop
   count_expected:=count_expected+1;
   if not exists(select 1 from pg_attribute a join pg_type ty on ty.oid=a.atttypid left join pg_attrdef d on d.adrelid=t and d.adnum=a.attnum
    where a.attrelid=t and a.attnum=count_expected and a.attname=col->>'name' and a.atttypid=to_regtype(col->>'type') and a.atttypmod=-1
    and not a.attisdropped and a.attidentity='' and a.attgenerated='' and a.attnotnull=(not(col->>'nullable')::boolean) and a.attcollation=ty.typcollation
    and ${normalize('pg_get_expr(d.adbin,t)')} is not distinct from ${normalize("col->>'default'")}) then raise exception 'merchant_attendance_independent_installation_conflict:column:%.%',spec->>'name',col->>'name';end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid=t)<>jsonb_array_length(spec->'constraints') then raise exception 'merchant_attendance_independent_installation_conflict:constraints:%',spec->>'name';end if;
  for c in select value from jsonb_array_elements(spec->'constraints') loop
   select * into con from pg_constraint where conrelid=t and conname=c->>'name';
   if coalesce(c->>'kind','') not in('c','p','u','f') or con.oid is null or con.contype::text<>c->>'kind' or not con.convalidated
    or con.connoinherit is distinct from ((c->>'kind') in('p','u','f')) or con.conislocal is distinct from true or con.coninhcount<>0
    or con.condeferrable<>coalesce((c->>'deferred')::boolean,false) or con.condeferred<>coalesce((c->>'initiallyDeferred')::boolean,false) then raise exception 'merchant_attendance_independent_installation_conflict:constraint:%.%',spec->>'name',c->>'name';end if;
   if con.contype='c' then
    if ${normalize('pg_get_expr(con.conbin,t)')} is distinct from ${normalize("c->>'expression'")} then raise exception 'merchant_attendance_independent_installation_conflict:check:%.%',spec->>'name',c->>'name';end if;
   else
    select array_agg(a.attname::text order by z.ord) into keys from unnest(con.conkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=t and a.attnum=z.n;
    if keys is distinct from array(select jsonb_array_elements_text(c->'keys')) then raise exception 'merchant_attendance_independent_installation_conflict:constraint_keys:%',c->>'name';end if;
    if con.contype='f' then
     select array_agg(a.attname::text order by z.ord) into refkeys from unnest(con.confkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=z.n;
     if con.confrelid is distinct from to_regclass(format('%I.%I',ns,c->>'reference')) or refkeys is distinct from array(select jsonb_array_elements_text(c->'referenceKeys'))
      or con.confmatchtype<>'s' or con.confupdtype<>'a' or con.confdeltype::text<>c->>'delete' then raise exception 'merchant_attendance_independent_installation_conflict:foreign_key:%',c->>'name';end if;
    else
     select * into idx from pg_index where indexrelid=con.conindid;
     if idx.indexrelid is null or not(idx.indisvalid and idx.indisready and idx.indislive and idx.indisunique) or idx.indpred is not null or idx.indexprs is not null
      or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys) or idx.indnullsnotdistinct
      or not exists(select 1 from pg_class z join pg_am a on a.oid=z.relam where z.oid=idx.indexrelid and z.relowner=expected_owner and a.amname='btree')
      or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=t and a.attname=keys[z]
       join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indkey[z-1]<>a.attnum or idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_independent_installation_conflict:constraint_index:%',c->>'name';end if;
    end if;
   end if;
  end loop;
  count_expected:=case when spec->>'name' in('merchant_attendance_independent_entries','merchant_attendance_independent_event_sources','merchant_attendance_independent_member_bindings') then 2 else 0 end;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>count_expected then raise exception 'merchant_attendance_independent_installation_conflict:triggers:%',spec->>'name';end if;
  for tr in select * from pg_trigger where tgrelid=t and not tgisinternal loop
   if tr.tgname not in('independent_immutable','independent_no_truncate') or tr.tgfoid<>to_regprocedure(format('%I.faolla_attendance_independent_guard_v1()',ns))
    or tr.tgtype<>(case when tr.tgname='independent_immutable' then 31 else 34 end) or tr.tgenabled<>'O' or tr.tgdeferrable or tr.tginitdeferred
    or tr.tgconstraint<>0 or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgargs<>''::bytea or tr.tgoldtable is not null or tr.tgnewtable is not null then raise exception 'merchant_attendance_independent_installation_conflict:trigger:%',tr.tgname;end if;
  end loop;
  if (select count(*) from pg_index where indrelid=t)<>(select count(*) from jsonb_array_elements(spec->'constraints') v where v->>'kind' in('p','u'))
   +(case when spec->>'name' in('merchant_attendance_independent_leases','merchant_attendance_independent_event_sources') then 1 else 0 end) then raise exception 'merchant_attendance_independent_installation_conflict:index_inventory:%',spec->>'name';end if;
 end loop;
 for ix in select value from jsonb_array_elements($${tag}_indexes$${compact(indexes)}$${tag}_indexes$::jsonb) loop
  select * into idx from pg_index where indexrelid=to_regclass(format('%I.%I',ns,ix->>'name'));
  if installed<>(idx.indexrelid is not null) then raise exception 'merchant_attendance_independent_installation_conflict:index:%',ix->>'name';end if;
  if not installed then continue;end if;
  select array_agg(a.attname::text order by z.ord) into keys from unnest(idx.indkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=idx.indrelid and a.attnum=z.n;
  if idx.indrelid<>to_regclass(format('%I.%I',ns,ix->>'table')) or keys is distinct from array(select jsonb_array_elements_text(ix->'keys'))
   or not(idx.indisvalid and idx.indisready and idx.indislive) or idx.indisunique or idx.indisprimary or idx.indpred is not null or idx.indexprs is not null
   or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys) or not exists(select 1 from pg_class z join pg_am a on a.oid=z.relam where z.oid=idx.indexrelid and z.relowner=expected_owner and a.amname='btree')
   or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=idx.indrelid and a.attname=keys[z]
    join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_independent_installation_conflict:index_shape:%',ix->>'name';end if;
 end loop;
 if not installed then return;end if;
 for spec in select value from jsonb_array_elements($${tag}_functions$${compact(functions)}$${tag}_functions$::jsonb) loop
  signature:=format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.'));select * into f from pg_proc where oid=to_regprocedure(signature);
  ${functionCheck("spec->>'hash'")}
 end loop;
end;
$${tag}$;`;
}
function functionCheck(hash){return `if f.oid is null or f.proowner<>expected_owner or f.prokind<>'f' or f.proretset or f.proisstrict or f.proleakproof or f.proargmodes is not null or f.proparallel<>'u'
   or f.prolang<>(select oid from pg_language where lanname=spec->>'language') or f.prorettype<>to_regtype(replace(spec->>'resultType','public.',ns||'.'))
   or f.provolatile::text<>spec->>'volatility' or f.prosecdef<>(spec->>'securityDefiner')::boolean or f.proconfig is distinct from array(select jsonb_array_elements_text(spec->'config'))
   or coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames')) or f.pronargdefaults<>(spec->>'defaults')::integer
   or encode(sha256(convert_to(replace(replace(f.prosrc,E'\\r\\n',E'\\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from ${hash}
   then raise exception 'merchant_attendance_independent_installation_conflict:function:%',spec->>'name';end if;
  if spec->>'name'='${independentPermissionHelperName}' then
   if ${independentPermissionAclConflictSql()} then raise exception 'merchant_attendance_independent_installation_conflict:function_acl:%',spec->>'name';end if;
  else
   if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE')<>(spec->>'serviceExecute')::boolean
    or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantor<>expected_owner or a.grantee<>expected_owner and not((spec->>'serviceExecute')::boolean and a.grantee=(select oid from pg_roles where rolname='service_role') and a.privilege_type='EXECUTE' and not a.is_grantable)) then raise exception 'merchant_attendance_independent_installation_conflict:function_acl:%',spec->>'name';end if;
  end if;`;}

export function independentForwardSql(manifest){return `do $independent_forward$
declare spec jsonb;change jsonb;f pg_proc%rowtype;after_fn pg_proc%rowtype;ns text;body_value text;signature text;definition text;
begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080196) then return;end if;
 select n.nspname into ns from pg_class v join pg_namespace n on n.oid=v.relnamespace where v.oid='public.faolla_schema_migrations'::regclass;
 for spec in select value from jsonb_array_elements($independent_recipes$${compact(manifest.forward)}$independent_recipes$::jsonb) loop
  signature:=format('%I.%I(%s)',ns,spec->>'name',spec->>'types');select * into f from pg_proc where oid=to_regprocedure(signature);
  if encode(sha256(convert_to(replace(replace(f.prosrc,E'\\r\\n',E'\\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'oldHash' then raise exception 'merchant_attendance_independent_forward_conflict:%',spec->>'name';end if;
  body_value:=replace(f.prosrc,E'\\r\\n',E'\\n');
  for change in select value from jsonb_array_elements(spec->'changes') loop
   if (length(body_value)-length(replace(body_value,replace(change->>'from','public.',ns||'.'),'')))/length(replace(change->>'from','public.',ns||'.'))<>(change->>'count')::integer then raise exception 'merchant_attendance_independent_recipe_conflict:%',spec->>'name';end if;
   body_value:=replace(body_value,replace(change->>'from','public.',ns||'.'),replace(change->>'to','public.',ns||'.'));
  end loop;
  if encode(sha256(convert_to(replace(body_value,ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'newHash' then raise exception 'merchant_attendance_independent_recipe_hash:%',spec->>'name';end if;
  definition:=pg_get_functiondef(f.oid);
  if (length(definition)-length(replace(definition,f.prosrc,'')))/length(f.prosrc)<>1 then raise exception 'merchant_attendance_independent_recipe_definition';end if;
  execute replace(definition,f.prosrc,body_value);
  select * into after_fn from pg_proc where oid=to_regprocedure(signature);
  if after_fn.oid is distinct from f.oid or after_fn.proacl is distinct from f.proacl or pg_get_expr(after_fn.proargdefaults,0) is distinct from pg_get_expr(f.proargdefaults,0)
   or (to_jsonb(after_fn)-array['prosrc','proargdefaults']) is distinct from (to_jsonb(f)-array['prosrc','proargdefaults']) then raise exception 'merchant_attendance_independent_recipe_metadata';end if;
 end loop;
end;
$independent_forward$;`;}

export function independentGuardNames(manifest){return list(manifest.functions.map(f=>f.name));}
