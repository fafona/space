-- PRIVATE UNINSTALLED PROTOTYPE. No API/role grants or production migration.
-- Preparation must validate current published source/permissions/coupon quote,
-- appointment capacity and their full snapshot CAS before calling this kernel.
-- Not a financial authorization API. No HTTP adapter enables this proposal.
-- The points transaction is unchanged. Both methods use the SAME nonce ledger.
BEGIN;
CREATE FUNCTION faolla_checkout_design.commit_on_site_pending(
 p_site_id text,p_operation_key text,p_principal_key text,p_request_hash text,p_plan jsonb,p_not_after timestamptz
) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
 previous faolla_checkout_design.bundle_results%rowtype;
 control public.faolla_booking_atomic_control%rowtype;
 settings_page public.pages%rowtype; member_page public.pages%rowtype; coupon_page public.pages%rowtype;
 offer jsonb; rec jsonb; receipt jsonb; member jsonb; settings jsonb; coupons jsonb; coupon jsonb; claim jsonb; pick jsonb; item jsonb;
 mutation jsonb := '{}'; coupon_uses jsonb := '[]'; stock_uses jsonb := '[]'; event jsonb;
 rows jsonb; before_records jsonb; versions jsonb; result jsonb; policy jsonb;
 kind text; resource_id text; member_id text; account_id text; user_id text; stamp text;
 quantity integer; gross bigint; discount bigint; coupon_count integer; stock_id text;
 effective_deadline timestamptz;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
  OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object' OR octet_length(p_plan::text)>262144
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_plan) k WHERE k NOT IN ('offer','quantity','membership','settingsVersion','coupons','booking','order','receipt'))
  THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 SELECT * INTO previous FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN
  IF previous.principal_key<>p_principal_key OR previous.request_hash<>p_request_hash OR previous.receipt->>'method' IS DISTINCT FROM 'on_site'
   THEN RAISE EXCEPTION 'checkout_operation_conflict'; END IF;
  RETURN jsonb_build_object('replayed',true,'receipt',previous.receipt);
 END IF;
 PERFORM 1 FROM faolla_checkout_design.bundle_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_disabled'; END IF;
 IF p_not_after IS NULL OR NOT isfinite(p_not_after) OR p_not_after<=clock_timestamp() OR p_not_after>clock_timestamp()+interval '30 seconds'
  THEN RAISE EXCEPTION 'checkout_quote_expired'; END IF;
 effective_deadline:=p_not_after;
 IF (p_plan?'booking')=(p_plan?'order') OR jsonb_typeof(p_plan->'quantity') IS DISTINCT FROM 'number'
  OR (p_plan->>'quantity')::numeric NOT BETWEEN 1 AND 999 OR trunc((p_plan->>'quantity')::numeric)<>(p_plan->>'quantity')::numeric
  THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 quantity := (p_plan->>'quantity')::integer; kind := CASE WHEN p_plan?'booking' THEN 'booking' ELSE 'order' END;
 account_id:=split_part(p_principal_key,':',2);user_id:=split_part(p_principal_key,':',3);
 rec:=p_plan#>ARRAY[kind,'record'];resource_id:=rec->>'id';receipt:=p_plan->'receipt';member_id:=p_plan#>>'{membership,id}';
 IF jsonb_typeof(rec) IS DISTINCT FROM 'object' OR coalesce(resource_id,'')!~'^[A-Za-z0-9:_-]{1,160}$'
  OR rec->>'siteId' IS DISTINCT FROM p_site_id OR rec->>'customerAccountId' IS DISTINCT FROM account_id OR rec->>'customerUserId' IS DISTINCT FROM user_id
  OR rec->>'status' IS DISTINCT FROM (CASE WHEN kind='booking' THEN 'active' ELSE 'pending' END)
  OR jsonb_typeof(p_plan->'membership') IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_plan->'membership') k WHERE k NOT IN ('id','expectedUpdatedAt'))
  OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR receipt->'version' IS DISTINCT FROM '2'::jsonb
  OR receipt->>'method' IS DISTINCT FROM 'on_site' OR receipt->>'currency' IS DISTINCT FROM 'eur'
  OR receipt->>'resourceKind' IS DISTINCT FROM kind OR receipt->>'resourceId' IS DISTINCT FROM resource_id
  OR receipt->'capturedMinor' IS DISTINCT FROM '0'::jsonb OR receipt->'totalPoints' IS DISTINCT FROM 'null'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(receipt) k WHERE k NOT IN ('version','method','resourceKind','resourceId','currency','grossMinor','discountMinor','dueMinor','capturedMinor','totalPoints','couponCount','paymentState'))
  THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['grossMinor','discountMinor','dueMinor','couponCount']) k
  WHERE jsonb_typeof(receipt->k) IS DISTINCT FROM 'number' OR (receipt->>k)::numeric NOT BETWEEN 0 AND 99999999 OR trunc((receipt->>k)::numeric)<>(receipt->>k)::numeric)
  THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 gross:=(receipt->>'grossMinor')::bigint;discount:=(receipt->>'discountMinor')::bigint;coupon_count:=(receipt->>'couponCount')::integer;
 IF gross<=0 OR discount>gross OR (receipt->>'dueMinor')::bigint<>gross-discount OR coupon_count NOT BETWEEN 0 AND 1
  OR (coupon_count=0)<>(discount=0) OR receipt->>'paymentState' IS DISTINCT FROM (CASE WHEN discount=gross THEN 'coupon_covered' ELSE 'unpaid' END)
  THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 SELECT v.snapshot INTO offer FROM faolla_checkout_design.offer_heads h JOIN faolla_checkout_design.offer_versions v USING(site_id,offer_id,revision)
  WHERE h.site_id=p_site_id AND h.offer_id=(p_plan#>>'{offer,id}')::uuid AND h.revision=(p_plan#>>'{offer,revision}')::uuid AND h.enabled FOR SHARE OF h;
 IF NOT FOUND OR offer->'enabled' IS DISTINCT FROM 'true'::jsonb OR offer->'allowOnSite' IS DISTINCT FROM 'true'::jsonb
  OR offer#>>'{source,kind}' IS DISTINCT FROM kind OR offer#>>'{cash,currency}' IS DISTINCT FROM 'eur'
  OR (offer#>>'{cash,unitAmountMinor}')::bigint*quantity IS DISTINCT FROM gross
  OR quantity>(offer->>'maxQuantity')::integer OR kind='booking' AND quantity<>1
  THEN RAISE EXCEPTION 'checkout_quote_changed'; END IF;
 IF jsonb_typeof(offer->'couponReturnOnCancel') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(offer#>'{checkoutBinding,cancellationAdvanceMinutes}') IS DISTINCT FROM 'number'
  OR (offer#>>'{checkoutBinding,cancellationAdvanceMinutes}')::numeric NOT BETWEEN 0 AND 43200
  OR trunc((offer#>>'{checkoutBinding,cancellationAdvanceMinutes}')::numeric)<>(offer#>>'{checkoutBinding,cancellationAdvanceMinutes}')::numeric
  THEN RAISE EXCEPTION 'checkout_coupon_policy_required'; END IF;
 IF kind='booking' THEN
  IF rec->>'bookingBlockId' IS DISTINCT FROM offer#>>'{source,blockId}' OR rec->>'bookingViewport' IS DISTINCT FROM offer#>>'{checkoutBinding,viewport}'
   OR rec->>'store' IS DISTINCT FROM offer#>>'{checkoutBinding,store}' OR rec->>'item' IS DISTINCT FROM offer#>>'{checkoutBinding,item}'
   OR rec->>'appointmentTimeZone' IS DISTINCT FROM offer#>>'{source,timeZone}' OR p_plan#>'{booking,mailJobs}' IS DISTINCT FROM '[]'::jsonb
   THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 ELSE
  -- Old order totals retain the original gross price, NOT a paid flag or gift.
  IF rec->>'blockId' IS DISTINCT FROM offer#>>'{source,blockId}' OR jsonb_typeof(rec->'items') IS DISTINCT FROM 'array'
   OR jsonb_array_length(rec->'items')<>1 OR rec#>>'{items,0,productId}' IS DISTINCT FROM offer#>>'{source,productId}'
   OR rec#>'{items,0,quantity}' IS DISTINCT FROM to_jsonb(quantity) OR rec->'totalQuantity' IS DISTINCT FROM to_jsonb(quantity)
   OR (rec#>>'{items,0,unitPrice}')::numeric IS DISTINCT FROM (offer#>>'{cash,unitAmountMinor}')::numeric/100
   OR (rec->>'totalAmount')::numeric IS DISTINCT FROM gross::numeric/100
   THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 END IF;
 policy:=jsonb_build_object('returnPoints',false,'returnCoupons',offer->'couponReturnOnCancel',
  'advanceMinutes',offer#>'{checkoutBinding,cancellationAdvanceMinutes}','cancellableUntil',CASE WHEN kind='booking' THEN
   ((rec->>'appointmentAt')::timestamp AT TIME ZONE (offer#>>'{source,timeZone}'))-make_interval(mins=>(offer#>>'{checkoutBinding,cancellationAdvanceMinutes}')::integer) ELSE NULL END);
 IF kind='booking' AND policy->>'cancellableUntil' IS NULL THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 IF kind='booking' THEN
  SELECT * INTO STRICT control FROM public.faolla_booking_atomic_control FOR UPDATE;
  IF NOT control.active OR control.protocol<>2 THEN RAISE EXCEPTION 'booking_atomic_inactive'; END IF;
  IF p_plan#>>'{booking,generation}' IS DISTINCT FROM control.generation::text OR p_plan#>>'{booking,revision}' IS DISTINCT FROM control.revision::text
   THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0));
 IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_membership_settings__:'||p_site_id)<>1
  OR (SELECT count(*) FROM public.pages WHERE slug='__merchant_memberships__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 SELECT * INTO STRICT settings_page FROM public.pages WHERE slug='__merchant_membership_settings__:'||p_site_id FOR UPDATE;
 SELECT * INTO STRICT member_page FROM public.pages WHERE slug='__merchant_memberships__:'||p_site_id FOR SHARE;
 IF settings_page.merchant_id IS DISTINCT FROM p_site_id OR member_page.merchant_id IS DISTINCT FROM p_site_id
  OR settings_page.updated_at IS DISTINCT FROM (p_plan->>'settingsVersion')::timestamptz
  OR member_page.updated_at IS DISTINCT FROM (p_plan#>>'{membership,expectedUpdatedAt}')::timestamptz
  OR jsonb_typeof(member_page.blocks) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(member_page.blocks) m WHERE m->>'id'=member_id)<>1 THEN RAISE EXCEPTION 'checkout_membership_unavailable'; END IF;
 SELECT value INTO member FROM jsonb_array_elements(member_page.blocks) m WHERE m->>'id'=member_id;
 IF member->>'siteId' IS DISTINCT FROM p_site_id OR member->>'status' IS DISTINCT FROM 'active'
  OR coalesce(member->>'accountId','')='' AND coalesce(member->>'userId','')=''
  OR coalesce(member->>'accountId','') NOT IN ('',account_id) OR coalesce(member->>'userId','') NOT IN ('',user_id)
  THEN RAISE EXCEPTION 'checkout_membership_unavailable'; END IF;
 -- Deliberately NO membership mutation, expiry/growth/benefit prep or operation
 -- receipt in 046. bundle_results itself is the durable original-operation key.
 settings:=settings_page.blocks;stock_id:=offer#>>'{checkoutBinding,stockItemId}';
 IF stock_id IS NOT NULL THEN
  IF (SELECT count(*) FROM jsonb_array_elements(settings->'redemptionItems') i WHERE i->>'id'=stock_id)<>1 THEN RAISE EXCEPTION 'checkout_quantity_unavailable'; END IF;
  SELECT value INTO item FROM jsonb_array_elements(settings->'redemptionItems') i WHERE i->>'id'=stock_id;
  IF item->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'checkout_quantity_unavailable'; END IF;
  IF item->'stock' IS DISTINCT FROM 'null'::jsonb THEN
   IF jsonb_typeof(item->'stock') IS DISTINCT FROM 'number' OR (item->>'stock')::numeric<quantity
    OR trunc((item->>'stock')::numeric)<>(item->>'stock')::numeric THEN RAISE EXCEPTION 'checkout_quantity_unavailable'; END IF;
   stock_uses:=jsonb_build_array(jsonb_build_object('itemId',stock_id,'quantity',quantity));
   item:=item||jsonb_build_object('stock',(item->>'stock')::bigint-quantity);
   SELECT settings||jsonb_build_object('redemptionItems',jsonb_agg(CASE WHEN i->>'id'=stock_id THEN item ELSE i END ORDER BY n)) INTO settings
    FROM jsonb_array_elements(settings->'redemptionItems') WITH ORDINALITY x(i,n);
   mutation:=jsonb_build_object('settings',jsonb_build_object('expectedUpdatedAt',settings_page.updated_at,'next',settings));
  END IF;
 END IF;
 stamp:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 IF coupon_count>0 THEN
  IF jsonb_typeof(p_plan#>'{coupons,claims}') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan#>'{coupons,claims}')<>coupon_count
   OR (SELECT count(*) FROM public.pages WHERE slug='__merchant_coupons__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
  SELECT * INTO STRICT coupon_page FROM public.pages WHERE slug='__merchant_coupons__:'||p_site_id FOR UPDATE;
  IF coupon_page.merchant_id IS DISTINCT FROM p_site_id OR coupon_page.updated_at IS DISTINCT FROM (p_plan#>>'{coupons,expectedUpdatedAt}')::timestamptz
   THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  coupons:=coupon_page.blocks;
  FOR pick IN SELECT value FROM jsonb_array_elements(p_plan#>'{coupons,claims}') LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(coupons) c WHERE c->>'id'=pick->>'couponId')<>1 THEN RAISE EXCEPTION 'checkout_coupon_unavailable'; END IF;
   SELECT value INTO coupon FROM jsonb_array_elements(coupons) c WHERE c->>'id'=pick->>'couponId';
   IF coupon->>'siteId' IS DISTINCT FROM p_site_id OR coupon->>'status' IS DISTINCT FROM 'active'
    OR coalesce(coupon->>'discountType','') NOT IN ('amount_off','threshold_amount_off','stored_value','percent_off','product_voucher','exchange_voucher','ticket_voucher')
    OR (coupon->>'startsAt')::timestamptz>clock_timestamp() OR (coupon->>'expiresAt')::timestamptz<clock_timestamp()
    OR (SELECT count(*) FROM jsonb_array_elements(coupon->'claimEvents') c WHERE c->>'id'=pick->>'claimEventId')<>1
    THEN RAISE EXCEPTION 'checkout_coupon_unavailable'; END IF;
   SELECT value INTO claim FROM jsonb_array_elements(coupon->'claimEvents') c WHERE c->>'id'=pick->>'claimEventId';
   IF coalesce(claim->>'accountId','')='' AND coalesce(claim->>'userId','')=''
    OR coalesce(claim->>'accountId','') NOT IN ('',account_id) OR coalesce(claim->>'userId','') NOT IN ('',user_id)
    OR (claim->>'validUntil')::timestamptz<clock_timestamp() OR coalesce(claim->>'settlementCode','')=''
    OR (SELECT count(*) FROM jsonb_array_elements(coupon->'claimEvents') c WHERE c->>'settlementCode'=claim->>'settlementCode')<>1
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(coupon->'redeemEvents') r WHERE r->>'claimEventId'=claim->>'id' OR r->>'settlementCode'=claim->>'settlementCode')
    THEN RAISE EXCEPTION 'checkout_coupon_unavailable'; END IF;
   effective_deadline:=least(effective_deadline,(coupon->>'expiresAt')::timestamptz,(claim->>'validUntil')::timestamptz);
   event:=jsonb_build_object('id',gen_random_uuid()::text,'at',stamp,'claimEventId',claim->>'id','settlementCode',claim->>'settlementCode',
    'accountId',claim->>'accountId','userId',claim->>'userId','operatorId','customer:'||account_id,'note','[op:member-checkout-coupon:'||p_operation_key||']');
   coupon_uses:=coupon_uses||jsonb_build_array(jsonb_build_object('couponId',coupon->>'id','claimEventId',claim->>'id','redeemEventId',event->>'id'));
   coupon:=coupon||jsonb_build_object('usedCount',(coupon->>'usedCount')::bigint+1,'updatedAt',stamp,'redeemEvents',jsonb_build_array(event)||(coupon->'redeemEvents'));
   SELECT jsonb_agg(CASE WHEN c->>'id'=pick->>'couponId' THEN coupon ELSE c END ORDER BY n) INTO coupons FROM jsonb_array_elements(coupons) WITH ORDINALITY x(c,n);
  END LOOP;
  mutation:=mutation||jsonb_build_object('coupons',jsonb_build_object('expectedUpdatedAt',coupon_page.updated_at,'next',coupons));
 ELSIF p_plan?'coupons' THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 IF effective_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'checkout_quote_expired'; END IF;
 IF mutation<>'{}'::jsonb THEN PERFORM public.faolla_commit_redemption_v1(p_site_id,mutation); END IF;
 IF kind='booking' THEN
  rows:=public.faolla_booking_atomic_rows_v1();
  SELECT r#>'{blocks,records}' INTO before_records FROM jsonb_array_elements(rows) r WHERE r->>'slug'='__merchant_booking_records__:v1';
  PERFORM public.faolla_booking_atomic_commit_v1(p_site_id,encode(sha256(convert_to('member-checkout-booking:'||p_operation_key,'UTF8')),'hex'),p_request_hash,
   jsonb_build_object('generation',control.generation,'revision',control.revision::text,'rows',rows,
    'next',jsonb_build_object('version',1,'records',jsonb_build_array(rec)||before_records),'result',receipt,'mailJobs','[]'::jsonb));
 ELSE
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'blocks',blocks,'updated_at',updated_at) ORDER BY slug,id),'[]'::jsonb) INTO rows
   FROM public.pages WHERE slug='__merchant_orders__:'||p_site_id OR slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r->'id','slug',r->'slug','updatedAt',r->'updated_at') ORDER BY r->>'slug',r->>'id'),'[]'::jsonb) INTO versions FROM jsonb_array_elements(rows) r;
  IF versions IS DISTINCT FROM p_plan#>'{order,expectedVersions}' THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  SELECT coalesce(jsonb_agg(i ORDER BY CASE WHEN r->>'slug'='__merchant_orders__:'||p_site_id THEN -1 ELSE substring(r->>'slug' FROM ':chunk:([0-9]+)$')::integer END,n),'[]'::jsonb) INTO before_records
   FROM jsonb_array_elements(rows) r CROSS JOIN LATERAL jsonb_array_elements(r->'blocks') WITH ORDINALITY x(i,n)
   WHERE r->>'slug'<>'__merchant_orders__:'||p_site_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) c WHERE c->>'slug'~':chunk:[0-9]+$');
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(before_records) o WHERE o->>'id'=resource_id) THEN RAISE EXCEPTION 'checkout_operation_conflict'; END IF;
  PERFORM public.faolla_commit_order_membership_v1(p_site_id,jsonb_build_object('orders',jsonb_build_object('expectedRows',rows,'next',jsonb_build_array(rec)||before_records)));
 END IF;
 -- Late failure rolls back ALL original resource/history/coupon/stock writes.
 IF effective_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'checkout_quote_expired'; END IF;
 result:=receipt||jsonb_build_object('siteId',p_site_id,'operationKey',p_operation_key,'membershipId',member_id,'offer',p_plan->'offer',
  'couponReturnOnCancel',offer->'couponReturnOnCancel','couponUses',coupon_uses,'stockUses',stock_uses,'cancellationPolicy',policy,
  'resourceTerms',CASE WHEN kind='booking' THEN jsonb_build_object('appointmentAt',rec->'appointmentAt','store',rec->'store','item',rec->'item','bookingBlockId',rec->'bookingBlockId','bookingViewport',rec->'bookingViewport')
   ELSE jsonb_build_object('items',rec->'items','totalQuantity',rec->'totalQuantity','totalAmount',rec->'totalAmount') END);
 INSERT INTO faolla_checkout_design.bundle_results VALUES(p_site_id,p_operation_key,p_principal_key,p_request_hash,kind,resource_id,result);
 RETURN jsonb_build_object('replayed',false,'receipt',result);
END;
$$;
REVOKE ALL ON FUNCTION faolla_checkout_design.commit_on_site_pending(text,text,text,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
