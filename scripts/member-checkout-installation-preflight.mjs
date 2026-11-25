// Fixed, metadata-only observation. No connector, DDL, credentials, production
// approval or automatic baseline refresh. The caller owns the transaction.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {installationBundleSummary} from './member-checkout-installation-bundle.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const observations=new WeakSet();
const sections=['roles','memberships','defaultAcls','schemas','relations','columns','constraints','indexes','functions','extensions'];

// One SELECT = one catalogue snapshot. No customer/auth/message/financial rows,
// passwords, JWT settings, function bodies or filesystem paths are returned.
// SHA-256 is built into PG 15/17; no extension or additional grant is installed.
export const installationPreflightSql=`WITH
 selected_relations AS (
  SELECT c.*,n.nspname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='faolla_checkout_design' OR n.nspname='public' AND c.relname IN
   ('pages','faolla_schema_migrations','faolla_booking_atomic_control','faolla_booking_atomic_commands')
 ),
 registry_entries AS (
  SELECT version::text version,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(name,'UTF8')),'hex') AS "nameSha256"
  FROM public.faolla_schema_migrations ORDER BY version LIMIT 1001
 )
 SELECT pg_catalog.jsonb_build_object(
 'context',pg_catalog.jsonb_build_object('backendPid',pg_catalog.pg_backend_pid(),
  'readOnly',pg_catalog.current_setting('transaction_read_only')='on',
  'isolation',pg_catalog.current_setting('transaction_isolation'),'searchPath',pg_catalog.current_setting('search_path')),
 'target',pg_catalog.jsonb_build_object(
  'clusterSha256',(SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(system_identifier::text,'UTF8')),'hex') FROM pg_catalog.pg_control_system()),
  'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
  'databaseName',pg_catalog.current_database(),'databaseOwner',(SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
  'databaseEncoding',pg_catalog.current_setting('server_encoding'),
  'serverVersion',pg_catalog.current_setting('server_version_num'),'serverAddress',pg_catalog.inet_server_addr()::text,'serverPort',pg_catalog.inet_server_port(),
  'sessionUser',SESSION_USER,'currentRole',CURRENT_USER,
  'actor',(SELECT pg_catalog.to_jsonb(r) FROM (SELECT oid::text,rolname::text,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls,rolreplication
   FROM pg_catalog.pg_roles WHERE rolname=CURRENT_USER) r)),
 'registry',pg_catalog.jsonb_build_object('count',(SELECT pg_catalog.count(*)::integer FROM public.faolla_schema_migrations),
  'entries',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY version),'[]'::jsonb) FROM registry_entries r)),
 'roles',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY rolname),'[]'::jsonb) FROM (
  SELECT oid::text,rolname::text,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls,rolreplication,rolconnlimit,
   extract(epoch FROM rolvaliduntil)::text AS valid_until FROM pg_catalog.pg_roles) r),
 'memberships',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY parent,child,grantor),'[]'::jsonb) FROM (
  SELECT pg_catalog.pg_get_userbyid(roleid) parent,pg_catalog.pg_get_userbyid(member) child,pg_catalog.pg_get_userbyid(grantor) grantor,
   admin_option,pg_catalog.to_jsonb(m)->'inherit_option' AS inherit_option,pg_catalog.to_jsonb(m)->'set_option' AS set_option FROM pg_catalog.pg_auth_members m) r),
 'defaultAcls',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY owner,namespace,kind),'[]'::jsonb) FROM (
  SELECT pg_catalog.pg_get_userbyid(d.defaclrole) owner,n.nspname namespace,d.defaclobjtype kind,
   ARRAY(SELECT acl::text FROM pg_catalog.unnest(d.defaclacl) a(acl) ORDER BY acl::text) acl
  FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace) r),
 'schemas',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY name),'[]'::jsonb) FROM (
  SELECT oid::text,nspname::text name,pg_catalog.pg_get_userbyid(nspowner) owner,
   ARRAY(SELECT acl::text FROM pg_catalog.unnest(coalesce(nspacl,pg_catalog.acldefault('n',nspowner))) a(acl) ORDER BY acl::text) acl
  FROM pg_catalog.pg_namespace WHERE nspname IN ('public','faolla_checkout_design')) r),
 'relations',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY namespace,name),'[]'::jsonb) FROM (
  SELECT oid::text,nspname::text namespace,relname::text name,relkind kind,relpersistence persistence,
   pg_catalog.pg_get_userbyid(relowner) owner,relrowsecurity rls,relforcerowsecurity forced,
   ARRAY(SELECT acl::text FROM pg_catalog.unnest(coalesce(relacl,pg_catalog.acldefault('r',relowner))) a(acl) ORDER BY acl::text) acl
  FROM selected_relations) r),
 'columns',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY relation,ordinal),'[]'::jsonb) FROM (
  SELECT c.oid::text relation,a.attnum ordinal,a.attname::text name,pg_catalog.format_type(a.atttypid,a.atttypmod) type,a.attnotnull not_null,
   a.attidentity AS "identity",a.attgenerated AS "generated",a.attcollation::text AS "collation",
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'UTF8')),'hex') default_sha256,
   ARRAY(SELECT acl::text FROM pg_catalog.unnest(a.attacl) x(acl) ORDER BY acl::text) acl
  FROM selected_relations c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
  WHERE a.attnum>0 AND NOT a.attisdropped) r),
 'constraints',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY relation,name),'[]'::jsonb) FROM (
  SELECT c.oid::text relation,k.oid::text,k.conname::text name,k.contype kind,k.convalidated validated,k.condeferrable AS "deferrable",k.condeferred deferred,
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_constraintdef(k.oid,false),'UTF8')),'hex') definition_sha256
  FROM selected_relations c JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid) r),
 'indexes',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY relation,oid),'[]'::jsonb) FROM (
  SELECT c.oid::text relation,i.indexrelid::text oid,i.indisvalid valid,i.indisready ready,i.indislive live,
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_indexdef(i.indexrelid),'UTF8')),'hex') definition_sha256
  FROM selected_relations c JOIN pg_catalog.pg_index i ON i.indrelid=c.oid) r),
 'functions',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY namespace,name,oid),'[]'::jsonb) FROM (
  SELECT p.oid::text,n.nspname::text namespace,p.proname::text name,pg_catalog.pg_get_userbyid(p.proowner) owner,
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') definition_sha256,
   ARRAY(SELECT acl::text FROM pg_catalog.unnest(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a(acl) ORDER BY acl::text) acl
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prokind='f' AND (n.nspname='faolla_checkout_design' OR n.nspname='public' AND p.proname LIKE 'faolla_%')) r),
 'extensions',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY name),'[]'::jsonb) FROM (
  SELECT e.oid::text,e.extname::text name,e.extversion version,pg_catalog.pg_get_userbyid(e.extowner) owner,n.nspname namespace
  FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace) r)
 ) AS metadata`;

