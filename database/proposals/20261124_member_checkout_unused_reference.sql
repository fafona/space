-- PRIVATE, UNINSTALLED. Explicitly close an exact nonce which never committed.
-- Not a cancellation/refund, local-storage deletion, migration or role grant.
BEGIN;
CREATE TABLE faolla_checkout_design.unused_reference_pilots(
 site_id text PRIMARY KEY CHECK(site_id~'^[0-9]{8}$'),enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE faolla_checkout_design.closed_unused_references(
 site_id text NOT NULL CHECK(site_id~'^[0-9]{8}$'),operation_key text NOT NULL CHECK(operation_key~'^[a-f0-9]{64}$'),
 principal_key text NOT NULL CHECK(principal_key~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'),
 review_hash text NOT NULL CHECK(review_hash~'^[a-f0-9]{64}$'),closed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(site_id,operation_key)
);
ALTER TABLE faolla_checkout_design.unused_reference_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.unused_reference_pilots FORCE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.closed_unused_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.closed_unused_references FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.unused_reference_pilots,faolla_checkout_design.closed_unused_references FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_closed_unused_references BEFORE UPDATE OR DELETE ON faolla_checkout_design.closed_unused_references
 FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();

-- Existing trusted financial writers reach this append in the SAME atomic
-- transaction after the SAME site lock. A late write must roll back ALL effects.
-- Trigger-only definer: direct callers gain no private schema/table privileges.
CREATE FUNCTION faolla_checkout_design.guard_closed_unused_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_SCHEMA<>'faolla_checkout_design' OR TG_TABLE_NAME<>'bundle_results' OR TG_OP<>'INSERT'
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_unused_unavailable';END IF;
 -- Never wait in an inverted lock order, including a direct old append.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||NEW.site_id,0)) THEN RAISE EXCEPTION 'checkout_unused_busy';END IF;
 -- Independent of pilot closure: an already closed key can NEVER be reused.
 IF EXISTS(SELECT 1 FROM faolla_checkout_design.closed_unused_references WHERE site_id=NEW.site_id AND operation_key=NEW.operation_key)
  THEN RAISE EXCEPTION 'checkout_reference_closed';END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER checkout_closed_unused_reference BEFORE INSERT ON faolla_checkout_design.bundle_results
 FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.guard_closed_unused_reference();

CREATE FUNCTION public.faolla_member_checkout_unused_reference_review_v1(p_site_id text,p_operation_key text,p_principal_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c faolla_checkout_design.closed_unused_references%rowtype;b faolla_checkout_design.bundle_results%rowtype;token text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_unused_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_unused_busy';END IF;
 IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.unused_reference_pilots WHERE site_id=p_site_id AND enabled)
  OR NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=p_site_id AND enabled) THEN RAISE EXCEPTION 'checkout_unused_disabled';END IF;
 SELECT * INTO b FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN
  IF b.principal_key<>p_principal_key THEN RAISE EXCEPTION 'checkout_unused_unavailable';END IF;
  RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'state','original','reviewHash',NULL,'closedAt',NULL);
 END IF;
 IF EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims WHERE site_id=p_site_id AND operation_key=p_operation_key) THEN RAISE EXCEPTION 'checkout_unused_unavailable';END IF;
 token:=encode(sha256(convert_to(jsonb_build_array('unused-reference-v1',p_site_id,p_operation_key,p_principal_key)::text,'UTF8')),'hex');
 SELECT * INTO c FROM faolla_checkout_design.closed_unused_references WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND AND (c.principal_key<>p_principal_key OR c.review_hash<>token) THEN RAISE EXCEPTION 'checkout_unused_unavailable';END IF;
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'state',CASE WHEN c.operation_key IS NULL THEN 'unused' ELSE 'closed' END,
  'reviewHash',token,'closedAt',c.closed_at);
END;
$$;

CREATE FUNCTION public.faolla_member_checkout_close_unused_reference_v1(p_site_id text,p_operation_key text,p_principal_key text,p_review_hash text,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v jsonb;c faolla_checkout_design.closed_unused_references%rowtype;deadline timestamptz;replayed boolean;
BEGIN
 IF p_review_hash IS NULL OR p_review_hash!~'^[a-f0-9]{64}$' OR p_not_after IS NULL OR octet_length(p_not_after)>64 THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 deadline:=p_not_after::timestamptz;
 IF NOT isfinite(deadline) OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '15 seconds' THEN RAISE EXCEPTION 'checkout_unused_expired';END IF;
 -- Re-read under the same transaction lock. A prior READ proving "unused"
 -- alone is never sufficient, and a writer currently holding the lock wins.
 v:=public.faolla_member_checkout_unused_reference_review_v1(p_site_id,p_operation_key,p_principal_key);
 PERFORM 1 FROM faolla_checkout_design.unused_reference_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_unused_disabled';END IF;
 PERFORM 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=p_site_id AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_unused_disabled';END IF;
 IF v->>'state'='original' THEN RAISE EXCEPTION 'checkout_original_exists';END IF;
 IF v->>'reviewHash' IS DISTINCT FROM p_review_hash THEN RAISE EXCEPTION 'checkout_unused_changed';END IF;
 replayed:=v->>'state'='closed';
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_unused_expired';END IF;
 IF NOT replayed THEN INSERT INTO faolla_checkout_design.closed_unused_references(site_id,operation_key,principal_key,review_hash)
  VALUES(p_site_id,p_operation_key,p_principal_key,p_review_hash);END IF;
 SELECT * INTO STRICT c FROM faolla_checkout_design.closed_unused_references WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_unused_expired';END IF;
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'closed',true,'replayed',replayed,'reviewHash',c.review_hash,'closedAt',c.closed_at);
END;
$$;
REVOKE ALL ON FUNCTION faolla_checkout_design.guard_closed_unused_reference(),
 public.faolla_member_checkout_unused_reference_review_v1(text,text,text),public.faolla_member_checkout_close_unused_reference_v1(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
