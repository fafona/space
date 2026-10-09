// OPTIONAL attendance-only recovery evidence. No import-time IO, installation,
// database connection or change to the production v1/v2 recovery contract.
export const ATTENDANCE_RECOVERY_CONTENT_SCHEMA_VERSION = 1;
export const ATTENDANCE_RECOVERY_PROFILE = 'attendance-recovery-v1';
export const ATTENDANCE_RECOVERY_LIMITS = Object.freeze({relations:256,rows:100000,catalogObjects:20000,rowBytes:8388608});

// Explicit presence markers through migration181. Missing is not an empty table
// or proof that the corresponding capability was installed/exercised. Other
// actual tables in the requested namespace are also included, never discarded.
export const ATTENDANCE_RECOVERY_RELATIONS = Object.freeze([
  'merchants','faolla_schema_migrations','merchant_enterprise_employees','merchant_enterprise_roles',
  ...`settings locations workers employment_periods events config_operations
  scopes scope_grants scope_workers scope_locations scope_operations
  location_results location_policy_drafts location_reviews location_discussion
  location_notices location_notice_acknowledgements location_clock_notices location_setup_operations
  correction_entries correction_controls correction_periods correction_rule_bindings correction_decisions correction_effects
  report_exports revision_requests effect_versions revision_decisions
  schedule_commands schedule_slots schedule_cancellations missing_requests missing_entries unified_exports
  terminals terminal_audit pin_credentials pin_audit pin_attempts pin_clock_receipts onsite_receipts
  shift_templates shift_template_operations leave_requests leave_entries calendar_entries calendar_operations
  groups group_operations group_assignments group_assignment_operations leave_notifications leave_notification_reads
  rule_streams rule_operations personal_rule_streams personal_rule_operations rule_capture_artifacts rule_capture_operations
  shift_rule_sources shift_rule_bindings schedule_publication_evidence shift_schedule_relations
  plan_rule_artifacts plan_rule_operations plan_rule_streams shift_plan_adoptions
  plan_exception_cases plan_exception_entries plan_exception_reads
  period_closures period_artifacts period_versions period_entries
  work_arrangement_policies work_arrangement_requests work_arrangement_entries
  missing_delegations missing_delegation_revocations missing_delegation_decisions
  application_delegations application_delegation_revocations application_delegation_decisions
  account_suspensions account_epochs account_status_operations account_restores delegation_epochs employment_operations
  schedule_delegations schedule_delegation_revocations schedule_delegation_operations
  event_notifications event_notification_reads plan_posthoc_operations plan_posthoc_claims
  outage_operations outage_incidents outage_declarations outage_link_operations outage_review_operations outage_relation_operations`
    .trim().split(/\s+/).map(name=>'merchant_attendance_'+name),
].sort());
export const ATTENDANCE_RECOVERY_CATALOG_CATEGORIES = Object.freeze([
  'columns','constraints','defaultPrivileges','functions','indexes','namespace','policies','relations','sequences','triggers','types',
]);
const essential = ['merchants','faolla_schema_migrations','merchant_enterprise_employees','merchant_enterprise_roles',
  'merchant_attendance_settings','merchant_attendance_workers'];
const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
const sha = /^[a-f0-9]{64}$/;
const count = /^(0|[1-9][0-9]{0,5})$/;
const literal = value=>"'"+value.replaceAll("'","''")+"'";
const digest = value=>`pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(${value},'UTF8')),'hex')`;
const keys = (v,names)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
const validSchema = schema=>typeof schema==='string'&&identifier.test(schema)&&!schema.startsWith('pg_')&&schema!=='information_schema';
// Normalize ACL ordering and role OIDs. Except for table-like ACLs
// below, keep NULL distinct from an explicit ACL (no blanket NULL coercion).
const acl = expression=>`CASE WHEN ${expression} IS NULL THEN NULL ELSE (SELECT COALESCE(pg_catalog.jsonb_agg(
  pg_catalog.jsonb_build_array(pg_catalog.pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
  ORDER BY pg_catalog.pg_get_userbyid(a.grantor) COLLATE "C",CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END COLLATE "C",a.privilege_type COLLATE "C",a.is_grantable),'[]'::jsonb)
  FROM pg_catalog.aclexplode(${expression}) a) END`;
