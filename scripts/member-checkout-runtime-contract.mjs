// Executable LOCAL-ONLY privilege design, not an installer or release approval.
// All original SQL stays pinned; a reviewed fixture contains the rendered DDL.
import { loadCompatibilityBaseline } from './member-checkout-compatibility-check.mjs';

export const runtimeRole = 'faolla_checkout_runtime';
export const executorRole = 'faolla_checkout_executor';
export const runtimeEntry = 'public.faolla_checkout_runtime_v1(text,jsonb)';
export const runtimeFixture = 'scripts/fixtures/member-checkout-runtime-prototype.sql';
const quote = x => { if (!/^[a-z][a-z0-9_]*$/.test(x)) throw Error('runtime_contract_invalid'); return `'${x}'`; };

export async function runtimeContract() {
  const baseline = await loadCompatibilityBaseline();
  if (baseline.issues.length) throw Error('runtime_contract_baseline_changed');
  const dependencies = baseline.expected.functions.filter(p => p.privateSource);
  const methods = dependencies.filter(p => p.namespace === 'public');
  if (!methods.length || methods.some(p => p.returnType !== 'jsonb' || !p.args.length)) throw Error('runtime_contract_invalid');
  return { baseline, dependencies, methods };
}

/** Fixed CASE calls, never EXECUTE supplied names, SQL, identifiers or casts.
 * The credential is a trusted SERVER capability, not customer authentication.
 * Existing handlers still have to verify actor, tenant, gates and deadlines. */
export function renderRuntimePrototype({ baseline, dependencies, methods }) {
  const signatures = [...dependencies.map(p => p.signature),
    'public.faolla_commit_redemption_v1(text,jsonb)', 'public.faolla_commit_order_membership_v1(text,jsonb)',
    'public.faolla_booking_atomic_rows_v1()', 'public.faolla_booking_atomic_commit_v1(text,text,text,jsonb)'].sort();
  const argumentCases = methods.map(p => `  WHEN ${quote(p.name)} THEN allowed:=ARRAY[${p.args.map(quote).join(',')}]::text[];`).join('\n');
  const callCases = methods.map(p => `  WHEN ${quote(p.name)} THEN RETURN public.${p.name}(${p.args.map((a, i) => p.types[i] === 'jsonb' ? `(p_arguments->${quote(a)})` : `(p_arguments->>${quote(a)})::${p.types[i]}`).join(',')});`).join('\n');
  const tables = baseline.expected.tables.join(',');
  const appendTables = ['offer_versions','catalog_versions','bundle_results','bundle_cancellations','bundle_coupon_returns',
    'merchant_cancellation_actors','on_site_collections','cart_collections','intent_claims','intent_acknowledgements',
    'retained_intent_registrations','closed_unused_references'];
  const lockingPilots = ['bundle_pilots','intent_pilots','cart_quote_pilots','cart_submission_pilots','cart_collection_pilots','unused_reference_pilots','original_service_pilots'];
  return `-- LOCAL-ONLY executable design. NOT a registered migration or production installer.
-- Creates fresh roles; collision fails. No passwords, role memberships,
-- authenticator grants, rollout activation, mail or business-data mutation.
-- The NOLOGIN executor needs BYPASSRLS because private tables FORCE RLS with
-- no policies. It cannot log in or create roles, and owns no business tables.
-- The runtime role receives ONLY this fixed dispatcher, not executor membership.
BEGIN;
CREATE ROLE ${runtimeRole} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
CREATE ROLE ${executorRole} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOREPLICATION;
GRANT USAGE ON SCHEMA public TO ${runtimeRole},${executorRole};
GRANT USAGE ON SCHEMA faolla_checkout_design TO ${executorRole};
GRANT SELECT ON ${tables} TO ${executorRole};
GRANT INSERT ON ${appendTables.map(t => 'faolla_checkout_design.' + t).join(',')} TO ${executorRole};
GRANT INSERT,UPDATE ON faolla_checkout_design.catalog_heads,faolla_checkout_design.offer_heads TO ${executorRole};
-- Row locking requires UPDATE privilege, even though no enabled flag is written.
${lockingPilots.map(t => `GRANT UPDATE(enabled) ON faolla_checkout_design.${t} TO ${executorRole};`).join('\n')}
GRANT SELECT,UPDATE(id) ON public.pages TO ${executorRole};
GRANT SELECT,UPDATE(singleton) ON public.faolla_booking_atomic_control TO ${executorRole};
GRANT SELECT ON public.faolla_booking_atomic_commands TO ${executorRole};
GRANT EXECUTE ON FUNCTION ${signatures.join(',')} TO ${executorRole};
CREATE FUNCTION public.faolla_checkout_runtime_v1(p_function text,p_arguments jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE allowed text[];
BEGIN
 IF p_function IS NULL OR jsonb_typeof(p_arguments) IS DISTINCT FROM 'object'
   OR octet_length(p_arguments::text)>33554432 THEN RAISE EXCEPTION 'checkout_runtime_invalid_request';END IF;
 CASE p_function
${argumentCases}
  ELSE RAISE EXCEPTION 'checkout_runtime_forbidden';
 END CASE;
 IF NOT (p_arguments ?& allowed) OR (SELECT count(*) FROM jsonb_object_keys(p_arguments))<>cardinality(allowed)
   THEN RAISE EXCEPTION 'checkout_runtime_invalid_request';END IF;
 CASE p_function
${callCases}
  ELSE RAISE EXCEPTION 'checkout_runtime_forbidden';
 END CASE;
END;
$$;
REVOKE ALL ON FUNCTION ${runtimeEntry} FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION ${runtimeEntry} OWNER TO ${executorRole};
GRANT EXECUTE ON FUNCTION ${runtimeEntry} TO ${runtimeRole};
COMMIT;
`;
}
