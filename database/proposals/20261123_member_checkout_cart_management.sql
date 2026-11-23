-- UNINSTALLED PRIVATE PROPOSAL. No production registry/grants/rollout.
-- Merchant authority is independently verified by the server adapter. The
-- customer's original principal is inferred ONLY inside this private wrapper;
-- the actual merchant owner is appended to the immutable actor audit.
BEGIN;
CREATE FUNCTION public.faolla_checkout_cart_resource_link_v1(p_site_id text,p_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype; rec jsonb; view jsonb; n integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_id IS NULL OR p_id!~'^[A-Za-z0-9:_-]{1,160}$' THEN RAISE EXCEPTION 'checkout_unauthorized';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_unavailable';END IF;
 SELECT count(*) INTO n FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND resource_kind='order' AND resource_id=p_id;
 IF n=0 THEN RETURN NULL;END IF;
 IF n<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
 SELECT * INTO STRICT b FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND resource_kind='order' AND resource_id=p_id;
 -- Known old single receipts retain their original bridge; unknown versions
 -- must not masquerade as an unlinked ordinary order.
 IF b.receipt->'version'='1'::jsonb OR b.receipt->'version'='2'::jsonb AND b.receipt->>'method'='on_site' THEN RETURN NULL;END IF;
 IF (b.receipt->'version'='3'::jsonb AND b.receipt->>'purpose'='product_cart' AND b.receipt->>'method' IN ('points','on_site')) IS NOT TRUE
  THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
 WITH matches AS (
  SELECT r FROM public.pages p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.blocks)='array' THEN p.blocks ELSE '[]'::jsonb END) r
  WHERE p.merchant_id=p_site_id AND (p.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$') OR p.slug='__merchant_orders__:'||p_site_id
   AND NOT EXISTS(SELECT 1 FROM public.pages c WHERE c.merchant_id=p_site_id AND c.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$')))
   AND r->>'id'=p_id AND r->>'siteId'=p_site_id
 ) SELECT count(*),CASE WHEN count(*)=1 THEN (jsonb_agg(r))->0 ELSE NULL END INTO n,rec FROM matches;
 IF n<>1 OR rec->>'customerAccountId' IS DISTINCT FROM split_part(b.principal_key,':',2)
  OR rec->>'customerUserId' IS DISTINCT FROM split_part(b.principal_key,':',3) THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
 view:=public.faolla_member_checkout_cart_result_v1(p_site_id,b.operation_key,b.principal_key);
 IF view IS NULL THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
 RETURN jsonb_build_object('siteId',p_site_id,'kind','order','id',p_id,'operationKey',b.operation_key,'record',rec,'cart',view,
  'refundRequired',EXISTS(SELECT 1 FROM faolla_checkout_design.on_site_collections WHERE site_id=p_site_id AND operation_key=b.operation_key)
   OR EXISTS(SELECT 1 FROM faolla_checkout_design.cart_collections WHERE site_id=p_site_id AND operation_key=b.operation_key));
END;
$$;
CREATE FUNCTION public.faolla_checkout_cart_merchant_cancel_v1(p_site_id text,p_operation_key text,p_actor_key text,p_expected_updated_at text,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype; result jsonb; deadline timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_actor_key IS NULL OR p_actor_key!~'^owner:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_unauthorized';END IF;
 deadline:=p_not_after::timestamptz;
 IF deadline IS NULL OR NOT isfinite(deadline) OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '15 seconds' THEN RAISE EXCEPTION 'checkout_quote_expired';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_quote_expired';END IF;
 SELECT * INTO b FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF NOT FOUND OR b.resource_kind<>'order' OR (b.receipt->'version'='3'::jsonb AND b.receipt->>'purpose'='product_cart') IS NOT TRUE THEN RAISE EXCEPTION 'checkout_not_found';END IF;
 result:=public.faolla_member_checkout_cart_cancel_v1(p_site_id,p_operation_key,b.principal_key,p_expected_updated_at,p_not_after);
 IF result->'replayed'='false'::jsonb THEN INSERT INTO faolla_checkout_design.merchant_cancellation_actors VALUES(p_site_id,p_operation_key,p_actor_key);END IF;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_quote_expired';END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_checkout_cart_resource_link_v1(text,text),public.faolla_checkout_cart_merchant_cancel_v1(text,text,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
