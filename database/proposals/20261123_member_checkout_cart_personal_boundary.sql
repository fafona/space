-- UNINSTALLED, private lookup only. Uses the existing cart link/result and
-- customer cancellation command without replacing either financial writer.
BEGIN;
CREATE FUNCTION public.faolla_checkout_cart_personal_resource_link_v1(p_site_id text,p_id text,p_principal_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype;n integer;v jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_id IS NULL OR p_id!~'^[A-Za-z0-9:_-]{1,160}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_unauthorized';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_unavailable';END IF;
 SELECT count(*) INTO n FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND resource_kind='order' AND resource_id=p_id;
 IF n=0 THEN RETURN NULL;END IF;
 IF n<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
 SELECT * INTO STRICT b FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND resource_kind='order' AND resource_id=p_id;
 -- Old single originals retain their proven bridge. A cart belonging to a
 -- different account must not be reported as an ordinary unlinked order.
 IF b.receipt->'version'='1'::jsonb OR b.receipt->'version'='2'::jsonb AND b.receipt->>'method'='on_site' THEN RETURN NULL;END IF;
 IF b.principal_key IS DISTINCT FROM p_principal_key THEN RAISE EXCEPTION 'checkout_not_found';END IF;
 v:=public.faolla_checkout_cart_resource_link_v1(p_site_id,p_id);
 IF v IS NULL THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
 RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_checkout_cart_personal_resource_link_v1(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
