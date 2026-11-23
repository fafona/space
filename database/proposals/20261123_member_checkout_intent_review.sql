-- UNINSTALLED PRIVATE PROPOSAL. No production registry, ACL grants, pilot
-- activation, old financial function replacement or business-data backfill.
BEGIN;
CREATE FUNCTION public.faolla_member_checkout_intent_review_v1(p_site_id text,p_operation_key text,p_principal_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c faolla_checkout_design.intent_claims%rowtype;v jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_intent_busy';END IF;
 SELECT * INTO c FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND operation_key=p_operation_key AND principal_key=p_principal_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('version',1,'siteId',p_site_id,'review',NULL);END IF;
 v:=faolla_checkout_design.intent_original_view(p_site_id,p_operation_key,p_principal_key);
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'review',jsonb_build_object('operationKey',p_operation_key,'generation',c.generation,
  'reviewHash',encode(sha256(convert_to(v::text,'UTF8')),'hex'),'original',v->'original','reviewRequired',v->'reviewRequired',
  'acknowledged',EXISTS(SELECT 1 FROM faolla_checkout_design.intent_acknowledgements WHERE site_id=p_site_id AND operation_key=p_operation_key)));
END;
$$;
-- The new HTTP mode dispatches THIS wrapper, not a pre-read followed by an
-- unguarded write. Enrollment and the original writer share one transaction,
-- site lock and enrollment row lock. Default-off cannot create an untracked
-- first original even if an app flag was accidentally configured alone.
CREATE FUNCTION public.faolla_member_checkout_intent_cart_commit_v1(p_site_id text,p_operation_key text,p_principal_key text,p_request_hash text,p_snapshot jsonb,p_plan jsonb,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 PERFORM 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;
 IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND principal_key=p_principal_key) THEN RAISE EXCEPTION 'checkout_intent_disabled';END IF;
 RETURN public.faolla_member_checkout_cart_commit_v1(p_site_id,p_operation_key,p_principal_key,p_request_hash,p_snapshot,p_plan,p_not_after);
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_intent_review_v1(text,text,text),
 public.faolla_member_checkout_intent_cart_commit_v1(text,text,text,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
