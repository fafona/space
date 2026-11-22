-- PRIVATE, OWNER-ONLY ISOLATED PROPOSAL. Not a registered production migration.
-- No public endpoint/grant, no Stripe/mail and no inverse compensation.
-- Future HTTP authorization must still verify the current customer session.
BEGIN;
CREATE TABLE faolla_checkout_design.bundle_cancellations (
  site_id text NOT NULL, operation_key text NOT NULL, principal_key text NOT NULL,
  receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(site_id,operation_key),
  FOREIGN KEY(site_id,operation_key) REFERENCES faolla_checkout_design.bundle_results(site_id,operation_key)
);
CREATE TABLE faolla_checkout_design.bundle_coupon_returns (
  site_id text NOT NULL, redeem_event_id text NOT NULL, operation_key text NOT NULL,
  original_redemption jsonb NOT NULL,
  PRIMARY KEY(site_id,redeem_event_id),
  FOREIGN KEY(site_id,operation_key) REFERENCES faolla_checkout_design.bundle_cancellations(site_id,operation_key) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER immutable_bundle_cancellations BEFORE UPDATE OR DELETE ON faolla_checkout_design.bundle_cancellations
FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();
CREATE TRIGGER immutable_bundle_coupon_returns BEFORE UPDATE OR DELETE ON faolla_checkout_design.bundle_coupon_returns
FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();

CREATE FUNCTION faolla_checkout_design.cancel_bundle(p_site_id text,p_operation_key text,p_principal_key text,p_expected_updated_at text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
  v_original faolla_checkout_design.bundle_results%rowtype;
  v_previous faolla_checkout_design.bundle_cancellations%rowtype;
  v_control public.faolla_booking_atomic_control%rowtype;
  v_member_page public.pages%rowtype; v_settings_page public.pages%rowtype; v_coupon_page public.pages%rowtype;
  v_receipt jsonb; v_policy jsonb; v_result jsonb;
  v_rows jsonb; v_records jsonb; v_record jsonb; v_next_records jsonb;
  v_members jsonb; v_member jsonb; v_settings jsonb; v_coupons jsonb;
  v_use jsonb; v_item jsonb; v_coupon jsonb; v_claim jsonb; v_event jsonb; v_tx jsonb; v_transactions jsonb;
  v_mutation jsonb := '{}'; v_refund_tx jsonb; v_foreign jsonb;
  v_account text; v_user text; v_member_id text; v_stamp text; v_level text;
  v_points bigint := 0; v_coupon_count integer := 0; v_stock_count integer := 0;
  v_growth numeric; v_growth_return numeric := 0; v_new_points numeric;
BEGIN
  IF p_site_id IS NULL OR p_site_id !~ '^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key !~ '^[a-f0-9]{64}$'
    OR p_principal_key IS NULL OR p_principal_key !~ '^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_unauthorized'; END IF;
  v_account := split_part(p_principal_key,':',2); v_user := split_part(p_principal_key,':',3);
  -- Same lock order as commit_bundle and the original domain writers.
  PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
  SELECT * INTO v_original FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
  IF NOT FOUND OR v_original.principal_key IS DISTINCT FROM p_principal_key THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
  SELECT * INTO v_previous FROM faolla_checkout_design.bundle_cancellations WHERE site_id=p_site_id AND operation_key=p_operation_key;
  IF FOUND THEN
    IF v_previous.principal_key IS DISTINCT FROM p_principal_key THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
    RETURN jsonb_build_object('replayed',true,'receipt',v_previous.receipt);
  END IF;
  -- New purchases may be disabled, but an ORIGINAL paid/coupon operation may
  -- still be cancelled under its ORIGINAL policy. Do not read today's offer.
  v_receipt := v_original.receipt; v_policy := v_receipt->'cancellationPolicy';
  IF jsonb_typeof(v_policy->'returnPoints') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(v_policy->'returnCoupons') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(v_receipt->'stockUses') IS DISTINCT FROM 'array'
    OR jsonb_typeof(v_receipt->'pointTransactions') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
  IF v_original.resource_kind='booking' THEN
    SELECT * INTO STRICT v_control FROM public.faolla_booking_atomic_control FOR UPDATE;
    IF NOT v_control.active OR v_control.protocol<>2 THEN RAISE EXCEPTION 'booking_atomic_inactive'; END IF;
    v_rows := public.faolla_booking_atomic_rows_v1();
    SELECT r#>'{blocks,records}' INTO v_records FROM jsonb_array_elements(v_rows) r WHERE r->>'slug'='__merchant_booking_records__:v1';
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'blocks',blocks,'updated_at',updated_at) ORDER BY slug,id),'[]'::jsonb) INTO v_rows
      FROM public.pages WHERE slug='__merchant_orders__:'||p_site_id OR slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$');
    SELECT coalesce(jsonb_agg(i ORDER BY CASE WHEN r->>'slug'='__merchant_orders__:'||p_site_id THEN -1 ELSE substring(r->>'slug' FROM ':chunk:([0-9]+)$')::integer END,n),'[]'::jsonb) INTO v_records
      FROM jsonb_array_elements(v_rows) r CROSS JOIN LATERAL jsonb_array_elements(r->'blocks') WITH ORDINALITY x(i,n)
      WHERE r->>'slug'<>'__merchant_orders__:'||p_site_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) c WHERE c->>'slug'~':chunk:[0-9]+$');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0));
  IF (SELECT count(*) FROM jsonb_array_elements(v_records) r WHERE r->>'id'=v_original.resource_id AND r->>'siteId'=p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
  SELECT value INTO v_record FROM jsonb_array_elements(v_records) r WHERE r->>'id'=v_original.resource_id AND r->>'siteId'=p_site_id;
  IF v_record->>'customerAccountId' IS DISTINCT FROM v_account OR v_record->>'customerUserId' IS DISTINCT FROM v_user THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
  IF v_record->>'updatedAt' IS DISTINCT FROM p_expected_updated_at OR p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  IF coalesce(v_record->>'status','') NOT IN ('active','pending','confirmed') THEN RAISE EXCEPTION 'checkout_cancellation_not_allowed'; END IF;
  -- Old editors do not author settlement amendments. A changed time/item/cart
  -- requires the future verified reschedule/change path, not silent refunds
  -- against different inventory or an earlier service deadline.
  IF v_receipt->'resourceTerms' IS DISTINCT FROM (CASE WHEN v_original.resource_kind='booking' THEN
    jsonb_build_object('appointmentAt',v_record->'appointmentAt','store',v_record->'store','item',v_record->'item',
      'bookingBlockId',v_record->'bookingBlockId','bookingViewport',v_record->'bookingViewport')
    ELSE jsonb_build_object('items',v_record->'items','totalQuantity',v_record->'totalQuantity','totalAmount',v_record->'totalAmount') END)
    THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
  IF v_original.resource_kind='booking' AND ((v_policy->>'cancellableUntil') IS NULL
    OR clock_timestamp()>(v_policy->>'cancellableUntil')::timestamptz) THEN RAISE EXCEPTION 'checkout_cancellation_deadline'; END IF;
  v_stamp := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_membership_settings__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  SELECT * INTO STRICT v_settings_page FROM public.pages WHERE slug='__merchant_membership_settings__:'||p_site_id FOR UPDATE;
  IF v_settings_page.merchant_id IS DISTINCT FROM p_site_id THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  v_settings := v_settings_page.blocks;
  v_member_id := v_receipt->>'membershipId';
  IF (v_policy->>'returnPoints')::boolean AND (v_receipt->>'totalPoints')::bigint>0 THEN
    IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_memberships__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_membership_unavailable'; END IF;
    SELECT * INTO STRICT v_member_page FROM public.pages WHERE slug='__merchant_memberships__:'||p_site_id FOR UPDATE;
    IF v_member_page.merchant_id IS DISTINCT FROM p_site_id THEN RAISE EXCEPTION 'checkout_membership_unavailable'; END IF;
    v_members := v_member_page.blocks;
    IF (SELECT count(*) FROM jsonb_array_elements(v_members) m WHERE m->>'id'=v_member_id)<>1 THEN RAISE EXCEPTION 'checkout_membership_unavailable'; END IF;
    SELECT value INTO v_member FROM jsonb_array_elements(v_members) m WHERE m->>'id'=v_member_id;
    -- Refunding the original record remains possible after leaving membership;
    -- it does NOT activate membership or select another matching email/name.
    IF v_member->>'siteId' IS DISTINCT FROM p_site_id OR coalesce(v_member->>'accountId','') NOT IN ('',v_account)
      OR coalesce(v_member->>'userId','') NOT IN ('',v_user) OR coalesce(v_member->>'accountId','')='' AND coalesce(v_member->>'userId','')='' THEN RAISE EXCEPTION 'checkout_membership_unavailable'; END IF;
    v_transactions := v_member->'transactions';
    FOR v_tx IN SELECT value FROM jsonb_array_elements(v_receipt->'pointTransactions') LOOP
      IF (SELECT count(*) FROM jsonb_array_elements(v_transactions) t WHERE t->>'id'=v_tx->>'id' AND t=v_tx)<>1
        OR v_tx->>'status' IS DISTINCT FROM 'completed' OR v_tx->>'type' IS DISTINCT FROM 'redeem'
        OR v_tx->>'operatorId' IS DISTINCT FROM 'customer:'||v_account THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
      v_points := v_points-(v_tx->>'pointDelta')::bigint;
      v_growth_return := v_growth_return+(v_tx->>'growthDelta')::numeric;
      SELECT jsonb_agg(CASE WHEN t->>'id'=v_tx->>'id' THEN t||jsonb_build_object('status','cancelled','cancelledAt',v_stamp,
        'cancelledBy','customer:'||v_account,'cancellationNote','Member checkout cancelled','cancellationOperationMarker','[member-checkout-return:'||p_operation_key||']') ELSE t END ORDER BY n)
        INTO v_transactions FROM jsonb_array_elements(v_transactions) WITH ORDINALITY x(t,n);
    END LOOP;
    IF v_points IS DISTINCT FROM (v_receipt->>'totalPoints')::bigint THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
    v_new_points := (v_member->>'pointBalance')::numeric+v_points;
    IF v_new_points NOT BETWEEN 0 AND 9007199254740991 OR trunc(v_new_points)<>v_new_points THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
    v_refund_tx := jsonb_build_object('id',gen_random_uuid()::text,'type','recharge','status','completed','at',v_stamp,
      'pointDelta',v_points,'balanceDelta',0,'growthDelta',0,'note','Points returned [member-checkout-return:'||p_operation_key||']',
      'operatorId','system','cancelledAt',NULL,'cancellationNote','','cancelledBy','','cancellationOperationMarker','',
      'relatedTransactionId',CASE WHEN jsonb_array_length(v_receipt->'pointTransactions')=1 THEN v_receipt#>>'{pointTransactions,0,id}' ELSE '' END,'adjustmentKind','');
    v_transactions := jsonb_build_array(v_refund_tx)||v_transactions;
    -- Same annual/cumulative rule as the existing membership calculation.
    -- Cancelled spend growth is excluded; historical gift markers remain, so
    -- a cancellation/retry cannot grant a one-time level gift again.
    IF v_settings#>'{growthRules,annualRecalculate}'='true'::jsonb THEN
      SELECT coalesce(sum(greatest(0,(t->>'growthDelta')::numeric)),0) INTO v_growth FROM jsonb_array_elements(v_transactions) t
        WHERE t->>'status'<>'cancelled' AND extract(year FROM (t->>'at')::timestamptz)=extract(year FROM clock_timestamp());
    ELSE v_growth := greatest(0,(v_member->>'growthValue')::numeric-v_growth_return); END IF;
    SELECT coalesce(l->>'id','') INTO v_level FROM jsonb_array_elements(v_settings->'levels') WITH ORDINALITY x(l,n)
      WHERE l->'enabled'='true'::jsonb AND coalesce(l->>'name','')<>'' AND (l->>'requiredGrowthValue')::numeric<=v_growth
      ORDER BY (l->>'requiredGrowthValue')::numeric DESC,(l->>'sort')::numeric DESC,n DESC LIMIT 1;
    v_member := v_member||jsonb_build_object('pointBalance',v_new_points,'growthValue',v_growth,'levelId',coalesce(v_level,''),'transactions',v_transactions,'updatedAt',v_stamp);
    SELECT jsonb_agg(CASE WHEN m->>'id'=v_member_id THEN v_member ELSE m END ORDER BY n) INTO v_members FROM jsonb_array_elements(v_members) WITH ORDINALITY x(m,n);
    -- Original 046 deliberately rejects a membership-only envelope. Retain
    -- its exact settings CAS guard even when this checkout held no stock/coupon.
    v_mutation := v_mutation||jsonb_build_object('memberships',jsonb_build_object('expectedUpdatedAt',v_member_page.updated_at,'next',v_members),
      'settings',jsonb_build_object('expectedUpdatedAt',v_settings_page.updated_at,'next',v_settings));
  END IF;
  FOR v_use IN SELECT value FROM jsonb_array_elements(v_receipt->'stockUses') LOOP
    IF (SELECT count(*) FROM jsonb_array_elements(v_settings->'redemptionItems') i WHERE i->>'id'=v_use->>'itemId')<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
    SELECT value INTO v_item FROM jsonb_array_elements(v_settings->'redemptionItems') i WHERE i->>'id'=v_use->>'itemId';
    IF v_item->'stock'<>'null'::jsonb THEN
      IF jsonb_typeof(v_item->'stock') IS DISTINCT FROM 'number' OR (v_item->>'stock')::numeric<0
        OR (v_item->>'stock')::numeric+(v_use->>'quantity')::integer>9007199254740991 THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
      v_item := v_item||jsonb_build_object('stock',(v_item->>'stock')::numeric+(v_use->>'quantity')::integer);
      SELECT v_settings||jsonb_build_object('redemptionItems',jsonb_agg(CASE WHEN i->>'id'=v_use->>'itemId' THEN v_item ELSE i END ORDER BY n)) INTO v_settings
        FROM jsonb_array_elements(v_settings->'redemptionItems') WITH ORDINALITY x(i,n);
    END IF;
    v_stock_count := v_stock_count+(v_use->>'quantity')::integer;
  END LOOP;
  IF jsonb_array_length(v_receipt->'stockUses')>0 THEN
    v_mutation := v_mutation||jsonb_build_object('settings',jsonb_build_object('expectedUpdatedAt',v_settings_page.updated_at,'next',v_settings));
  END IF;
  IF (v_policy->>'returnCoupons')::boolean AND (v_receipt->>'couponCount')::integer>0 THEN
    IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_coupons__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
    SELECT * INTO STRICT v_coupon_page FROM public.pages WHERE slug='__merchant_coupons__:'||p_site_id FOR UPDATE;
    IF v_coupon_page.merchant_id IS DISTINCT FROM p_site_id THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
    v_coupons := v_coupon_page.blocks;
    FOR v_use IN SELECT value FROM jsonb_array_elements(v_receipt->'couponUses') LOOP
      IF (SELECT count(*) FROM jsonb_array_elements(v_coupons) c WHERE c->>'id'=v_use->>'couponId')<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
      SELECT value INTO v_coupon FROM jsonb_array_elements(v_coupons) c WHERE c->>'id'=v_use->>'couponId';
      SELECT value INTO v_claim FROM jsonb_array_elements(v_coupon->'claimEvents') c WHERE c->>'id'=v_use->>'claimEventId';
      IF v_coupon->>'siteId' IS DISTINCT FROM p_site_id OR v_claim IS NULL
        OR coalesce(v_claim->>'accountId','') NOT IN ('',v_account) OR coalesce(v_claim->>'userId','') NOT IN ('',v_user)
        OR coalesce(v_claim->>'accountId','')='' AND coalesce(v_claim->>'userId','')='' THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
      IF (SELECT count(*) FROM jsonb_array_elements(v_coupon->'redeemEvents') r WHERE r->>'id'=v_use->>'redeemEventId'
        AND r->>'claimEventId'=v_use->>'claimEventId' AND r->>'settlementCode'=v_claim->>'settlementCode')<>1
        OR (v_coupon->>'usedCount')::bigint<1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
      SELECT value INTO v_event FROM jsonb_array_elements(v_coupon->'redeemEvents') r WHERE r->>'id'=v_use->>'redeemEventId';
      IF v_event->>'note' NOT LIKE '%[op:member-checkout-coupon:'||p_operation_key||']%' THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
      INSERT INTO faolla_checkout_design.bundle_coupon_returns VALUES(p_site_id,v_use->>'redeemEventId',p_operation_key,v_event);
      SELECT coalesce(jsonb_agg(r ORDER BY n),'[]'::jsonb) INTO v_foreign FROM jsonb_array_elements(v_coupon->'redeemEvents') WITH ORDINALITY x(r,n) WHERE r->>'id'<>v_use->>'redeemEventId';
      -- Original claims and expiry are byte-for-byte JSON preserved, even if
      -- expired now; returning a coupon is NOT extending or issuing a coupon.
      v_coupon := v_coupon||jsonb_build_object('usedCount',(v_coupon->>'usedCount')::bigint-1,'redeemEvents',v_foreign,'updatedAt',v_stamp);
      SELECT jsonb_agg(CASE WHEN c->>'id'=v_use->>'couponId' THEN v_coupon ELSE c END ORDER BY n) INTO v_coupons FROM jsonb_array_elements(v_coupons) WITH ORDINALITY x(c,n);
      v_coupon_count := v_coupon_count+1;
    END LOOP;
    IF v_coupon_count IS DISTINCT FROM (v_receipt->>'couponCount')::integer THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
    v_mutation := v_mutation||jsonb_build_object('coupons',jsonb_build_object('expectedUpdatedAt',v_coupon_page.updated_at,'next',v_coupons));
  END IF;
  IF v_mutation<>'{}'::jsonb THEN PERFORM public.faolla_commit_redemption_v1(p_site_id,v_mutation); END IF;
  v_record := v_record||jsonb_build_object('status','cancelled','cancelledAt',v_stamp,'updatedAt',v_stamp);
  SELECT jsonb_agg(CASE WHEN r->>'id'=v_original.resource_id AND r->>'siteId'=p_site_id THEN v_record ELSE r END ORDER BY n) INTO v_next_records
    FROM jsonb_array_elements(v_records) WITH ORDINALITY x(r,n);
  v_result := jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'resourceKind',v_original.resource_kind,
    'resourceId',v_original.resource_id,'closed',true,'pointsReturned',v_points,'couponsReturned',v_coupon_count,'stockReleased',v_stock_count,'cancelledAt',v_stamp);
  IF v_original.resource_kind='booking' THEN
    PERFORM public.faolla_booking_atomic_commit_v1(p_site_id,encode(sha256(convert_to('member-checkout-cancel:'||p_operation_key,'UTF8')),'hex'),
      encode(sha256(convert_to(v_original.request_hash||':cancel','UTF8')),'hex'),jsonb_build_object('generation',v_control.generation,'revision',v_control.revision::text,
        'rows',v_rows,'next',jsonb_build_object('version',1,'records',v_next_records),'result',v_result,'mailJobs','[]'::jsonb));
  ELSE PERFORM public.faolla_commit_order_membership_v1(p_site_id,jsonb_build_object('orders',jsonb_build_object('expectedRows',v_rows,'next',v_next_records))); END IF;
  INSERT INTO faolla_checkout_design.bundle_cancellations(site_id,operation_key,principal_key,receipt) VALUES(p_site_id,p_operation_key,p_principal_key,v_result);
  RETURN jsonb_build_object('replayed',false,'receipt',v_result);
END;
$$;
ALTER TABLE faolla_checkout_design.bundle_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.bundle_cancellations FORCE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.bundle_coupon_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.bundle_coupon_returns FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.bundle_cancellations,faolla_checkout_design.bundle_coupon_returns FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION faolla_checkout_design.cancel_bundle(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
