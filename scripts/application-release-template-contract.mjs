// The new lane admits only this additive table, never arbitrary SQL or a repair.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const TEMPLATE_SCHEMA=Object.freeze({kind:'already-applied-website-template-table-v1',version:'202611100214',name:'website_template_library',
 file:'scripts/supabase-migrations/202611100214_website_template_library.sql',
 sha256:'20c7c9b3760e57e9de2ed56291db4f54f9dd844fcb6d9475009277c6a4f88db4',
 databaseExecution:'forbidden'});
export const TEMPLATE_BASELINE='37fe3c3b8220c73090ba953c7d046a63a5ab1bfc';
export const templateNeed=(value,reason)=>{if(!value)throw Error('application_template_'+reason);};
export const templateHash=value=>createHash('sha256').update(value).digest('hex');
export const templateGitBlob=value=>createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex');
export function assertTemplateSql(bytes){templateNeed(templateHash(bytes)===TEMPLATE_SCHEMA.sha256,'sql_changed');return true;}
export const TEMPLATE_COLUMNS=[['id','uuid',true,null],['revision','uuid',true,null],['name','text',true,null],['category','text',true,null],
 ['status','text',true,"'draft'::text"],['sort_order','integer',true,'0'],['design','jsonb',true,null],['cover_image_url','text',true,"''::text"],
 ['desktop_page_count','integer',true,null],['mobile_page_count','integer',true,null],['source_site_id','text',true,null],['source_plan_id','text',true,null],
 ['created_at','timestamp with time zone',true,'clock_timestamp()'],['updated_at','timestamp with time zone',true,'clock_timestamp()']];
export function assertTemplateTable(table,{owner='supabase_admin'}={}){
 templateNeed(table&&table.owner===owner&&table.rls===true&&table.forceRls===false,'table_owner_rls');
 templateNeed(isDeepStrictEqual(table.columns,TEMPLATE_COLUMNS),'table_columns');
 templateNeed(Array.isArray(table.constraints)&&table.constraints.length===6&&table.constraints.filter(c=>c.type==='p').length===1&&
  table.constraints.filter(c=>c.type==='c').length===5,'table_constraints');
 const defs=table.constraints.map(c=>c.definition).join('\n');
 for(const fragment of ['PRIMARY KEY (id)','length(name)','category = ANY','status = ANY',"jsonb_typeof(design)",'source_plan_id = ANY'])templateNeed(defs.includes(fragment),'table_constraint_definition');
 templateNeed(table.indexes?.length===2&&table.indexes.some(v=>v.includes('(status, sort_order, updated_at DESC)')),'table_indexes');
 templateNeed(table.triggers===0&&table.policies===0,'table_hooks');
 templateNeed(isDeepStrictEqual(table.access,{anon:false,authenticated:false,service:true}),'table_access');
 templateNeed(Array.isArray(table.grants)&&table.grants.every(g=>[owner,'postgres','service_role'].includes(g.role))&&
  table.grants.filter(g=>g.role==='service_role').map(g=>g.privilege).sort().join(',')==='DELETE,INSERT,SELECT,UPDATE'&&
  table.grants.every(g=>g.role!=='service_role'||!g.grantable),'table_grants');
 return table;
}
// Metadata only: no merchant rows, template contents, credentials or write SQL.
export const TEMPLATE_TABLE_EXPRESSION=`(select jsonb_build_object('owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('type',k.contype,'definition',pg_get_constraintdef(k.oid)) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
 'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=c.oid),
 'triggers',(select count(*) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
 'policies',(select count(*) from pg_policy p where p.polrelid=c.oid),
 'grants',(select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable) order by x.grantee,x.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x),
 'access',jsonb_build_object('anon',has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') or has_table_privilege('anon',c.oid,'DELETE,TRUNCATE,TRIGGER'),
 'authenticated',has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') or has_table_privilege('authenticated',c.oid,'DELETE,TRUNCATE,TRIGGER'),
 'service',has_table_privilege('service_role',c.oid,'SELECT') and has_table_privilege('service_role',c.oid,'INSERT') and has_table_privilege('service_role',c.oid,'UPDATE') and has_table_privilege('service_role',c.oid,'DELETE')))
 from pg_class c where c.oid=to_regclass('public.website_templates'))`;
