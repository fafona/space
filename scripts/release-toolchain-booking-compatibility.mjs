// Read-only compatibility revalidation AFTER the already installed additive
// booking schema. Do not drop objects on production, even in a rolled-back TX.
import {attendanceCompatibilityMetadataContractSql} from './attendance-production-052-compatibility.mjs';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
const tables="('faolla_booking_atomic_control','faolla_booking_atomic_commands','faolla_booking_mail_jobs')";
const functions="('faolla_booking_atomic_pages_guard_v1','faolla_booking_atomic_rows_v1','faolla_booking_atomic_snapshot_v1','faolla_booking_atomic_commit_v1','faolla_booking_mail_claim_v1','faolla_booking_mail_settle_v1','faolla_booking_atomic_read_v2','faolla_booking_command_result_v2','faolla_booking_atomic_configuration_v2','faolla_booking_mail_settle_v2','faolla_booking_mail_states_v2')";
const triggers="('faolla_booking_atomic_pages_guard_v1','faolla_booking_atomic_pages_clear_guard_v1')";
const user="s.nspname<>'information_schema' and s.nspname!~'^pg_'";
export function bookingHistoricalMetadataReadSql(){
 let source=attendanceCompatibilityMetadataContractSql();const replace=(before,after)=>{need(source.split(before).length===2,'source_changed');source=source.replace(before,after);};
 const relation=`not(s.nspname='public' and c.relname in ${tables})`;
 replace(`where ${user} and c.relkind in('r','p','v','m','S')`,`where ${user} and ${relation} and c.relkind in('r','p','v','m','S')`);
 replace(`where ${user}),\n 'constraints'`,`where ${user} and not(s.nspname='public' and p.proname in ${functions})),\n 'constraints'`);
 replace(`where ${user}),\n 'triggers'`,`where ${user} and ${relation}),\n 'triggers'`);
 replace(`where ${user} and not t.tgisinternal`,`where ${user} and ${relation} and not(s.nspname='public' and c.relname='pages' and t.tgname in ${triggers}) and not t.tgisinternal`);
 replace(`where ${user}),\n 'defaults'`,`where ${user} and ${relation}),\n 'defaults'`);return source;
}
const acl=expression=>`(select jsonb_agg(jsonb_build_array(case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) order by case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) from aclexplode(${expression}) a)`;
export const bookingInstalledMetadataReadSql=`begin read only;set local statement_timeout='8s';set local search_path=pg_catalog,public;
select encode(sha256(convert_to(jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),pg_get_userbyid(p.proowner),l.lanname,p.provolatile,p.prosecdef,p.proisstrict,p.proparallel,p.proleakproof,p.proretset,p.procost,p.prorows,p.proargnames,p.proargmodes,p.proconfig,p.pronargdefaults,pg_get_expr(p.proargdefaults,0),replace(p.prosrc,E'\\r\\n',E'\\n'),${acl("coalesce(p.proacl,acldefault('f',p.proowner))")}) order by p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='public' and p.proname in ${functions}),
 'tables',(select jsonb_agg(jsonb_build_array(c.relname,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,${acl("coalesce(c.relacl,acldefault('r',c.relowner))")},
  (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  (select jsonb_agg(jsonb_build_array(k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true)) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
  (select jsonb_agg(pg_get_indexdef(i.indexrelid) order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid=c.oid)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ${tables}),
 'triggers',(select jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true)) order by t.tgname) from pg_trigger t where t.tgrelid='public.pages'::regclass and t.tgname in ${triggers}),
 'policies',(select jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ${tables})
 )::text,'UTF8')),'hex');rollback;`;
export const bookingDefaultPrivilegesReadSql=`begin read only;set local statement_timeout='8s';select jsonb_agg(jsonb_build_object('scope',x.scope,'kind',x.kind,'acl',
 (select coalesce(jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type),'[]'::jsonb)
 from aclexplode(case when x.scope='global' then coalesce(d.defaclacl,acldefault(x.code,'supabase_admin'::regrole)) else coalesce(d.defaclacl,'{}'::aclitem[]) end) a)) order by x.scope,x.kind)
 from (values('global','tables','r'::"char",0::oid),('global','functions','f'::"char",0::oid),('public','tables','r'::"char",'public'::regnamespace::oid),('public','functions','f'::"char",'public'::regnamespace::oid)) x(scope,kind,code,namespace)
 left join pg_default_acl d on d.defaclrole='supabase_admin'::regrole and d.defaclnamespace=x.namespace and d.defaclobjtype=x.code;rollback;`;
export function isolatedBookingDefaultPrivilegesSql(value){
 need(Array.isArray(value)&&value.length===4,'evidence_invalid');const keys=new Set(),roles=new Set(['supabase_admin']);
 for(const row of value){need(['global','public'].includes(row?.scope)&&['tables','functions'].includes(row.kind)&&!keys.has(row.scope+row.kind)&&Array.isArray(row.acl)&&row.acl.length<=512,'evidence_invalid');keys.add(row.scope+row.kind);
  for(const a of row.acl){need(typeof a.grantee==='string'&&a.grantee.length>0&&Buffer.byteLength(a.grantee)<=63&&!/[\x00-\x1f]/.test(a.grantee)&&a.grantor==='supabase_admin'&&typeof a.grantable==='boolean'&&
   (row.kind==='functions'?a.privilege==='EXECUTE':['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'].includes(a.privilege)),'evidence_invalid');if(a.grantee!=='PUBLIC')roles.add(a.grantee);}}
 need(roles.size<=64,'evidence_invalid');const identifier=v=>'"'+v.replaceAll('"','""')+'"',literal=v=>"'"+v.replaceAll("'","''")+"'";
 let sql='begin;set local standard_conforming_strings=on;';for(const role of roles)sql+='do '+literal(`begin if not exists(select 1 from pg_roles where rolname=${literal(role)}) then execute ${literal('create role '+identifier(role)+' nologin')};end if;end;`)+';';
 for(const row of value){const prefix='alter default privileges for role supabase_admin'+(row.scope==='public'?' in schema public':'');
  sql+=prefix+' revoke all on '+row.kind+' from PUBLIC,'+[...roles].map(identifier).join(',')+';';
  for(const a of row.acl)sql+=prefix+' grant '+a.privilege+' on '+row.kind+' to '+(a.grantee==='PUBLIC'?'PUBLIC':identifier(a.grantee))+(a.grantable?' with grant option':'')+';';
 }return sql+'commit;';
}
