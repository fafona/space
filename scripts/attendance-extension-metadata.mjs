// Actual formal metadata only. No historical hooks, roles, rows or CLI entry.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(value,code)=>{if(!value)throw Error(code);};
const same=(actual,expected,code)=>{try{assert.deepEqual(actual,expected);}catch{throw Error(code);}};
const pgText=value=>`convert_from(decode('${Buffer.from(value,'utf8').toString('hex')}','hex'),'UTF8')`;
export const attendanceExtensionMetadataPins=Object.freeze([
 ['pg_graphql','1.5.11','graphql',10,7],['pg_net','0.14.0','extensions',18,10],
 ['pg_stat_statements','1.10','extensions',5,3],['pgcrypto','1.3','extensions',36,36],
 ['pgjwt','0.2.0','extensions',6,6],['plpgsql','1.0','pg_catalog',4,3],
 ['supabase_vault','0.3.1','vault',7,5],['uuid-ossp','1.1','extensions',10,10]
]);
const wrapper='graphql_public.graphql(text,text,jsonb,jsonb)';
const wrapperPins={bodySha256:'03b36c9655c8688b452fba90346ce43dafa2ded68bffb9250da6c236133d467e',definitionSha256:'22e0e26950cfdf51038425ad17051de3fb19bc7afa72edefda05c2da3e0d8bb2'};
const get='net.http_get(text,jsonb,jsonb,integer)',post='net.http_post(text,jsonb,jsonb,jsonb,integer)';
const netPins={
 [get]:{bodySha256:'c322a26b9fc4dd51d846a98e33eda0f6e370adc783bd2720132f93e09d194c37',definitionSha256:'86fa25bb0510ccef3de5898ad0fb37538d18c08a80a99e7dfa6f86226accbcda'},
 [post]:{bodySha256:'bf3029e1611294a3dfe101c46763bee1d99d7d2b95c5c91a7d86065f44cc0a5f',definitionSha256:'60dee9c36e3e20fdd520c89b1a29477b351fd36610c492a7b569c577b6756891'}
};
const acl=expression=>`(select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable),'[]'::jsonb) from aclexplode(${expression}) a)`;
const routine=()=>`jsonb_build_object(
 'memberIdentity',(pg_identify_object('pg_proc'::regclass,p.oid,0)).identity,
 'signature',n.nspname||'.'||p.proname||'('||(select coalesce(string_agg(format_type(t,null),',' order by ord),'') from unnest(p.proargtypes::oid[]) with ordinality x(t,ord))||')',
 'schema',n.nspname,'name',p.proname,'identityArguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),
 'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'kind',p.prokind,'volatile',p.provolatile,'strict',p.proisstrict,
 'securityDefiner',p.prosecdef,'parallel',p.proparallel,'leakproof',p.proleakproof,'returnsSet',p.proretset,'cost',p.procost,'rows',p.prorows,
 'argumentNames',p.proargnames,'argumentModes',p.proargmodes,'allArgumentTypes',(select array_agg(format_type(t,null) order by ord) from unnest(p.proallargtypes) with ordinality x(t,ord)),
 'defaultCount',p.pronargdefaults,'defaults',pg_get_expr(p.proargdefaults,0),'config',p.proconfig,'binary',p.probin,
 'support',p.prosupport::regprocedure::text,'returnType',format_type(p.prorettype,null),'argumentTypes',(select array_agg(format_type(t,null) order by ord) from unnest(p.proargtypes::oid[]) with ordinality x(t,ord)),
 'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'definition',case when p.prokind<>'a' then pg_get_functiondef(p.oid) else null end,
 'definitionSha256',case when p.prokind<>'a' then encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') else null end,
 'acl',${acl("coalesce(p.proacl,acldefault('f',p.proowner))")})`;

