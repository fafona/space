-- ISOLATED PROPOSAL, not a registered migration, activation or role grant.
-- Raw snapshots/plans belong to the trusted server only, never the browser.
-- Keep the original points protocol unchanged. Both methods share its nonce
-- lock and immutable operation ledger so switching methods cannot double-order.
BEGIN;
CREATE FUNCTION public.faolla_member_checkout_on_site_snapshot_v1(p_site_id text,p_operation_key text,p_principal_key text,p_request_hash text,p_offer_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_previous faolla_checkout_design.bundle_results%rowtype; v_offer jsonb; v_result jsonb; v_kind text;
 v_control public.faolla_booking_atomic_control%rowtype; v_booking jsonb;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
   OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
   OR p_offer_id IS NULL OR p_offer_id!~'^[a-fA-F0-9]{8}-([a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$' THEN RAISE EXCEPTION 'checkout_invalid_request'; END IF;
 SELECT * INTO v_previous FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN
   IF v_previous.principal_key<>p_principal_key OR v_previous.request_hash<>p_request_hash OR v_previous.receipt->>'method' IS DISTINCT FROM 'on_site'
     THEN RAISE EXCEPTION 'checkout_operation_conflict'; END IF;
   RETURN jsonb_build_object('replayed',true,'result',public.faolla_member_checkout_on_site_result_v1(p_site_id,p_operation_key,p_principal_key));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_pilots WHERE site_id=p_site_id AND enabled) THEN RAISE EXCEPTION 'checkout_disabled'; END IF;
 SELECT v.snapshot INTO v_offer FROM faolla_checkout_design.offer_heads h JOIN faolla_checkout_design.offer_versions v USING(site_id,offer_id,revision)
   WHERE h.site_id=p_site_id AND h.offer_id=p_offer_id::uuid AND h.enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_offer_not_found'; END IF;
 IF v_offer->'allowOnSite' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(v_offer->'cash') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'checkout_on_site_unavailable'; END IF;
 v_kind:=v_offer#>>'{source,kind}';
 IF v_kind='booking' THEN
   SELECT * INTO STRICT v_control FROM public.faolla_booking_atomic_control WHERE singleton;
   IF NOT v_control.active OR v_control.protocol<>2 THEN RAISE EXCEPTION 'checkout_unavailable'; END IF;
   v_booking:=jsonb_build_object('generation',v_control.generation,'revision',v_control.revision::text,'rows',public.faolla_booking_atomic_rows_v1());
 ELSIF v_kind<>'order' OR v_kind IS NULL THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 v_result:=jsonb_build_object('version',3,'method','on_site','siteId',p_site_id,'operationKey',p_operation_key,'principalKey',p_principal_key,'requestHash',p_request_hash,
   'databaseNow',clock_timestamp(),'offer',v_offer,'sourceRows',faolla_checkout_design.submission_rows(p_site_id,true),
   'domainRows',faolla_checkout_design.submission_rows(p_site_id,false),'booking',v_booking);
 IF octet_length(v_result::text)>16777216 THEN RAISE EXCEPTION 'checkout_snapshot_too_large'; END IF;
 RETURN jsonb_build_object('replayed',false,'snapshot',v_result);
