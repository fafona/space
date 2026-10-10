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
export function attendanceExtensionMetadataSupplement(dump,snapshot){
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
 const sql=dump.slice(0,anchor)+insertion+dump.slice(anchor)+finalGuard;
 need(sql.slice(0,anchor)+sql.slice(anchor+insertion.length,-finalGuard.length)===dump,'attendance_extension_metadata_original_changed');
 const supplementSql=insertion+finalGuard;
 return {sql,supplementSql,supplementSha256:sha(supplementSql),snapshotSha256:validated.snapshotSha256,sourceSha256:sha(dump),insertBeforeFirstAcl:anchor,operations:[{signature:wrapper,operation:'create-missing-member',definitionSha256:validated.wrapper.definitionSha256},{signature:get,operation:'actual-attributes-only',securityDefiner:false,config:['search_path=net']},{signature:post,operation:'actual-attributes-only',securityDefiner:false,config:['search_path=net']}]};
}