// Every extension-member address is inventoried. Non-routines retain their
// semantic metadata; resolved names replace database-local OIDs. No table rows,
// passwords, physical relation statistics or pg_init_privs are exported.
export function attendanceExtensionMetadataSnapshotExpression(){return `(select coalesce(jsonb_agg(jsonb_build_object(
 'name',e.extname,'version',e.extversion,'schema',en.nspname,'owner',pg_get_userbyid(e.extowner),'relocatable',e.extrelocatable,
 'configuration',(select coalesce(jsonb_agg(jsonb_build_object('relation',r::regclass::text,'condition',e.extcondition[ord::integer]) order by ord),'[]'::jsonb) from unnest(e.extconfig) with ordinality x(r,ord)),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('catalog',d.classid::regclass::text,'type',i.type,'schema',i.schema,'name',i.name,'identity',i.identity,
  'metadata',case
   when d.classid='pg_proc'::regclass then null
   when d.classid='pg_namespace'::regclass then (select jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'acl',${acl("coalesce(n.nspacl,acldefault('n',n.nspowner))")}) from pg_namespace n where n.oid=d.objid)
   when d.classid='pg_language'::regclass then (select jsonb_build_object('owner',pg_get_userbyid(l.lanowner),'procedural',l.lanispl,'trusted',l.lanpltrusted,'handler',l.lanplcallfoid::regprocedure::text,'inline',l.laninline::regprocedure::text,'validator',l.lanvalidator::regprocedure::text,'acl',${acl("coalesce(l.lanacl,acldefault('l',l.lanowner))")}) from pg_language l where l.oid=d.objid)
   when d.classid='pg_event_trigger'::regclass then (select jsonb_build_object('owner',pg_get_userbyid(t.evtowner),'event',t.evtevent,'enabled',t.evtenabled,'function',t.evtfoid::regprocedure::text,'tags',t.evttags) from pg_event_trigger t where t.oid=d.objid)
   when d.classid='pg_class'::regclass then (select jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'persistence',c.relpersistence,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,'replicaIdentity',c.relreplident,'options',c.reloptions,
    'acl',${acl("coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::\"char\" else 'r'::\"char\" end,c.relowner))")},
    'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'collation',(select cn.nspname||'.'||co.collname from pg_collation co join pg_namespace cn on cn.oid=co.collnamespace where co.oid=a.attcollation),'default',pg_get_expr(ad.adbin,ad.adrelid),'acl',${acl('a.attacl')}) order by a.attnum),'[]'::jsonb) from pg_attribute a left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'definition',case when c.relkind in('v','m') then pg_get_viewdef(c.oid,true) when c.relkind in('i','I') then pg_get_indexdef(c.oid) else null end,
    'sequence',(select jsonb_build_array(q.seqtypid::regtype::text,q.seqstart::text,q.seqincrement::text,q.seqmax::text,q.seqmin::text,q.seqcache::text,q.seqcycle) from pg_sequence q where q.seqrelid=c.oid),
    'constraints',(select coalesce(jsonb_agg(jsonb_build_array(k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true)) order by k.conname),'[]'::jsonb) from pg_constraint k where k.conrelid=c.oid)) from pg_class c where c.oid=d.objid)
   when d.classid='pg_type'::regclass then (select jsonb_build_object('owner',pg_get_userbyid(t.typowner),'type',t.typtype,'category',t.typcategory,'preferred',t.typispreferred,'defined',t.typisdefined,'delimiter',t.typdelim,'length',t.typlen,'byValue',t.typbyval,'alignment',t.typalign,'storage',t.typstorage,
    'element',case when t.typelem<>0 then format_type(t.typelem,null) else null end,'base',case when t.typbasetype<>0 then format_type(t.typbasetype,t.typtypmod) else null end,'notNull',t.typnotnull,'default',t.typdefault,
    'input',t.typinput::regprocedure::text,'output',t.typoutput::regprocedure::text,'receive',t.typreceive::regprocedure::text,'send',t.typsend::regprocedure::text,'modifierIn',t.typmodin::regprocedure::text,'modifierOut',t.typmodout::regprocedure::text,'analyze',t.typanalyze::regprocedure::text,
    'acl',${acl("coalesce(t.typacl,acldefault('T',t.typowner))")},'enum',(select coalesce(jsonb_agg(enumlabel order by enumsortorder),'[]'::jsonb) from pg_enum where enumtypid=t.oid),
    'columns',(select coalesce(jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by a.attnum),'[]'::jsonb) from pg_attribute a where a.attrelid=t.typrelid and a.attnum>0 and not a.attisdropped)) from pg_type t where t.oid=d.objid)
   else jsonb_build_object('unsupportedCatalog',d.classid::regclass::text)
  end) order by d.classid::regclass::text,i.identity,d.objsubid),'[]'::jsonb)
  from pg_depend d cross join lateral pg_identify_object(d.classid,d.objid,d.objsubid) i where d.refclassid='pg_extension'::regclass and d.refobjid=e.oid and d.deptype='e'),
 'routines',(select coalesce(jsonb_agg(${routine()} order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
  from pg_depend d join pg_proc p on d.classid='pg_proc'::regclass and p.oid=d.objid join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where d.refclassid='pg_extension'::regclass and d.refobjid=e.oid and d.deptype='e')) order by e.extname),'[]'::jsonb)
 from pg_extension e join pg_namespace en on en.oid=e.extnamespace)`;}