const ordered = expression=>`(SELECT pg_catalog.jsonb_agg(v ORDER BY v COLLATE "C") FROM pg_catalog.unnest(${expression}) v)`;
// PG15 documents NULL ACL as acldefault(object-type,owner). pg_dump omits an
// explicit default table ACL, so restore legitimately stores NULL instead.
// Preserve explicit empty ACLs and every grantor/grantee/privilege/grant option.
// Other object classes (including sequences) retain their prior strict ACL
// representation: this correction covers the observed table-only differences.
// https://www.postgresql.org/docs/15/functions-info.html#FUNCTIONS-ACLITEM
const effectiveRelationAcl=`CASE WHEN c.relkind IN('r','p','v','m','f') THEN COALESCE(c.relacl,pg_catalog.acldefault('r'::"char",c.relowner)) ELSE c.relacl END`;
// Compare CHECK definitions using PG15's own precedence-aware deparser, not a
// textual parenthesis stripper. Nested ANDs may flatten during dump reparsing;
// OR under AND and arguments under NOT still require and retain parentheses.
// Only same-major comparison; this output is NEVER used as restore SQL.
// REL_15_STABLE ruleutils.c: isSimpleNode / get_rule_expr(T_BoolExpr).
const constraintDefinition="pg_catalog.pg_get_constraintdef(k.oid,k.contype='c')";

function catalogQueries(){
  return {
    namespace:`SELECT pg_catalog.jsonb_build_array(n.nspname,pg_catalog.pg_get_userbyid(n.nspowner),${acl('n.nspacl')}) item FROM ns n`,
    relations:`SELECT pg_catalog.jsonb_build_array(c.relname,c.relkind,c.relpersistence,pg_catalog.pg_get_userbyid(c.relowner),${acl(effectiveRelationAcl)},c.relrowsecurity,c.relforcerowsecurity,c.relreplident,c.relispopulated,c.relispartition,${ordered('c.reloptions')},CASE WHEN c.relkind IN('v','m') THEN pg_catalog.pg_get_viewdef(c.oid,false) END,pg_catalog.pg_get_expr(c.relpartbound,c.oid),CASE WHEN c.relkind='p' THEN pg_catalog.pg_get_partkeydef(c.oid) END) item FROM classes c`,
    columns:`SELECT pg_catalog.jsonb_build_array(c.relname,a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,a.attisdropped,a.attstorage,a.attcompression,${acl('a.attacl')},CASE WHEN a.attcollation<>0 THEN pg_catalog.format('%I.%I',cn.nspname,co.collname) END,pg_catalog.pg_get_expr(d.adbin,d.adrelid)) item FROM classes c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum LEFT JOIN pg_catalog.pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=co.collnamespace`,
    constraints:`SELECT pg_catalog.jsonb_build_array(c.relname,k.conname,k.contype,k.condeferrable,k.condeferred,k.convalidated,k.connoinherit,${constraintDefinition}) item FROM classes c JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid`,
    indexes:`SELECT pg_catalog.jsonb_build_array(c.relname,i.relname,pg_catalog.pg_get_indexdef(x.indexrelid),x.indisvalid,x.indisready,x.indislive,x.indisreplident,x.indisclustered) item FROM classes c JOIN pg_catalog.pg_index x ON x.indrelid=c.oid JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid`,
    // FK-generated internal trigger names contain OIDs. Their semantics are
    // represented by complete constraint definitions, not unstable trigger IDs.
    triggers:`SELECT pg_catalog.jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid,false)) item FROM classes c JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid WHERE NOT t.tgisinternal`,
    functions:`SELECT pg_catalog.jsonb_build_array(p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid),p.prokind,pg_catalog.pg_get_userbyid(p.proowner),${acl('p.proacl')},p.prosecdef,p.proleakproof,p.provolatile,p.proparallel,p.proisstrict,${ordered('p.proconfig')},CASE WHEN p.prokind<>'a' THEN pg_catalog.pg_get_functiondef(p.oid) END) item FROM pg_catalog.pg_proc p JOIN ns n ON p.pronamespace=n.oid`,
    policies:`SELECT pg_catalog.jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,(SELECT pg_catalog.jsonb_agg(CASE WHEN role_id=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(role_id) END ORDER BY CASE WHEN role_id=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(role_id) END COLLATE "C") FROM pg_catalog.unnest(p.polroles) role_id),pg_catalog.pg_get_expr(p.polqual,p.polrelid),pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) item FROM classes c JOIN pg_catalog.pg_policy p ON p.polrelid=c.oid`,
    defaultPrivileges:`SELECT pg_catalog.jsonb_build_array(pg_catalog.pg_get_userbyid(d.defaclrole),d.defaclobjtype,${acl('d.defaclacl')}) item FROM pg_catalog.pg_default_acl d JOIN ns n ON d.defaclnamespace=n.oid`,
    sequences:`SELECT pg_catalog.jsonb_build_array(c.relname,pg_catalog.format_type(s.seqtypid,NULL),s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle,(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(rn.nspname,r.relname,a.attname,d.deptype) ORDER BY rn.nspname COLLATE "C",r.relname COLLATE "C",a.attname COLLATE "C") FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class r ON r.oid=d.refobjid JOIN pg_catalog.pg_namespace rn ON rn.oid=r.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum=d.refobjsubid WHERE d.classid='pg_catalog.pg_class'::regclass AND d.refclassid='pg_catalog.pg_class'::regclass AND d.objid=c.oid AND d.deptype IN('a','i'))) item FROM classes c JOIN pg_catalog.pg_sequence s ON s.seqrelid=c.oid`,
    types:`SELECT pg_catalog.jsonb_build_array(t.typname,t.typtype,pg_catalog.pg_get_userbyid(t.typowner),${acl('t.typacl')},t.typnotnull,pg_catalog.format_type(t.typbasetype,t.typtypmod),t.typdefault,(SELECT pg_catalog.jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_catalog.pg_enum e WHERE e.enumtypid=t.oid),(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(k.conname,pg_catalog.pg_get_constraintdef(k.oid,false)) ORDER BY k.conname COLLATE "C") FROM pg_catalog.pg_constraint k WHERE k.contypid=t.oid)) item FROM pg_catalog.pg_type t JOIN ns n ON t.typnamespace=n.oid`,
  };
}

