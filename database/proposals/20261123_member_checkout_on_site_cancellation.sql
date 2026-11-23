-- UNINSTALLED PRIVATE PROPOSAL. No production registration, activation or ACL.
-- Cash cancellation is NOT points cancellation and NOT a cash/Stripe refund.
-- Current customer/owner authorization is required in the trusted adapter.
BEGIN;
-- Guard future manual full-cash confirmation against racing original cancel.
-- This is a merchant's recorded receipt, NOT provider/bank confirmation. There
-- is deliberately no HTTP collector or member-benefit writer in this proposal.
CREATE TABLE faolla_checkout_design.on_site_collections (
 site_id text NOT NULL CHECK(site_id~'^[0-9]{8}$'), operation_key text NOT NULL CHECK(operation_key~'^[a-f0-9]{64}$'),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 99999999), currency text NOT NULL CHECK(currency='eur'),
 actor_key text NOT NULL CHECK(actor_key~'^owner:[A-Za-z0-9_-]{8,128}$'), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(site_id,operation_key), FOREIGN KEY(site_id,operation_key) REFERENCES faolla_checkout_design.bundle_results(site_id,operation_key)
);
CREATE FUNCTION faolla_checkout_design.guard_on_site_collection()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||NEW.site_id,0));
 SELECT * INTO b FROM faolla_checkout_design.bundle_results WHERE site_id=NEW.site_id AND operation_key=NEW.operation_key;
 IF NOT FOUND OR b.receipt->'version' IS DISTINCT FROM '2'::jsonb OR b.receipt->>'method' IS DISTINCT FROM 'on_site'
  OR b.receipt->'capturedMinor' IS DISTINCT FROM '0'::jsonb OR b.receipt->'totalPoints' IS DISTINCT FROM 'null'::jsonb
  OR b.receipt->>'currency' IS DISTINCT FROM NEW.currency OR (b.receipt->>'dueMinor')::bigint IS DISTINCT FROM NEW.amount_minor
  OR EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_cancellations WHERE site_id=NEW.site_id AND operation_key=NEW.operation_key)
  THEN RAISE EXCEPTION 'checkout_collection_not_allowed'; END IF;
 NEW.recorded_at:=clock_timestamp();
 RETURN NEW;
END;
$$;
CREATE TRIGGER validate_on_site_collection BEFORE INSERT ON faolla_checkout_design.on_site_collections
 FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.guard_on_site_collection();
CREATE TRIGGER immutable_on_site_collection BEFORE UPDATE OR DELETE ON faolla_checkout_design.on_site_collections
 FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();
