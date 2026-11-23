-- UNINSTALLED PRIVATE PROPOSAL. Load before the unpublished cart result
-- proposal. Does not replace the proven single-offer collector or its guard.
BEGIN;
CREATE TABLE faolla_checkout_design.cart_collection_pilots(
 site_id text PRIMARY KEY CHECK(site_id~'^[0-9]{8}$'),enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE faolla_checkout_design.cart_collections(
 site_id text NOT NULL CHECK(site_id~'^[0-9]{8}$'),operation_key text NOT NULL CHECK(operation_key~'^[a-f0-9]{64}$'),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 99999999),currency text NOT NULL CHECK(currency='eur'),
 actor_key text NOT NULL CHECK(actor_key~'^owner:[A-Za-z0-9_-]{8,128}$'),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(site_id,operation_key),FOREIGN KEY(site_id,operation_key) REFERENCES faolla_checkout_design.bundle_results(site_id,operation_key)
);
CREATE FUNCTION faolla_checkout_design.guard_cart_collection() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype;v jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||NEW.site_id,0));
 PERFORM 1 FROM faolla_checkout_design.cart_collection_pilots WHERE site_id=NEW.site_id AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_disabled';END IF;
 SELECT * INTO b FROM faolla_checkout_design.bundle_results WHERE site_id=NEW.site_id AND operation_key=NEW.operation_key;
 IF NOT FOUND OR b.resource_kind<>'order' OR b.receipt->'version' IS DISTINCT FROM '3'::jsonb OR b.receipt->>'purpose' IS DISTINCT FROM 'product_cart'
  OR b.receipt->>'method' IS DISTINCT FROM 'on_site' OR b.receipt->'capturedMinor' IS DISTINCT FROM '0'::jsonb
  OR b.receipt->'totalPoints' IS DISTINCT FROM 'null'::jsonb OR b.receipt->>'currency' IS DISTINCT FROM NEW.currency
  OR (b.receipt->>'dueMinor')::bigint IS DISTINCT FROM NEW.amount_minor
  OR EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_cancellations WHERE site_id=NEW.site_id AND operation_key=NEW.operation_key)
  OR EXISTS(SELECT 1 FROM faolla_checkout_design.on_site_collections WHERE site_id=NEW.site_id AND operation_key=NEW.operation_key)
  THEN RAISE EXCEPTION 'checkout_collection_not_allowed';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||NEW.site_id,0));
 PERFORM 1 FROM public.pages WHERE merchant_id=NEW.site_id AND (slug='__merchant_orders__:'||NEW.site_id OR slug~('^__merchant_orders__:'||NEW.site_id||':chunk:[0-9]+$')) ORDER BY slug,id FOR UPDATE;
 v:=public.faolla_member_checkout_cart_result_v1(NEW.site_id,NEW.operation_key,b.principal_key);
 IF v IS NULL OR v->'reviewRequired' IS DISTINCT FROM 'false'::jsonb OR v->'closed' IS DISTINCT FROM 'false'::jsonb
  OR coalesce(v#>>'{resource,status}','') NOT IN ('pending','confirmed','completed') THEN RAISE EXCEPTION 'checkout_collection_review_required';END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
CREATE FUNCTION faolla_checkout_design.guard_cart_collected_cancel() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||NEW.site_id,0));
 IF EXISTS(SELECT 1 FROM faolla_checkout_design.cart_collections WHERE site_id=NEW.site_id AND operation_key=NEW.operation_key) THEN RAISE EXCEPTION 'checkout_refund_required';END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER validate_cart_collection BEFORE INSERT ON faolla_checkout_design.cart_collections FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.guard_cart_collection();
CREATE TRIGGER immutable_cart_collection BEFORE UPDATE OR DELETE ON faolla_checkout_design.cart_collections FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();
CREATE TRIGGER prevent_collected_cart_cancel BEFORE INSERT ON faolla_checkout_design.bundle_cancellations FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.guard_cart_collected_cancel();
ALTER TABLE faolla_checkout_design.cart_collection_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.cart_collection_pilots FORCE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.cart_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.cart_collections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.cart_collection_pilots,faolla_checkout_design.cart_collections FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.faolla_checkout_cart_collect_v1(p_site_id text,p_operation_key text,p_actor_key text,p_expected_updated_at text,p_expected_due_minor bigint,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype;k faolla_checkout_design.cart_collections%rowtype;v jsonb;deadline timestamptz;replayed boolean:=false;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_actor_key IS NULL OR p_actor_key!~'^owner:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_unauthorized';END IF;
 deadline:=p_not_after::timestamptz;
 IF deadline IS NULL OR NOT isfinite(deadline) OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '15 seconds' THEN RAISE EXCEPTION 'checkout_conflict';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_conflict';END IF;
 SELECT * INTO b FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_not_found';END IF;
 IF b.resource_kind<>'order' OR b.receipt->'version' IS DISTINCT FROM '3'::jsonb OR b.receipt->>'purpose' IS DISTINCT FROM 'product_cart'
  OR b.receipt->>'method' IS DISTINCT FROM 'on_site' OR b.receipt->>'currency' IS DISTINCT FROM 'eur'
  OR p_expected_due_minor IS NULL OR p_expected_due_minor NOT BETWEEN 1 AND 99999999 OR (b.receipt->>'dueMinor')::bigint IS DISTINCT FROM p_expected_due_minor THEN RAISE EXCEPTION 'checkout_collection_not_allowed';END IF;
 SELECT * INTO k FROM faolla_checkout_design.cart_collections WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF FOUND THEN replayed:=true;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0));
  PERFORM 1 FROM public.pages WHERE merchant_id=p_site_id AND (slug='__merchant_orders__:'||p_site_id OR slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$')) ORDER BY slug,id FOR UPDATE;
  v:=public.faolla_member_checkout_cart_result_v1(p_site_id,p_operation_key,b.principal_key);
  IF v IS NULL OR v->'reviewRequired' IS DISTINCT FROM 'false'::jsonb OR v->'closed' IS DISTINCT FROM 'false'::jsonb
   OR coalesce(v#>>'{resource,status}','') NOT IN ('pending','confirmed','completed') THEN RAISE EXCEPTION 'checkout_collection_review_required';END IF;
  IF p_expected_updated_at IS NULL OR v#>>'{resource,updatedAt}' IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'checkout_conflict';END IF;
  IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_conflict';END IF;
  INSERT INTO faolla_checkout_design.cart_collections(site_id,operation_key,amount_minor,currency,actor_key) VALUES(p_site_id,p_operation_key,p_expected_due_minor,'eur',p_actor_key) RETURNING * INTO k;
 END IF;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_conflict';END IF;
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',p_operation_key,'resourceKind','order','resourceId',b.resource_id,'replayed',replayed,'amountMinor',k.amount_minor,'currency',k.currency,'recordedAt',k.recorded_at);
END;
$$;
CREATE FUNCTION public.faolla_checkout_cart_collection_read_v1(p_site_id text,p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'checkout_unauthorized';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_unavailable';END IF;
 SELECT * INTO b FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF NOT FOUND OR b.receipt->'version' IS DISTINCT FROM '3'::jsonb OR b.receipt->>'purpose' IS DISTINCT FROM 'product_cart' OR b.resource_kind<>'order' THEN RETURN NULL;END IF;
 RETURN public.faolla_member_checkout_cart_result_v1(p_site_id,p_operation_key,b.principal_key);
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_checkout_cart_collect_v1(text,text,text,text,bigint,text),faolla_checkout_design.guard_cart_collection(),faolla_checkout_design.guard_cart_collected_cancel() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.faolla_checkout_cart_collection_read_v1(text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
