// Separately authorized additive visitor schema; this is not a generic SQL lane.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
export const GUEST_BASELINE='61c0c93a9935b642fbee94ecc28353512c8b79a5';
export const GUEST_SCHEMA=Object.freeze({kind:'already-applied-merchant-guest-chat-v1',version:'202611160215',name:'merchant_guest_chat',
 file:'scripts/supabase-migrations/202611160215_merchant_guest_chat.sql',
 sha256:'d239f596180a9992fadc440a3bd381748f33448d7ef40b8c7625b173a120f56c',databaseExecution:'forbidden'});
export const guestNeed=(value,reason)=>{if(!value)throw Error('application_guest_chat_'+reason);};
export const guestHash=value=>createHash('sha256').update(value).digest('hex');
export const guestBlob=value=>createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex');
export function guestSqlBytes(){const bytes=fs.readFileSync(new URL('./supabase-migrations/202611160215_merchant_guest_chat.sql',import.meta.url));guestNeed(guestHash(bytes)===GUEST_SCHEMA.sha256,'sql_changed');return bytes;}
export const GUEST_TABLES=['merchant_guest_chat_sessions','merchant_guest_chat_threads','merchant_guest_chat_messages'];
export const GUEST_FUNCTIONS=[
 'public.merchant_guest_chat_create_session(text, text)',
 'public.merchant_guest_chat_send(text, uuid, text, text, uuid, text, text)',
 'public.merchant_guest_chat_mark_read(text, uuid, text, text, bigint)',
 'public.merchant_guest_chat_list(text, uuid, uuid, text, integer)',
];
export const GUEST_COLUMNS={
 merchant_guest_chat_sessions:[['id','uuid',true,''],['token_hash','text',true,''],['guest_number','text',true,''],['creation_ip_hash','text',true,''],['created_at','timestamp with time zone',true,''],['expires_at','timestamp with time zone',true,'']],
 merchant_guest_chat_threads:[['id','uuid',true,''],['session_id','uuid',true,''],['site_id','text',true,''],['guest_read_through','bigint',true,''],['merchant_read_through','bigint',true,''],['created_at','timestamp with time zone',true,''],['updated_at','timestamp with time zone',true,'']],
 merchant_guest_chat_messages:[['sequence','bigint',true,'a'],['thread_id','uuid',true,''],['sender','text',true,''],['request_id','uuid',true,''],['text','text',true,''],['sender_principal','text',false,''],['created_at','timestamp with time zone',true,'']],
};
export function assertGuestSchema(schema){
 guestNeed(schema&&Array.isArray(schema.tables)&&schema.tables.length===3&&Array.isArray(schema.functions)&&schema.functions.length===4,'objects');
 for(const [index,name]of GUEST_TABLES.entries()){
  const t=schema.tables.find(row=>row.name===name);guestNeed(t?.owner==='supabase_admin'&&t.rls===true&&t.forceRls===false,'table_owner_rls');
  guestNeed(isDeepStrictEqual(t.columns.map(c=>c.slice(0,4)),GUEST_COLUMNS[name]),'table_columns');
  guestNeed(t.policies===0&&t.triggers===0&&t.constraints?.length===[6,4,6][index]&&t.indexes?.length===[4,3,4][index],'table_shape');
  guestNeed(t.grants?.some(g=>g.role==='service_role'&&g.privilege==='SELECT'&&!g.grantable)&&
   t.grants.every(g=>['supabase_admin','postgres'].includes(g.role)||g.role==='service_role'&&g.privilege==='SELECT'&&!g.grantable),'table_grants');
 }
 const bodies=[...guestSqlBytes().toString('utf8').matchAll(/create function public\.(merchant_guest_chat_\w+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)];
 guestNeed(bodies.length===4,'function_sources');
 for(const signature of GUEST_FUNCTIONS){
  const f=schema.functions.find(row=>row.signature===signature),name=signature.slice(7,signature.indexOf('('));
  const body=bodies.find(m=>m[1]===name)?.[2];
  guestNeed(f?.owner==='supabase_admin'&&f.definer===true&&isDeepStrictEqual(f.config,['search_path=pg_catalog, public'])&&
   typeof body==='string'&&f.bodyMd5===createHash('md5').update(body.replaceAll('\r','')).digest('hex'),'function_definition');
  guestNeed(f.grants?.some(g=>g.role==='service_role'&&g.privilege==='EXECUTE'&&!g.grantable)&&
   f.grants.every(g=>['supabase_admin','postgres'].includes(g.role)||g.role==='service_role'&&g.privilege==='EXECUTE'&&!g.grantable),'function_grants');
 }
 guestNeed(schema.sequence?.owner==='supabase_admin'&&schema.sequence.name==='merchant_guest_chat_messages_sequence_seq'&&
  schema.sequence.grants?.every(g=>['supabase_admin','postgres'].includes(g.role)),'sequence_grants');
 return schema;
}
const grants=(acl,defaults)=>`(select coalesce(jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable) order by x.grantee,x.privilege_type),'[]'::jsonb) from aclexplode(coalesce(${acl},${defaults})) x)`;
export const GUEST_SCHEMA_EXPRESSION=`jsonb_build_object(
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid and k.contype in ('p','u','f','c')),
 'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=c.oid),
 'policies',(select count(*) from pg_policy p where p.polrelid=c.oid),'triggers',(select count(*) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
 'grants',${grants('c.relacl',"acldefault('r',c.relowner)")}) order by c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname in (${GUEST_TABLES.map(s=>"'"+s+"'").join(',')})),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')','owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'bodyMd5',md5(replace(p.prosrc,chr(13),'')),
 'grants',${grants('p.proacl',"acldefault('f',p.proowner)")}) order by p.oid::regprocedure::text),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'merchant_guest_chat_%'),
 'sequence',(select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'grants',${grants('c.relacl',"acldefault('s',c.relowner)")}) from pg_class c where c.oid=to_regclass('public.merchant_guest_chat_messages_sequence_seq')))`;
