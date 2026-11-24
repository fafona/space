-- PRIVATE, UNINSTALLED read-only proposal. No production registration, role
-- grants, enrollment, claim/ack backfill, business writes or financial action.
BEGIN;
CREATE FUNCTION public.faolla_member_checkout_history_original_v1(p_site_id text,p_operation_key text,p_principal_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_history_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 -- Do not wait indefinitely or declare absence from a pre-commit snapshot.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_history_busy';END IF;
 IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key AND principal_key=p_principal_key) THEN
  RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'original',NULL,'reviewRequired',NULL);
 END IF;
 -- The existing complete v3/resource projection checks current original terms
 -- in one read snapshot. A claim/ack is NOT required and is never created.
 v:=faolla_checkout_design.intent_original_view(p_site_id,p_operation_key,p_principal_key);
 IF v IS NULL OR jsonb_typeof(v->'original') IS DISTINCT FROM 'object' OR jsonb_typeof(v->'reviewRequired') IS DISTINCT FROM 'boolean'
  THEN RAISE EXCEPTION 'checkout_history_unavailable';END IF;
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'original',v->'original','reviewRequired',v->'reviewRequired');
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_history_original_v1(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
