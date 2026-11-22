-- ISOLATED INTEGRATION PROPOSAL ONLY. Not registered as a production migration.
-- Owner-only composition of the EXISTING 045/046/211/212/213 transactions.
-- No API-role grants, SECURITY DEFINER, activation RPC, production URL or mail
-- dispatch. Trusted offer/rule/permission preparation is a separate prerequisite.
BEGIN;
CREATE TABLE faolla_checkout_design.bundle_pilots (
  site_id text PRIMARY KEY CHECK (site_id ~ '^[0-9]{8}$'), enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE faolla_checkout_design.bundle_results (
  site_id text NOT NULL, operation_key text NOT NULL CHECK (operation_key ~ '^[a-f0-9]{64}$'),
  principal_key text NOT NULL, request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  resource_kind text NOT NULL, resource_id text NOT NULL, receipt jsonb NOT NULL,
  PRIMARY KEY(site_id, operation_key), UNIQUE(site_id,resource_kind,resource_id)
);
CREATE TRIGGER immutable_bundle_results BEFORE UPDATE OR DELETE ON faolla_checkout_design.bundle_results
FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();

CREATE FUNCTION faolla_checkout_design.commit_bundle(p_site_id text,p_operation_key text,p_principal_key text,p_request_hash text,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_previous faolla_checkout_design.bundle_results%rowtype;
  v_control public.faolla_booking_atomic_control%rowtype;
  v_page public.pages%rowtype; v_member_page public.pages%rowtype; v_settings_page public.pages%rowtype; v_coupon_page public.pages%rowtype;
  v_members jsonb; v_member jsonb; v_next_member jsonb; v_next_members jsonb; v_transactions jsonb;
  v_settings jsonb; v_coupons jsonb; v_coupon jsonb; v_claim jsonb; v_pick jsonb; v_delta jsonb; v_item jsonb;
  v_redemption jsonb; v_redeem_event jsonb; v_coupon_uses jsonb := '[]';
  v_orders_rows jsonb; v_orders_before jsonb; v_rows jsonb; v_before jsonb; v_record jsonb;
  v_result jsonb; v_receipt jsonb; v_order_versions jsonb;
  v_account text; v_user text; v_member_id text; v_kind text; v_id text; v_stamp text;
  v_debit bigint; v_coupon_count integer; v_new_points numeric; v_transaction_delta numeric;
  v_member_state jsonb; v_level_id text;
BEGIN
  IF p_site_id IS NULL OR p_site_id !~ '^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key !~ '^[a-f0-9]{64}$'
    OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$'
    OR p_principal_key IS NULL OR p_principal_key !~ '^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
    OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object' OR octet_length(p_plan::text)>262144
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_plan) k WHERE k NOT IN ('membership','settingsVersion','stock','coupons','couponReturnOnCancel','booking','order','receipt')) THEN
    RAISE EXCEPTION 'checkout_invalid_plan';
  END IF;
  v_account := split_part(p_principal_key,':',2); v_user := split_part(p_principal_key,':',3);
  PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
  SELECT * INTO v_previous FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
  IF FOUND THEN
    IF v_previous.principal_key<>p_principal_key OR v_previous.request_hash<>p_request_hash THEN RAISE EXCEPTION 'checkout_operation_conflict'; END IF;
    RETURN jsonb_build_object('replayed',true,'receipt',v_previous.receipt);
  END IF;
  PERFORM 1 FROM faolla_checkout_design.bundle_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_disabled'; END IF;
  IF (p_plan ? 'booking') = (p_plan ? 'order') THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
  v_kind := CASE WHEN p_plan ? 'booking' THEN 'booking' ELSE 'order' END;
  v_record := p_plan#>ARRAY[v_kind,'record']; v_id := v_record->>'id'; v_receipt := p_plan->'receipt';
  IF jsonb_typeof(v_record) IS DISTINCT FROM 'object' OR v_record->>'siteId' IS DISTINCT FROM p_site_id
    OR v_id IS NULL OR length(v_id) NOT BETWEEN 1 AND 160 OR v_record->>'customerAccountId' IS DISTINCT FROM v_account
    OR v_record->>'customerUserId' IS DISTINCT FROM v_user
    OR v_record->>'status' IS DISTINCT FROM (CASE v_kind WHEN 'booking' THEN 'active' ELSE 'pending' END)
    OR jsonb_typeof(v_receipt) IS DISTINCT FROM 'object' OR v_receipt->'version' IS DISTINCT FROM '1'::jsonb
    OR v_receipt->>'resourceKind' IS DISTINCT FROM v_kind OR v_receipt->>'resourceId' IS DISTINCT FROM v_id
    OR jsonb_typeof(v_receipt->'totalPoints') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v_receipt->'couponCount') IS DISTINCT FROM 'number'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_receipt) k WHERE k NOT IN ('version','resourceKind','resourceId','totalPoints','couponCount')) THEN
    RAISE EXCEPTION 'checkout_invalid_plan';
  END IF;
  IF (v_receipt->>'totalPoints')::numeric NOT BETWEEN 0 AND 99999999
    OR trunc((v_receipt->>'totalPoints')::numeric)<>(v_receipt->>'totalPoints')::numeric
    OR (v_receipt->>'couponCount')::numeric NOT BETWEEN 0 AND 20
    OR trunc((v_receipt->>'couponCount')::numeric)<>(v_receipt->>'couponCount')::numeric THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
  v_debit := (v_receipt->>'totalPoints')::bigint; v_coupon_count := (v_receipt->>'couponCount')::integer;
  IF v_debit=0 AND v_coupon_count=0 THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
  IF v_coupon_count>0 AND jsonb_typeof(p_plan->'couponReturnOnCancel') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'checkout_coupon_policy_required'; END IF;

  -- Shared lock order: original global booking control, THEN original merchant
  -- order/member lock. Old booking writers never acquire the latter, old
  -- member/coupon writers never acquire the former. No alternate lock namespace
  -- can bypass the original CAS or active-generation fence.
  IF v_kind='booking' THEN
    SELECT * INTO STRICT v_control FROM public.faolla_booking_atomic_control FOR UPDATE;
    IF NOT v_control.active OR v_control.protocol<>2 THEN RAISE EXCEPTION 'booking_atomic_inactive'; END IF;
    IF p_plan#>>'{booking,generation}' IS DISTINCT FROM v_control.generation::text
      OR p_plan#>>'{booking,revision}' IS DISTINCT FROM v_control.revision::text THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0));
  -- Membership pricing/expiry/benefit configuration is part of every prepared
  -- checkout, even when no finite stock changes. Keep 046's original guard.
  IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_membership_settings__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  SELECT * INTO STRICT v_settings_page FROM public.pages WHERE slug='__merchant_membership_settings__:'||p_site_id FOR UPDATE;
  IF v_settings_page.merchant_id IS DISTINCT FROM p_site_id OR v_settings_page.updated_at IS DISTINCT FROM (p_plan->>'settingsVersion')::timestamptz THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  v_settings := v_settings_page.blocks;
  IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_memberships__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_membership_unavailable'; END IF;
  SELECT * INTO STRICT v_member_page FROM public.pages WHERE slug='__merchant_memberships__:'||p_site_id FOR UPDATE;
  IF v_member_page.merchant_id IS DISTINCT FROM p_site_id OR jsonb_typeof(v_member_page.blocks) IS DISTINCT FROM 'array'
    OR v_member_page.updated_at IS DISTINCT FROM (p_plan#>>'{membership,expectedUpdatedAt}')::timestamptz THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  v_members := v_member_page.blocks; v_member_id := p_plan#>>'{membership,id}';
  IF (SELECT count(*) FROM jsonb_array_elements(v_members) m WHERE m->>'id'=v_member_id)<>1 THEN RAISE EXCEPTION 'checkout_membership_unavailable'; END IF;
  SELECT value INTO v_member FROM jsonb_array_elements(v_members) m WHERE m->>'id'=v_member_id;
  IF v_member->>'siteId' IS DISTINCT FROM p_site_id OR v_member->>'status' IS DISTINCT FROM 'active'
    OR coalesce(v_member->>'accountId','')='' AND coalesce(v_member->>'userId','')=''
    OR coalesce(v_member->>'accountId','') NOT IN ('',v_account) OR coalesce(v_member->>'userId','') NOT IN ('',v_user) THEN
    RAISE EXCEPTION 'checkout_membership_unavailable';
  END IF;
  v_transactions := p_plan#>'{membership,transactions}';
  IF jsonb_typeof(v_transactions) IS DISTINCT FROM 'array' OR jsonb_array_length(v_transactions)>256
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_transactions) t WHERE jsonb_typeof(t) IS DISTINCT FROM 'object'
      OR coalesce(t->>'id','')='' OR length(t->>'id')>180 OR t->>'status' IS DISTINCT FROM 'completed'
      OR jsonb_typeof(t->'pointDelta') IS DISTINCT FROM 'number' OR (t->>'pointDelta')::numeric<>trunc((t->>'pointDelta')::numeric)
      OR t->>'operatorId' IS NULL OR t->>'operatorId' NOT IN ('system','customer:'||v_account)
      OR t->'balanceDelta' IS DISTINCT FROM '0'::jsonb OR jsonb_typeof(t->'growthDelta') IS DISTINCT FROM 'number'
      OR (t->>'growthDelta')::numeric<0 OR (t->>'growthDelta')::numeric>9007199254740991
      OR round((t->>'growthDelta')::numeric,2)<>(t->>'growthDelta')::numeric)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_transactions) t GROUP BY t->>'id' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_transactions) t CROSS JOIN jsonb_array_elements(v_member->'transactions') old WHERE t->>'id'=old->>'id') THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
  IF (SELECT coalesce(-sum((t->>'pointDelta')::numeric),0) FROM jsonb_array_elements(v_transactions) t WHERE t->>'operatorId'='customer:'||v_account)<>v_debit
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_transactions) t WHERE t->>'operatorId'='customer:'||v_account
      AND ((t->>'pointDelta')::numeric>=0 OR t->>'type' IS DISTINCT FROM 'redeem')) THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
  SELECT coalesce(sum((t->>'pointDelta')::numeric),0) INTO v_transaction_delta FROM jsonb_array_elements(v_transactions) t;
  v_new_points := (v_member->>'pointBalance')::numeric+v_transaction_delta;
  IF v_new_points<0 THEN RAISE EXCEPTION 'checkout_insufficient_points'; END IF;
  -- Transaction cost has a pilot cap; an existing member balance keeps the
  -- original safe-integer range. Do not silently impose the order-cost cap.
  IF v_new_points>9007199254740991 OR trunc(v_new_points)<>v_new_points THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
  v_member_state := p_plan#>'{membership,nextState}';
  -- The trusted server prepares existing expiry/level/birthday benefits and
  -- annual growth rules against the exact settings/member CAS snapshots.
  -- This PRIVATE OWNER-ONLY prototype is not a financial authorization API:
  -- no role grants may be added without the reviewed pricing/ACL rollout.
  IF v_member_state IS NOT NULL THEN
    IF jsonb_typeof(v_member_state) IS DISTINCT FROM 'object'
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_member_state) k WHERE k NOT IN ('pointBalance','growthValue','levelId'))
      OR v_member_state->'pointBalance' IS DISTINCT FROM to_jsonb(v_new_points)
      OR jsonb_typeof(v_member_state->'growthValue') IS DISTINCT FROM 'number'
      OR (v_member_state->>'growthValue')::numeric NOT BETWEEN 0 AND 9007199254740991
      OR round((v_member_state->>'growthValue')::numeric,2)<>(v_member_state->>'growthValue')::numeric
      OR jsonb_typeof(v_member_state->'levelId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
    SELECT coalesce(l->>'id','') INTO v_level_id FROM jsonb_array_elements(v_settings->'levels') WITH ORDINALITY x(l,n)
      WHERE l->'enabled'='true'::jsonb AND coalesce(l->>'name','')<>''
        AND (l->>'requiredGrowthValue')::numeric<=(v_member_state->>'growthValue')::numeric
      ORDER BY (l->>'requiredGrowthValue')::numeric DESC,(l->>'sort')::numeric DESC,n DESC LIMIT 1;
    IF v_member_state->>'levelId' IS DISTINCT FROM coalesce(v_level_id,'') THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
  ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(v_transactions) t WHERE t->'growthDelta' IS DISTINCT FROM '0'::jsonb) THEN
    RAISE EXCEPTION 'checkout_invalid_plan';
  END IF;
  v_stamp := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  -- Only the target member changes. Other members and old transactions remain
  -- original JSON; the request carries NEW transactions, never a whole tenant.
  v_next_member := v_member||jsonb_build_object('pointBalance',v_new_points,'transactions',v_transactions||(v_member->'transactions'),'updatedAt',v_stamp);
  IF v_member_state IS NOT NULL THEN
    v_next_member := v_next_member||jsonb_build_object('growthValue',v_member_state->'growthValue','levelId',v_member_state->'levelId');
  END IF;
  SELECT jsonb_agg(CASE WHEN m->>'id'=v_member_id THEN v_next_member ELSE m END ORDER BY n) INTO v_next_members
    FROM jsonb_array_elements(v_members) WITH ORDINALITY x(m,n);
  v_redemption := jsonb_build_object('operation',jsonb_build_object('id','self-checkout:'||p_operation_key,'fingerprint',p_request_hash,'membershipId',v_member_id),
    'settings',jsonb_build_object('expectedUpdatedAt',v_settings_page.updated_at,'next',v_settings),
    'memberships',jsonb_build_object('expectedUpdatedAt',v_member_page.updated_at,'next',v_next_members));

  IF p_plan ? 'stock' THEN
    IF v_settings_page.merchant_id IS DISTINCT FROM p_site_id OR v_settings_page.updated_at IS DISTINCT FROM (p_plan#>>'{stock,expectedUpdatedAt}')::timestamptz
      OR jsonb_typeof(p_plan#>'{stock,deltas}') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan#>'{stock,deltas}')>20 THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_plan#>'{stock,deltas}') d GROUP BY d->>'itemId' HAVING count(*)>1) THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
    FOR v_delta IN SELECT value FROM jsonb_array_elements(p_plan#>'{stock,deltas}') LOOP
      IF jsonb_typeof(v_delta->'quantity') IS DISTINCT FROM 'number' OR (v_delta->>'quantity')::numeric NOT BETWEEN 1 AND 999
        OR trunc((v_delta->>'quantity')::numeric)<>(v_delta->>'quantity')::numeric
        OR (SELECT count(*) FROM jsonb_array_elements(v_settings->'redemptionItems') i WHERE i->>'id'=v_delta->>'itemId')<>1 THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
      SELECT value INTO v_item FROM jsonb_array_elements(v_settings->'redemptionItems') i WHERE i->>'id'=v_delta->>'itemId';
      IF v_item->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'checkout_quantity_unavailable'; END IF;
      IF v_item->'stock'='null'::jsonb THEN CONTINUE; END IF;
      IF (v_item->>'stock')::numeric<(v_delta->>'quantity')::numeric THEN RAISE EXCEPTION 'checkout_quantity_unavailable'; END IF;
      v_item := v_item||jsonb_build_object('stock',(v_item->>'stock')::numeric-(v_delta->>'quantity')::numeric);
      SELECT v_settings||jsonb_build_object('redemptionItems',jsonb_agg(CASE WHEN i->>'id'=v_delta->>'itemId' THEN v_item ELSE i END ORDER BY n)) INTO v_settings
        FROM jsonb_array_elements(v_settings->'redemptionItems') WITH ORDINALITY x(i,n);
    END LOOP;
    v_redemption := v_redemption||jsonb_build_object('settings',jsonb_build_object('expectedUpdatedAt',v_settings_page.updated_at,'next',v_settings));
  END IF;

  IF v_coupon_count>0 THEN
    IF jsonb_typeof(p_plan#>'{coupons,claims}') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan#>'{coupons,claims}')<>v_coupon_count
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_plan#>'{coupons,claims}') c GROUP BY c->>'couponId',c->>'claimEventId' HAVING count(*)>1)
      OR (SELECT count(*) FROM public.pages WHERE slug='__merchant_coupons__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
    SELECT * INTO STRICT v_coupon_page FROM public.pages WHERE slug='__merchant_coupons__:'||p_site_id FOR UPDATE;
    IF v_coupon_page.merchant_id IS DISTINCT FROM p_site_id OR v_coupon_page.updated_at IS DISTINCT FROM (p_plan#>>'{coupons,expectedUpdatedAt}')::timestamptz THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
    v_coupons := v_coupon_page.blocks;
    FOR v_pick IN SELECT value FROM jsonb_array_elements(p_plan#>'{coupons,claims}') LOOP
      IF (SELECT count(*) FROM jsonb_array_elements(v_coupons) c WHERE c->>'id'=v_pick->>'couponId')<>1 THEN RAISE EXCEPTION 'checkout_coupon_unavailable'; END IF;
      SELECT value INTO v_coupon FROM jsonb_array_elements(v_coupons) c WHERE c->>'id'=v_pick->>'couponId';
      IF v_coupon->>'status' IS DISTINCT FROM 'active' OR v_coupon->>'siteId' IS DISTINCT FROM p_site_id
        OR (v_coupon->>'startsAt')::timestamptz>clock_timestamp() OR (v_coupon->>'expiresAt')::timestamptz<clock_timestamp()
        OR (SELECT count(*) FROM jsonb_array_elements(v_coupon->'claimEvents') c WHERE c->>'id'=v_pick->>'claimEventId')<>1 THEN RAISE EXCEPTION 'checkout_coupon_unavailable'; END IF;
      SELECT value INTO v_claim FROM jsonb_array_elements(v_coupon->'claimEvents') c WHERE c->>'id'=v_pick->>'claimEventId';
      IF coalesce(v_claim->>'accountId','')='' AND coalesce(v_claim->>'userId','')=''
        OR coalesce(v_claim->>'accountId','') NOT IN ('',v_account) OR coalesce(v_claim->>'userId','') NOT IN ('',v_user)
        OR (v_claim->>'validUntil')::timestamptz<clock_timestamp()
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_coupon->'redeemEvents') r WHERE r->>'claimEventId'=v_claim->>'id' OR r->>'settlementCode'=v_claim->>'settlementCode') THEN RAISE EXCEPTION 'checkout_coupon_unavailable'; END IF;
      v_redeem_event := jsonb_build_object('id',gen_random_uuid()::text,'at',v_stamp,'claimEventId',v_claim->>'id','settlementCode',v_claim->>'settlementCode',
        'accountId',v_claim->>'accountId','userId',v_claim->>'userId','operatorId','customer:'||v_account,'note','[op:member-checkout-coupon:'||p_operation_key||']');
      v_coupon_uses := v_coupon_uses||jsonb_build_array(jsonb_build_object('couponId',v_coupon->>'id','claimEventId',v_claim->>'id','redeemEventId',v_redeem_event->>'id'));
      v_coupon := v_coupon||jsonb_build_object('usedCount',(v_coupon->>'usedCount')::bigint+1,'updatedAt',v_stamp,
        'redeemEvents',jsonb_build_array(v_redeem_event)||(v_coupon->'redeemEvents'));
      SELECT jsonb_agg(CASE WHEN c->>'id'=v_pick->>'couponId' THEN v_coupon ELSE c END ORDER BY n) INTO v_coupons FROM jsonb_array_elements(v_coupons) WITH ORDINALITY x(c,n);
    END LOOP;
    v_redemption := v_redemption||jsonb_build_object('coupons',jsonb_build_object('expectedUpdatedAt',v_coupon_page.updated_at,'next',v_coupons));
  ELSIF p_plan ? 'coupons' THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;

  -- A later booking/order failure rolls back THIS write, its histories, stock,
  -- coupon usage and both completion ledgers too. No inverse compensation.
  PERFORM public.faolla_commit_redemption_v1(p_site_id,v_redemption);
  IF v_kind='booking' THEN
    v_rows := public.faolla_booking_atomic_rows_v1();
    SELECT r#>'{blocks,records}' INTO v_before FROM jsonb_array_elements(v_rows) r WHERE r->>'slug'='__merchant_booking_records__:v1';
    PERFORM public.faolla_booking_atomic_commit_v1(p_site_id,
      encode(sha256(convert_to('member-checkout-booking:'||p_operation_key,'UTF8')),'hex'),p_request_hash,
      jsonb_build_object('generation',v_control.generation,'revision',v_control.revision::text,'rows',v_rows,
        'next',jsonb_build_object('version',1,'records',jsonb_build_array(v_record)||v_before),'result',v_receipt,'mailJobs',p_plan#>'{booking,mailJobs}'));
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'blocks',blocks,'updated_at',updated_at) ORDER BY slug,id),'[]'::jsonb) INTO v_orders_rows
      FROM public.pages WHERE slug='__merchant_orders__:'||p_site_id OR slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$');
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',r->'id','slug',r->'slug','updatedAt',r->'updated_at') ORDER BY r->>'slug',r->>'id'),'[]'::jsonb) INTO v_order_versions FROM jsonb_array_elements(v_orders_rows) r;
    IF v_order_versions IS DISTINCT FROM p_plan#>'{order,expectedVersions}' THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
    SELECT coalesce(jsonb_agg(i ORDER BY CASE WHEN r->>'slug'='__merchant_orders__:'||p_site_id THEN -1 ELSE substring(r->>'slug' FROM ':chunk:([0-9]+)$')::integer END,n),'[]'::jsonb) INTO v_orders_before
      FROM jsonb_array_elements(v_orders_rows) r CROSS JOIN LATERAL jsonb_array_elements(r->'blocks') WITH ORDINALITY x(i,n)
      WHERE r->>'slug'<>'__merchant_orders__:'||p_site_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_orders_rows) c WHERE c->>'slug'~':chunk:[0-9]+$');
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_orders_before) o WHERE o->>'id'=v_id) THEN RAISE EXCEPTION 'checkout_operation_conflict'; END IF;
    PERFORM public.faolla_commit_order_membership_v1(p_site_id,jsonb_build_object('orders',jsonb_build_object('expectedRows',v_orders_rows,'next',jsonb_build_array(v_record)||v_orders_before)));
  END IF;
  v_result := v_receipt||jsonb_build_object('siteId',p_site_id,'operationKey',p_operation_key,'membershipId',v_member_id);
  IF v_coupon_count>0 THEN
    v_result := v_result||jsonb_build_object('couponReturnOnCancel',p_plan->'couponReturnOnCancel','couponUses',v_coupon_uses);
  END IF;
  INSERT INTO faolla_checkout_design.bundle_results VALUES(p_site_id,p_operation_key,p_principal_key,p_request_hash,v_kind,v_id,v_result);
  RETURN jsonb_build_object('replayed',false,'receipt',v_result);
END;
$$;
ALTER TABLE faolla_checkout_design.bundle_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.bundle_pilots FORCE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.bundle_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.bundle_results FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.bundle_pilots,faolla_checkout_design.bundle_results FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION faolla_checkout_design.commit_bundle(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
