-- PRIVATE ISOLATED PROPOSAL ONLY. No migration registration, public grants,
-- production flag or real refund. Whole-order cancellation; line policies
-- decide EXACT original points/coupon returns, never a partial order rewrite.
BEGIN;
CREATE FUNCTION public.faolla_member_checkout_cart_cancel_v1(p_site_id text,p_operation_key text,p_principal_key text,p_expected_updated_at text,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE original faolla_checkout_design.bundle_results%rowtype;prior faolla_checkout_design.bundle_cancellations%rowtype;
 settings_page public.pages%rowtype;member_page public.pages%rowtype;coupon_page public.pages%rowtype;
 receipt jsonb;rows jsonb;records jsonb;rec jsonb;next_records jsonb;members jsonb;member jsonb;settings jsonb;coupons jsonb;coupon jsonb;claim jsonb;event jsonb;use jsonb;item jsonb;line jsonb;tx jsonb;
 transactions jsonb;refund jsonb;mutation jsonb:='{}';result jsonb;deadline timestamptz;
 account_id text;user_id text;member_id text;stamp text;level_id text;points bigint:=0;coupon_count integer:=0;stock_count integer:=0;growth_return numeric:=0;growth numeric;new_points numeric;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_unauthorized';END IF;
 deadline:=p_not_after::timestamptz;
 IF deadline IS NULL OR NOT isfinite(deadline) OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '15 seconds' THEN RAISE EXCEPTION 'checkout_quote_expired';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 SELECT * INTO original FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF NOT FOUND OR original.principal_key IS DISTINCT FROM p_principal_key OR original.receipt->'version' IS DISTINCT FROM '3'::jsonb
  OR original.receipt->>'purpose' IS DISTINCT FROM 'product_cart' THEN RAISE EXCEPTION 'checkout_not_found';END IF;
 SELECT * INTO prior FROM faolla_checkout_design.bundle_cancellations WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN RETURN jsonb_build_object('replayed',true,'result',public.faolla_member_checkout_cart_result_v1(p_site_id,p_operation_key,p_principal_key));END IF;
 IF EXISTS(SELECT 1 FROM faolla_checkout_design.on_site_collections WHERE site_id=p_site_id AND operation_key=p_operation_key) THEN RAISE EXCEPTION 'checkout_refund_required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0));
 PERFORM p.id FROM public.pages p WHERE p.merchant_id=p_site_id AND (p.slug IN ('__merchant_membership_settings__:'||p_site_id,'__merchant_memberships__:'||p_site_id,'__merchant_coupons__:'||p_site_id,'__merchant_orders__:'||p_site_id)
  OR p.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$')) ORDER BY p.slug,p.id FOR UPDATE;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_quote_expired';END IF;
 receipt:=original.receipt;account_id:=split_part(p_principal_key,':',2);user_id:=split_part(p_principal_key,':',3);member_id:=receipt->>'membershipId';
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'blocks',blocks,'updated_at',updated_at) ORDER BY slug,id),'[]'::jsonb) INTO rows
  FROM public.pages WHERE slug='__merchant_orders__:'||p_site_id OR slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$');
 SELECT coalesce(jsonb_agg(i ORDER BY CASE WHEN r->>'slug'='__merchant_orders__:'||p_site_id THEN -1 ELSE substring(r->>'slug' FROM ':chunk:([0-9]+)$')::integer END,n),'[]'::jsonb) INTO records
  FROM jsonb_array_elements(rows) r CROSS JOIN LATERAL jsonb_array_elements(r->'blocks') WITH ORDINALITY x(i,n)
  WHERE r->>'slug'<>'__merchant_orders__:'||p_site_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) c WHERE c->>'slug'~':chunk:[0-9]+$');
 IF (SELECT count(*) FROM jsonb_array_elements(records) r WHERE r->>'id'=original.resource_id AND r->>'siteId'=p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
 SELECT value INTO rec FROM jsonb_array_elements(records) r WHERE r->>'id'=original.resource_id AND r->>'siteId'=p_site_id;
 IF rec->>'customerAccountId' IS DISTINCT FROM account_id OR rec->>'customerUserId' IS DISTINCT FROM user_id THEN RAISE EXCEPTION 'checkout_not_found';END IF;
 IF p_expected_updated_at IS NULL OR rec->>'updatedAt' IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'checkout_conflict';END IF;
 IF rec->>'status' IS NULL OR rec->>'status' NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'checkout_cancellation_not_allowed';END IF;
 IF receipt->'resourceTerms' IS DISTINCT FROM jsonb_build_object('items',rec->'items','totalQuantity',rec->'totalQuantity','totalAmount',rec->'totalAmount') THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
 stamp:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_membership_settings__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_conflict';END IF;
 SELECT * INTO STRICT settings_page FROM public.pages WHERE merchant_id=p_site_id AND slug='__merchant_membership_settings__:'||p_site_id;settings:=settings_page.blocks;
 IF receipt->>'method'='points' AND EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'lines') l WHERE l->'returnPoints'='true'::jsonb AND (l->>'points')::bigint>0) THEN
  IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_memberships__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_membership_unavailable';END IF;
  SELECT * INTO STRICT member_page FROM public.pages WHERE merchant_id=p_site_id AND slug='__merchant_memberships__:'||p_site_id;members:=member_page.blocks;
  IF (SELECT count(*) FROM jsonb_array_elements(members) m WHERE m->>'id'=member_id)<>1 THEN RAISE EXCEPTION 'checkout_membership_unavailable';END IF;
  SELECT value INTO member FROM jsonb_array_elements(members) m WHERE m->>'id'=member_id;
  IF member->>'siteId' IS DISTINCT FROM p_site_id OR coalesce(member->>'accountId','') NOT IN ('',account_id) OR coalesce(member->>'userId','') NOT IN ('',user_id)
   OR coalesce(member->>'accountId','')='' AND coalesce(member->>'userId','')='' THEN RAISE EXCEPTION 'checkout_membership_unavailable';END IF;
  transactions:=member->'transactions';
  FOR line IN SELECT value FROM jsonb_array_elements(receipt->'lines') l WHERE l->'returnPoints'='true'::jsonb AND (l->>'points')::bigint>0 LOOP
   SELECT value INTO tx FROM jsonb_array_elements(receipt->'pointTransactions') t WHERE t->>'id'=line->>'pointTransactionId';
   IF tx IS NULL OR tx->>'operatorId' IS DISTINCT FROM 'customer:'||account_id OR tx->>'type' IS DISTINCT FROM 'redeem' OR tx->>'status' IS DISTINCT FROM 'completed'
    OR (tx->>'pointDelta')::numeric<>-(line->>'points')::numeric OR (SELECT count(*) FROM jsonb_array_elements(transactions) t WHERE t=tx)<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
   points:=points+(line->>'points')::bigint;growth_return:=growth_return+(tx->>'growthDelta')::numeric;
   SELECT jsonb_agg(CASE WHEN t->>'id'=tx->>'id' THEN t||jsonb_build_object('status','cancelled','cancelledAt',stamp,'cancelledBy','customer:'||account_id,
    'cancellationNote','Cart checkout cancelled','cancellationOperationMarker','[member-checkout-return:'||p_operation_key||']') ELSE t END ORDER BY n) INTO transactions
    FROM jsonb_array_elements(transactions) WITH ORDINALITY x(t,n);
  END LOOP;
  new_points:=(member->>'pointBalance')::numeric+points;
  IF new_points NOT BETWEEN 0 AND 9007199254740991 OR trunc(new_points)<>new_points THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
  refund:=jsonb_build_object('id',gen_random_uuid()::text,'type','recharge','status','completed','at',stamp,'pointDelta',points,'balanceDelta',0,'growthDelta',0,
   'note','Cart points returned [member-checkout-return:'||p_operation_key||']','operatorId','system','cancelledAt',NULL,'cancellationNote','','cancelledBy','','cancellationOperationMarker','','relatedTransactionId','','adjustmentKind','');
  transactions:=jsonb_build_array(refund)||transactions;
  IF settings#>'{growthRules,annualRecalculate}'='true'::jsonb THEN
   SELECT coalesce(sum(greatest(0,(t->>'growthDelta')::numeric)),0) INTO growth FROM jsonb_array_elements(transactions) t WHERE t->>'status'<>'cancelled' AND extract(year FROM (t->>'at')::timestamptz)=extract(year FROM clock_timestamp());
  ELSE growth:=greatest(0,(member->>'growthValue')::numeric-growth_return);END IF;
  SELECT coalesce(l->>'id','') INTO level_id FROM jsonb_array_elements(settings->'levels') WITH ORDINALITY x(l,n)
   WHERE l->'enabled'='true'::jsonb AND coalesce(l->>'name','')<>'' AND (l->>'requiredGrowthValue')::numeric<=growth ORDER BY (l->>'requiredGrowthValue')::numeric DESC,(l->>'sort')::numeric DESC,n DESC LIMIT 1;
  member:=member||jsonb_build_object('pointBalance',new_points,'growthValue',growth,'levelId',coalesce(level_id,''),'transactions',transactions,'updatedAt',stamp);
  SELECT jsonb_agg(CASE WHEN m->>'id'=member_id THEN member ELSE m END ORDER BY n) INTO members FROM jsonb_array_elements(members) WITH ORDINALITY x(m,n);
  mutation:=jsonb_build_object('settings',jsonb_build_object('expectedUpdatedAt',settings_page.updated_at,'next',settings),'memberships',jsonb_build_object('expectedUpdatedAt',member_page.updated_at,'next',members));
 END IF;
 FOR use IN SELECT value FROM jsonb_array_elements(receipt->'stockUses') LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(settings->'redemptionItems') i WHERE i->>'id'=use->>'itemId')<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
  SELECT value INTO item FROM jsonb_array_elements(settings->'redemptionItems') i WHERE i->>'id'=use->>'itemId';
  IF item->'stock'<>'null'::jsonb THEN
   IF NOT faolla_checkout_design.cart_natural(item->'stock',9007199254740991) OR (item->>'stock')::numeric+(use->>'quantity')::numeric>9007199254740991 THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
   item:=item||jsonb_build_object('stock',(item->>'stock')::numeric+(use->>'quantity')::numeric);
   SELECT settings||jsonb_build_object('redemptionItems',jsonb_agg(CASE WHEN i->>'id'=use->>'itemId' THEN item ELSE i END ORDER BY n)) INTO settings FROM jsonb_array_elements(settings->'redemptionItems') WITH ORDINALITY x(i,n);
  END IF;
  stock_count:=stock_count+(use->>'quantity')::integer;
 END LOOP;
 IF jsonb_array_length(receipt->'stockUses')>0 THEN mutation:=mutation||jsonb_build_object('settings',jsonb_build_object('expectedUpdatedAt',settings_page.updated_at,'next',settings));END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'couponUses') u JOIN LATERAL jsonb_array_elements(receipt->'lines') l ON l->>'offerId'=u->>'offerId' WHERE l->'returnCoupons'='true'::jsonb) THEN
  IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_coupons__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
  SELECT * INTO STRICT coupon_page FROM public.pages WHERE merchant_id=p_site_id AND slug='__merchant_coupons__:'||p_site_id;coupons:=coupon_page.blocks;
  FOR use IN SELECT u FROM jsonb_array_elements(receipt->'couponUses') u JOIN LATERAL jsonb_array_elements(receipt->'lines') l ON l->>'offerId'=u->>'offerId' WHERE l->'returnCoupons'='true'::jsonb LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(coupons) c WHERE c->>'id'=use->>'couponId')<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
   SELECT value INTO coupon FROM jsonb_array_elements(coupons) c WHERE c->>'id'=use->>'couponId';
   IF (SELECT count(*) FROM jsonb_array_elements(coupon->'claimEvents') c WHERE c->>'id'=use->>'claimEventId')<>1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
   SELECT value INTO claim FROM jsonb_array_elements(coupon->'claimEvents') c WHERE c->>'id'=use->>'claimEventId';
   IF coupon->>'siteId' IS DISTINCT FROM p_site_id OR coalesce(claim->>'accountId','') NOT IN ('',account_id) OR coalesce(claim->>'userId','') NOT IN ('',user_id)
    OR coalesce(claim->>'accountId','')='' AND coalesce(claim->>'userId','')=''
    OR (SELECT count(*) FROM jsonb_array_elements(coupon->'redeemEvents') r WHERE r->>'id'=use->>'redeemEventId' AND r->>'claimEventId'=claim->>'id' AND r->>'settlementCode'=claim->>'settlementCode')<>1
    OR (coupon->>'usedCount')::bigint<1 THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
   SELECT value INTO event FROM jsonb_array_elements(coupon->'redeemEvents') r WHERE r->>'id'=use->>'redeemEventId';
   IF event->>'note' NOT LIKE '%[op:member-checkout-coupon:'||p_operation_key||']%' THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
   INSERT INTO faolla_checkout_design.bundle_coupon_returns VALUES(p_site_id,use->>'redeemEventId',p_operation_key,event);
   coupon:=coupon||jsonb_build_object('usedCount',(coupon->>'usedCount')::bigint-1,'updatedAt',stamp,'redeemEvents',(SELECT coalesce(jsonb_agg(r ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(coupon->'redeemEvents') WITH ORDINALITY x(r,n) WHERE r->>'id'<>use->>'redeemEventId'));
   SELECT jsonb_agg(CASE WHEN c->>'id'=use->>'couponId' THEN coupon ELSE c END ORDER BY n) INTO coupons FROM jsonb_array_elements(coupons) WITH ORDINALITY x(c,n);coupon_count:=coupon_count+1;
  END LOOP;
  mutation:=mutation||jsonb_build_object('coupons',jsonb_build_object('expectedUpdatedAt',coupon_page.updated_at,'next',coupons));
 END IF;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_quote_expired';END IF;
 IF mutation<>'{}'::jsonb THEN PERFORM public.faolla_commit_redemption_v1(p_site_id,mutation);END IF;
 rec:=rec||jsonb_build_object('status','cancelled','cancelledAt',stamp,'updatedAt',stamp);
 SELECT jsonb_agg(CASE WHEN r->>'id'=original.resource_id AND r->>'siteId'=p_site_id THEN rec ELSE r END ORDER BY n) INTO next_records FROM jsonb_array_elements(records) WITH ORDINALITY x(r,n);
 PERFORM public.faolla_commit_order_membership_v1(p_site_id,jsonb_build_object('orders',jsonb_build_object('expectedRows',rows,'next',next_records)));
 result:=jsonb_build_object('version',3,'siteId',p_site_id,'operationKey',p_operation_key,'resourceKind','order','resourceId',original.resource_id,'closed',true,
  'pointsReturned',points,'couponsReturned',coupon_count,'stockReleased',stock_count,'cancelledAt',stamp);
 INSERT INTO faolla_checkout_design.bundle_cancellations VALUES(p_site_id,p_operation_key,p_principal_key,result,clock_timestamp());
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_quote_expired';END IF;
 RETURN jsonb_build_object('replayed',false,'result',public.faolla_member_checkout_cart_result_v1(p_site_id,p_operation_key,p_principal_key));
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_cart_cancel_v1(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
