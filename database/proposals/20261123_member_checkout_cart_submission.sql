-- PRIVATE / SYNTHETIC ACCEPTANCE PROPOSAL ONLY. No production registration,
-- grants, flags, real account data, Stripe, mail or live financial endpoint.
-- The original single-offer functions and their guards remain unchanged.
BEGIN;
CREATE TABLE faolla_checkout_design.cart_submission_pilots(
 site_id text PRIMARY KEY CHECK(site_id~'^[0-9]{8}$'),enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE faolla_checkout_design.cart_submission_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.cart_submission_pilots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.cart_submission_pilots FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION faolla_checkout_design.cart_natural(v jsonb,maximum numeric) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(v)='number' THEN (v::text)::numeric BETWEEN 0 AND maximum AND trunc((v::text)::numeric)=(v::text)::numeric ELSE false END;
$$;
CREATE FUNCTION public.faolla_member_checkout_cart_result_v1(p_site_id text,p_operation_key text,p_principal_key text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH owned AS (
  SELECT b.*,c.receipt cancellation,EXISTS(SELECT 1 FROM faolla_checkout_design.on_site_collections x WHERE x.site_id=b.site_id AND x.operation_key=b.operation_key) collected
  FROM faolla_checkout_design.bundle_results b LEFT JOIN faolla_checkout_design.bundle_cancellations c USING(site_id,operation_key)
  WHERE b.site_id=p_site_id AND b.operation_key=p_operation_key AND b.principal_key=p_principal_key
   AND p_site_id~'^[0-9]{8}$' AND p_operation_key~'^[a-f0-9]{64}$' AND p_principal_key~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
   AND b.receipt->'version'='3'::jsonb AND b.receipt->>'purpose'='product_cart'
 ), records AS (
  SELECT r FROM owned b JOIN public.pages p ON p.merchant_id=b.site_id AND
   (p.slug~('^__merchant_orders__:'||b.site_id||':chunk:[0-9]+$') OR p.slug='__merchant_orders__:'||b.site_id
    AND NOT EXISTS(SELECT 1 FROM public.pages c WHERE c.merchant_id=b.site_id AND c.slug~('^__merchant_orders__:'||b.site_id||':chunk:[0-9]+$')))
  -- Join predicates can be evaluated AFTER a lateral expansion. Never feed
  -- unrelated settings objects to the SRF, regardless of the chosen plan.
  -- A malformed matching order page still has no resource and is review-required.
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.blocks)='array' THEN p.blocks ELSE '[]'::jsonb END) r WHERE r->>'id'=b.resource_id AND r->>'siteId'=b.site_id
 ), resource AS (SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(r))->0 ELSE NULL END r FROM records), checked AS (
  SELECT b.*,r.r,coalesce(r.r->>'customerAccountId'=split_part(p_principal_key,':',2) AND r.r->>'customerUserId'=split_part(p_principal_key,':',3)
   AND b.receipt->'resourceTerms'=jsonb_build_object('items',r.r->'items','totalQuantity',r.r->'totalQuantity','totalAmount',r.r->'totalAmount')
   AND (b.cancellation IS NOT NULL)=(r.r->>'status'='cancelled') AND NOT b.collected,false) ok FROM owned b CROSS JOIN resource r
 )
 SELECT jsonb_build_object('version',3,'purpose','product_cart_result','siteId',site_id,'operationKey',operation_key,'resourceKind','order','resourceId',resource_id,
  'method',receipt->'method','currency',receipt->'currency','totalPoints',receipt->'totalPoints','grossMinor',receipt->'grossMinor','discountMinor',receipt->'discountMinor',
  'dueMinor',receipt->'dueMinor','capturedMinor',0,'couponCount',receipt->'couponCount','closed',cancellation IS NOT NULL,'reviewRequired',NOT ok,
  'cancellationAvailable',ok AND cancellation IS NULL AND r->>'status' IN ('pending','confirmed'),
  'lines',(SELECT jsonb_agg(jsonb_build_object('offerId',l->'offerId','offerRevision',l->'offerRevision','productId',l->'productId','title',l->'title','quantity',l->'quantity',
    'points',l->'points','grossMinor',l->'grossMinor','discountMinor',l->'discountMinor','dueMinor',l->'dueMinor','returnPoints',l->'returnPoints','returnCoupons',l->'returnCoupons','couponCount',jsonb_array_length(l->'couponClaims')) ORDER BY n)
    FROM jsonb_array_elements(receipt->'lines') WITH ORDINALITY x(l,n)),
  'resource',CASE WHEN r IS NOT NULL THEN jsonb_build_object('status',r->'status','updatedAt',r->'updatedAt') ELSE NULL END,
  'cancellation',CASE WHEN cancellation IS NOT NULL THEN jsonb_build_object('pointsReturned',cancellation->'pointsReturned','couponsReturned',cancellation->'couponsReturned',
   'stockReleased',cancellation->'stockReleased','cancelledAt',cancellation->'cancelledAt') ELSE NULL END) FROM checked;