export function attendanceExtensionMetadataSnapshotSql(){return `-- attendance_compatibility_extension_metadata\nbegin read only;set local statement_timeout='8s';set local search_path=pg_catalog,public;select ${attendanceExtensionMetadataSnapshotExpression()}::text;commit;\n`;}
// PostgreSQL int8 exceeds JavaScript's safe number range. Keep all sequence
// integers as canonical decimal text and fail closed on lossy numeric input.
function validateLosslessNumbers(value){
 if(typeof value==='number')need(Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value)),'attendance_extension_metadata_unsafe_number');
 else if(value&&typeof value==='object')for(const child of Object.values(value))validateLosslessNumbers(child);
}
function validateSequence(sequence){
 if(sequence==null)return;
 need(Array.isArray(sequence)&&sequence.length===7&&['smallint','integer','bigint'].includes(sequence[0])&&typeof sequence[6]==='boolean','attendance_extension_metadata_sequence');
 for(const value of sequence.slice(1,6)){
  need(typeof value==='string'&&/^(?:0|-?[1-9][0-9]*)$/.test(value)&&value.length<=20,'attendance_extension_metadata_sequence_integer');
  const integer=BigInt(value);
  need(integer>=-9223372036854775808n&&integer<=9223372036854775807n,'attendance_extension_metadata_sequence_integer');
 }
}
export function validateAttendanceExtensionMetadata(snapshot){
 need(Array.isArray(snapshot)&&snapshot.length===8,'attendance_extension_metadata_extensions');
 validateLosslessNumbers(snapshot);
 same(snapshot.map(e=>[e.name,e.version,e.schema,e.members?.length,e.routines?.length]),attendanceExtensionMetadataPins,'attendance_extension_metadata_pins');
 const catalogs=['pg_proc','pg_namespace','pg_language','pg_class','pg_type','pg_event_trigger'];
 for(const e of snapshot){
  need(e.owner==='supabase_admin'&&e.members.every(m=>catalogs.includes(m.catalog)&&typeof m.identity==='string'&&!m.metadata?.unsupportedCatalog),'attendance_extension_metadata_member');
  for(const member of e.members)if(member.catalog==='pg_class')validateSequence(member.metadata?.sequence);
  need(new Set(e.members.map(m=>m.catalog+':'+m.identity)).size===e.members.length&&new Set(e.routines.map(r=>r.signature)).size===e.routines.length,'attendance_extension_metadata_duplicates');
  const routineMembers=e.members.filter(m=>m.catalog==='pg_proc');
  need(routineMembers.length===e.routines.length&&e.routines.every(r=>routineMembers.some(m=>m.identity===r.memberIdentity)),'attendance_extension_metadata_routine_members');
  for(const r of e.routines)need(r.owner==='supabase_admin'&&typeof r.definition==='string'&&r.definition.length<1000000&&/^[a-f0-9]{64}$/.test(r.bodySha256)&&sha(r.definition)===r.definitionSha256&&Array.isArray(r.acl),'attendance_extension_metadata_routine');
 }
 const find=(extension,signature)=>snapshot.find(e=>e.name===extension).routines.find(r=>r.signature===signature);
 const graph=find('pg_graphql',wrapper);
 need(graph?.language==='sql'&&graph.kind==='f'&&graph.result==='jsonb'&&graph.securityDefiner===false&&graph.config===null&&graph.defaultCount===4,'attendance_extension_metadata_wrapper');
 need(/^CREATE OR REPLACE FUNCTION graphql_public\.graphql\(/.test(graph.definition)&&graph.definition.endsWith('\n')&&!graph.definition.includes('\0'),'attendance_extension_metadata_wrapper_definition');
 same({bodySha256:graph.bodySha256,definitionSha256:graph.definitionSha256},wrapperPins,'attendance_extension_metadata_wrapper_source');
 for(const signature of [get,post]){
  const r=find('pg_net',signature);
  need(r?.language==='plpgsql'&&r.kind==='f'&&r.result==='bigint'&&r.securityDefiner===false,'attendance_extension_metadata_net');
  same(r.config,['search_path=net'],'attendance_extension_metadata_net_config');
  same({bodySha256:r.bodySha256,definitionSha256:r.definitionSha256},netPins[signature],'attendance_extension_metadata_net_source');
 }
 return {snapshot,snapshotSha256:sha(JSON.stringify(snapshot)),wrapper:graph,net:[find('pg_net',get),find('pg_net',post)]};
}

// The anchor lexer recognizes only complete top-level statements. Quoted
// strings, dollar bodies and nested comments cannot supply an ACL/CREATE anchor.
function statements(source){
 const result=[];let start=0,masked='';
 for(let i=0;i<source.length;){
  if(source.startsWith('--',i)){let end=source.indexOf('\n',i);if(end<0)end=source.length;masked+=' '.repeat(end-i);i=end;continue;}
  if(source.startsWith('/*',i)){let end=i+2,depth=1;while(end<source.length&&depth){if(source.startsWith('/*',end)){depth++;end+=2;}else if(source.startsWith('*/',end)){depth--;end+=2;}else end++;}need(depth===0,'attendance_extension_metadata_dump_anchor');masked+=' '.repeat(end-i);i=end;continue;}
  const dollar=source.slice(i).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i);
  if(dollar){const end=source.indexOf(dollar[0],i+dollar[0].length);need(end>=0,'attendance_extension_metadata_dump_anchor');const until=end+dollar[0].length;masked+=' '.repeat(until-i);i=until;continue;}
  if(source[i]==="'"){let end=i+1,closed=false;const escaped=/[eE]/.test(source[i-1]??'')&&!/[a-z0-9_$]/i.test(source[i-2]??'');while(end<source.length){if(escaped&&source[end]==='\\'){end+=2;continue;}if(source[end]==="'"){if(source[end+1]==="'"){end+=2;continue;}end++;closed=true;break;}end++;}need(closed,'attendance_extension_metadata_dump_anchor');masked+=' '.repeat(end-i);i=end;continue;}
  if(source[i]==='"'){let end=i+1,closed=false;while(end<source.length){if(source[end]==='"'){if(source[end+1]==='"'){end+=2;continue;}end++;closed=true;break;}end++;}need(closed,'attendance_extension_metadata_dump_anchor');const quoted=source.slice(i,end);masked+=/^"[a-z_][a-z0-9_]*"$/i.test(quoted)?quoted.slice(1,-1):quoted;i=end;continue;}
  masked+=source[i];i++;
  if(source[i-1]===';'){result.push({start,end:i,code:masked.replace(/\s+/g,' ').trim()});start=i;masked='';}
 }
 need(!masked.trim(),'attendance_extension_metadata_dump_anchor');return result;
}
const graphqlAclRoles=Object.freeze(['anon','authenticated','postgres','service_role']);
const graphqlAclFunctions=Object.freeze(['graphql._internal_resolve(text,jsonb,text,jsonb)','graphql.comment_directive(text)','graphql.exception(text)','graphql.get_schema_version()','graphql.increment_schema_version()','graphql.resolve(text,jsonb,text,jsonb)']);
const graphqlSequence='graphql.seq_schema_version';
function checkedSupplementOptions(options){
 const keys=['restoreGraphqlInitialAcl','restoreGraphqlInitialSchemaAcl'];
 need(options&&typeof options==='object'&&!Array.isArray(options)&&Reflect.ownKeys(options).every(k=>keys.includes(k))&&
  keys.every(k=>!Object.hasOwn(options,k)||typeof options[k]==='boolean'),'attendance_extension_metadata_options');
 return Object.fromEntries(keys.map(k=>[k,Object.hasOwn(options,k)&&options[k]===true]));
}
function canonicalAcl(entries){
 need(Array.isArray(entries),'attendance_extension_graphql_acl_expected');
 for(const a of entries)need(a&&typeof a==='object'&&!Array.isArray(a)&&Object.keys(a).length===4&&
  ['grantor','grantee','privilege','grantable'].every(k=>Object.hasOwn(a,k)),'attendance_extension_graphql_acl_expected');
 return entries.map(a=>[a.grantor,a.grantee,a.privilege,a.grantable]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
}
// Explicitly authorized for the fixed NEW isolated clone only. The old sealed
// supplement is byte-identical when this independent option is not selected.
function graphqlInitialAclSupplement(snapshot){
 const extension=snapshot.find(e=>e.name==='pg_graphql');
 need(extension?.version==='1.5.11'&&extension.schema==='graphql'&&extension.owner==='supabase_admin','attendance_extension_graphql_acl_extension');
 const expectedAcl=(grantees,privileges)=>grantees.flatMap(grantee=>privileges.map(privilege=>({grantor:'supabase_admin',grantee,privilege,grantable:false})));
 const sequence=extension.members.filter(m=>m.catalog==='pg_class'&&m.identity===graphqlSequence);
 need(sequence.length===1&&sequence[0].type==='sequence'&&sequence[0].metadata?.kind==='S'&&sequence[0].metadata.owner==='supabase_admin','attendance_extension_graphql_acl_sequence');
 const targets=[{catalog:'pg_class',signature:graphqlSequence,expected:sequence[0],acl:sequence[0].metadata.acl,privileges:['SELECT','UPDATE','USAGE'],grantees:[...graphqlAclRoles,'supabase_admin']}];
 for(const signature of graphqlAclFunctions){
  const routines=extension.routines.filter(r=>r.signature===signature);
  need(routines.length===1&&routines[0].owner==='supabase_admin'&&routines[0].kind==='f'&&
   extension.members.filter(m=>m.catalog==='pg_proc'&&m.identity===routines[0].memberIdentity).length===1,'attendance_extension_graphql_acl_function');
  targets.push({catalog:'pg_proc',signature,expected:routines[0],acl:routines[0].acl,privileges:['EXECUTE'],grantees:['PUBLIC',...graphqlAclRoles,'supabase_admin']});
 }
 let sql=`\n-- Seven actual pg_graphql initial ACLs omitted by pg_dump's initial-privilege delta.\nset local search_path=pg_catalog,public;\ndo $attendance_extension_graphql_initial_acl$\ndeclare\n actual_snapshot jsonb;actual_object jsonb;actual_acl jsonb;\nbegin\n if current_database()<>'faolla_attendance_compat_a535a308e21f' or current_user<>'supabase_admin' or session_user<>'supabase_admin' or not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_graphql' and e.extversion='1.5.11' and n.nspname='graphql' and pg_get_userbyid(e.extowner)='supabase_admin') then raise exception 'attendance_extension_graphql_acl_identity';end if;\n actual_snapshot:=${attendanceExtensionMetadataSnapshotExpression()};\n`;
 const operations=[];
 for(const target of targets){
  same(canonicalAcl(target.acl),canonicalAcl(expectedAcl(target.grantees,target.privileges)),'attendance_extension_graphql_acl_expected');
  const isSequence=target.catalog==='pg_class',lookup=isSequence?`to_regclass('${target.signature}')`:`to_regprocedure('${target.signature}')`;
  const objectGuard=isSequence?`exists(select 1 from pg_class c where c.oid=${lookup} and c.relkind='S' and pg_get_userbyid(c.relowner)='supabase_admin')`:
   `exists(select 1 from pg_proc p where p.oid=${lookup} and p.prokind='f' and pg_get_userbyid(p.proowner)='supabase_admin')`;
  sql+=` if not ${objectGuard} or (select count(*) from pg_depend d join pg_extension e on e.oid=d.refobjid where d.classid='${target.catalog}'::regclass and d.objid=${lookup} and d.objsubid=0 and d.refclassid='pg_extension'::regclass and d.refobjsubid=0 and d.deptype='e' and e.extname='pg_graphql' and e.extversion='1.5.11' and pg_get_userbyid(e.extowner)='supabase_admin')<>1 then raise exception 'attendance_extension_graphql_acl_member';end if;\n`;
  sql+=` select x.value into strict actual_object from jsonb_array_elements(actual_snapshot) e cross join lateral jsonb_array_elements(e.value->'${isSequence?'members':'routines'}') x where e.value->>'name'='pg_graphql' and ${isSequence?`x.value->>'catalog'='pg_class' and x.value->>'identity'`:`x.value->>'signature'`}='${target.signature}';\n`;
  const expected=pgText(JSON.stringify(target.expected))+'::jsonb',full=pgText(JSON.stringify(target.acl))+'::jsonb';
  const base=pgText(JSON.stringify(target.acl.filter(a=>isSequence?a.grantee==='supabase_admin'&&a.privilege==='USAGE':a.grantee==='supabase_admin'||a.grantee==='PUBLIC')))+'::jsonb';
  sql+=isSequence?` if actual_object #- '{metadata,acl}' is distinct from (${expected} #- '{metadata,acl}') then raise exception 'attendance_extension_graphql_acl_nonacl_changed';end if;\n actual_acl:=actual_object#>'{metadata,acl}';\n`:
   ` if actual_object-'acl' is distinct from (${expected}-'acl') then raise exception 'attendance_extension_graphql_acl_nonacl_changed';end if;\n actual_acl:=actual_object->'acl';\n`;
  sql+=` if actual_acl is distinct from ${base} and actual_acl is distinct from ${full} then raise exception 'attendance_extension_graphql_acl_prestate';end if;\n if actual_acl=${base} then\n`;
  if(isSequence)sql+=`  grant SELECT, UPDATE on sequence ${target.signature} to supabase_admin granted by supabase_admin;\n`;
  for(const role of graphqlAclRoles)sql+=`  grant ${target.privileges.join(', ')} on ${isSequence?'sequence':'function'} ${target.signature} to ${role} granted by supabase_admin;\n`;
  sql+=' end if;\n';
  operations.push({catalog:target.catalog,signature:target.signature,operation:'restore-actual-initial-acl',extension:'pg_graphql',version:'1.5.11',grantor:'supabase_admin',missingGrantees:[...graphqlAclRoles],privileges:target.privileges,...(isSequence?{missingOwnerPrivileges:['SELECT','UPDATE']}:{}),expectedAcl:target.acl});
 }
 sql+='end;\n$attendance_extension_graphql_initial_acl$;\n';return {sql,operations};
}
const graphqlAclSchemas=Object.freeze(['graphql','graphql_public']);
const graphqlSchemaExpectedAcl=()=>[
 ...['anon','authenticated'].map(grantee=>({grantor:'supabase_admin',grantee,privilege:'USAGE',grantable:false})),
 {grantor:'supabase_admin',grantee:'postgres',privilege:'USAGE',grantable:true},
 {grantor:'supabase_admin',grantee:'service_role',privilege:'USAGE',grantable:false},
 ...['CREATE','USAGE'].map(privilege=>({grantor:'supabase_admin',grantee:'supabase_admin',privilege,grantable:false}))
];
const graphqlSchemaCurrentExpression=()=>`(select coalesce(jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',${acl("coalesce(n.nspacl,acldefault('n',n.nspowner))")}) order by n.nspname),'[]'::jsonb) from pg_namespace n where n.nspname in ('graphql','graphql_public'))`;
// These namespaces are not pg_graphql extension members. Keep the original
// 8-extension / 96-member / 80-routine snapshot and its sealed hashes unchanged.
export function attendanceGraphqlInitialSchemaAclSnapshotExpression(){return `(select coalesce(jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',${acl("coalesce(n.nspacl,acldefault('n',n.nspowner))")},'initialAcl',${acl('i.initprivs')},'initialPrivilegeType',i.privtype) order by n.nspname),'[]'::jsonb) from pg_namespace n left join pg_init_privs i on i.classoid='pg_namespace'::regclass and i.objoid=n.oid and i.objsubid=0 where n.nspname in ('graphql','graphql_public'))`;}
export function attendanceGraphqlInitialSchemaAclSnapshotSql(){return `-- attendance_compatibility_graphql_initial_schema_acl\nbegin read only;set local statement_timeout='8s';set local search_path=pg_catalog,public;select ${attendanceGraphqlInitialSchemaAclSnapshotExpression()}::text;commit;\n`;}
export function validateAttendanceGraphqlInitialSchemaAclSnapshot(snapshot){
 need(Array.isArray(snapshot)&&snapshot.length===2,'attendance_extension_graphql_schema_acl_snapshot');
 same(snapshot.map(s=>s?.name),graphqlAclSchemas,'attendance_extension_graphql_schema_acl_snapshot');
 for(const schema of snapshot){
  need(schema&&typeof schema==='object'&&!Array.isArray(schema)&&Reflect.ownKeys(schema).length===5&&
   ['name','owner','acl','initialAcl','initialPrivilegeType'].every(k=>Object.hasOwn(schema,k))&&schema.owner==='supabase_admin'&&schema.initialPrivilegeType==='e','attendance_extension_graphql_schema_acl_expected');
  for(const entries of [schema.acl,schema.initialAcl]){
   need(Array.isArray(entries)&&entries.every(a=>a&&typeof a==='object'&&!Array.isArray(a)&&Reflect.ownKeys(a).length===4&&
    ['grantor','grantee','privilege','grantable'].every(k=>Object.hasOwn(a,k))),'attendance_extension_graphql_schema_acl_expected');
   same(canonicalAcl(entries),canonicalAcl(graphqlSchemaExpectedAcl()),'attendance_extension_graphql_schema_acl_expected');
  }
 }
 return {snapshot,snapshotSha256:sha(JSON.stringify(snapshot))};
}
function graphqlInitialSchemaAclSupplement(snapshot){
 const validated=validateAttendanceGraphqlInitialSchemaAclSnapshot(snapshot);
 const full=graphqlSchemaExpectedAcl(),base=full.filter(a=>a.grantee==='supabase_admin');
 const expected=snapshot.map(s=>({name:s.name,owner:s.owner,acl:full}));
 let sql=`\n-- Two actual GraphQL initial schema ACLs omitted by pg_dump's initial-privilege delta.\nset local search_path=pg_catalog,public;\ndo $attendance_extension_graphql_initial_schema_acl$\ndeclare\n actual_snapshot jsonb;actual_object jsonb;actual_acl jsonb;\nbegin\n if current_database()<>'faolla_attendance_compat_a535a308e21f' or current_user<>'supabase_admin' or session_user<>'supabase_admin' or not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_graphql' and e.extversion='1.5.11' and n.nspname='graphql' and pg_get_userbyid(e.extowner)='supabase_admin') then raise exception 'attendance_extension_graphql_schema_acl_identity';end if;\n actual_snapshot:=${graphqlSchemaCurrentExpression()};\n if jsonb_array_length(actual_snapshot)<>2 then raise exception 'attendance_extension_graphql_schema_acl_prestate';end if;\n`;
 // Validate BOTH namespaces before any of the eight authorized GRANTs. No
 // partial, widened, wrong-owner or unknown-role prestate is repaired.
 for(const schema of expected){
  sql+=` select x.value into strict actual_object from jsonb_array_elements(actual_snapshot) x where x.value->>'name'='${schema.name}';\n if actual_object-'acl' is distinct from ${pgText(JSON.stringify({name:schema.name,owner:schema.owner}))}::jsonb then raise exception 'attendance_extension_graphql_schema_acl_owner';end if;\n actual_acl:=actual_object->'acl';\n if actual_acl is distinct from ${pgText(JSON.stringify(base))}::jsonb and actual_acl is distinct from ${pgText(JSON.stringify(full))}::jsonb then raise exception 'attendance_extension_graphql_schema_acl_prestate';end if;\n`;
 }
 for(const schema of expected){
  sql+=` if (select x.value->'acl' from jsonb_array_elements(actual_snapshot) x where x.value->>'name'='${schema.name}')=${pgText(JSON.stringify(base))}::jsonb then\n`;
  for(const role of ['anon','authenticated','service_role'])sql+=`  grant USAGE on schema ${schema.name} to ${role} granted by supabase_admin;\n`;
  sql+=`  grant USAGE on schema ${schema.name} to postgres with grant option granted by supabase_admin;\n end if;\n`;
 }
 sql+=` if ${graphqlSchemaCurrentExpression()} is distinct from ${pgText(JSON.stringify(expected))}::jsonb then raise exception 'attendance_extension_graphql_schema_acl_poststate';end if;\nend;\n$attendance_extension_graphql_initial_schema_acl$;\n`;
 return {sql,snapshotSha256:validated.snapshotSha256,operations:expected.map(schema=>({catalog:'pg_namespace',signature:schema.name,operation:'restore-actual-initial-schema-acl',extension:'pg_graphql',version:'1.5.11',grantor:'supabase_admin',missingGrantees:[...graphqlAclRoles],privileges:['USAGE'],grantOptionGrantees:['postgres'],expectedAcl:schema.acl}))};
}
export function attendanceExtensionMetadataSupplement(dump,snapshot,options={},schemaSnapshot){
 const {restoreGraphqlInitialAcl,restoreGraphqlInitialSchemaAcl}=checkedSupplementOptions(options);
 need(restoreGraphqlInitialSchemaAcl||schemaSnapshot===undefined,'attendance_extension_metadata_options');
 need(typeof dump==='string'&&dump.length>0&&Buffer.byteLength(dump)<16000000&&!dump.includes('\0'),'attendance_extension_metadata_dump');
 const validated=validateAttendanceExtensionMetadata(snapshot),parsed=statements(dump);
 const graphAcl=/^GRANT ALL ON FUNCTION graphql_public\.graphql\((?:text, text, jsonb, jsonb|operationName text, query text, variables jsonb, extensions jsonb)\) TO (anon|authenticated|postgres|service_role)(?: WITH GRANT OPTION)?;$/i;
 const grants=parsed.filter(s=>graphAcl.test(s.code));
 need(grants.length===4&&!parsed.some(s=>/^CREATE (?:OR REPLACE )?FUNCTION graphql_public\.graphql\(/i.test(s.code)),'attendance_extension_metadata_dump_anchor');
 need(parsed.filter(s=>/\bgraphql_public\.graphql\(/i.test(s.code)).every(s=>graphAcl.test(s.code)),'attendance_extension_metadata_dump_wrapper_reference');
 same(grants.map(s=>s.code.match(graphAcl)[1].toLowerCase()).sort(),['anon','authenticated','postgres','service_role'],'attendance_extension_metadata_dump_roles');
 const anchor=grants[0].start;
 for(const [name,schema] of [['pg_graphql','graphql'],['pg_net','extensions']])need(parsed.some(s=>s.end<=anchor&&s.code===`CREATE EXTENSION IF NOT EXISTS ${name} WITH SCHEMA ${schema};`),'attendance_extension_metadata_dump_extension');
 const wrapperSql=`-- Actual extension member omitted by pg_dump; no historical hook is replayed.\ndo $attendance_extension_wrapper$\nbegin\n if to_regprocedure('${wrapper}') is not null or not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_graphql' and e.extversion='1.5.11' and n.nspname='graphql' and pg_get_userbyid(e.extowner)='supabase_admin') then raise exception 'attendance_extension_wrapper_prestate';end if;\n execute ${pgText(validated.wrapper.definition)};\n alter function ${wrapper} owner to supabase_admin;\n alter extension pg_graphql add function ${wrapper};\n if (select encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${wrapper}')),'UTF8')),'hex'))<>${pgText(validated.wrapper.definitionSha256)} then raise exception 'attendance_extension_wrapper_definition';end if;\nend;\n$attendance_extension_wrapper$;\n`;
 let attributes='-- Only actual formal attributes of the two fixed pg_net routines.\ndo $attendance_extension_net$\nbegin\n';
 for(const r of validated.net){attributes+=` if not exists(select 1 from pg_proc p join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.refclassid='pg_extension'::regclass and d.deptype='e' join pg_extension e on e.oid=d.refobjid where p.oid=to_regprocedure('${r.signature}') and e.extname='pg_net' and e.extversion='0.14.0' and pg_get_userbyid(e.extowner)='supabase_admin' and pg_get_userbyid(p.proowner)='supabase_admin' and (p.proconfig is null or p.proconfig=array['search_path=net']) and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='${r.bodySha256}') then raise exception 'attendance_extension_net_prestate';end if;\n alter function ${r.signature} security invoker;\n alter function ${r.signature} set search_path=net;\n`;}
 attributes+='end;\n$attendance_extension_net$;\n';
 const insertion=wrapperSql+attributes;
 const finalGuard=`\n-- Compare every actual extension member and routine before metadata COMMIT.\nset local search_path=pg_catalog,public;\ndo $attendance_extension_full_metadata$\nbegin\n if ${attendanceExtensionMetadataSnapshotExpression()}<>${pgText(JSON.stringify(snapshot))}::jsonb then raise exception 'attendance_extension_full_metadata_mismatch';end if;\nend;\n$attendance_extension_full_metadata$;\n`;
 const aclSupplement=restoreGraphqlInitialAcl?graphqlInitialAclSupplement(snapshot):{sql:'',operations:[]};
 const schemaAclSupplement=restoreGraphqlInitialSchemaAcl?graphqlInitialSchemaAclSupplement(schemaSnapshot):{sql:'',operations:[]};
 const sql=dump.slice(0,anchor)+insertion+dump.slice(anchor)+aclSupplement.sql+schemaAclSupplement.sql+finalGuard;
 need(sql.slice(0,anchor)+sql.slice(anchor+insertion.length,-(aclSupplement.sql.length+schemaAclSupplement.sql.length+finalGuard.length))===dump,'attendance_extension_metadata_original_changed');
 const supplementSql=insertion+aclSupplement.sql+schemaAclSupplement.sql+finalGuard;
 return {sql,supplementSql,supplementSha256:sha(supplementSql),snapshotSha256:validated.snapshotSha256,sourceSha256:sha(dump),insertBeforeFirstAcl:anchor,operations:[{signature:wrapper,operation:'create-missing-member',definitionSha256:validated.wrapper.definitionSha256},{signature:get,operation:'actual-attributes-only',securityDefiner:false,config:['search_path=net']},{signature:post,operation:'actual-attributes-only',securityDefiner:false,config:['search_path=net']},...aclSupplement.operations,...schemaAclSupplement.operations],...(restoreGraphqlInitialSchemaAcl?{schemaSnapshotSha256:schemaAclSupplement.snapshotSha256}:{})};
}
