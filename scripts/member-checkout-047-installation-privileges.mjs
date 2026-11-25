// Fixed read-only post-install assertions for the separate owned 047 rehearsal.
// Reads effective/catalogue grants, never grants, repairs or opens connections.
import assert from 'node:assert/strict';
import {checkout047InstallationBundleSummary} from './member-checkout-047-installation.mjs';
import {readCheckout047Compatibility,inspectCheckout047Compatibility} from './member-checkout-047-compatibility.mjs';

export async function assertCheckout047InstalledPrivileges(query,bundle){
 checkout047InstallationBundleSummary(bundle);
 const observed=await readCheckout047Compatibility(query,bundle.contract),report=inspectCheckout047Compatibility(bundle.contract,observed.catalog,observed.legacyDetails);
 assert.deepEqual(report.issues,[],'checkout_047_installed_protocol_changed');
 const roles=(await query(`SELECT rolname::text name,rolsuper,rolcanlogin,rolinherit,rolcreaterole,rolcreatedb,rolbypassrls,rolreplication
  FROM pg_catalog.pg_roles WHERE rolname IN ('faolla_checkout_runtime','faolla_checkout_executor') ORDER BY rolname`)).rows;
 assert.equal(roles.length,2,'checkout_047_installed_roles_missing');
 for(const r of roles){for(const k of ['rolsuper','rolcanlogin','rolinherit','rolcreaterole','rolcreatedb','rolreplication'])assert.equal(r[k],false,'checkout_047_installed_role_attribute');assert.equal(r.rolbypassrls,r.name==='faolla_checkout_executor');}
 assert.equal((await query(`SELECT count(*)::integer n FROM pg_catalog.pg_auth_members m WHERE m.roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('faolla_checkout_executor','faolla_checkout_runtime'))
  OR m.member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('faolla_checkout_executor','faolla_checkout_runtime'))`)).rows[0].n,0,'checkout_047_installed_membership_changed');
 assert.equal((await query(`SELECT pg_catalog.pg_get_userbyid(proowner)::text owner FROM pg_catalog.pg_proc WHERE oid='public.faolla_checkout_runtime_v1(text,jsonb)'::regprocedure`)).rows[0].owner,'faolla_checkout_executor');
 for(const role of ['anon','authenticated','service_role','faolla_checkout_runtime']){
  const row=(await query(`SELECT has_function_privilege($1,'public.faolla_checkout_runtime_v1(text,jsonb)','EXECUTE') entry,
   has_schema_privilege($1,'faolla_checkout_design','USAGE,CREATE') private`,[role])).rows[0];
  assert.equal(row.entry,role==='faolla_checkout_runtime','checkout_047_installed_entry_changed');assert.equal(row.private,false,'checkout_047_installed_schema_exposed');
 }
 for(const role of ['faolla_checkout_runtime','faolla_checkout_executor'])assert.equal((await query("SELECT has_schema_privilege($1,'public','CREATE') allowed",[role])).rows[0].allowed,false);
 for(const table of [...bundle.contract.expected.tables,'public.pages','public.faolla_booking_atomic_control'])assert.equal((await query("SELECT has_table_privilege('faolla_checkout_runtime',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed",[table])).rows[0].allowed,false,'checkout_047_installed_runtime_table_access');
 assert.equal((await query("SELECT has_function_privilege('faolla_checkout_executor','faolla_checkout_design.commit_redemption_047(text,text,text,text,jsonb)','EXECUTE') allowed")).rows[0].allowed,true,'checkout_047_installed_bridge_grant_missing');
 assert.equal((await query("SELECT has_table_privilege('faolla_checkout_executor','faolla_checkout_design.redemption_047_audits','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed")).rows[0].allowed,false,'checkout_047_installed_audit_exposed');
 // Include every grantee, not only API roles. Defaults/inheritance must not
 // smuggle pg_read_all_data or another unrelated role into the new schema.
 const unexpected=(await query(`WITH allowed AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN (CURRENT_USER,'faolla_checkout_executor')), grants AS (
  SELECT a.grantee FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='faolla_checkout_design'
  UNION ALL SELECT a.grantee FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='faolla_checkout_design' AND c.relkind='r'
  UNION ALL SELECT a.grantee FROM pg_catalog.pg_attribute v JOIN pg_catalog.pg_class c ON c.oid=v.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(v.attacl) a WHERE n.nspname='faolla_checkout_design'
  UNION ALL SELECT a.grantee FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE (n.nspname='faolla_checkout_design' OR n.nspname='public' AND (p.proname LIKE 'faolla_member_checkout_%' OR p.proname LIKE 'faolla_checkout_%'))
   AND NOT(p.oid='public.faolla_checkout_runtime_v1(text,jsonb)'::regprocedure AND a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='faolla_checkout_runtime')))
  SELECT count(*)::integer n FROM grants WHERE grantee NOT IN (SELECT oid FROM allowed)`)).rows[0].n;
 assert.equal(unexpected,0,'checkout_047_installed_unapproved_grantee');return {functions:93,tables:24,guards:28,productionAuthorized:false,deploymentReady:false};
}
