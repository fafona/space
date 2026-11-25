// Fixed metadata-only supplement. No connector, secret/config reader, DDL,
// business rows, installation authority or automatic baseline replacement.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {loadInstallationPlan} from './member-checkout-installation-plan.mjs';
import {installationBundleSummary} from './member-checkout-installation-bundle.mjs';
import {installationSealSql,observeInstallationSeal} from './member-checkout-installation-seal.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const contracts=new WeakSet(),observations=new WeakSet(),marker='__FAOLLA_GATEWAY_ADDRESSES__';
const literal=value=>{assert.match(value,/^[a-z][a-z0-9_]*$/);return "'"+value+"'";};
const canonType=value=>({'timestamp with time zone':'timestamptz',int4:'integer',int8:'bigint',bool:'boolean'}[value]??value);

export async function loadInstallationSupplement(bundle) {
 const source=installationBundleSummary(bundle),plan=await loadInstallationPlan();assert.equal(plan.digest,source.planSha256);
 const names=[...new Set(plan.prerequisites.functions.map(v=>v.name))].sort(),triggers=plan.prerequisites.triggers.map(v=>v.name).sort();
 assert.equal(names.length,15);assert.equal(triggers.length,3);
 const template=`WITH sealed AS (${installationSealSql}) SELECT pg_catalog.jsonb_build_object(
 'seal',(SELECT metadata FROM sealed),
 'legacyFunctions',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY namespace,name,oid),'[]'::jsonb) FROM (
  SELECT p.oid::text,n.nspname::text namespace,p.proname::text name,
   ARRAY(SELECT pg_catalog.format_type(x,NULL) FROM pg_catalog.unnest(p.proargtypes) WITH ORDINALITY a(x,i) ORDER BY i) types,
   p.proargnames args,l.lanname::text language,pg_catalog.format_type(p.prorettype,NULL) AS "returnType",p.proretset AS "returnsSet",
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex') AS "bodySha256",
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') AS "definitionSha256",
   p.prosecdef AS "securityDefiner",p.provolatile volatility,p.proisstrict strict,p.proparallel parallel,p.proconfig config,
   p.prosqlbody IS NOT NULL AS "sqlBody",p.pronargdefaults defaults,pg_catalog.pg_get_userbyid(p.proowner) owner,
   o.rolsuper OR o.rolbypassrls AS "ownerBypassesRls"
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   JOIN pg_catalog.pg_language l ON l.oid=p.prolang JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
  WHERE p.prokind='f' AND n.nspname='public' AND p.proname IN (${names.map(literal).join(',')})) r),
 'legacyTriggers',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY name),'[]'::jsonb) FROM (
  SELECT n.nspname||'.'||c.relname AS "table",t.tgname::text name,pn.nspname||'.'||p.proname||'()' AS function,
   t.tgtype::integer type,t.tgenabled enabled,t.tgconstraint<>0 AS constraint,t.tgdeferrable AS deferrable,t.tginitdeferred deferred,
   t.tgnargs args,t.tgqual IS NOT NULL qualified,t.tgattr::text columns
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
  WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname='pages' AND t.tgname IN (${triggers.map(literal).join(',')})) r),
 'gatewayLogins',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY role),'[]'::jsonb) FROM (
  SELECT a.usesysid::text AS "roleOid",r.rolname::text role,pg_catalog.count(*)::integer connections
  FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_roles r ON r.oid=a.usesysid
  WHERE a.datid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
   AND a.backend_type='client backend' AND a.client_addr=ANY(ARRAY[${marker}]::pg_catalog.inet[])
  GROUP BY a.usesysid,r.rolname) r)) AS metadata`;
 const contract=freeze({template,templateSha256:sha(template),sourceBundleSha256:source.sha256,expected:plan.prerequisites});
 contracts.add(contract);return contract;
}
export function installationSupplementSql(contract,addresses) {
 assert.ok(contracts.has(contract),'installation_supplement_contract_unverified');
 assert.ok(Array.isArray(addresses)&&addresses.length>0&&addresses.length<=8&&new Set(addresses).size===addresses.length,'installation_supplement_addresses_invalid');
 for(const address of addresses)assert.ok(typeof address==='string'&&/^[a-fA-F0-9:.]+$/.test(address)&&isIP(address),'installation_supplement_addresses_invalid');
 assert.equal(contract.template.split(marker).length,2);
 return contract.template.replace(marker,[...addresses].sort().map(v=>"'"+v+"'::pg_catalog.inet").join(','));
}
export async function observeInstallationSupplement(query,contract,bundle,addresses) {
 try{
  const sql=installationSupplementSql(contract,addresses),source=installationBundleSummary(bundle);assert.equal(contract.sourceBundleSha256,source.sha256);
  const result=await query(sql);assert.equal(result.rows.length,1);const wire=canonical(result.rows[0].metadata);
  assert.ok(Buffer.byteLength(wire,'utf8')<=4*1024*1024);const data=JSON.parse(wire);
  assert.deepEqual(Object.keys(data).sort(),['gatewayLogins','legacyFunctions','legacyTriggers','seal']);
  for(const key of ['legacyFunctions','legacyTriggers','gatewayLogins'])assert.ok(Array.isArray(data[key])&&data[key].length<=500&&data[key].every(v=>v&&typeof v==='object'&&!Array.isArray(v)));
  const seal=await observeInstallationSeal(async()=>({rows:[{metadata:data.seal}]}),bundle);
  const value=freeze({seal,data,sourceBundleSha256:source.sha256,querySha256:sha(sql),templateSha256:contract.templateSha256,
   sha256:sha(canonical({seal:seal.sha256,legacyFunctions:data.legacyFunctions,legacyTriggers:data.legacyTriggers,gatewayLogins:data.gatewayLogins}))});
  observations.add(value);return value;
 }catch(error){throw Object.assign(Error('installation_supplement_unavailable'),{code:/^[A-Z0-9_]{1,40}$/.test(error?.code??'')?error.code:'INSTALL_SUPPLEMENT_INVALID'});}
}
export function inspectInstallationSupplement(contract,observation) {
 assert.ok(contracts.has(contract)&&observations.has(observation),'installation_supplement_not_observed');
 assert.equal(contract.sourceBundleSha256,observation.sourceBundleSha256);
 const issues=[],rows=observation.data.legacyFunctions,expected=contract.expected;
 const key=value=>`${value.namespace}.${value.name}(${value.types.map(canonType).join(',')})`;
 try{
  const functions=new Map(rows.map(v=>[key(v),v]));assert.equal(functions.size,rows.length);
  for(const wanted of expected.functions){const actual=functions.get(wanted.signature);
   if(!actual){issues.push('legacy_function_missing:'+wanted.signature);continue;}
   if(actual.bodySha256!==wanted.bodySha256||actual.sqlBody!==false||actual.defaults!==0
    ||['language','returnType','returnsSet','securityDefiner','volatility','strict','parallel'].some(k=>actual[k]!==wanted[k])
    ||canonical(actual.args??[])!==canonical(wanted.args)||canonical((actual.config??[]).map(v=>v.replace(/\s/g,'')))!==canonical(wanted.config))
    issues.push('legacy_function_changed:'+wanted.signature);
   assert.match(actual.definitionSha256,/^[a-f0-9]{64}$/);
   const matches=observation.seal.core.data.functions.filter(v=>v.oid===actual.oid);
   assert.equal(matches.length,1);assert.equal(matches[0].definition_sha256,actual.definitionSha256);assert.equal(matches[0].owner,actual.owner);
  }
  if(rows.some(v=>!expected.functions.some(w=>w.signature===key(v))))issues.push('unexpected_legacy_function_overload');
  for(const wanted of expected.triggers){const matches=observation.data.legacyTriggers.filter(v=>v.table===wanted.table&&v.name===wanted.name),actual=matches[0];
   if(matches.length!==1){issues.push('legacy_trigger_missing_or_duplicate:'+wanted.name);continue;}
   if(['function','type','constraint','deferrable','deferred'].some(k=>actual[k]!==wanted[k])||actual.enabled!=='O'||actual.args!==0||actual.qualified!==false||actual.columns!=='')issues.push('legacy_trigger_changed:'+wanted.name);
  }
  if(observation.data.legacyTriggers.length!==expected.triggers.length)issues.push('legacy_trigger_count_changed');
 }catch{issues.push('supplement_definition_metadata_invalid');}
 const gateway=observation.data.gatewayLogins;
 let gatewayStatus=gateway.length===0?'not-observed':gateway.length>1?'ambiguous':'unconfirmed';
 if(gateway.length===1){const value=gateway[0],role=observation.seal.core.data.roles.find(v=>v.oid===value.roleOid&&v.rolname===value.role);
  if(role?.rolcanlogin===true&&Number.isSafeInteger(value.connections)&&value.connections>0)gatewayStatus='observed-session-login';}
 return freeze({issues:[...new Set(issues)].sort(),legacyDefinitionsMatch:issues.length===0,gatewayStatus,
  gatewayIsConfiguredLoginProof:false,gatewayGrantAuthorized:false,productionAuthorized:false,deploymentReady:false});
}
export function installationSupplementSummary(contract,observation) {
 const inspected=inspectInstallationSupplement(contract,observation);
 return {version:1,sha256:observation.sha256,querySha256:observation.querySha256,sourceBundleSha256:observation.sourceBundleSha256,
  legacyFunctions:observation.data.legacyFunctions.length,legacyTriggers:observation.data.legacyTriggers.length,
  scopedTriggers:observation.seal.triggers,scopedPolicies:observation.seal.policies,registryRows:observation.seal.core.data.registry.count,
  issues:inspected.issues,legacyDefinitionsMatch:inspected.legacyDefinitionsMatch,gatewayStatus:inspected.gatewayStatus,
  gatewayGrantAuthorized:false,businessRowsRead:false,productionAuthorized:false,deploymentReady:false};
}
