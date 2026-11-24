-- PRIVATE, UNINSTALLED. Exact, explicitly reviewed historical-original
-- registration only. No original repair, financial action, ack or role grants.
BEGIN;
CREATE TABLE faolla_checkout_design.retained_intent_registrations(
 site_id text NOT NULL,operation_key text NOT NULL,review_hash text NOT NULL CHECK(review_hash~'^[a-f0-9]{64}$'),
 registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(site_id,operation_key),
 FOREIGN KEY(site_id,operation_key) REFERENCES faolla_checkout_design.intent_claims(site_id,operation_key)
);
ALTER TABLE faolla_checkout_design.retained_intent_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.retained_intent_registrations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.retained_intent_registrations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_retained_intent_registrations BEFORE UPDATE OR DELETE ON faolla_checkout_design.retained_intent_registrations
 FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();
CREATE FUNCTION public.faolla_member_checkout_retained_intent_review_v1(p_site_id text,p_operation_key text,p_principal_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_intent_busy';END IF;
 IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=p_site_id AND enabled) THEN RAISE EXCEPTION 'checkout_intent_disabled';END IF;
 IF EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key AND principal_key=p_principal_key) THEN
  v:=faolla_checkout_design.intent_original_view(p_site_id,p_operation_key,p_principal_key);
 END IF;
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'proposal',
  CASE WHEN v IS NULL THEN NULL ELSE jsonb_build_object('reviewHash',encode(sha256(convert_to(v::text,'UTF8')),'hex'),'original',v->'original','reviewRequired',v->'reviewRequired') END);
END;
$$;
CREATE FUNCTION public.faolla_member_checkout_register_retained_intent_v1(p_site_id text,p_operation_key text,p_principal_key text,p_review_hash text,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v jsonb;c faolla_checkout_design.intent_claims%rowtype;last_generation bigint;replayed boolean;deadline timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
  OR p_review_hash IS NULL OR p_review_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 deadline:=p_not_after::timestamptz;
 IF deadline IS NULL OR NOT isfinite(deadline) OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '15 seconds' THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_intent_busy';END IF;
 -- Serialize enrollment closure too; never recreate enrollment or an original.
 PERFORM 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_intent_disabled';END IF;
 IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key AND principal_key=p_principal_key) THEN RAISE EXCEPTION 'checkout_intent_not_found';END IF;
 v:=faolla_checkout_design.intent_original_view(p_site_id,p_operation_key,p_principal_key);
 IF (v->>'reviewRequired')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'checkout_intent_review_required';END IF;
 IF encode(sha256(convert_to(v::text,'UTF8')),'hex')<>p_review_hash THEN RAISE EXCEPTION 'checkout_intent_changed';END IF;
 SELECT * INTO c FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND operation_key=p_operation_key AND principal_key=p_principal_key;
 replayed:=FOUND;
 IF NOT replayed THEN
  IF EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims pending WHERE pending.site_id=p_site_id AND pending.principal_key=p_principal_key
   AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_acknowledgements a WHERE a.site_id=pending.site_id AND a.operation_key=pending.operation_key)) THEN RAISE EXCEPTION 'checkout_original_pending';END IF;
  SELECT coalesce(max(generation),0) INTO last_generation FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND principal_key=p_principal_key;
  IF last_generation>=9007199254740991 THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
  IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
  INSERT INTO faolla_checkout_design.intent_claims(site_id,principal_key,generation,operation_key)
   VALUES(p_site_id,p_principal_key,last_generation+1,p_operation_key) RETURNING * INTO c;
  INSERT INTO faolla_checkout_design.retained_intent_registrations(site_id,operation_key,review_hash) VALUES(p_site_id,p_operation_key,p_review_hash);
 END IF;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'replayed',replayed,'review',jsonb_build_object('operationKey',p_operation_key,
  'generation',c.generation,'reviewHash',p_review_hash,'original',v->'original','reviewRequired',false,
  'acknowledged',EXISTS(SELECT 1 FROM faolla_checkout_design.intent_acknowledgements WHERE site_id=p_site_id AND operation_key=p_operation_key)));
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_retained_intent_review_v1(text,text,text),
 public.faolla_member_checkout_register_retained_intent_v1(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