ALTER TABLE faolla_checkout_design.on_site_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.on_site_collections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.on_site_collections FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION faolla_checkout_design.guard_on_site_collection() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION faolla_checkout_design.cancel_on_site_pending(p_site_id text,p_operation_key text,p_principal_key text,p_expected_updated_at text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
 original faolla_checkout_design.bundle_results%rowtype; previous faolla_checkout_design.bundle_cancellations%rowtype;
 control public.faolla_booking_atomic_control%rowtype; settings_page public.pages%rowtype; coupon_page public.pages%rowtype;
 receipt jsonb; policy jsonb; rows jsonb; records jsonb; rec jsonb; next_records jsonb; settings jsonb; coupons jsonb;
 use_row jsonb; item jsonb; coupon jsonb; claim jsonb; event jsonb; remaining jsonb;
 mutation jsonb:='{}'; result jsonb; stock_count integer:=0; coupon_count integer:=0;
 account_id text; user_id text; stamp text; until_at timestamptz;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_unauthorized'; END IF;
 account_id:=split_part(p_principal_key,':',2);user_id:=split_part(p_principal_key,':',3);
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 SELECT * INTO original FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF NOT FOUND OR original.principal_key IS DISTINCT FROM p_principal_key THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
 receipt:=original.receipt;policy:=receipt->'cancellationPolicy';
 -- Check METHOD before replay; an existing points cancellation is never a
 -- cash cancellation receipt, even under an otherwise valid original key.
 IF receipt->'version' IS DISTINCT FROM '2'::jsonb OR receipt->>'method' IS DISTINCT FROM 'on_site'
  OR receipt->>'currency' IS DISTINCT FROM 'eur' OR receipt->'capturedMinor' IS DISTINCT FROM '0'::jsonb
  OR receipt->'totalPoints' IS DISTINCT FROM 'null'::jsonb OR receipt->>'resourceKind' IS DISTINCT FROM original.resource_kind
  OR receipt->>'resourceId' IS DISTINCT FROM original.resource_id OR policy->'returnPoints' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(policy->'returnCoupons') IS DISTINCT FROM 'boolean' OR jsonb_typeof(receipt->'stockUses') IS DISTINCT FROM 'array'
  OR jsonb_array_length(receipt->'stockUses')>1 OR jsonb_typeof(receipt->'couponUses') IS DISTINCT FROM 'array'
  OR jsonb_typeof(receipt->'couponCount') IS DISTINCT FROM 'number' OR (receipt->>'couponCount')::numeric NOT BETWEEN 0 AND 1
  OR trunc((receipt->>'couponCount')::numeric)<>(receipt->>'couponCount')::numeric
  OR jsonb_array_length(receipt->'couponUses')<>(receipt->>'couponCount')::integer
  THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
 SELECT * INTO previous FROM faolla_checkout_design.bundle_cancellations WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN
  IF previous.principal_key IS DISTINCT FROM p_principal_key OR previous.receipt->>'method' IS DISTINCT FROM 'on_site'
   OR previous.receipt->'version' IS DISTINCT FROM '2'::jsonb THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
  RETURN jsonb_build_object('replayed',true,'receipt',previous.receipt);
 END IF;
 IF EXISTS(SELECT 1 FROM faolla_checkout_design.on_site_collections WHERE site_id=p_site_id AND operation_key=p_operation_key)
  THEN RAISE EXCEPTION 'checkout_cancellation_requires_refund'; END IF;
 -- Original policy only: no pilot/current offer/member/service-status read.
 IF original.resource_kind='booking' THEN
  SELECT * INTO STRICT control FROM public.faolla_booking_atomic_control FOR UPDATE;
  IF NOT control.active OR control.protocol<>2 THEN RAISE EXCEPTION 'booking_atomic_inactive'; END IF;
  rows:=public.faolla_booking_atomic_rows_v1();
  SELECT r#>'{blocks,records}' INTO records FROM jsonb_array_elements(rows) r WHERE r->>'slug'='__merchant_booking_records__:v1';
 ELSIF original.resource_kind<>'order' THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0));
 IF original.resource_kind='order' THEN
  IF EXISTS(SELECT 1 FROM public.pages WHERE (slug='__merchant_orders__:'||p_site_id OR slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$'))
   AND merchant_id IS DISTINCT FROM p_site_id) THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'blocks',blocks,'updated_at',updated_at) ORDER BY slug,id),'[]'::jsonb) INTO rows
   FROM public.pages WHERE merchant_id=p_site_id AND (slug='__merchant_orders__:'||p_site_id OR slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$'));
  SELECT coalesce(jsonb_agg(i ORDER BY CASE WHEN r->>'slug'='__merchant_orders__:'||p_site_id THEN -1 ELSE substring(r->>'slug' FROM ':chunk:([0-9]+)$')::integer END,n),'[]'::jsonb) INTO records
   FROM jsonb_array_elements(rows) r CROSS JOIN LATERAL jsonb_array_elements(r->'blocks') WITH ORDINALITY x(i,n)
   WHERE r->>'slug'<>'__merchant_orders__:'||p_site_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) c WHERE c->>'slug'~':chunk:[0-9]+$');
 END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(records) r WHERE r->>'id'=original.resource_id AND r->>'siteId'=p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
 SELECT value INTO rec FROM jsonb_array_elements(records) r WHERE r->>'id'=original.resource_id AND r->>'siteId'=p_site_id;
 IF rec->>'customerAccountId' IS DISTINCT FROM account_id OR rec->>'customerUserId' IS DISTINCT FROM user_id THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
 IF p_expected_updated_at IS NULL OR rec->>'updatedAt' IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 IF coalesce(rec->>'status','') NOT IN ('active','pending','confirmed') THEN RAISE EXCEPTION 'checkout_cancellation_not_allowed'; END IF;
 IF receipt->'resourceTerms' IS DISTINCT FROM (CASE WHEN original.resource_kind='booking' THEN
  jsonb_build_object('appointmentAt',rec->'appointmentAt','store',rec->'store','item',rec->'item','bookingBlockId',rec->'bookingBlockId','bookingViewport',rec->'bookingViewport')
  ELSE jsonb_build_object('items',rec->'items','totalQuantity',rec->'totalQuantity','totalAmount',rec->'totalAmount') END)
  THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
 IF original.resource_kind='booking' THEN
  until_at:=(policy->>'cancellableUntil')::timestamptz;
  IF until_at IS NULL OR NOT isfinite(until_at) OR clock_timestamp()>until_at THEN RAISE EXCEPTION 'checkout_cancellation_deadline'; END IF;
 END IF;
 stamp:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 -- No membership read/normalization/write and no zero-amount refund, benefit,
 -- point expiry or reactivation. Cancellation still works after leaving.
 IF jsonb_array_length(receipt->'stockUses')>0 THEN
  IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_membership_settings__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
  SELECT * INTO STRICT settings_page FROM public.pages WHERE slug='__merchant_membership_settings__:'||p_site_id FOR UPDATE;
  IF settings_page.merchant_id IS DISTINCT FROM p_site_id THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
  settings:=settings_page.blocks;
  FOR use_row IN SELECT value FROM jsonb_array_elements(receipt->'stockUses') LOOP
   IF jsonb_typeof(use_row->'quantity') IS DISTINCT FROM 'number' OR (use_row->>'quantity')::numeric NOT BETWEEN 1 AND 999
    OR trunc((use_row->>'quantity')::numeric)<>(use_row->>'quantity')::numeric
    OR (SELECT count(*) FROM jsonb_array_elements(settings->'redemptionItems') i WHERE i->>'id'=use_row->>'itemId')<>1
    THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
   SELECT value INTO item FROM jsonb_array_elements(settings->'redemptionItems') i WHERE i->>'id'=use_row->>'itemId';
   IF item->'stock' IS DISTINCT FROM 'null'::jsonb THEN
    IF jsonb_typeof(item->'stock') IS DISTINCT FROM 'number' OR (item->>'stock')::numeric<0
     OR trunc((item->>'stock')::numeric)<>(item->>'stock')::numeric OR (item->>'stock')::numeric+(use_row->>'quantity')::integer>9007199254740991
     THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
    item:=item||jsonb_build_object('stock',(item->>'stock')::numeric+(use_row->>'quantity')::integer);
    SELECT settings||jsonb_build_object('redemptionItems',jsonb_agg(CASE WHEN i->>'id'=use_row->>'itemId' THEN item ELSE i END ORDER BY n)) INTO settings
     FROM jsonb_array_elements(settings->'redemptionItems') WITH ORDINALITY x(i,n);
   END IF;
   stock_count:=stock_count+(use_row->>'quantity')::integer;
  END LOOP;
  IF settings IS DISTINCT FROM settings_page.blocks THEN mutation:=jsonb_build_object('settings',jsonb_build_object('expectedUpdatedAt',settings_page.updated_at,'next',settings)); END IF;
 END IF;
 IF (policy->>'returnCoupons')::boolean AND (receipt->>'couponCount')::integer>0 THEN
  IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_coupons__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
  SELECT * INTO STRICT coupon_page FROM public.pages WHERE slug='__merchant_coupons__:'||p_site_id FOR UPDATE;
  IF coupon_page.merchant_id IS DISTINCT FROM p_site_id THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
  coupons:=coupon_page.blocks;
  FOR use_row IN SELECT value FROM jsonb_array_elements(receipt->'couponUses') LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(coupons) c WHERE c->>'id'=use_row->>'couponId')<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
   SELECT value INTO coupon FROM jsonb_array_elements(coupons) c WHERE c->>'id'=use_row->>'couponId';
   IF coupon->>'siteId' IS DISTINCT FROM p_site_id OR (SELECT count(*) FROM jsonb_array_elements(coupon->'claimEvents') c WHERE c->>'id'=use_row->>'claimEventId')<>1
    THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
   SELECT value INTO claim FROM jsonb_array_elements(coupon->'claimEvents') c WHERE c->>'id'=use_row->>'claimEventId';
   IF coalesce(claim->>'accountId','')='' AND coalesce(claim->>'userId','')=''
    OR coalesce(claim->>'accountId','') NOT IN ('',account_id) OR coalesce(claim->>'userId','') NOT IN ('',user_id)
    OR (SELECT count(*) FROM jsonb_array_elements(coupon->'redeemEvents') r WHERE r->>'id'=use_row->>'redeemEventId')<>1
    OR (SELECT count(*) FROM jsonb_array_elements(coupon->'redeemEvents') r WHERE r->>'id'=use_row->>'redeemEventId'
     AND r->>'claimEventId'=claim->>'id' AND r->>'settlementCode'=claim->>'settlementCode'
     AND r->>'accountId' IS NOT DISTINCT FROM claim->>'accountId' AND r->>'userId' IS NOT DISTINCT FROM claim->>'userId')<>1
    OR jsonb_typeof(coupon->'usedCount') IS DISTINCT FROM 'number' OR (coupon->>'usedCount')::numeric<1
    OR trunc((coupon->>'usedCount')::numeric)<>(coupon->>'usedCount')::numeric THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
   SELECT value INTO event FROM jsonb_array_elements(coupon->'redeemEvents') r WHERE r->>'id'=use_row->>'redeemEventId';
   IF event->>'operatorId' IS DISTINCT FROM 'customer:'||account_id OR event->>'note' IS DISTINCT FROM '[op:member-checkout-coupon:'||p_operation_key||']'
    OR EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_coupon_returns WHERE site_id=p_site_id AND redeem_event_id=use_row->>'redeemEventId')
    THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
   INSERT INTO faolla_checkout_design.bundle_coupon_returns VALUES(p_site_id,use_row->>'redeemEventId',p_operation_key,event);
   SELECT coalesce(jsonb_agg(r ORDER BY n),'[]'::jsonb) INTO remaining FROM jsonb_array_elements(coupon->'redeemEvents') WITH ORDINALITY x(r,n) WHERE r->>'id'<>use_row->>'redeemEventId';
   -- Preserve the original claim, validity and unrelated events EXACTLY. An
   -- expired returned coupon remains expired; no extension/new claim/wallet.
   coupon:=coupon||jsonb_build_object('usedCount',(coupon->>'usedCount')::bigint-1,'redeemEvents',remaining,'updatedAt',stamp);
   SELECT jsonb_agg(CASE WHEN c->>'id'=use_row->>'couponId' THEN coupon ELSE c END ORDER BY n) INTO coupons FROM jsonb_array_elements(coupons) WITH ORDINALITY x(c,n);
   coupon_count:=coupon_count+1;
  END LOOP;
  IF coupon_count<>(receipt->>'couponCount')::integer THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
  mutation:=mutation||jsonb_build_object('coupons',jsonb_build_object('expectedUpdatedAt',coupon_page.updated_at,'next',coupons));
 END IF;
 IF until_at IS NOT NULL AND clock_timestamp()>until_at THEN RAISE EXCEPTION 'checkout_cancellation_deadline'; END IF;
 IF mutation<>'{}'::jsonb THEN PERFORM public.faolla_commit_redemption_v1(p_site_id,mutation); END IF;
 rec:=rec||jsonb_build_object('status','cancelled','cancelledAt',stamp,'updatedAt',stamp);
 SELECT jsonb_agg(CASE WHEN r->>'id'=original.resource_id AND r->>'siteId'=p_site_id THEN rec ELSE r END ORDER BY n) INTO next_records
  FROM jsonb_array_elements(records) WITH ORDINALITY x(r,n);
 result:=jsonb_build_object('version',2,'method','on_site','siteId',p_site_id,'operationKey',p_operation_key,'resourceKind',original.resource_kind,
  'resourceId',original.resource_id,'closed',true,'pointsReturned',0,'cashReturnedMinor',0,'couponsReturned',coupon_count,'stockReleased',stock_count,'cancelledAt',stamp);
 IF original.resource_kind='booking' THEN
  PERFORM public.faolla_booking_atomic_commit_v1(p_site_id,encode(sha256(convert_to('member-checkout-on-site-cancel:'||p_operation_key,'UTF8')),'hex'),
   encode(sha256(convert_to(original.request_hash||':on-site-cancel','UTF8')),'hex'),jsonb_build_object('generation',control.generation,'revision',control.revision::text,
    'rows',rows,'next',jsonb_build_object('version',1,'records',next_records),'result',result,'mailJobs','[]'::jsonb));
 ELSE PERFORM public.faolla_commit_order_membership_v1(p_site_id,jsonb_build_object('orders',jsonb_build_object('expectedRows',rows,'next',next_records))); END IF;
 IF until_at IS NOT NULL AND clock_timestamp()>until_at THEN RAISE EXCEPTION 'checkout_cancellation_deadline'; END IF;
 INSERT INTO faolla_checkout_design.bundle_cancellations VALUES(p_site_id,p_operation_key,p_principal_key,result,clock_timestamp());
 RETURN jsonb_build_object('replayed',false,'receipt',result);
