-- DESIGN / ISOLATED-TEST SCHEMA ONLY. NOT A PRODUCTION MIGRATION.
-- No existing booking, order, membership, points, configuration or business row
-- is read or changed. There are deliberately NO exposed RPCs or role grants.
-- The future cross-domain commit must be proved against the original booking
-- generation/CAS and membership/stock writers before any production activation.
BEGIN;
CREATE SCHEMA faolla_checkout_design;
REVOKE ALL ON SCHEMA faolla_checkout_design FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE faolla_checkout_design.offer_versions (
  site_id text NOT NULL CHECK (site_id ~ '^[0-9]{8}$'),
  offer_id uuid NOT NULL,
  revision uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('booking','order')),
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 180),
  snapshot jsonb NOT NULL CHECK ((jsonb_typeof(snapshot) = 'object'
    AND snapshot->>'siteId' = site_id AND snapshot->>'id' = offer_id::text
    AND snapshot->>'revision' = revision::text AND snapshot->>'version' = '1'
    AND snapshot->'source'->>'kind' = source_kind) IS TRUE),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (site_id,offer_id,revision),
  UNIQUE (site_id,offer_id,revision,source_kind)
);
CREATE TABLE faolla_checkout_design.offer_heads (
  site_id text NOT NULL,
  offer_id uuid NOT NULL,
  revision uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (site_id,offer_id),
  FOREIGN KEY (site_id,offer_id,revision) REFERENCES faolla_checkout_design.offer_versions
);
CREATE TABLE faolla_checkout_design.settlements (
  site_id text NOT NULL CHECK (site_id ~ '^[0-9]{8}$'),
  operation_key text NOT NULL CHECK (operation_key ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  principal_key text NOT NULL CHECK (length(principal_key) BETWEEN 8 AND 512),
  offer_id uuid NOT NULL,
  offer_revision uuid NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('booking','order')),
  resource_id text NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 180),
  method text NOT NULL CHECK (method IN ('online','points','on_site')),
  currency text,
  total_minor bigint,
  initial_due_minor bigint,
  total_points bigint,
  coupon_count integer NOT NULL DEFAULT 0 CHECK (coupon_count BETWEEN 0 AND 20),
  coupon_return_on_cancel boolean,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','committed','cancelled')),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (site_id,operation_key),
  UNIQUE (site_id,resource_kind,resource_id),
  FOREIGN KEY (site_id,offer_id,offer_revision,resource_kind) REFERENCES faolla_checkout_design.offer_versions(site_id,offer_id,revision,source_kind),
  CHECK ((coupon_count = 0 OR coupon_return_on_cancel IS NOT NULL) IS TRUE),
  CHECK (((method = 'points' AND total_points BETWEEN 0 AND 99999999 AND (total_points>0 OR coupon_count>0)
      AND currency IS NULL AND total_minor IS NULL AND initial_due_minor IS NULL)
    OR (method IN ('online','on_site') AND currency = 'eur' AND total_minor BETWEEN 1 AND 99999999
      AND initial_due_minor BETWEEN 1 AND total_minor AND total_points IS NULL)
    OR (method='on_site' AND currency='eur' AND total_minor=0 AND initial_due_minor=0 AND total_points IS NULL AND coupon_count>0)) IS TRUE),
  CHECK (((state = 'committed' AND jsonb_typeof(receipt) = 'object') OR (state <> 'committed' AND receipt IS NULL)) IS TRUE)
);
CREATE TABLE faolla_checkout_design.facts (
  id uuid PRIMARY KEY,
  site_id text NOT NULL,
  operation_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cash_captured','cash_refunded','points_debited','points_returned')),
  amount_minor bigint,
  points bigint,
  provider_scope text NOT NULL CHECK (length(provider_scope) BETWEEN 1 AND 180),
  provider_reference text NOT NULL CHECK (length(provider_reference) BETWEEN 1 AND 180),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (site_id,operation_key) REFERENCES faolla_checkout_design.settlements,
  UNIQUE (provider_scope,provider_reference),
  CHECK (((kind IN ('cash_captured','cash_refunded') AND amount_minor BETWEEN 1 AND 99999999 AND points IS NULL)
    OR (kind IN ('points_debited','points_returned') AND points BETWEEN 1 AND 99999999 AND amount_minor IS NULL)) IS TRUE)
);
CREATE UNIQUE INDEX one_initial_points_debit ON faolla_checkout_design.facts(site_id,operation_key) WHERE kind = 'points_debited';

CREATE FUNCTION faolla_checkout_design.reject_historical_change() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'checkout_history_immutable';
END;
$$;
CREATE TRIGGER immutable_offer_versions BEFORE UPDATE OR DELETE ON faolla_checkout_design.offer_versions
FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();
CREATE TRIGGER immutable_facts BEFORE UPDATE OR DELETE ON faolla_checkout_design.facts
FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();

CREATE FUNCTION faolla_checkout_design.guard_settlement_change() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state <> 'pending'
    OR (to_jsonb(NEW) - 'state' - 'updated_at' - 'receipt') <> (to_jsonb(OLD) - 'state' - 'updated_at' - 'receipt')
    OR NEW.state NOT IN ('committed','cancelled') THEN
    RAISE EXCEPTION 'checkout_operation_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_checkout_intent BEFORE UPDATE OR DELETE ON faolla_checkout_design.settlements
FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.guard_settlement_change();

CREATE FUNCTION faolla_checkout_design.guard_fact_method() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE v_method text;
BEGIN
  SELECT method INTO v_method FROM faolla_checkout_design.settlements
    WHERE site_id = NEW.site_id AND operation_key = NEW.operation_key FOR KEY SHARE;
  IF v_method IS NULL OR ((NEW.kind IN ('points_debited','points_returned')) <> (v_method = 'points')) THEN
    RAISE EXCEPTION 'checkout_fact_method_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER financial_units_match BEFORE INSERT ON faolla_checkout_design.facts
FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.guard_fact_method();

ALTER TABLE faolla_checkout_design.offer_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.offer_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.offer_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.offer_heads FORCE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.settlements FORCE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.facts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA faolla_checkout_design FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA faolla_checkout_design FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA faolla_checkout_design REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA faolla_checkout_design REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
