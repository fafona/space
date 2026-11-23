-- UNINSTALLED PRIVATE PROPOSAL. Preserve the original booking CAS, ledger,
-- backup and notification outbox. No receipt adoption or financial write.
BEGIN;
CREATE FUNCTION public.faolla_checkout_legacy_booking_commit_v1(p_site_id text,p_command_key text,p_request_hash text,p_mutation jsonb,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE deadline timestamptz;rec jsonb;principal text;before_records jsonb;last_claim faolla_checkout_design.intent_claims%rowtype;control public.faolla_booking_atomic_control%rowtype;result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_command_key IS NULL OR p_command_key!~'^[a-f0-9]{64}$'
  OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'booking_atomic_invalid_command';END IF;
 deadline:=p_not_after::timestamptz;
 IF deadline IS NULL OR NOT isfinite(deadline) OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '15 seconds' THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 SELECT * INTO STRICT control FROM public.faolla_booking_atomic_control WHERE singleton FOR UPDATE;
 IF NOT control.active OR control.protocol<>2 THEN RAISE EXCEPTION 'booking_atomic_inactive';END IF;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 -- A same-command replay remains the original read, including original key
 -- reuse validation. Pending intent never forces the caller to create again.
 IF NOT EXISTS(SELECT 1 FROM public.faolla_booking_atomic_commands WHERE site_id=p_site_id AND command_key=p_command_key) THEN
  IF jsonb_typeof(p_mutation) IS DISTINCT FROM 'object' OR jsonb_typeof(p_mutation#>'{next,records}') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'booking_atomic_invalid_mutation';END IF;
  SELECT r#>'{blocks,records}' INTO before_records FROM jsonb_array_elements(public.faolla_booking_atomic_rows_v1()) r WHERE r->>'slug'='__merchant_booking_records__:v1';
  IF jsonb_typeof(before_records) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'booking_atomic_store_corrupt';END IF;
  FOR rec IN SELECT n FROM jsonb_array_elements(p_mutation#>'{next,records}') n WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(before_records) o WHERE o->>'id'=n->>'id') LOOP
   IF rec->>'siteId' IS DISTINCT FROM p_site_id THEN RAISE EXCEPTION 'booking_atomic_scope_violation';END IF;
   IF coalesce(rec->>'customerAccountId','')!~'^[0-9]{8}$' OR coalesce(rec->>'customerUserId','')!~'^[A-Za-z0-9_-]{8,128}$' THEN CONTINUE;END IF;
   principal:='account:'||(rec->>'customerAccountId')||':'||(rec->>'customerUserId');
   PERFORM 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;
   IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND principal_key=principal) THEN CONTINUE;END IF;
   IF EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_results b WHERE b.site_id=p_site_id AND b.principal_key=principal
    AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims c WHERE c.site_id=b.site_id AND c.operation_key=b.operation_key)) THEN RAISE EXCEPTION 'checkout_intent_review_required';END IF;
   SELECT * INTO last_claim FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND principal_key=principal ORDER BY generation DESC LIMIT 1;
   IF FOUND AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_acknowledgements a WHERE a.site_id=last_claim.site_id AND a.operation_key=last_claim.operation_key) THEN RAISE EXCEPTION 'checkout_original_pending';END IF;
  END LOOP;
 END IF;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 result:=public.faolla_booking_atomic_commit_v1(p_site_id,p_command_key,p_request_hash,p_mutation);
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_checkout_legacy_booking_commit_v1(text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
