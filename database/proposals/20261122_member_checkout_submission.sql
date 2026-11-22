-- ISOLATED PROPOSAL. Not a registered migration or an activation/ACL grant.
-- Only the trusted server planner may construct p_snapshot/p_plan. Browsers
-- never receive these raw tenant documents, private tokens or mutations.
BEGIN;
CREATE FUNCTION faolla_checkout_design.submission_rows(p_site_id text,p_sources boolean)
RETURNS jsonb LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'merchant_id',p.merchant_id,'slug',p.slug,
   'blocks',p.blocks,'updated_at',p.updated_at,'created_at',to_jsonb(p)->'created_at') ORDER BY p.slug,p.id),'[]'::jsonb)
 FROM public.pages p WHERE CASE WHEN p_sources THEN
   (p.merchant_id IS NULL AND p.slug='__platform_merchant_snapshot__') OR
   (p.merchant_id=p_site_id AND (p.slug IS NULL OR left(p.slug,2)<>'__' OR p.slug='__merchant_catalog__:'||p_site_id))
 ELSE p.merchant_id=p_site_id AND (p.slug IN ('__merchant_memberships__:'||p_site_id,
   '__merchant_membership_settings__:'||p_site_id,'__merchant_coupons__:'||p_site_id,'__merchant_orders__:'||p_site_id)
   OR p.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$')) END;
$$;
CREATE FUNCTION public.faolla_member_checkout_submission_snapshot_v2(p_site_id text,p_operation_key text,p_principal_key text,p_request_hash text,p_offer_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_previous faolla_checkout_design.bundle_results%rowtype; v_offer jsonb; v_result jsonb; v_kind text;
 v_control public.faolla_booking_atomic_control%rowtype; v_booking jsonb;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
   OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
   OR p_offer_id IS NULL OR p_offer_id!~'^[a-fA-F0-9-]{36}$' THEN RAISE EXCEPTION 'checkout_invalid_request'; END IF;
 SELECT * INTO v_previous FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN
   IF v_previous.principal_key<>p_principal_key OR v_previous.request_hash<>p_request_hash THEN RAISE EXCEPTION 'checkout_operation_conflict'; END IF;
   RETURN jsonb_build_object('replayed',true,'result',public.faolla_member_checkout_result_v2(p_site_id,p_operation_key,p_principal_key));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_pilots WHERE site_id=p_site_id AND enabled) THEN RAISE EXCEPTION 'checkout_disabled'; END IF;
 SELECT v.snapshot INTO v_offer FROM faolla_checkout_design.offer_heads h JOIN faolla_checkout_design.offer_versions v USING(site_id,offer_id,revision)
   WHERE h.site_id=p_site_id AND h.offer_id=p_offer_id::uuid AND h.enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_offer_not_found'; END IF;
 v_kind:=v_offer#>>'{source,kind}';
 IF v_kind='booking' THEN
   SELECT * INTO STRICT v_control FROM public.faolla_booking_atomic_control WHERE singleton;
   IF NOT v_control.active OR v_control.protocol<>2 THEN RAISE EXCEPTION 'checkout_unavailable'; END IF;
   v_booking:=jsonb_build_object('generation',v_control.generation,'revision',v_control.revision::text,'rows',public.faolla_booking_atomic_rows_v1());
 ELSIF v_kind<>'order' OR v_kind IS NULL THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 v_result:=jsonb_build_object('version',2,'siteId',p_site_id,'operationKey',p_operation_key,'principalKey',p_principal_key,'requestHash',p_request_hash,
   'databaseNow',clock_timestamp(),'offer',v_offer,'sourceRows',faolla_checkout_design.submission_rows(p_site_id,true),
   'domainRows',faolla_checkout_design.submission_rows(p_site_id,false),'booking',v_booking);
 IF octet_length(v_result::text)>16777216 THEN RAISE EXCEPTION 'checkout_snapshot_too_large'; END IF;
 RETURN jsonb_build_object('replayed',false,'snapshot',v_result);
END;
$$;
CREATE FUNCTION public.faolla_member_checkout_submission_commit_v2(p_site_id text,p_operation_key text,p_principal_key text,p_request_hash text,p_snapshot jsonb,p_plan jsonb,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_previous faolla_checkout_design.bundle_results%rowtype; v_control public.faolla_booking_atomic_control%rowtype;
 v_offer jsonb; v_kind text; v_now timestamptz:=clock_timestamp(); v_issued timestamptz; v_deadline timestamptz;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
   OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
   OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR octet_length(p_snapshot::text)>16777216
   OR p_snapshot->'version' IS DISTINCT FROM '2'::jsonb OR p_snapshot->>'siteId' IS DISTINCT FROM p_site_id
   OR p_snapshot->>'operationKey' IS DISTINCT FROM p_operation_key OR p_snapshot->>'principalKey' IS DISTINCT FROM p_principal_key
   OR p_snapshot->>'requestHash' IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 SELECT * INTO v_previous FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN
   IF v_previous.principal_key<>p_principal_key OR v_previous.request_hash<>p_request_hash THEN RAISE EXCEPTION 'checkout_operation_conflict'; END IF;
   RETURN jsonb_build_object('replayed',true,'result',public.faolla_member_checkout_result_v2(p_site_id,p_operation_key,p_principal_key));
 END IF;
 PERFORM 1 FROM faolla_checkout_design.bundle_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_disabled'; END IF;
 v_issued:=(p_snapshot->>'databaseNow')::timestamptz; v_deadline:=p_not_after::timestamptz;
 IF v_issued IS NULL OR v_deadline IS NULL OR v_issued>v_now+interval '2 seconds' OR v_deadline<=v_issued
   OR v_deadline>v_issued+interval '30 seconds' OR v_now>=v_deadline THEN RAISE EXCEPTION 'checkout_quote_expired'; END IF;
 SELECT v.snapshot INTO v_offer FROM faolla_checkout_design.offer_heads h JOIN faolla_checkout_design.offer_versions v USING(site_id,offer_id,revision)
   WHERE h.site_id=p_site_id AND h.offer_id=(p_plan#>>'{offer,id}')::uuid AND h.enabled FOR SHARE OF h;
 IF NOT FOUND OR v_offer IS DISTINCT FROM p_snapshot->'offer' OR v_offer->>'revision' IS DISTINCT FROM p_plan#>>'{offer,revision}' THEN RAISE EXCEPTION 'checkout_quote_changed'; END IF;
 v_kind:=v_offer#>>'{source,kind}';
 IF (v_kind='booking') IS DISTINCT FROM (p_plan ? 'booking') OR (v_kind='order') IS DISTINCT FROM (p_plan ? 'order') THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 -- Source rows (not member/order documents) are locked in stable physical
 -- order before the original booking/member locks. Existing booking writers
 -- never lock published/source rows. No new lock replaces the original CAS.
 PERFORM p.id FROM public.pages p WHERE p.id::text IN (SELECT r->>'id' FROM jsonb_array_elements(p_snapshot->'sourceRows') r) ORDER BY p.id FOR SHARE;
 IF faolla_checkout_design.submission_rows(p_site_id,true) IS DISTINCT FROM p_snapshot->'sourceRows' THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 IF v_kind='booking' THEN
   SELECT * INTO STRICT v_control FROM public.faolla_booking_atomic_control FOR UPDATE;
   IF NOT v_control.active OR v_control.protocol<>2 OR v_control.generation::text IS DISTINCT FROM p_snapshot#>>'{booking,generation}'
     OR v_control.revision::text IS DISTINCT FROM p_snapshot#>>'{booking,revision}' THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
   IF public.faolla_booking_atomic_rows_v1() IS DISTINCT FROM p_snapshot#>'{booking,rows}' THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0));
 IF faolla_checkout_design.submission_rows(p_site_id,false) IS DISTINCT FROM p_snapshot->'domainRows' THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 -- Recheck time after lock waits. A queued request cannot write after its
 -- appointment/advance/expiry/day boundary just because it started earlier.
 IF clock_timestamp()>=v_deadline THEN RAISE EXCEPTION 'checkout_quote_expired'; END IF;
 PERFORM faolla_checkout_design.commit_bundle(p_site_id,p_operation_key,p_principal_key,p_request_hash,p_plan);
 -- A slow inner storage operation can cross an expiry/midnight boundary even
 -- after the outer locks were acquired. Reject inside this same transaction.
 IF clock_timestamp()>=v_deadline THEN RAISE EXCEPTION 'checkout_quote_expired'; END IF;
 -- Detect a concurrent insert of a newer published/source row as well. A
 -- mismatch raises inside this SAME transaction, rolling back every effect.
 IF faolla_checkout_design.submission_rows(p_site_id,true) IS DISTINCT FROM p_snapshot->'sourceRows' THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 RETURN jsonb_build_object('replayed',false,'result',public.faolla_member_checkout_result_v2(p_site_id,p_operation_key,p_principal_key));
END;
$$;
REVOKE ALL ON FUNCTION faolla_checkout_design.submission_rows(text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_submission_snapshot_v2(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_submission_commit_v2(text,text,text,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