END;
$$;

CREATE FUNCTION public.faolla_member_checkout_on_site_result_v1(p_site_id text,p_operation_key text,p_principal_key text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH owned AS (
  SELECT b.*,c.receipt AS cancellation,k.amount_minor,k.recorded_at FROM faolla_checkout_design.bundle_results b
  LEFT JOIN faolla_checkout_design.bundle_cancellations c USING(site_id,operation_key)
  LEFT JOIN faolla_checkout_design.on_site_collections k USING(site_id,operation_key)
  WHERE b.site_id=p_site_id AND b.operation_key=p_operation_key AND b.principal_key=p_principal_key
   AND p_site_id~'^[0-9]{8}$' AND p_operation_key~'^[a-f0-9]{64}$' AND p_principal_key~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
   AND b.receipt->'version'='2'::jsonb AND b.receipt->>'method'='on_site'
 ), sources AS (
  SELECT b.resource_id,b.resource_kind,p.blocks FROM owned b JOIN public.pages p ON
   (b.resource_kind='booking' AND p.slug='__merchant_booking_records__:v1') OR
   (b.resource_kind='order' AND p.merchant_id=b.site_id AND (p.slug~('^__merchant_orders__:'||b.site_id||':chunk:[0-9]+$') OR
    p.slug='__merchant_orders__:'||b.site_id AND NOT EXISTS(SELECT 1 FROM public.pages c WHERE c.merchant_id=b.site_id AND c.slug~('^__merchant_orders__:'||b.site_id||':chunk:[0-9]+$'))))
 ), matches AS (
  SELECT r FROM sources s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN s.resource_kind='booking' THEN s.blocks->'records' ELSE s.blocks END) r
  WHERE r->>'id'=s.resource_id AND r->>'siteId'=p_site_id AND r->>'customerAccountId'=split_part(p_principal_key,':',2) AND r->>'customerUserId'=split_part(p_principal_key,':',3)
 ), resource AS (SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(r))->0 ELSE NULL END AS r FROM matches), state AS (
  SELECT b.*,r.r,coalesce(b.receipt->'resourceTerms'=(CASE WHEN b.resource_kind='booking' THEN
   jsonb_build_object('appointmentAt',r.r->'appointmentAt','store',r.r->'store','item',r.r->'item','bookingBlockId',r.r->'bookingBlockId','bookingViewport',r.r->'bookingViewport')
   ELSE jsonb_build_object('items',r.r->'items','totalQuantity',r.r->'totalQuantity','totalAmount',r.r->'totalAmount') END),false) AS terms_match FROM owned b CROSS JOIN resource r
 ) SELECT jsonb_build_object('version',2,'siteId',site_id,'operationKey',operation_key,
  'terms',jsonb_build_object('version',receipt->'version','method',receipt->'method','resourceKind',receipt->'resourceKind','resourceId',receipt->'resourceId',
   'currency',receipt->'currency','grossMinor',receipt->'grossMinor','discountMinor',receipt->'discountMinor','dueMinor',receipt->'dueMinor',
   'capturedMinor',receipt->'capturedMinor','totalPoints',receipt->'totalPoints','couponCount',receipt->'couponCount','paymentState',receipt->'paymentState'),
  'resource',CASE WHEN r IS NOT NULL THEN jsonb_build_object('status',r->'status','updatedAt',r->'updatedAt') ELSE NULL END,'termsMatch',terms_match,
  'closed',cancellation IS NOT NULL,'cancellationPolicy',jsonb_build_object('returnCoupons',receipt#>'{cancellationPolicy,returnCoupons}',
   'advanceMinutes',receipt#>'{cancellationPolicy,advanceMinutes}','cancellableUntil',receipt#>'{cancellationPolicy,cancellableUntil}'),
  'cancellationAvailable',coalesce(cancellation IS NULL AND amount_minor IS NULL AND terms_match AND r->>'status' IN ('active','pending','confirmed')
   AND (resource_kind='order' OR statement_timestamp()<=(receipt#>>'{cancellationPolicy,cancellableUntil}')::timestamptz),false),
  'collection',CASE WHEN amount_minor IS NULL THEN NULL ELSE jsonb_build_object('amountMinor',amount_minor,'currency','eur','recordedAt',recorded_at) END,
  'cancellation',CASE WHEN cancellation IS NULL THEN NULL ELSE jsonb_build_object('version',cancellation->'version','method',cancellation->'method',
   'siteId',cancellation->'siteId','operationKey',cancellation->'operationKey','resourceKind',cancellation->'resourceKind','resourceId',cancellation->'resourceId',
   'closed',cancellation->'closed','pointsReturned',cancellation->'pointsReturned','cashReturnedMinor',cancellation->'cashReturnedMinor',
   'couponsReturned',cancellation->'couponsReturned','stockReleased',cancellation->'stockReleased','cancelledAt',cancellation->'cancelledAt') END) FROM state;
$$;
CREATE FUNCTION public.faolla_member_checkout_on_site_cancel_v1(p_site_id text,p_operation_key text,p_principal_key text,p_expected_updated_at text)
RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT faolla_checkout_design.cancel_on_site_pending(p_site_id,p_operation_key,p_principal_key,p_expected_updated_at);
$$;
CREATE FUNCTION public.faolla_checkout_on_site_merchant_cancel_v1(p_site_id text,p_operation_key text,p_actor_key text,p_expected_updated_at text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype; r jsonb;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_actor_key IS NULL OR p_actor_key!~'^owner:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_unauthorized'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 SELECT * INTO b FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
 r:=faolla_checkout_design.cancel_on_site_pending(p_site_id,p_operation_key,b.principal_key,p_expected_updated_at);
 IF r->'replayed'='false'::jsonb THEN INSERT INTO faolla_checkout_design.merchant_cancellation_actors VALUES(p_site_id,p_operation_key,p_actor_key); END IF;
 RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION faolla_checkout_design.cancel_on_site_pending(text,text,text,text),public.faolla_member_checkout_on_site_result_v1(text,text,text),
 public.faolla_member_checkout_on_site_cancel_v1(text,text,text,text),public.faolla_checkout_on_site_merchant_cancel_v1(text,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