/** Optional local diagnostic, not recovery evidence and not an equality bypass.
 * Returns only the SAME relation/constraint metadata hashed by the profile; no
 * application rows. Caller must use the profile's serialization/permission
 * settings. Over 5000 objects returns limited=true and entries=null, never an
 * apparently complete prefix. Do not publish diagnostic definitions externally.
 */
export function buildAttendanceRecoveryCatalogDiagnosticSql(options){
  if(!keys(options,['schema','category'])||!validSchema(options.schema)||!['relations','constraints'].includes(options.category))throw new Error('attendance_recovery_diagnostic_invalid');
  const {schema,category}=options;
  const entryKey=category==='relations'?"pg_catalog.jsonb_build_array(item->0)":"pg_catalog.jsonb_build_array(item->0,item->1)";
  return `WITH ns AS MATERIALIZED (SELECT * FROM pg_catalog.pg_namespace WHERE nspname=${literal(schema)}),
  classes AS MATERIALIZED (SELECT c.* FROM pg_catalog.pg_class c JOIN ns n ON c.relnamespace=n.oid),
  bounded_entries AS MATERIALIZED (SELECT ${entryKey} key,item value FROM (${catalogQueries()[category]}) catalog_entries LIMIT 5001)
  SELECT pg_catalog.jsonb_build_object('profile','attendance-recovery-catalog-diagnostic-v1','schema',${literal(schema)},'category',${literal(category)},
    'schemaPresent',EXISTS(SELECT 1 FROM ns),'limited',pg_catalog.count(*)>5000,
    'entries',CASE WHEN pg_catalog.count(*)<=5000 THEN COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',key,'value',value) ORDER BY key::text COLLATE "C"),'[]'::jsonb) END)
  AS attendance_recovery_catalog_diagnostic FROM bounded_entries;`;
}

/** PostgreSQL15 logical comparison, same schema name, same server major and
 * serialization settings. This is NOT a dump, writer freeze, authorization
 * proof, cluster/role backup, production promotion gate or business smoke test.
 * JSONB is logically canonical; text/bytea archive columns retain their exact
 * stored bytes through to_jsonb and the row hash. No secret/raw row is returned.
 * Caller must use the read-only wrapper below (or its exact transaction settings)
 * and an authorized role able to see every row. row_security=off fails closed
 * rather than silently hashing an RLS-filtered subset.
 */
