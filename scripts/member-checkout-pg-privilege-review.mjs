// Read-only review of the fixed checkout LOGIN. A caller provides an already
// owned query handle; this module has no connection, installer or repair path.
import { runtimeEntry, executorRole, runtimeRole } from './member-checkout-runtime-contract.mjs';

export const checkoutPgLogin = 'faolla_checkout_runtime_login';
const deniedCounts = ['membership_edges', 'owned_objects', 'role_settings', 'schema_create', 'table_grants', 'sequence_grants',
  'other_callable_routines', 'unexpected_entry_grants', 'widening_default_grants'];
const reviewBooleans = ['role_ok', 'database_ok', 'public_schema_ok', 'private_schema_ok', 'entry_ok'];
const contextCounts = ['inaccessible_routine_grants', 'invoker_trigger_grants', 'other_database_connect'];

// Keep the output aggregate-only. Do not fetch role verifiers, connection
// configuration, SQL bodies, grant targets or application data. Deliberately
// count latent table / sequence grants even in schemas without current USAGE.
export const checkoutPgPrivilegeSql = `WITH
 login AS (SELECT * FROM pg_catalog.pg_roles WHERE rolname=$1),
 namespaces AS (SELECT oid,nspname FROM pg_catalog.pg_namespace
   WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'),
 relations AS MATERIALIZED (SELECT c.oid,c.relkind FROM pg_catalog.pg_class c JOIN namespaces n ON c.relnamespace=n.oid
   WHERE c.relkind IN ('r','p','v','m','f')),
 sequences AS MATERIALIZED (SELECT c.oid FROM pg_catalog.pg_class c JOIN namespaces n ON c.relnamespace=n.oid WHERE c.relkind='S'),
 db AS (SELECT oid,datacl FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
 entry AS (SELECT p.* FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure($2)),
 routines AS (SELECT p.oid,n.oid namespace,NOT p.prosecdef AND p.prorettype IN
    ('pg_catalog.trigger'::pg_catalog.regtype,'pg_catalog.event_trigger'::pg_catalog.regtype) invoker_trigger
   FROM pg_catalog.pg_proc p JOIN namespaces n ON p.pronamespace=n.oid WHERE p.oid IS DISTINCT FROM pg_catalog.to_regprocedure($2))
 SELECT coalesce((SELECT rolcanlogin AND NOT (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
   AND rolconnlimit=$5 FROM login),false) role_ok,
 coalesce(pg_catalog.has_database_privilege(l.oid,d.oid,'CONNECT') AND NOT pg_catalog.has_database_privilege(l.oid,d.oid,'CREATE,CONNECT WITH GRANT OPTION')
   AND EXISTS(SELECT 1 FROM pg_catalog.aclexplode(d.datacl) a WHERE a.grantee=l.oid AND a.privilege_type='CONNECT'),false) database_ok,
 coalesce((SELECT pg_catalog.has_schema_privilege(l.oid,n.oid,'USAGE') AND NOT pg_catalog.has_schema_privilege(l.oid,n.oid,'USAGE WITH GRANT OPTION')
   AND EXISTS(SELECT 1 FROM pg_catalog.aclexplode(n.nspacl) a WHERE a.grantee=l.oid AND a.privilege_type='USAGE')
   FROM pg_catalog.pg_namespace n WHERE n.nspname='public'),false) public_schema_ok,
 coalesce((SELECT NOT pg_catalog.has_schema_privilege(l.oid,n.oid,'USAGE,CREATE') FROM namespaces n WHERE n.nspname='faolla_checkout_design'),false) private_schema_ok,
 coalesce((SELECT e.prosecdef AND e.proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND pg_catalog.pg_get_userbyid(e.proowner)=$3
   AND pg_catalog.has_function_privilege(l.oid,e.oid,'EXECUTE') AND NOT pg_catalog.has_function_privilege(l.oid,e.oid,'EXECUTE WITH GRANT OPTION')
   AND pg_catalog.has_function_privilege($4::name,e.oid,'EXECUTE') FROM entry e),false) entry_ok,
 coalesce(pg_catalog.has_database_privilege(l.oid,d.oid,'TEMPORARY'),false) temporary_allowed,
 (SELECT count(*)::int FROM pg_catalog.pg_auth_members m WHERE l.oid IN (m.roleid,m.member)) membership_edges,
 (SELECT count(*)::int FROM pg_catalog.pg_shdepend s WHERE s.refclassid='pg_catalog.pg_authid'::pg_catalog.regclass AND s.refobjid=l.oid AND s.deptype='o') owned_objects,
 (SELECT count(*)::int FROM pg_catalog.pg_db_role_setting s WHERE s.setrole=l.oid) role_settings,
 (SELECT count(*)::int FROM namespaces n WHERE pg_catalog.has_schema_privilege(l.oid,n.oid,'CREATE')) schema_create,
 (SELECT count(*)::int FROM relations c WHERE pg_catalog.has_table_privilege(l.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
   pg_catalog.has_any_column_privilege(l.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) table_grants,
 (SELECT count(*)::int FROM sequences c WHERE pg_catalog.has_sequence_privilege(l.oid,c.oid,'USAGE,SELECT,UPDATE')) sequence_grants,
 (SELECT count(*)::int FROM routines r WHERE NOT r.invoker_trigger AND pg_catalog.has_function_privilege(l.oid,r.oid,'EXECUTE')
   AND pg_catalog.has_schema_privilege(l.oid,r.namespace,'USAGE')) other_callable_routines,
 (SELECT count(*)::int FROM routines r WHERE pg_catalog.has_function_privilege(l.oid,r.oid,'EXECUTE')
   AND NOT pg_catalog.has_schema_privilege(l.oid,r.namespace,'USAGE')) inaccessible_routine_grants,
 (SELECT count(*)::int FROM routines r WHERE r.invoker_trigger AND pg_catalog.has_function_privilege(l.oid,r.oid,'EXECUTE')
   AND pg_catalog.has_schema_privilege(l.oid,r.namespace,'USAGE')) invoker_trigger_grants,
 (SELECT count(*)::int FROM entry e CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(e.proacl,pg_catalog.acldefault('f',e.proowner))) a
   WHERE a.grantee<>e.proowner AND (a.grantee NOT IN (l.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=$4)) OR a.is_grantable)) unexpected_entry_grants,
 (SELECT count(*)::int FROM pg_catalog.pg_default_acl acl CROSS JOIN LATERAL pg_catalog.aclexplode(acl.defaclacl) a
   WHERE a.grantee IN (0,l.oid) AND acl.defaclobjtype IN ('r','S','f','n')) widening_default_grants,
 (SELECT count(*)::int FROM pg_catalog.pg_database b WHERE b.datallowconn AND b.oid<>d.oid
   AND pg_catalog.has_database_privilege(l.oid,b.oid,'CONNECT')) other_database_connect
 FROM db d LEFT JOIN login l ON true`;

