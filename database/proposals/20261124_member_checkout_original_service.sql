-- PRIVATE / UNINSTALLED. Original-only servicing after new purchases stop.
-- No production migration, grants, enrollment, receipt, ack or provider IO.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'checkout_service_unavailable';END IF;
END;$$;
CREATE TABLE faolla_checkout_design.original_service_pilots(
 site_id text PRIMARY KEY CHECK(site_id~'^[0-9]{8}$'),enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE faolla_checkout_design.original_service_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.original_service_pilots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.original_service_pilots FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.faolla_member_checkout_original_service_review_v1(p_site_id text,p_operation_key text,p_principal_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_service_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_service_busy';END IF;
 BEGIN
  PERFORM 1 FROM faolla_checkout_design.original_service_pilots WHERE site_id=p_site_id AND enabled FOR SHARE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'checkout_service_busy';END;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_service_disabled';END IF;
 -- No current offer, membership, intent enrollment or purchase flag is a
 -- substitute for the exact immutable original and its original policy.
 IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key AND principal_key=p_principal_key) THEN RAISE EXCEPTION 'checkout_not_found';END IF;
 v:=faolla_checkout_design.intent_original_view(p_site_id,p_operation_key,p_principal_key);
 IF v IS NULL OR jsonb_typeof(v->'original') IS DISTINCT FROM 'object' OR jsonb_typeof(v->'reviewRequired') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'checkout_service_unavailable';END IF;
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,
  'reviewHash',encode(sha256(convert_to(v::text,'UTF8')),'hex'),'original',v->'original','reviewRequired',v->'reviewRequired');
END;
$$;
CREATE FUNCTION public.faolla_member_checkout_original_service_cancel_v1(p_site_id text,p_operation_key text,p_principal_key text,p_review_hash text,p_expected_updated_at text,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE checked jsonb;result jsonb;after_review jsonb;deadline timestamptz;receipt jsonb;closed jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_service_unavailable';END IF;
 IF p_review_hash IS NULL OR p_review_hash!~'^[a-f0-9]{64}$' OR p_expected_updated_at IS NULL OR length(p_expected_updated_at)>64
  OR NOT isfinite(p_expected_updated_at::timestamptz) THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 deadline:=p_not_after::timestamptz;
 IF deadline IS NULL OR NOT isfinite(deadline) OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '15 seconds' THEN RAISE EXCEPTION 'checkout_service_expired';END IF;
 checked:=public.faolla_member_checkout_original_service_review_v1(p_site_id,p_operation_key,p_principal_key);
 IF checked->>'reviewHash' IS DISTINCT FROM p_review_hash THEN RAISE EXCEPTION 'checkout_service_changed';END IF;
 IF checked->'reviewRequired' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
 SELECT b.receipt INTO STRICT receipt FROM faolla_checkout_design.bundle_results b WHERE site_id=p_site_id AND operation_key=p_operation_key AND principal_key=p_principal_key;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_service_expired';END IF;
 -- Exactly one original cancellation, never a quote/create/payment/ack. The
 -- established atomic writers retain policy, stock, coupon and receipt checks.
 IF receipt->'version'='3'::jsonb AND receipt->>'purpose'='product_cart' THEN
  result:=public.faolla_member_checkout_cart_cancel_v1(p_site_id,p_operation_key,p_principal_key,p_expected_updated_at,p_not_after);
 ELSIF receipt->'version'='2'::jsonb AND receipt->>'method'='on_site' THEN
  result:=public.faolla_member_checkout_on_site_cancel_v1(p_site_id,p_operation_key,p_principal_key,p_expected_updated_at);
 ELSIF receipt->'version'='1'::jsonb THEN
  result:=public.faolla_member_checkout_cancel_v2(p_site_id,p_operation_key,p_principal_key,p_expected_updated_at);
 ELSE RAISE EXCEPTION 'checkout_cancellation_review_required';END IF;
 -- Include the old writer in this deadline. A slow/blocked original writer
 -- cannot commit late then produce a misleading timeout/release proof.
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_service_expired';END IF;
 IF jsonb_typeof(result->'replayed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'checkout_service_unavailable';END IF;
 after_review:=public.faolla_member_checkout_original_service_review_v1(p_site_id,p_operation_key,p_principal_key);
 closed:=CASE WHEN after_review#>>'{original,kind}'='cart' THEN after_review#>'{original,result,closed}' ELSE after_review#>'{original,original,result,closed}' END;
 IF after_review->'reviewRequired' IS DISTINCT FROM 'false'::jsonb OR closed IS DISTINCT FROM 'true'::jsonb
  THEN RAISE EXCEPTION 'checkout_service_unavailable';END IF;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_service_expired';END IF;
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'requestedReviewHash',p_review_hash,'replayed',result->'replayed','review',after_review);
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_original_service_review_v1(text,text,text),
 public.faolla_member_checkout_original_service_cancel_v1(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