export function buildAttendanceRecoveryContentSql(options){
  if(!keys(options,['schema'])||!validSchema(options.schema))throw new Error('attendance_recovery_schema_invalid');
  const {schema}=options,L=ATTENDANCE_RECOVERY_LIMITS;
  const tableQuery=`WITH bounded AS MATERIALIZED (SELECT pg_catalog.to_jsonb(r)::text value FROM %I.%I r LIMIT ${L.rows+1}),
    hashes AS (SELECT pg_catalog.octet_length(value) bytes,${digest('value')} hash FROM bounded)
    SELECT pg_catalog.jsonb_build_object('rowCount',pg_catalog.count(*)::text,'limited',pg_catalog.count(*)>${L.rows} OR COALESCE(pg_catalog.max(bytes),0)>${L.rowBytes},
    'contentSha256',CASE WHEN pg_catalog.count(*)<=${L.rows} AND COALESCE(pg_catalog.max(bytes),0)<=${L.rowBytes} THEN ${digest("'attendance-recovery-v1:rows:'||COALESCE(pg_catalog.string_agg(hash,'' ORDER BY hash COLLATE \"C\"),'')")} END)::text value FROM hashes`;
  const sequenceQuery=`SELECT pg_catalog.jsonb_build_object('rowCount','1','limited',false,'contentSha256',${digest("'attendance-recovery-v1:sequence:'||pg_catalog.jsonb_build_array(last_value,is_called)::text")})::text value FROM %I.%I`;
  const cats=catalogQueries();
  const summaries=ATTENDANCE_RECOVERY_CATALOG_CATEGORIES.map(category=>`SELECT ${literal(category)} category,pg_catalog.jsonb_build_object('count',pg_catalog.count(*)::text,
    'limited',pg_catalog.count(*)>${L.catalogObjects} OR COALESCE(pg_catalog.max(bytes),0)>${L.rowBytes},'sha256',CASE WHEN pg_catalog.count(*)<=${L.catalogObjects} AND COALESCE(pg_catalog.max(bytes),0)<=${L.rowBytes} THEN
    ${digest(`${literal('attendance-recovery-v1:catalog:'+category+':')}||COALESCE(pg_catalog.string_agg(hash,'' ORDER BY hash COLLATE "C"),'')`)} END) summary
    FROM (SELECT ${digest('item::text')} hash,pg_catalog.octet_length(item::text) bytes FROM (${cats[category]}) entries LIMIT ${L.catalogObjects+1}) hashed`).join('\nUNION ALL\n');
  return `WITH ns AS MATERIALIZED (SELECT * FROM pg_catalog.pg_namespace WHERE nspname=${literal(schema)}),
  classes AS MATERIALIZED (SELECT c.* FROM pg_catalog.pg_class c JOIN ns n ON c.relnamespace=n.oid),
  roster AS MATERIALIZED (SELECT name FROM (VALUES ${ATTENDANCE_RECOVERY_RELATIONS.map(n=>'('+literal(n)+')').join(',')}) tracked(name)
    UNION SELECT relname::text FROM classes WHERE relkind IN('r','p','m','S','f')),
  bounded_roster AS MATERIALIZED (SELECT name FROM roster ORDER BY name COLLATE "C" LIMIT ${L.relations+1}),
  relation_content AS (SELECT r.name,c.relkind,CASE WHEN c.relkind IN('r','p','m','S') THEN
    (pg_catalog.xpath('/table/row/value/text()',pg_catalog.query_to_xml(pg_catalog.format(CASE WHEN c.relkind='S' THEN ${literal(sequenceQuery)} ELSE ${literal(tableQuery)} END,${literal(schema)},r.name),false,false,'')))[1]::text::jsonb END body
    FROM bounded_roster r LEFT JOIN classes c ON c.relname=r.name),
  catalog_content AS (${summaries})
  SELECT pg_catalog.jsonb_build_object('profile',${literal(ATTENDANCE_RECOVERY_PROFILE)},'schemaVersion',1,'schema',${literal(schema)},
    'schemaPresent',EXISTS(SELECT 1 FROM ns),'serverMajor',pg_catalog.current_setting('server_version_num')::integer/10000,
    'limited',(SELECT pg_catalog.count(*)>${L.relations} FROM bounded_roster),
    'unsupported',(SELECT EXISTS(SELECT 1 FROM classes WHERE relkind='f') OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN ns n ON p.pronamespace=n.oid WHERE p.prokind='a') OR EXISTS(SELECT 1 FROM pg_catalog.pg_type t JOIN ns n ON t.typnamespace=n.oid WHERE t.typtype IN('r','m'))),
    'relations',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',name,'present',relkind IS NOT NULL,'kind',relkind,'rowCount',body->'rowCount','limited',COALESCE((body->>'limited')::boolean,false),'contentSha256',body->'contentSha256') ORDER BY name COLLATE "C") FROM relation_content),
    'catalog',(SELECT pg_catalog.jsonb_object_agg(category,summary) FROM catalog_content)) AS attendance_recovery_content;`;
}