export async function readCheckoutPgPrivilegeReview(query, expectedConnectionLimit) {
  if (typeof query !== 'function' || !Number.isSafeInteger(expectedConnectionLimit) || expectedConnectionLimit < 1 || expectedConnectionLimit > 100) {
    throw Error('checkout_pg_review_invalid_input');
  }
  let rows;
  try {
    ({ rows } = await query(checkoutPgPrivilegeSql, [checkoutPgLogin, runtimeEntry, executorRole, runtimeRole, expectedConnectionLimit]));
  } catch {
    throw Error('checkout_pg_review_unavailable');
  }
  const expected = [...reviewBooleans, ...deniedCounts, ...contextCounts, 'temporary_allowed'];
  const r = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!r || Object.keys(r).length !== expected.length || expected.some(key => !Object.hasOwn(r, key)) ||
      [...reviewBooleans, 'temporary_allowed'].some(key => typeof r[key] !== 'boolean') ||
      [...deniedCounts, ...contextCounts].some(key => !Number.isSafeInteger(r[key]) || r[key] < 0)) {
    throw Error('checkout_pg_review_invalid_result');
  }
  const issues = [...reviewBooleans.filter(key => !r[key]), ...deniedCounts.filter(key => r[key] !== 0)];
  return { passed: issues.length === 0, issues,
    counts: Object.fromEntries([...deniedCounts, ...contextCounts].map(key => [key, r[key]])),
    temporaryAllowed: r.temporary_allowed,
    // These are independent gates, not implied by a passing catalog review.
    hostAuthenticationVerified: false, productionAuthorized: false };
}