END;
$$;
CREATE FUNCTION public.faolla_member_checkout_on_site_commit_v1(p_site_id text,p_operation_key text,p_principal_key text,p_request_hash text,p_snapshot jsonb,p_plan jsonb,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_previous faolla_checkout_design.bundle_results%rowtype; v_control public.faolla_booking_atomic_control%rowtype;
 v_offer jsonb; v_kind text; v_issued timestamptz; v_deadline timestamptz;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
   OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
   OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR octet_length(p_snapshot::text)>16777216
   OR p_snapshot->'version' IS DISTINCT FROM '3'::jsonb OR p_snapshot->>'method' IS DISTINCT FROM 'on_site' OR p_snapshot->>'siteId' IS DISTINCT FROM p_site_id
   OR p_snapshot->>'operationKey' IS DISTINCT FROM p_operation_key OR p_snapshot->>'principalKey' IS DISTINCT FROM p_principal_key
   OR p_snapshot->>'requestHash' IS DISTINCT FROM p_request_hash OR jsonb_typeof(p_snapshot->'sourceRows') IS DISTINCT FROM 'array'
   OR jsonb_typeof(p_snapshot->'domainRows') IS DISTINCT FROM 'array' OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 SELECT * INTO v_previous FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN
   IF v_previous.principal_key<>p_principal_key OR v_previous.request_hash<>p_request_hash OR v_previous.receipt->>'method' IS DISTINCT FROM 'on_site'
     THEN RAISE EXCEPTION 'checkout_operation_conflict'; END IF;
   RETURN jsonb_build_object('replayed',true,'result',public.faolla_member_checkout_on_site_result_v1(p_site_id,p_operation_key,p_principal_key));
 END IF;
 PERFORM 1 FROM faolla_checkout_design.bundle_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_disabled'; END IF;
 v_issued:=(p_snapshot->>'databaseNow')::timestamptz; v_deadline:=p_not_after::timestamptz;
 IF v_issued IS NULL OR v_deadline IS NULL OR NOT isfinite(v_issued) OR NOT isfinite(v_deadline) OR v_issued>clock_timestamp()+interval '2 seconds' OR v_deadline<=v_issued
   OR v_deadline>v_issued+interval '30 seconds' OR clock_timestamp()>=v_deadline THEN RAISE EXCEPTION 'checkout_quote_expired'; END IF;
 SELECT v.snapshot INTO v_offer FROM faolla_checkout_design.offer_heads h JOIN faolla_checkout_design.offer_versions v USING(site_id,offer_id,revision)
   WHERE h.site_id=p_site_id AND h.offer_id=(p_plan#>>'{offer,id}')::uuid AND h.enabled FOR SHARE OF h;
 IF NOT FOUND OR v_offer IS DISTINCT FROM p_snapshot->'offer' OR v_offer->>'revision' IS DISTINCT FROM p_plan#>>'{offer,revision}' THEN RAISE EXCEPTION 'checkout_quote_changed'; END IF;
 IF v_offer->'allowOnSite' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(v_offer->'cash') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'checkout_on_site_unavailable'; END IF;
 v_kind:=v_offer#>>'{source,kind}';
 IF (v_kind='booking') IS DISTINCT FROM (p_plan ? 'booking') OR (v_kind='order') IS DISTINCT FROM (p_plan ? 'order')
   OR v_kind IS NULL OR v_kind NOT IN ('booking','order') THEN RAISE EXCEPTION 'checkout_invalid_plan'; END IF;
 -- Exact physical vectors, stable source lock order, then original booking
 -- and order/member locks. A raw snapshot is never reconstructed from a DTO.
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
 IF clock_timestamp()>=v_deadline THEN RAISE EXCEPTION 'checkout_quote_expired'; END IF;
 PERFORM faolla_checkout_design.commit_on_site_pending(p_site_id,p_operation_key,p_principal_key,p_request_hash,p_plan,v_deadline);
 IF clock_timestamp()>=v_deadline THEN RAISE EXCEPTION 'checkout_quote_expired'; END IF;
 -- Detect a newer published-row insert during the inner write, and roll back
 -- the SAME transaction. Full publisher-writer protocol rollout is separate.
 IF faolla_checkout_design.submission_rows(p_site_id,true) IS DISTINCT FROM p_snapshot->'sourceRows' THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 RETURN jsonb_build_object('replayed',false,'result',public.faolla_member_checkout_on_site_result_v1(p_site_id,p_operation_key,p_principal_key));
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_on_site_snapshot_v1(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_on_site_commit_v1(text,text,text,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
