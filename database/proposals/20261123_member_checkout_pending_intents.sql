-- PRIVATE / UNINSTALLED PROPOSAL. No production registration, role grants,
-- flag activation, old writer replacement, Stripe or business-data migration.
-- Enrollment is default closed; already enrolled principals remain protected
-- even if new enrollment is disabled. No timeout auto-acknowledges an original.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
END;$$;
CREATE TABLE faolla_checkout_design.intent_pilots(
 site_id text PRIMARY KEY CHECK(site_id~'^[0-9]{8}$'),enabled boolean NOT NULL DEFAULT false
);
CREATE INDEX bundle_results_intent_principal ON faolla_checkout_design.bundle_results(site_id,principal_key,operation_key);
CREATE TABLE faolla_checkout_design.intent_claims(
 site_id text NOT NULL,principal_key text NOT NULL CHECK(principal_key~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'),
 generation bigint NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),operation_key text NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(site_id,operation_key),UNIQUE(site_id,principal_key,generation),
 FOREIGN KEY(site_id,operation_key) REFERENCES faolla_checkout_design.bundle_results(site_id,operation_key) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE faolla_checkout_design.intent_acknowledgements(
 site_id text NOT NULL,operation_key text NOT NULL,review_hash text NOT NULL CHECK(review_hash~'^[a-f0-9]{64}$'),
 acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(site_id,operation_key),
 FOREIGN KEY(site_id,operation_key) REFERENCES faolla_checkout_design.intent_claims(site_id,operation_key)
);
CREATE TRIGGER immutable_intent_claims BEFORE UPDATE OR DELETE ON faolla_checkout_design.intent_claims
 FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();
CREATE TRIGGER immutable_intent_acknowledgements BEFORE UPDATE OR DELETE ON faolla_checkout_design.intent_acknowledgements
 FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();
ALTER TABLE faolla_checkout_design.intent_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.intent_pilots FORCE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.intent_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.intent_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.intent_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.intent_acknowledgements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.intent_pilots,faolla_checkout_design.intent_claims,faolla_checkout_design.intent_acknowledgements FROM PUBLIC,anon,authenticated,service_role;

-- Every existing checkout receipt writer reaches this append point in the
-- SAME financial transaction and already uses the SAME site advisory lock.
-- A rejected second claim rolls back points/coupons/stock/order together.
CREATE FUNCTION faolla_checkout_design.claim_checkout_intent() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE last_claim faolla_checkout_design.intent_claims%rowtype;tracking boolean;
BEGIN
 IF TG_TABLE_SCHEMA<>'faolla_checkout_design' OR TG_TABLE_NAME<>'bundle_results' OR TG_OP<>'INSERT' THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 SELECT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=NEW.site_id AND enabled)
  OR EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims WHERE site_id=NEW.site_id AND principal_key=NEW.principal_key) INTO tracking;
 IF NOT tracking THEN RETURN NEW;END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||NEW.site_id,0));
 -- Hold enrollment row against changes until this transaction ends.
 PERFORM 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=NEW.site_id AND enabled FOR SHARE;
 IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims WHERE site_id=NEW.site_id AND principal_key=NEW.principal_key) THEN RETURN NEW;END IF;
 IF NEW.principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' OR NEW.resource_kind NOT IN ('booking','order')
  OR (NEW.receipt->'version'='1'::jsonb OR NEW.receipt->'version'='2'::jsonb AND NEW.receipt->>'method'='on_site'
   OR NEW.receipt->'version'='3'::jsonb AND NEW.receipt->>'purpose'='product_cart' AND NEW.resource_kind='order' AND NEW.receipt->>'method' IN ('points','on_site')) IS NOT TRUE
  THEN RAISE EXCEPTION 'checkout_intent_review_required';END IF;
 -- Untracked old originals are NEVER silently treated as acknowledged at
 -- cutover. No production ledger backfill or arbitrary "latest" choice here.
 IF EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_results b WHERE b.site_id=NEW.site_id AND b.principal_key=NEW.principal_key
  AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims tracked WHERE tracked.site_id=b.site_id AND tracked.operation_key=b.operation_key)) THEN RAISE EXCEPTION 'checkout_intent_review_required';END IF;
 SELECT * INTO last_claim FROM faolla_checkout_design.intent_claims WHERE site_id=NEW.site_id AND principal_key=NEW.principal_key ORDER BY generation DESC LIMIT 1;
 IF FOUND AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_acknowledgements a WHERE a.site_id=last_claim.site_id AND a.operation_key=last_claim.operation_key)
  THEN RAISE EXCEPTION 'checkout_original_pending';END IF;
 IF coalesce(last_claim.generation,0)>=9007199254740991 THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 INSERT INTO faolla_checkout_design.intent_claims(site_id,principal_key,generation,operation_key) VALUES(NEW.site_id,NEW.principal_key,coalesce(last_claim.generation,0)+1,NEW.operation_key);
 RETURN NEW;
