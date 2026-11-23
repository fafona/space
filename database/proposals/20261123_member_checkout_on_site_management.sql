-- UNINSTALLED PRIVATE proposal. No migration registration, grants or activation.
-- Full original on-site receipt only: NOT Stripe/bank proof, refund or benefits.
BEGIN;
CREATE FUNCTION public.faolla_checkout_on_site_collect_v1(p_site_id text,p_operation_key text,p_actor_key text,p_expected_updated_at text,p_expected_due_minor bigint,p_not_after timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype; k faolla_checkout_design.on_site_collections%rowtype;
 c public.faolla_booking_atomic_control%rowtype; r jsonb; v jsonb; replayed boolean:=false;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_actor_key IS NULL OR p_actor_key!~'^owner:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_unauthorized'; END IF;
 IF p_not_after IS NULL OR NOT isfinite(p_not_after) OR p_not_after<clock_timestamp() OR p_not_after>clock_timestamp()+interval '15 seconds'
  THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 SELECT * INTO b FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
 IF b.receipt->'version' IS DISTINCT FROM '2'::jsonb OR b.receipt->>'method' IS DISTINCT FROM 'on_site'
  OR b.receipt->>'currency' IS DISTINCT FROM 'eur' OR b.receipt->'capturedMinor' IS DISTINCT FROM '0'::jsonb OR b.receipt->'totalPoints' IS DISTINCT FROM 'null'::jsonb
  OR p_expected_due_minor IS NULL OR p_expected_due_minor NOT BETWEEN 1 AND 99999999 OR (b.receipt->>'dueMinor')::bigint IS DISTINCT FROM p_expected_due_minor
  THEN RAISE EXCEPTION 'checkout_collection_not_allowed'; END IF;
 SELECT * INTO k FROM faolla_checkout_design.on_site_collections WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN replayed:=true;
 ELSE
  IF b.resource_kind='booking' THEN
   SELECT * INTO STRICT c FROM public.faolla_booking_atomic_control FOR UPDATE;
   IF NOT c.active OR c.protocol<>2 THEN RAISE EXCEPTION 'checkout_collection_review_required'; END IF;
  ELSIF b.resource_kind<>'order' THEN RAISE EXCEPTION 'checkout_collection_review_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0));
  -- Lock the actual old storage rows as well as its advisory protocol. A raw
  -- existing writer cannot change the observed resource between check/insert.
  PERFORM 1 FROM public.pages WHERE (b.resource_kind='booking' AND slug='__merchant_booking_records__:v1') OR
   (b.resource_kind='order' AND merchant_id=p_site_id AND (slug='__merchant_orders__:'||p_site_id OR slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$')))
   ORDER BY slug,id FOR UPDATE;
  v:=public.faolla_member_checkout_on_site_result_v1(p_site_id,p_operation_key,b.principal_key);r:=v->'resource';
  IF v IS NULL OR v->'termsMatch' IS DISTINCT FROM 'true'::jsonb OR v->'closed' IS DISTINCT FROM 'false'::jsonb OR jsonb_typeof(r) IS DISTINCT FROM 'object'
   OR coalesce(r->>'status','') NOT IN ('active','pending','confirmed','completed') THEN RAISE EXCEPTION 'checkout_collection_review_required'; END IF;
  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM r->>'updatedAt' THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  IF clock_timestamp()>p_not_after THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  INSERT INTO faolla_checkout_design.on_site_collections(site_id,operation_key,amount_minor,currency,actor_key)
   VALUES(p_site_id,p_operation_key,p_expected_due_minor,'eur',p_actor_key) RETURNING * INTO k;
 END IF;
 IF clock_timestamp()>p_not_after THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'resourceKind',b.resource_kind,'resourceId',b.resource_id,
  'replayed',replayed,'amountMinor',k.amount_minor,'currency',k.currency,'recordedAt',k.recorded_at);
END;
$$;
-- Preserve the old exact resource/ownership lookup, then replace its points-
-- only projection inside SQL. Raw records never go to a browser directly.
CREATE FUNCTION public.faolla_checkout_resource_link_v2(p_site_id text,p_kind text,p_id text,p_principal_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE old jsonb; original jsonb;
BEGIN
 old:=public.faolla_checkout_resource_link_v1(p_site_id,p_kind,p_id,p_principal_key);
 IF old IS NULL THEN RETURN NULL; END IF;
 SELECT public.faolla_member_checkout_original_result_v1(b.site_id,b.operation_key,b.principal_key) INTO original
  FROM faolla_checkout_design.bundle_results b WHERE b.site_id=old->>'siteId' AND b.operation_key=old->>'operationKey';
 IF original IS NULL THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
 RETURN (old-'result')||jsonb_build_object('original',original);
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_checkout_on_site_collect_v1(text,text,text,text,bigint,timestamptz),public.faolla_checkout_resource_link_v2(text,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