export function buildAttendanceRecoveryReadOnlyPsqlArgs(sql){
  if(typeof sql!=='string'||!sql.startsWith('WITH ns AS MATERIALIZED ')||!sql.endsWith(' AS attendance_recovery_content;'))throw new Error('attendance_recovery_query_invalid');
  return ['--command','BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',
    '--command',"SET LOCAL timezone='UTC';",'--command',"SET LOCAL datestyle='ISO,YMD';",
    '--command','SET LOCAL extra_float_digits=3;','--command','SET LOCAL search_path=pg_catalog;',
    '--command','SET LOCAL row_security=off;','--command',"SET LOCAL bytea_output='hex';",
    '--command',"SET LOCAL intervalstyle='postgres';",'--command',"SET LOCAL statement_timeout='60s';",
    '--command',sql,'--command','COMMIT;'];
}

export function validateAttendanceRecoveryContent(value){
  const invalid=()=>({valid:false,error:'attendance_recovery_content_invalid'}),L=ATTENDANCE_RECOVERY_LIMITS;
  if(!keys(value,['profile','schemaVersion','schema','schemaPresent','serverMajor','limited','unsupported','relations','catalog'])||value.profile!==ATTENDANCE_RECOVERY_PROFILE||
    value.schemaVersion!==1||!validSchema(value.schema)||value.schemaPresent!==true||value.serverMajor!==15||value.limited!==false||value.unsupported!==false||
    !Array.isArray(value.relations)||value.relations.length<ATTENDANCE_RECOVERY_RELATIONS.length||value.relations.length>L.relations||!keys(value.catalog,ATTENDANCE_RECOVERY_CATALOG_CATEGORIES))return invalid();
  let previous='';const relations=[];
  for(const item of value.relations){
    if(!keys(item,['name','present','kind','rowCount','limited','contentSha256'])||typeof item.name!=='string'||!identifier.test(item.name)||item.name<=previous||typeof item.present!=='boolean'||item.limited!==false)return invalid();
    if(item.present){if(!['r','p','m','S'].includes(item.kind)||typeof item.rowCount!=='string'||!count.test(item.rowCount)||Number(item.rowCount)>L.rows||typeof item.contentSha256!=='string'||!sha.test(item.contentSha256)||(item.kind==='S'&&item.rowCount!=='1'))return invalid();}
    else if(item.kind!==null||item.rowCount!==null||item.contentSha256!==null)return invalid();
    relations.push({name:item.name,present:item.present,kind:item.kind,rowCount:item.rowCount,limited:false,contentSha256:item.contentSha256});previous=item.name;
  }
  if(ATTENDANCE_RECOVERY_RELATIONS.some(n=>!relations.some(r=>r.name===n))||essential.some(n=>!relations.some(r=>r.name===n&&r.present)))return invalid();
  const catalog={};
  for(const category of ATTENDANCE_RECOVERY_CATALOG_CATEGORIES){
    const item=value.catalog[category];
    if(!keys(item,['count','limited','sha256'])||item.limited!==false||typeof item.count!=='string'||!count.test(item.count)||Number(item.count)>L.catalogObjects||typeof item.sha256!=='string'||!sha.test(item.sha256))return invalid();
    catalog[category]={count:item.count,limited:false,sha256:item.sha256};
  }
  if(catalog.namespace.count!=='1')return invalid();
  return {valid:true,content:{profile:value.profile,schemaVersion:1,schema:value.schema,schemaPresent:true,serverMajor:15,limited:false,unsupported:false,relations,catalog}};
}

export function assertAttendanceRecoveryContentMatch(actual,expected){
  const a=validateAttendanceRecoveryContent(actual),b=validateAttendanceRecoveryContent(expected);
  if(!a.valid||!b.valid)throw new Error('attendance_recovery_content_invalid');
  if(JSON.stringify(a.content)!==JSON.stringify(b.content))throw new Error('attendance_recovery_content_mismatch');
  return a.content;
}