END;
$$;
CREATE TRIGGER checkout_intent_claim BEFORE INSERT ON faolla_checkout_design.bundle_results
 FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.claim_checkout_intent();

-- Safe display projection, not a nonce, session proof, price override or raw
-- receipt hash. Includes the current review flag in the compare token.
CREATE FUNCTION faolla_checkout_design.intent_original_view(p_site_id text,p_operation_key text,p_principal_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype;r jsonb;row jsonb;original jsonb;
BEGIN
 SELECT * INTO b FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key AND principal_key=p_principal_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_intent_not_found';END IF;
 r:=public.faolla_member_checkout_reporting_v3(p_site_id,jsonb_build_array(jsonb_build_object('kind',b.resource_kind,'id',b.resource_id)));row:=r#>'{rows,0}';
 original:=public.faolla_member_checkout_original_resource_v2(p_site_id,b.resource_kind,b.resource_id,p_principal_key);
 IF original IS NULL OR row IS NULL OR (row->>'termsMatch')::boolean IS NULL THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 RETURN jsonb_build_object('original',original,'reviewRequired',NOT (row->>'termsMatch')::boolean OR
  CASE WHEN original->>'kind'='cart' THEN coalesce((original#>>'{result,reviewRequired}')::boolean,true) OR original#>'{result,resource}'='null'::jsonb
   ELSE original#>'{original,result,resource}'='null'::jsonb END);
END;
$$;
CREATE FUNCTION public.faolla_member_checkout_pending_intent_v1(p_site_id text,p_principal_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c faolla_checkout_design.intent_claims%rowtype;v jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 -- Do not return "none" from a pre-commit snapshot or hang behind a writer.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_intent_busy';END IF;
 IF EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_results b WHERE b.site_id=p_site_id AND b.principal_key=p_principal_key
  AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims tracked WHERE tracked.site_id=b.site_id AND tracked.operation_key=b.operation_key)) THEN RAISE EXCEPTION 'checkout_intent_review_required';END IF;
 IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=p_site_id AND enabled)
  AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND principal_key=p_principal_key) THEN RAISE EXCEPTION 'checkout_intent_disabled';END IF;
 SELECT * INTO c FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND principal_key=p_principal_key ORDER BY generation DESC LIMIT 1;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM faolla_checkout_design.intent_acknowledgements a WHERE a.site_id=c.site_id AND a.operation_key=c.operation_key) THEN RETURN jsonb_build_object('version',1,'siteId',p_site_id,'pending',NULL);END IF;
 v:=faolla_checkout_design.intent_original_view(p_site_id,c.operation_key,p_principal_key);
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'pending',jsonb_build_object('operationKey',c.operation_key,'generation',c.generation,
  'reviewHash',encode(sha256(convert_to(v::text,'UTF8')),'hex'),'original',v->'original','reviewRequired',v->'reviewRequired'));
END;
$$;
CREATE FUNCTION public.faolla_member_checkout_acknowledge_intent_v1(p_site_id text,p_operation_key text,p_principal_key text,p_generation bigint,p_review_hash text,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c faolla_checkout_design.intent_claims%rowtype;a faolla_checkout_design.intent_acknowledgements%rowtype;v jsonb;deadline timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_intent_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' OR p_generation IS NULL OR p_generation NOT BETWEEN 1 AND 9007199254740991
  OR p_review_hash IS NULL OR p_review_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 deadline:=p_not_after::timestamptz;
 IF deadline IS NULL OR NOT isfinite(deadline) OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '15 seconds' THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_intent_busy';END IF;
 SELECT * INTO c FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND operation_key=p_operation_key AND principal_key=p_principal_key AND generation=p_generation;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_intent_not_found';END IF;
 SELECT * INTO a FROM faolla_checkout_design.intent_acknowledgements WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN
  IF a.review_hash<>p_review_hash THEN RAISE EXCEPTION 'checkout_intent_changed';END IF;
  RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'generation',p_generation,'acknowledged',true,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims newer WHERE newer.site_id=p_site_id AND newer.principal_key=p_principal_key AND newer.generation>p_generation) THEN RAISE EXCEPTION 'checkout_intent_changed';END IF;
 v:=faolla_checkout_design.intent_original_view(p_site_id,p_operation_key,p_principal_key);
 IF (v->>'reviewRequired')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'checkout_intent_review_required';END IF;
 IF encode(sha256(convert_to(v::text,'UTF8')),'hex')<>p_review_hash THEN RAISE EXCEPTION 'checkout_intent_changed';END IF;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_intent_expired';END IF;
 INSERT INTO faolla_checkout_design.intent_acknowledgements(site_id,operation_key,review_hash) VALUES(p_site_id,p_operation_key,p_review_hash);
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'generation',p_generation,'acknowledged',true,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION faolla_checkout_design.claim_checkout_intent(),faolla_checkout_design.intent_original_view(text,text,text),
 public.faolla_member_checkout_pending_intent_v1(text,text),public.faolla_member_checkout_acknowledge_intent_v1(text,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