export async function readInstallationPreflight(query,bundle) {
  try {
    const source=installationBundleSummary(bundle);assert.equal(typeof query,'function');
    const result=await query(installationPreflightSql);assert.equal(result.rows.length,1);
    const wire=canonical(result.rows[0].metadata);assert.ok(Buffer.byteLength(wire,'utf8')<=2*1024*1024);
    const data=JSON.parse(wire);
    assert.deepEqual(Object.keys(data).sort(),['context','target','registry',...sections].sort());
    assert.equal(data.context.searchPath.replace(/\s/g,''),'pg_catalog,public');
    assert.equal(typeof data.context.readOnly,'boolean');assert.ok(Number.isInteger(data.context.backendPid));
    assert.ok(['read committed','repeatable read','serializable'].includes(data.context.isolation));
    const target=data.target;assert.match(target.clusterSha256,/^[a-f0-9]{64}$/);
    assert.match(target.databaseOid,/^[1-9][0-9]*$/);assert.match(target.serverVersion,/^1[5-7][0-9]{4}$/);
    assert.ok([target.databaseName,target.databaseOwner,target.sessionUser,target.currentRole].every(v=>typeof v==='string'&&v.length>0&&v.length<=63));
    assert.equal(target.actor.rolname,target.currentRole);assert.match(target.actor.oid,/^[1-9][0-9]*$/);
    assert.equal(typeof target.actor.rolsuper,'boolean');
    assert.ok(Number.isSafeInteger(data.registry.count)&&data.registry.count>=0&&data.registry.count<=1000);
    assert.equal(data.registry.entries.length,data.registry.count);
    assert.equal(new Set(data.registry.entries.map(v=>v.version)).size,data.registry.count);
    for(const entry of data.registry.entries){assert.deepEqual(Object.keys(entry).sort(),['nameSha256','version']);assert.match(entry.version,/^[0-9]{12,14}$/);assert.match(entry.nameSha256,/^[a-f0-9]{64}$/);}
    for(const key of sections){assert.ok(Array.isArray(data[key])&&data[key].length<=5000);assert.ok(data[key].every(v=>v&&typeof v==='object'&&!Array.isArray(v)));}
    const catalog=Object.fromEntries(sections.map(key=>[key,data[key]]));
    const material={sourceBundleSha256:source.sha256,target,registry:data.registry,catalog};
    const observation=freeze({sourceBundleSha256:source.sha256,targetSha256:sha(canonical(target)),
      registrySha256:sha(canonical(data.registry)),catalogSha256:sha(canonical(catalog)),sha256:sha(canonical(material)),data});
    observations.add(observation);return observation;
  } catch(error) {
    // Preserve only a fixed SQLSTATE / numeric position in OUR fixed query.
    // Never propagate server messages, raw SQL, rows or connection details.
    const state=/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:null;
    const position=/^[0-9]{1,6}$/.test(error?.position??'')&&Number(error.position)<=installationPreflightSql.length?Number(error.position):null;
    throw Object.assign(Error('installation_preflight_unavailable'),{code:state?'PREFLIGHT_'+state+(position?'_AT_'+position:''):'CHECKOUT_PREFLIGHT_INVALID'});
  }
}

export function assertInstallationTarget(reference,current) {
  assert.ok(observations.has(reference)&&observations.has(current),'installation_preflight_not_observed');
  assert.equal(current.sourceBundleSha256,reference.sourceBundleSha256,'installation_source_changed');
  assert.equal(current.targetSha256,reference.targetSha256,'installation_target_changed');
}
export function assertInstallationPreflight(reference,current) {
  assertInstallationTarget(reference,current);
  assert.equal(current.sha256,reference.sha256,'installation_preflight_changed');
}
export function installationPreflightSummary(observation) {
  assert.ok(observations.has(observation),'installation_preflight_not_observed');
  return {version:1,scope:'installation-metadata-evidence-no-execution-authority',sha256:observation.sha256,sourceBundleSha256:observation.sourceBundleSha256,
    targetSha256:observation.targetSha256,registrySha256:observation.registrySha256,catalogSha256:observation.catalogSha256,
    registryRows:observation.data.registry.count,businessRowsRead:false,productionAuthorized:false};
}
