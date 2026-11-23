-- UNINSTALLED PRIVATE PROPOSAL. A guarded adapter around the original order
-- CAS, not a replacement, new charge, receipt adoption or acknowledgement.
BEGIN;
CREATE FUNCTION public.faolla_checkout_legacy_order_commit_v1(p_site_id text,p_mutation jsonb,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE deadline timestamptz;rec jsonb;principal text;last_claim faolla_checkout_design.intent_claims%rowtype;result jsonb;before_records jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR jsonb_typeof(p_mutation) IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_mutation->'orders') IS DISTINCT FROM 'object' OR jsonb_typeof(p_mutation#>'{orders,next}') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_mutation#>'{orders,expectedRows}') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'order_update_conflict';END IF;
 deadline:=p_not_after::timestamptz;
 IF deadline IS NULL OR NOT isfinite(deadline) OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '15 seconds' THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0));
 PERFORM 1 FROM public.pages WHERE merchant_id=p_site_id AND (slug='__merchant_orders__:'||p_site_id OR slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$')) ORDER BY slug,id FOR UPDATE;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 -- Compare new IDs against the actual locked whole store, not browser-sent
 -- ownership or an incomplete expected snapshot. Root/chunk moves are not
 -- new orders. The original CAS still validates every expected row.
 IF EXISTS(SELECT 1 FROM public.pages WHERE merchant_id=p_site_id AND (slug='__merchant_orders__:'||p_site_id OR slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$')) AND jsonb_typeof(blocks) IS DISTINCT FROM 'array') THEN RAISE EXCEPTION 'order_update_conflict';END IF;
 SELECT coalesce(jsonb_agg(r),'[]'::jsonb) INTO before_records FROM public.pages p CROSS JOIN LATERAL jsonb_array_elements(p.blocks) r
  WHERE p.merchant_id=p_site_id AND (p.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$') OR p.slug='__merchant_orders__:'||p_site_id
   AND NOT EXISTS(SELECT 1 FROM public.pages c WHERE c.merchant_id=p_site_id AND c.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$')));
 FOR rec IN SELECT n FROM jsonb_array_elements(p_mutation#>'{orders,next}') n WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(before_records) o WHERE o->>'id'=n->>'id' AND o->>'siteId'=p_site_id) LOOP
  IF rec->>'siteId' IS DISTINCT FROM p_site_id THEN RAISE EXCEPTION 'order_update_conflict';END IF;
  -- The old API constructs these fields from its actual session/signed
  -- identity. Guests and historical non-protocol identities remain legacy.
  IF coalesce(rec->>'customerAccountId','')!~'^[0-9]{8}$' OR coalesce(rec->>'customerUserId','')!~'^[A-Za-z0-9_-]{8,128}$' THEN CONTINUE;END IF;
  principal:='account:'||(rec->>'customerAccountId')||':'||(rec->>'customerUserId');
  PERFORM 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;
  IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND principal_key=principal) THEN CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_results b WHERE b.site_id=p_site_id AND b.principal_key=principal
   AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims c WHERE c.site_id=b.site_id AND c.operation_key=b.operation_key)) THEN RAISE EXCEPTION 'checkout_intent_review_required';END IF;
  SELECT * INTO last_claim FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND principal_key=principal ORDER BY generation DESC LIMIT 1;
  IF FOUND AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_acknowledgements a WHERE a.site_id=last_claim.site_id AND a.operation_key=last_claim.operation_key) THEN RAISE EXCEPTION 'checkout_original_pending';END IF;
 END LOOP;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 result:=public.faolla_commit_order_membership_v1(p_site_id,p_mutation);
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_checkout_legacy_order_commit_v1(text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