$$;

CREATE FUNCTION public.faolla_member_checkout_cart_submission_snapshot_v1(p_site_id text,p_operation_key text,p_principal_key text,p_request_hash text,p_quote_request_hash text,p_offer_ids jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE previous faolla_checkout_design.bundle_results%rowtype;q jsonb;orders jsonb;result jsonb;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' OR p_quote_request_hash IS NULL OR p_quote_request_hash!~'^[a-f0-9]{64}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 SELECT * INTO previous FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN
  IF previous.principal_key<>p_principal_key OR previous.request_hash<>p_request_hash OR previous.receipt->>'purpose' IS DISTINCT FROM 'product_cart'
   THEN RAISE EXCEPTION 'checkout_operation_conflict';END IF;
  RETURN jsonb_build_object('replayed',true,'result',public.faolla_member_checkout_cart_result_v1(p_site_id,p_operation_key,p_principal_key));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.cart_submission_pilots WHERE site_id=p_site_id AND enabled) THEN RAISE EXCEPTION 'checkout_disabled';END IF;
 q:=public.faolla_member_checkout_cart_quote_snapshot_v1(p_site_id,p_principal_key,p_quote_request_hash,p_offer_ids);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'merchant_id',p.merchant_id,'slug',p.slug,'blocks',p.blocks,'updated_at',p.updated_at,'created_at',to_jsonb(p)->'created_at') ORDER BY p.slug,p.id),'[]'::jsonb)
 INTO orders FROM public.pages p WHERE p.merchant_id=p_site_id AND (p.slug='__merchant_orders__:'||p_site_id OR p.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$'));
 result:=jsonb_build_object('version',1,'purpose','product_cart_submission','siteId',p_site_id,'operationKey',p_operation_key,'principalKey',p_principal_key,
  'requestHash',p_request_hash,'quoteSnapshot',q,'orderRows',orders);
 IF octet_length(result::text)>16777216 THEN RAISE EXCEPTION 'checkout_snapshot_too_large';END IF;
 RETURN jsonb_build_object('replayed',false,'snapshot',result);
END;
$$;

CREATE FUNCTION public.faolla_member_checkout_cart_commit_v1(p_site_id text,p_operation_key text,p_principal_key text,p_request_hash text,p_snapshot jsonb,p_plan jsonb,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE previous faolla_checkout_design.bundle_results%rowtype;q jsonb;issued timestamptz;deadline timestamptz;
 source_rows jsonb;domain_rows jsonb;order_rows jsonb;current_offers jsonb;settings_page public.pages%rowtype;member_page public.pages%rowtype;coupon_page public.pages%rowtype;
 settings jsonb;members jsonb;member jsonb;next_member jsonb;coupons jsonb;coupon jsonb;claim jsonb;event jsonb;line jsonb;offer jsonb;pick jsonb;item jsonb;stock jsonb;tx jsonb;
 transactions jsonb;state jsonb;mutation jsonb:='{}';stock_uses jsonb:='[]';coupon_uses jsonb:='[]';before_orders jsonb;legacy_rows jsonb;rec jsonb;receipt jsonb;terms jsonb;
 method text;account_id text;user_id text;member_id text;resource_id text;stamp text;level_id text;block_id text;viewport text;
 debit bigint:=0;coupon_count integer:=0;quantity integer:=0;gross bigint:=0;discount bigint:=0;due bigint:=0;new_points numeric;delta numeric;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
  OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR octet_length(p_snapshot::text)>16777216
  OR p_snapshot->'version' IS DISTINCT FROM '1'::jsonb OR p_snapshot->>'purpose' IS DISTINCT FROM 'product_cart_submission'
  OR p_snapshot->>'siteId' IS DISTINCT FROM p_site_id OR p_snapshot->>'operationKey' IS DISTINCT FROM p_operation_key
  OR p_snapshot->>'principalKey' IS DISTINCT FROM p_principal_key OR p_snapshot->>'requestHash' IS DISTINCT FROM p_request_hash
  OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object' OR octet_length(p_plan::text)>262144 OR p_plan->'version' IS DISTINCT FROM '1'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_plan) k WHERE k NOT IN ('version','method','memberId','membership','lines','record','terms'))
  THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 SELECT * INTO previous FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN
  IF previous.principal_key<>p_principal_key OR previous.request_hash<>p_request_hash OR previous.receipt->>'purpose' IS DISTINCT FROM 'product_cart' THEN RAISE EXCEPTION 'checkout_operation_conflict';END IF;
  RETURN jsonb_build_object('replayed',true,'result',public.faolla_member_checkout_cart_result_v1(p_site_id,p_operation_key,p_principal_key));
 END IF;
 PERFORM 1 FROM faolla_checkout_design.bundle_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'checkout_disabled';END IF;
 PERFORM 1 FROM faolla_checkout_design.cart_quote_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'checkout_disabled';END IF;
 PERFORM 1 FROM faolla_checkout_design.cart_submission_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'checkout_disabled';END IF;
 q:=p_snapshot->'quoteSnapshot';issued:=(q->>'databaseNow')::timestamptz;deadline:=p_not_after::timestamptz;
 IF issued IS NULL OR deadline IS NULL OR NOT isfinite(issued) OR NOT isfinite(deadline) OR issued>clock_timestamp()+interval '2 seconds'
  OR deadline<=issued OR deadline>issued+interval '30 seconds' OR clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_quote_expired';END IF;
 IF q->'version' IS DISTINCT FROM '1'::jsonb OR q->>'purpose' IS DISTINCT FROM 'product_cart_quote' OR q->>'siteId' IS DISTINCT FROM p_site_id
  OR q->>'principalKey' IS DISTINCT FROM p_principal_key OR jsonb_typeof(q->'offers') IS DISTINCT FROM 'array' OR jsonb_array_length(q->'offers') NOT BETWEEN 1 AND 20
  OR jsonb_typeof(p_plan->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'lines')<>jsonb_array_length(q->'offers') THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
 PERFORM h.offer_id FROM faolla_checkout_design.offer_heads h WHERE h.site_id=p_site_id AND h.offer_id::text IN(SELECT o->>'id' FROM jsonb_array_elements(q->'offers') o) ORDER BY h.offer_id FOR SHARE;
 SELECT jsonb_agg(v.snapshot ORDER BY h.offer_id) INTO current_offers FROM faolla_checkout_design.offer_heads h JOIN faolla_checkout_design.offer_versions v USING(site_id,offer_id,revision)
  WHERE h.site_id=p_site_id AND h.enabled AND h.offer_id::text IN(SELECT o->>'id' FROM jsonb_array_elements(q->'offers') o);
 IF current_offers IS DISTINCT FROM q->'offers' THEN RAISE EXCEPTION 'checkout_quote_changed';END IF;
 PERFORM p.id FROM public.pages p WHERE p.id::text IN(SELECT r->>'id' FROM jsonb_array_elements(q->'sourceRows') r) ORDER BY p.id FOR SHARE;
 source_rows:=faolla_checkout_design.submission_rows(p_site_id,true);IF source_rows IS DISTINCT FROM q->'sourceRows' THEN RAISE EXCEPTION 'checkout_conflict';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0));
 PERFORM p.id FROM public.pages p WHERE p.merchant_id=p_site_id AND (p.slug IN ('__merchant_membership_settings__:'||p_site_id,'__merchant_memberships__:'||p_site_id,'__merchant_coupons__:'||p_site_id,'__merchant_orders__:'||p_site_id)
  OR p.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$')) ORDER BY p.slug,p.id FOR UPDATE;
 SELECT coalesce(jsonb_agg(r ORDER BY r->>'slug',r->>'id'),'[]'::jsonb) INTO domain_rows FROM jsonb_array_elements(faolla_checkout_design.submission_rows(p_site_id,false)) r
  WHERE r->>'slug' NOT LIKE '__merchant_orders__:%';
 SELECT coalesce(jsonb_agg(r ORDER BY r->>'slug',r->>'id'),'[]'::jsonb) INTO order_rows FROM jsonb_array_elements(faolla_checkout_design.submission_rows(p_site_id,false)) r
  WHERE r->>'slug' LIKE '__merchant_orders__:%';
 IF domain_rows IS DISTINCT FROM q->'domainRows' OR order_rows IS DISTINCT FROM p_snapshot->'orderRows' THEN RAISE EXCEPTION 'checkout_conflict';END IF;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_quote_expired';END IF;
 method:=p_plan->>'method';account_id:=split_part(p_principal_key,':',2);user_id:=split_part(p_principal_key,':',3);member_id:=p_plan->>'memberId';terms:=p_plan->'terms';rec:=p_plan->'record';resource_id:=rec->>'id';
 IF method IS NULL OR method NOT IN ('points','on_site') OR jsonb_typeof(terms) IS DISTINCT FROM 'object' OR terms->'capturedMinor' IS DISTINCT FROM '0'::jsonb
  OR (SELECT count(*) FROM jsonb_object_keys(terms))<>6 OR EXISTS(SELECT 1 FROM jsonb_object_keys(terms) k WHERE k NOT IN ('totalPoints','grossMinor','discountMinor','dueMinor','couponCount','capturedMinor'))
  OR jsonb_typeof(rec) IS DISTINCT FROM 'object' OR rec->>'siteId' IS DISTINCT FROM p_site_id OR resource_id IS NULL OR resource_id!~'^[A-Za-z0-9:_-]{1,160}$'
  OR rec->>'customerAccountId' IS DISTINCT FROM account_id OR rec->>'customerUserId' IS DISTINCT FROM user_id OR rec->>'status' IS DISTINCT FROM 'pending'
  OR rec->>'checkoutOperationKey' IS DISTINCT FROM p_operation_key OR jsonb_typeof(rec->'items') IS DISTINCT FROM 'array'
  OR jsonb_array_length(rec->'items')<>jsonb_array_length(p_plan->'lines') THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_plan->'lines') l GROUP BY l->>'offerId' HAVING count(*)<>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_plan->'lines') l GROUP BY l->>'productId' HAVING count(*)<>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_plan->'lines') l WHERE l->'pointTransactionId'<>'null'::jsonb GROUP BY l->>'pointTransactionId' HAVING count(*)<>1) THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_plan->'lines') LOOP
  SELECT value INTO offer FROM jsonb_array_elements(current_offers) o WHERE o->>'id'=line->>'offerId';
  IF offer IS NULL OR offer->>'revision' IS DISTINCT FROM line->>'offerRevision' OR offer#>>'{source,kind}' IS DISTINCT FROM 'order'
   OR offer#>>'{source,productId}' IS DISTINCT FROM line->>'productId' OR offer->>'title' IS DISTINCT FROM line->>'title'
   OR NOT faolla_checkout_design.cart_natural(line->'quantity',999) OR (line->>'quantity')::integer<1 OR (line->>'quantity')::integer>(offer->>'maxQuantity')::integer
   OR line->'returnPoints' IS DISTINCT FROM offer#>'{checkoutBinding,pointsReturnOnCancel}' OR line->'returnCoupons' IS DISTINCT FROM offer->'couponReturnOnCancel'
   OR line->'stockItemId' IS DISTINCT FROM offer#>'{checkoutBinding,stockItemId}' OR jsonb_typeof(line->'couponClaims') IS DISTINCT FROM 'array'
   OR jsonb_array_length(line->'couponClaims')>20 OR (SELECT count(*) FROM jsonb_object_keys(line))<>14
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(line) k WHERE k NOT IN ('offerId','offerRevision','productId','title','quantity','points','grossMinor','discountMinor','dueMinor','returnPoints','returnCoupons','stockItemId','couponClaims','pointTransactionId'))
   THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
  IF block_id IS NULL THEN block_id:=offer#>>'{source,blockId}';viewport:=offer#>>'{checkoutBinding,viewport}';END IF;
  IF block_id IS DISTINCT FROM offer#>>'{source,blockId}' OR viewport IS DISTINCT FROM offer#>>'{checkoutBinding,viewport}' THEN RAISE EXCEPTION 'checkout_cart_source_mismatch';END IF;
  SELECT value INTO item FROM jsonb_array_elements(rec->'items') i WHERE i->>'productId'=line->>'productId';
  IF (SELECT count(*) FROM jsonb_array_elements(rec->'items') i WHERE i->>'productId'=line->>'productId')<>1 OR item->'quantity' IS DISTINCT FROM line->'quantity' THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
  quantity:=quantity+(line->>'quantity')::integer;coupon_count:=coupon_count+jsonb_array_length(line->'couponClaims');
  IF method='points' THEN
   IF offer->'unitPoints'='null'::jsonb OR NOT faolla_checkout_design.cart_natural(line->'points',99999999) OR (line->>'points')::numeric>(offer->>'unitPoints')::numeric*(line->>'quantity')::numeric
    OR line->'grossMinor' IS DISTINCT FROM 'null'::jsonb OR line->'discountMinor' IS DISTINCT FROM 'null'::jsonb OR line->'dueMinor' IS DISTINCT FROM 'null'::jsonb
    OR item->'unitPrice' IS DISTINCT FROM '0'::jsonb OR item->'subtotal' IS DISTINCT FROM '0'::jsonb THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
   debit:=debit+(line->>'points')::bigint;
  ELSE
   IF offer->'allowOnSite' IS DISTINCT FROM 'true'::jsonb OR line->'points' IS DISTINCT FROM 'null'::jsonb OR line->'pointTransactionId' IS DISTINCT FROM 'null'::jsonb
    OR NOT faolla_checkout_design.cart_natural(line->'grossMinor',99999999) OR NOT faolla_checkout_design.cart_natural(line->'discountMinor',99999999) OR NOT faolla_checkout_design.cart_natural(line->'dueMinor',99999999)
    OR (line->>'grossMinor')::numeric<>(offer#>>'{cash,unitAmountMinor}')::numeric*(line->>'quantity')::numeric
    OR (line->>'grossMinor')::numeric<>(line->>'discountMinor')::numeric+(line->>'dueMinor')::numeric
    OR (line->>'discountMinor')::numeric>0 AND jsonb_array_length(line->'couponClaims')=0
    OR (item->>'unitPrice')::numeric*100<>(offer#>>'{cash,unitAmountMinor}')::numeric OR (item->>'subtotal')::numeric*100<>(line->>'grossMinor')::numeric THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
   gross:=gross+(line->>'grossMinor')::bigint;discount:=discount+(line->>'discountMinor')::bigint;due:=due+(line->>'dueMinor')::bigint;
  END IF;
 END LOOP;
 IF quantity>999 OR rec->>'blockId' IS DISTINCT FROM block_id OR rec->'totalQuantity' IS DISTINCT FROM to_jsonb(quantity) OR coupon_count>20 OR terms->'couponCount' IS DISTINCT FROM to_jsonb(coupon_count)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_plan->'lines') l CROSS JOIN LATERAL jsonb_array_elements(l->'couponClaims') c GROUP BY c->>'couponId',c->>'claimEventId' HAVING count(*)<>1)
  OR method='points' AND (debit>99999999 OR debit=0 AND coupon_count=0 OR terms->'totalPoints' IS DISTINCT FROM to_jsonb(debit) OR rec->'totalAmount' IS DISTINCT FROM '0'::jsonb
   OR terms->'grossMinor' IS DISTINCT FROM 'null'::jsonb OR terms->'discountMinor' IS DISTINCT FROM 'null'::jsonb OR terms->'dueMinor' IS DISTINCT FROM 'null'::jsonb)
  OR method='on_site' AND (gross NOT BETWEEN 1 AND 99999999 OR discount>gross OR due<>gross-discount OR discount>0 AND coupon_count=0 OR terms->'totalPoints' IS DISTINCT FROM 'null'::jsonb
   OR terms->'grossMinor' IS DISTINCT FROM to_jsonb(gross) OR terms->'discountMinor' IS DISTINCT FROM to_jsonb(discount) OR terms->'dueMinor' IS DISTINCT FROM to_jsonb(due)
   OR (rec->>'totalAmount')::numeric*100<>gross OR p_plan->'membership' IS DISTINCT FROM 'null'::jsonb) THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
 IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_membership_settings__:'||p_site_id)<>1 OR (SELECT count(*) FROM public.pages WHERE slug='__merchant_memberships__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_conflict';END IF;
 SELECT * INTO STRICT settings_page FROM public.pages WHERE merchant_id=p_site_id AND slug='__merchant_membership_settings__:'||p_site_id;
 SELECT * INTO STRICT member_page FROM public.pages WHERE merchant_id=p_site_id AND slug='__merchant_memberships__:'||p_site_id;
 settings:=settings_page.blocks;members:=member_page.blocks;
 IF (SELECT count(*) FROM jsonb_array_elements(members) m WHERE m->>'id'=member_id)<>1 THEN RAISE EXCEPTION 'checkout_membership_unavailable';END IF;
 SELECT value INTO member FROM jsonb_array_elements(members) m WHERE m->>'id'=member_id;
 IF member->>'siteId' IS DISTINCT FROM p_site_id OR member->>'status' IS DISTINCT FROM 'active' OR coalesce(member->>'accountId','')='' AND coalesce(member->>'userId','')=''
  OR coalesce(member->>'accountId','') NOT IN ('',account_id) OR coalesce(member->>'userId','') NOT IN ('',user_id) THEN RAISE EXCEPTION 'checkout_membership_unavailable';END IF;
 stamp:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 IF method='points' THEN
  transactions:=p_plan#>'{membership,transactions}';state:=p_plan#>'{membership,nextState}';
  IF p_plan#>>'{membership,id}' IS DISTINCT FROM member_id OR jsonb_typeof(transactions) IS DISTINCT FROM 'array' OR jsonb_array_length(transactions)>256
   OR jsonb_typeof(state) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_array_elements(transactions) t WHERE jsonb_typeof(t) IS DISTINCT FROM 'object' OR coalesce(t->>'id','')='' OR length(t->>'id')>180
    OR t->>'status' IS DISTINCT FROM 'completed' OR t->>'operatorId' NOT IN ('system','customer:'||account_id) OR t->>'operatorId' IS NULL
    OR jsonb_typeof(t->'pointDelta') IS DISTINCT FROM 'number' OR trunc((t->>'pointDelta')::numeric)<>(t->>'pointDelta')::numeric OR t->'balanceDelta' IS DISTINCT FROM '0'::jsonb
    OR jsonb_typeof(t->'growthDelta') IS DISTINCT FROM 'number' OR (t->>'growthDelta')::numeric NOT BETWEEN 0 AND 9007199254740991 OR round((t->>'growthDelta')::numeric,2)<>(t->>'growthDelta')::numeric)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(transactions) t GROUP BY t->>'id' HAVING count(*)<>1)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(transactions) t CROSS JOIN jsonb_array_elements(member->'transactions') o WHERE o->>'id'=t->>'id') THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(p_plan->'lines') LOOP
   IF (line->>'points')::bigint>0 THEN
    SELECT value INTO tx FROM jsonb_array_elements(transactions) t WHERE t->>'id'=line->>'pointTransactionId';
    IF tx IS NULL OR tx->>'operatorId' IS DISTINCT FROM 'customer:'||account_id OR tx->>'type' IS DISTINCT FROM 'redeem' OR (tx->>'pointDelta')::numeric<>-(line->>'points')::numeric THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
   ELSIF line->'pointTransactionId' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(transactions) t WHERE t->>'operatorId'='customer:'||account_id)<>(SELECT count(*) FROM jsonb_array_elements(p_plan->'lines') l WHERE (l->>'points')::bigint>0)
   OR (SELECT coalesce(-sum((t->>'pointDelta')::numeric),0) FROM jsonb_array_elements(transactions) t WHERE t->>'operatorId'='customer:'||account_id)<>debit THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
  SELECT coalesce(sum((t->>'pointDelta')::numeric),0) INTO delta FROM jsonb_array_elements(transactions) t;new_points:=(member->>'pointBalance')::numeric+delta;
  IF new_points NOT BETWEEN 0 AND 9007199254740991 OR trunc(new_points)<>new_points OR state->'pointBalance' IS DISTINCT FROM to_jsonb(new_points)
   OR jsonb_typeof(state->'growthValue') IS DISTINCT FROM 'number' OR (state->>'growthValue')::numeric NOT BETWEEN 0 AND 9007199254740991 OR round((state->>'growthValue')::numeric,2)<>(state->>'growthValue')::numeric THEN RAISE EXCEPTION 'checkout_insufficient_points';END IF;
  SELECT coalesce(l->>'id','') INTO level_id FROM jsonb_array_elements(settings->'levels') WITH ORDINALITY x(l,n)
   WHERE l->'enabled'='true'::jsonb AND coalesce(l->>'name','')<>'' AND (l->>'requiredGrowthValue')::numeric<=(state->>'growthValue')::numeric
   ORDER BY (l->>'requiredGrowthValue')::numeric DESC,(l->>'sort')::numeric DESC,n DESC LIMIT 1;
  IF state->>'levelId' IS DISTINCT FROM coalesce(level_id,'') THEN RAISE EXCEPTION 'checkout_invalid_plan';END IF;
  next_member:=member||jsonb_build_object('pointBalance',new_points,'growthValue',state->'growthValue','levelId',state->'levelId','transactions',transactions||(member->'transactions'),'updatedAt',stamp);
  SELECT jsonb_agg(CASE WHEN m->>'id'=member_id THEN next_member ELSE m END ORDER BY n) INTO members FROM jsonb_array_elements(members) WITH ORDINALITY x(m,n);
  mutation:=jsonb_build_object('operation',jsonb_build_object('id','self-checkout:'||p_operation_key,'fingerprint',p_request_hash,'membershipId',member_id),
   'settings',jsonb_build_object('expectedUpdatedAt',settings_page.updated_at,'next',settings),'memberships',jsonb_build_object('expectedUpdatedAt',member_page.updated_at,'next',members));
 END IF;
 FOR stock IN SELECT jsonb_build_object('itemId',l->>'stockItemId','quantity',sum((l->>'quantity')::integer)) FROM jsonb_array_elements(p_plan->'lines') l
  WHERE l->'stockItemId'<>'null'::jsonb GROUP BY l->>'stockItemId' ORDER BY l->>'stockItemId' LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(settings->'redemptionItems') i WHERE i->>'id'=stock->>'itemId')<>1 THEN RAISE EXCEPTION 'checkout_quantity_unavailable';END IF;
  SELECT value INTO item FROM jsonb_array_elements(settings->'redemptionItems') i WHERE i->>'id'=stock->>'itemId';
  IF item->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'checkout_quantity_unavailable';END IF;
  IF item->'stock'='null'::jsonb THEN CONTINUE;END IF;
  IF NOT faolla_checkout_design.cart_natural(item->'stock',9007199254740991) OR (item->>'stock')::numeric<(stock->>'quantity')::numeric THEN RAISE EXCEPTION 'checkout_quantity_unavailable';END IF;
  stock_uses:=stock_uses||jsonb_build_array(stock);item:=item||jsonb_build_object('stock',(item->>'stock')::numeric-(stock->>'quantity')::numeric);
  SELECT settings||jsonb_build_object('redemptionItems',jsonb_agg(CASE WHEN i->>'id'=stock->>'itemId' THEN item ELSE i END ORDER BY n)) INTO settings FROM jsonb_array_elements(settings->'redemptionItems') WITH ORDINALITY x(i,n);
  mutation:=mutation||jsonb_build_object('settings',jsonb_build_object('expectedUpdatedAt',settings_page.updated_at,'next',settings));
 END LOOP;
 IF coupon_count>0 THEN
  IF (SELECT count(*) FROM public.pages WHERE slug='__merchant_coupons__:'||p_site_id)<>1 THEN RAISE EXCEPTION 'checkout_conflict';END IF;
  SELECT * INTO STRICT coupon_page FROM public.pages WHERE merchant_id=p_site_id AND slug='__merchant_coupons__:'||p_site_id;coupons:=coupon_page.blocks;
  FOR pick IN SELECT c||jsonb_build_object('offerId',l->'offerId') FROM jsonb_array_elements(p_plan->'lines') l CROSS JOIN LATERAL jsonb_array_elements(l->'couponClaims') c LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(coupons) c WHERE c->>'id'=pick->>'couponId')<>1 THEN RAISE EXCEPTION 'checkout_coupon_unavailable';END IF;
   SELECT value INTO coupon FROM jsonb_array_elements(coupons) c WHERE c->>'id'=pick->>'couponId';
   IF coupon->>'siteId' IS DISTINCT FROM p_site_id OR coupon->>'status' IS DISTINCT FROM 'active' OR (coupon->>'startsAt')::timestamptz>clock_timestamp() OR (coupon->>'expiresAt')::timestamptz<clock_timestamp()
    OR (SELECT count(*) FROM jsonb_array_elements(coupon->'claimEvents') c WHERE c->>'id'=pick->>'claimEventId')<>1 THEN RAISE EXCEPTION 'checkout_coupon_unavailable';END IF;
   SELECT value INTO claim FROM jsonb_array_elements(coupon->'claimEvents') c WHERE c->>'id'=pick->>'claimEventId';
   IF coalesce(claim->>'accountId','')='' AND coalesce(claim->>'userId','')='' OR coalesce(claim->>'accountId','') NOT IN ('',account_id) OR coalesce(claim->>'userId','') NOT IN ('',user_id)
    OR (claim->>'validUntil')::timestamptz<clock_timestamp() OR coalesce(claim->>'settlementCode','')=''
    OR (SELECT count(*) FROM jsonb_array_elements(coupon->'claimEvents') c WHERE c->>'settlementCode'=claim->>'settlementCode')<>1
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(coupon->'redeemEvents') r WHERE r->>'claimEventId'=claim->>'id' OR r->>'settlementCode'=claim->>'settlementCode') THEN RAISE EXCEPTION 'checkout_coupon_unavailable';END IF;
   deadline:=least(deadline,(coupon->>'expiresAt')::timestamptz,(claim->>'validUntil')::timestamptz);
   event:=jsonb_build_object('id',gen_random_uuid()::text,'at',stamp,'claimEventId',claim->>'id','settlementCode',claim->>'settlementCode','accountId',claim->>'accountId','userId',claim->>'userId',
    'operatorId','customer:'||account_id,'note','[op:member-checkout-coupon:'||p_operation_key||']');
   coupon_uses:=coupon_uses||jsonb_build_array(jsonb_build_object('offerId',pick->'offerId','couponId',coupon->>'id','claimEventId',claim->>'id','redeemEventId',event->>'id'));
   coupon:=coupon||jsonb_build_object('usedCount',(coupon->>'usedCount')::bigint+1,'updatedAt',stamp,'redeemEvents',jsonb_build_array(event)||(coupon->'redeemEvents'));
   SELECT jsonb_agg(CASE WHEN c->>'id'=pick->>'couponId' THEN coupon ELSE c END ORDER BY n) INTO coupons FROM jsonb_array_elements(coupons) WITH ORDINALITY x(c,n);
  END LOOP;
  mutation:=mutation||jsonb_build_object('coupons',jsonb_build_object('expectedUpdatedAt',coupon_page.updated_at,'next',coupons));
 END IF;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_quote_expired';END IF;
 IF mutation<>'{}'::jsonb THEN PERFORM public.faolla_commit_redemption_v1(p_site_id,mutation);END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r->'id','slug',r->'slug','blocks',r->'blocks','updated_at',r->'updated_at') ORDER BY r->>'slug',r->>'id'),'[]'::jsonb) INTO legacy_rows FROM jsonb_array_elements(order_rows) r;
 SELECT coalesce(jsonb_agg(i ORDER BY CASE WHEN r->>'slug'='__merchant_orders__:'||p_site_id THEN -1 ELSE substring(r->>'slug' FROM ':chunk:([0-9]+)$')::integer END,n),'[]'::jsonb) INTO before_orders
  FROM jsonb_array_elements(legacy_rows) r CROSS JOIN LATERAL jsonb_array_elements(r->'blocks') WITH ORDINALITY x(i,n)
  WHERE r->>'slug'<>'__merchant_orders__:'||p_site_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(legacy_rows) c WHERE c->>'slug'~':chunk:[0-9]+$');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(before_orders) o WHERE o->>'id'=resource_id) THEN RAISE EXCEPTION 'checkout_operation_conflict';END IF;
 PERFORM public.faolla_commit_order_membership_v1(p_site_id,jsonb_build_object('orders',jsonb_build_object('expectedRows',legacy_rows,'next',jsonb_build_array(rec)||before_orders)));
 receipt:=terms||jsonb_build_object('version',3,'purpose','product_cart','method',method,'currency',CASE WHEN method='points' THEN NULL ELSE 'eur' END,'resourceKind','order','resourceId',resource_id,
  'membershipId',member_id,'lines',p_plan->'lines','stockUses',stock_uses,'couponUses',coupon_uses,
  'pointTransactions',CASE WHEN method='points' THEN (SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM jsonb_array_elements(transactions) t WHERE t->>'operatorId'='customer:'||account_id) ELSE '[]'::jsonb END,
  'resourceTerms',jsonb_build_object('items',rec->'items','totalQuantity',rec->'totalQuantity','totalAmount',rec->'totalAmount'));
 INSERT INTO faolla_checkout_design.bundle_results VALUES(p_site_id,p_operation_key,p_principal_key,p_request_hash,'order',resource_id,receipt);
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_quote_expired';END IF;
 IF faolla_checkout_design.submission_rows(p_site_id,true) IS DISTINCT FROM source_rows THEN RAISE EXCEPTION 'checkout_conflict';END IF;
 RETURN jsonb_build_object('replayed',false,'result',public.faolla_member_checkout_cart_result_v1(p_site_id,p_operation_key,p_principal_key));
END;
$$;

REVOKE ALL ON FUNCTION faolla_checkout_design.cart_natural(jsonb,numeric) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_cart_result_v1(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_cart_submission_snapshot_v1(text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_cart_commit_v1(text,text,text,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
