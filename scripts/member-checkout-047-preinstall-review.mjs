// OFFLINE/unapproved 047 pre-install evidence. The supplied callback owns any
// connection; this module has no transport, secret, DDL or execution authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {checkout047InstallationBundleSummary,checkout047InstallationSealSql,observeCheckout047Installation} from './member-checkout-047-installation.mjs';
import {readReviewedMigrationInventory} from './member-checkout-installation-review.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const contracts=new WeakSet(),observations=new WeakSet(),reviews=new WeakSet();
const literal=value=>{assert.match(value,/^[a-z][a-z0-9_]*$/);return "'"+value+"'";};
const type=value=>({'timestamp with time zone':'timestamptz',int4:'integer',int8:'bigint',bool:'boolean','public.faolla_redemption_checkouts':'faolla_redemption_checkouts'}[value]??value);
const apiExposed=new Set(['faolla_commit_redemption_v1','faolla_stage_redemption_checkout_v1','faolla_get_redemption_checkout_v1','faolla_cancel_redemption_checkout_v1','faolla_ack_redemption_checkout_v1','faolla_commit_redemption_v2']);
export async function loadCheckout047PreinstallContract(bundle){
 const source=checkout047InstallationBundleSummary(bundle),expected=bundle.prerequisites;
 const names=[...new Set(expected.functions.map(v=>v.name))].sort(),triggers=expected.triggers.map(v=>v.name).sort();assert.equal(names.length,26);assert.equal(triggers.length,3);
 const sql=`WITH sealed AS (${checkout047InstallationSealSql}) SELECT pg_catalog.jsonb_build_object(
 'seal',(SELECT metadata FROM sealed),
 'legacyFunctions',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY namespace,name,oid),'[]'::jsonb) FROM (
  SELECT p.oid::text,n.nspname::text namespace,p.proname::text name,
   ARRAY(SELECT pg_catalog.format_type(x,NULL) FROM pg_catalog.unnest(p.proargtypes) WITH ORDINALITY a(x,i) ORDER BY i) types,
   p.proargnames args,l.lanname::text language,pg_catalog.format_type(p.prorettype,NULL) AS "returnType",p.proretset AS "returnsSet",
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex') AS "bodySha256",
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') AS "definitionSha256",
   p.prosecdef AS "securityDefiner",p.provolatile volatility,p.proisstrict strict,p.proparallel parallel,p.proconfig config,
   p.prosqlbody IS NOT NULL AS "sqlBody",p.pronargdefaults defaults,pg_catalog.pg_get_userbyid(p.proowner) owner,o.rolsuper OR o.rolbypassrls AS "ownerBypassesRls",
   EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicExecute",
   ARRAY(SELECT r.rolname::text FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role') AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE') ORDER BY r.rolname) AS "apiExecutors"
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
  WHERE p.prokind='f' AND n.nspname='public' AND p.proname IN (${names.map(literal).join(',')})) r),
 'legacyTriggers',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY name),'[]'::jsonb) FROM (
  SELECT t.oid::text,t.tgrelid::text relation,n.nspname||'.'||c.relname AS "table",t.tgname::text name,pn.nspname||'.'||p.proname||'()' AS function,
   t.tgtype::integer type,t.tgenabled enabled,t.tgconstraint<>0 AS constraint,t.tgdeferrable AS deferrable,t.tginitdeferred deferred,t.tgnargs args,t.tgqual IS NOT NULL qualified,t.tgattr::text columns,
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(t.oid,false),'UTF8')),'hex') AS "definitionSha256"
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
  WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname='pages' AND t.tgname IN (${triggers.map(literal).join(',')})) r),
 'gatewayLogins',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY role),'[]'::jsonb) FROM (
  SELECT a.usesysid::text AS "roleOid",r.rolname::text role,pg_catalog.count(*)::integer connections
  FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_roles r ON r.oid=a.usesysid
  WHERE a.datid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()) AND a.backend_type='client backend'
   AND a.client_addr=ANY($1::pg_catalog.inet[]) GROUP BY a.usesysid,r.rolname) r)) AS metadata`;
 const result=freeze({sql,querySha256:sha(sql),sourceBundleSha256:source.sha256,expected,legacy047Names:[...bundle.contract.legacy.map(v=>v.name),'faolla_commit_redemption_internal_v1']});contracts.add(result);return result;
}
export function checkout047PreinstallQuery(contract,addresses){
 assert.ok(contracts.has(contract),'checkout_047_preinstall_contract_unverified');
 assert.ok(Array.isArray(addresses)&&addresses.length>0&&addresses.length<=8&&new Set(addresses).size===addresses.length,'checkout_047_preinstall_addresses_invalid');
 for(const address of addresses)assert.ok(typeof address==='string'&&/^[a-fA-F0-9:.]+$/.test(address)&&isIP(address),'checkout_047_preinstall_addresses_invalid');
 return freeze({sql:contract.sql,values:[[...addresses].sort()],querySha256:contract.querySha256,addressBindingSha256:sha(canonical([...addresses].sort()))});
}
export async function observeCheckout047Preinstall(query,contract,bundle,addresses){
 try{
  const plan=checkout047PreinstallQuery(contract,addresses),source=checkout047InstallationBundleSummary(bundle);assert.equal(source.sha256,contract.sourceBundleSha256);
  const result=await query(plan.sql,plan.values);assert.equal(result.rows.length,1);const wire=canonical(result.rows[0].metadata);assert.ok(Buffer.byteLength(wire)<=4*1024*1024);const data=JSON.parse(wire);
  assert.deepEqual(Object.keys(data).sort(),['gatewayLogins','legacyFunctions','legacyTriggers','seal']);
  for(const key of ['legacyFunctions','legacyTriggers','gatewayLogins'])assert.ok(Array.isArray(data[key])&&data[key].length<=500&&data[key].every(v=>v&&typeof v==='object'&&!Array.isArray(v)));
  // Decode the seal projection from this SAME SELECT response, not another read.
  const seal=await observeCheckout047Installation(async()=>({rows:[{metadata:data.seal}]}),bundle);
  const value=freeze({data,seal,sourceBundleSha256:source.sha256,querySha256:plan.querySha256,addressBindingSha256:plan.addressBindingSha256,
   sha256:sha(canonical({sealSha256:seal.sha256,legacyFunctions:data.legacyFunctions,legacyTriggers:data.legacyTriggers,gatewayLogins:data.gatewayLogins,querySha256:plan.querySha256,addressBindingSha256:plan.addressBindingSha256}))});observations.add(value);return value;
 }catch(error){throw Object.assign(Error('checkout_047_preinstall_observation_unavailable'),{code:/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:'CHECKOUT_047_PREINSTALL_INVALID'});}
}
export function inspectCheckout047Preinstall(contract,observation){
 assert.ok(contracts.has(contract)&&observations.has(observation),'checkout_047_preinstall_not_observed');assert.equal(contract.sourceBundleSha256,observation.sourceBundleSha256);
 const issues=[],key=value=>`${value.namespace}.${value.name}(${value.types.map(type).join(',')})`,rows=observation.data.legacyFunctions,core=observation.seal.data.core;
 try{
  const functions=new Map(rows.map(v=>[key(v),v]));assert.equal(functions.size,rows.length);
  for(const wanted of contract.expected.functions){const actual=functions.get(wanted.signature);
   if(!actual){issues.push('legacy_function_missing:'+wanted.signature);continue;}
   if(actual.bodySha256!==wanted.bodySha256||actual.sqlBody!==false||actual.defaults!==(wanted.defaults??0)
    ||['language','returnType','returnsSet','securityDefiner','volatility','strict','parallel'].some(k=>actual[k]!==wanted[k])
    ||canonical(actual.args??[])!==canonical(wanted.args)||canonical((actual.config??[]).map(v=>v.replace(/\s/g,'')))!==canonical(wanted.config)
    ||wanted.securityDefiner&&actual.ownerBypassesRls!==true)issues.push('legacy_function_changed:'+wanted.signature);
   if(contract.legacy047Names.includes(wanted.name)&&(actual.publicExecute!==false||canonical(actual.apiExecutors)!==canonical(apiExposed.has(wanted.name)?['service_role']:[])))issues.push('legacy_047_api_boundary_changed:'+wanted.signature);
   assert.match(actual.definitionSha256,/^[a-f0-9]{64}$/);const matches=core.functions.filter(v=>v.oid===actual.oid);
   assert.equal(matches.length,1);assert.equal(matches[0].definition_sha256,actual.definitionSha256);assert.equal(matches[0].owner,actual.owner);
  }
  if(rows.some(v=>!contract.expected.functions.some(w=>w.signature===key(v))))issues.push('unexpected_legacy_function_overload');
  for(const wanted of contract.expected.triggers){const matches=observation.data.legacyTriggers.filter(v=>v.table===wanted.table&&v.name===wanted.name),actual=matches[0];
   if(matches.length!==1){issues.push('legacy_trigger_missing_or_duplicate:'+wanted.name);continue;}
   if(['function','type','constraint','deferrable','deferred'].some(k=>actual[k]!==wanted[k])||actual.enabled!=='O'||actual.args!==0||actual.qualified!==false||actual.columns!=='')issues.push('legacy_trigger_changed:'+wanted.name);
   const sealed=observation.seal.data.triggers.filter(v=>v.oid===actual.oid&&v.relation===actual.relation);assert.equal(sealed.length,1);assert.equal(sealed[0].enabled,actual.enabled);assert.equal(sealed[0].definition_sha256,actual.definitionSha256);
  }
  if(observation.data.legacyTriggers.length!==contract.expected.triggers.length)issues.push('legacy_trigger_count_changed');
 }catch{issues.push('preinstall_definition_metadata_invalid');}
 const logins=observation.data.gatewayLogins;let gatewayStatus=logins.length===0?'not-observed':logins.length>1?'ambiguous':'unconfirmed';
 if(logins.length===1){const value=logins[0],role=core.roles.find(v=>v.oid===value.roleOid&&v.rolname===value.role);if(role?.rolcanlogin===true&&Number.isSafeInteger(value.connections)&&value.connections>0)gatewayStatus='observed-session-login';}
 return freeze({issues:[...new Set(issues)].sort(),legacyDefinitionsMatch:issues.length===0,functions:rows.length,triggers:observation.data.legacyTriggers.length,
  gatewayStatus,gatewayIsConfiguredLoginProof:false,gatewayGrantAuthorized:false,legacyRelationSourceCompatibilityProved:false,productionAuthorized:false,deploymentReady:false});
}
export async function createCheckout047PreinstallReview(contract,observation,bundle,reference){
 const source=checkout047InstallationBundleSummary(bundle),inspection=inspectCheckout047Preinstall(contract,observation),core=observation.seal.data.core;
 assert.deepEqual(Object.keys(reference).sort(),['captureSha256','publicBuild']);assert.match(reference.captureSha256,/^[a-f0-9]{64}$/);assert.match(reference.publicBuild,/^[a-f0-9]{40}$/);
 assert.equal(core.context.readOnly,true,'checkout_047_review_not_readonly');assert.equal(core.context.isolation,'repeatable read','checkout_047_review_not_repeatable');
 assert.ok(core.roles.every(v=>!['faolla_checkout_runtime','faolla_checkout_executor'].includes(v.rolname)),'checkout_047_review_role_collision');
 assert.ok(core.schemas.every(v=>v.name!=='faolla_checkout_design')&&core.relations.every(v=>v.namespace!=='faolla_checkout_design'),'checkout_047_review_schema_collision');
 assert.ok(core.functions.every(v=>v.namespace!=='faolla_checkout_design'&&!/^faolla_(?:member_)?checkout_/.test(v.name)),'checkout_047_review_function_collision');
 assert.ok(core.registry.entries.every(v=>!/^99999999/.test(v.version)),'checkout_047_review_synthetic_registration');
 for(const name of ['faolla_redemption_operations','faolla_redemption_checkouts'])assert.equal(core.relations.filter(v=>v.namespace==='public'&&v.name===name&&v.kind==='r').length,1,'checkout_047_review_legacy_relation_missing');
 const inventory=await readReviewedMigrationInventory(),registered=new Set();
 for(const row of core.registry.entries){const item=inventory.entries.find(v=>v.version===row.version);assert.ok(item&&item.nameSha256===row.nameSha256,'checkout_047_review_registry_source_mismatch');registered.add(row.version);}
 for(const prerequisite of bundle.material.prerequisites.sources){const item=inventory.entries.find(v=>v.file===prerequisite.file);assert.ok(item&&item.sourceSha256===prerequisite.sha256&&registered.has(item.version),'checkout_047_review_prerequisite_missing');}
 const material={version:1,kind:'member-checkout-047-production-review-v1',status:'draft-unapproved-not-executable',
  evidence:{captureSha256:reference.captureSha256,publicBuild:reference.publicBuild,querySha256:observation.querySha256,observationSha256:observation.sha256,targetSha256:observation.seal.targetSha256,
   addressBindingSha256:observation.addressBindingSha256,freshnessProved:false,originalReadOnlyScopeExpanded:false,rawMetadataIncluded:false},
  sourceReview:{candidate:source,productionArtifactPromoted:false,sqlBodiesIncluded:false,inspection,
   proposedSources:bundle.material.steps.map(({id,file,sourceSha256,bodySha256})=>({id,file,sourceSha256,bodySha256})),legacyPrerequisites:bundle.material.prerequisites.sources,
   legacySourcesToExecute:[],unregisteredSourcesToExecute:[],registeredSources:inventory.entries.filter(v=>registered.has(v.version)),unregisteredSources:inventory.entries.filter(v=>!registered.has(v.version)),
   inventory:{files:inventory.files,sha256:inventory.sha256},namesAreNotInstalledDdlProof:true,legacyRelationsCaptured:true,legacyRelationSourceCompatibilityProved:false},
  registration:{status:'unreserved',version:null,name:null,syntheticReceiptReusable:false,fullPriorRegistryMustMatch:true},
  privileges:{installerPermissionApproved:false,observedActorSha256:sha(canonical(core.target.actor)),roleGraphSha256:sha(canonical({roles:core.roles,memberships:core.memberships,defaultAcls:core.defaultAcls})),
   gatewayDatabaseLogin:null,gatewayMembershipApproved:false,runtime:bundle.material.installedContract.runtime,executor:bundle.material.installedContract.executor,
   executorMembershipAllowed:false,ordinaryApiPrivateAccessAllowed:false,automaticAclRepair:false},
  credentials:{applicationVariable:'FAOLLA_CHECKOUT_RUNTIME_JWT',serverOnly:true,userAuthenticationStillRequired:true,minimumDispatchValidityMs:12000,issuer:null,delivery:null,renewal:null,revocation:null,tokensIncluded:false,serviceRoleFallback:false,projectSigningKeyExported:false},
  resultEvidence:{persistentPrivateStore:null,locatorDelivery:null,ciTempJournalIsProductionStore:false,missingEvidencePolicy:'refuse-no-regeneration',unknownCommitPolicy:'reconnect-confirm-original-never-blind-reapply'},
  rollout:{merchantSites:[],featureFlagsToWrite:[],businessRowsToWrite:[],checkoutSpecificReleaseRequired:true,oldQrReleaseReusable:false,mailEnabled:false,stripeEnabled:false},
  unresolved:['formal-source-approval-and-registration','fresh-complete-production-metadata','legacy-relation-source-compatibility','installer-and-gateway-authorization','persistent-private-journal-and-locator','runtime-issuer-delivery-renewal-revocation','full-supabase-kong-validation','checkout-specific-release-and-retained-rollback','merchant-configuration-and-pilot-approval'],
  authority:{installation:false,migrationReservation:false,roleGrants:false,credentialIssuance:false,deployment:false,pilotActivation:false,businessDataChanges:false,stripe:false,mail:false,backgroundWorkers:false}};
 const digest=sha(canonical(material)),wire=canonical({sha256:digest,material});assert.ok(Buffer.byteLength(wire)<=256*1024);const result=freeze({digest,wire,material});reviews.add(result);return result;
}
export async function verifyCheckout047PreinstallReview(wire,contract,observation,bundle,reference){
 try{assert.equal(typeof wire,'string');assert.ok(Buffer.byteLength(wire)<=256*1024);const value=JSON.parse(wire);assert.deepEqual(Object.keys(value).sort(),['material','sha256']);assert.equal(canonical(value),wire);assert.equal(value.sha256,sha(canonical(value.material)));
  const expected=await createCheckout047PreinstallReview(contract,observation,bundle,reference);assert.equal(wire,expected.wire);return expected;
 }catch{throw Error('checkout_047_preinstall_review_unapproved');}
}
export function checkout047PreinstallReviewSummary(review){
 assert.ok(reviews.has(review),'checkout_047_preinstall_review_unverified');const m=review.material;
 return {sha256:review.digest,status:m.status,sourceBundleSha256:m.sourceReview.candidate.sha256,registeredSources:m.sourceReview.registeredSources.length,
  unregisteredSources:m.sourceReview.unregisteredSources.length,proposedSteps:m.sourceReview.proposedSources.length,functions:m.sourceReview.inspection.functions,triggers:m.sourceReview.inspection.triggers,
  issues:m.sourceReview.inspection.issues,legacyDefinitionsMatch:m.sourceReview.inspection.legacyDefinitionsMatch,gatewayStatus:m.sourceReview.inspection.gatewayStatus,
  legacyRelationSourceCompatibilityProved:false,unresolved:m.unresolved.length,businessRowsRead:false,productionAuthorized:false,deploymentReady:false};
}
