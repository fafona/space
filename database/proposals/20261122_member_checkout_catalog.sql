-- LOCAL/ISOLATED PROPOSAL ONLY. Not registered for production migrations.
-- Configuration only: no booking, order, balance, coupons or stock are written.
-- No API roles are granted access. A separate reviewed rollout is required.
BEGIN;
CREATE TABLE faolla_checkout_design.catalog_versions (
 site_id text NOT NULL CHECK(site_id ~ '^[0-9]{8}$'), version uuid NOT NULL, previous_version uuid,
 actor_key text NOT NULL CHECK(actor_key ~ '^owner:[A-Za-z0-9_-]{8,128}$'), request_hash text NOT NULL,
 document jsonb NOT NULL CHECK((jsonb_typeof(document)='array' AND jsonb_array_length(document)<=100) IS TRUE),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(site_id,version),
 FOREIGN KEY(site_id,previous_version) REFERENCES faolla_checkout_design.catalog_versions(site_id,version)
);
CREATE TABLE faolla_checkout_design.catalog_heads (
 site_id text PRIMARY KEY, version uuid NOT NULL,
 FOREIGN KEY(site_id,version) REFERENCES faolla_checkout_design.catalog_versions(site_id,version)
);
CREATE TRIGGER immutable_catalog_versions BEFORE UPDATE OR DELETE ON faolla_checkout_design.catalog_versions
 FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();
CREATE FUNCTION public.faolla_member_checkout_catalog_snapshot_v1(p_site_id text) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
 DECLARE v_head uuid; v_document jsonb;
 BEGIN
  IF p_site_id IS NULL OR p_site_id !~ '^[0-9]{8}$' THEN RAISE EXCEPTION 'checkout_configuration_invalid'; END IF;
  SELECT h.version,v.document INTO v_head,v_document FROM faolla_checkout_design.catalog_heads h
   JOIN faolla_checkout_design.catalog_versions v ON v.site_id=h.site_id AND v.version=h.version WHERE h.site_id=p_site_id;
  RETURN jsonb_build_object('version',v_head,'offers',coalesce(v_document,'[]'::jsonb));
 END;
$$;
CREATE FUNCTION public.faolla_member_checkout_catalog_save_v1(p_site_id text,p_expected_version uuid,p_next_version uuid,p_actor_key text,p_offer jsonb)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
 DECLARE v_head uuid; v_previous faolla_checkout_design.catalog_versions%rowtype;
  v_offer_id uuid; v_offer_revision uuid; v_old jsonb; v_document jsonb; v_hash text;
 BEGIN
  IF p_site_id IS NULL OR p_site_id !~ '^[0-9]{8}$' OR p_next_version IS NULL OR p_next_version IS NOT DISTINCT FROM p_expected_version
   OR p_actor_key IS NULL OR p_actor_key !~ '^owner:[A-Za-z0-9_-]{8,128}$'
   OR jsonb_typeof(p_offer) IS DISTINCT FROM 'object' OR octet_length(p_offer::text)>32768
   OR p_offer->>'siteId' IS DISTINCT FROM p_site_id OR p_offer->'version' IS DISTINCT FROM '1'::jsonb
   OR p_offer->>'id' IS NULL OR p_offer->>'revision' IS NULL
   OR jsonb_typeof(p_offer->'enabled') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(p_offer->'couponReturnOnCancel') IS DISTINCT FROM 'boolean'
   OR p_offer#>>'{checkoutBinding,sourceKey}' IS NULL OR p_offer#>>'{checkoutBinding,sourceKey}' !~ '^[a-f0-9]{64}$'
   OR p_offer#>>'{checkoutBinding,sourceVersion}' IS NULL OR p_offer#>>'{checkoutBinding,sourceVersion}' !~ '^[a-f0-9]{64}$'
   OR p_offer#>>'{source,kind}' IS NULL OR p_offer#>>'{source,kind}' NOT IN ('booking','order') THEN RAISE EXCEPTION 'checkout_configuration_invalid'; END IF;
  v_offer_id := (p_offer->>'id')::uuid; v_offer_revision := (p_offer->>'revision')::uuid;
  v_hash := encode(sha256(convert_to(jsonb_build_object('previousVersion',p_expected_version,'offer',p_offer)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('faolla-member-checkout-config:'||p_site_id,0));
  SELECT * INTO v_previous FROM faolla_checkout_design.catalog_versions WHERE site_id=p_site_id AND version=p_next_version;
  IF FOUND THEN
   IF v_previous.actor_key<>p_actor_key OR v_previous.request_hash<>v_hash THEN RAISE EXCEPTION 'checkout_configuration_conflict'; END IF;
   RETURN jsonb_build_object('version',v_previous.version,'offers',v_previous.document);
  END IF;
  SELECT version INTO v_head FROM faolla_checkout_design.catalog_heads WHERE site_id=p_site_id FOR UPDATE;
  IF v_head IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'checkout_configuration_conflict'; END IF;
  SELECT snapshot INTO v_old FROM faolla_checkout_design.offer_heads h JOIN faolla_checkout_design.offer_versions v USING(site_id,offer_id,revision)
   WHERE h.site_id=p_site_id AND h.offer_id=v_offer_id;
  IF v_old IS NOT NULL AND v_old#>>'{checkoutBinding,sourceKey}' IS DISTINCT FROM p_offer#>>'{checkoutBinding,sourceKey}' THEN RAISE EXCEPTION 'checkout_source_rebinding_forbidden'; END IF;
  IF EXISTS(SELECT 1 FROM faolla_checkout_design.offer_heads h JOIN faolla_checkout_design.offer_versions v USING(site_id,offer_id,revision)
    WHERE h.site_id=p_site_id AND h.offer_id<>v_offer_id AND v.snapshot#>>'{checkoutBinding,sourceKey}'=p_offer#>>'{checkoutBinding,sourceKey}') THEN RAISE EXCEPTION 'checkout_source_already_configured'; END IF;
  IF v_old IS NULL AND (SELECT count(*) FROM faolla_checkout_design.offer_heads WHERE site_id=p_site_id)>=100 THEN RAISE EXCEPTION 'checkout_configuration_limit'; END IF;
  INSERT INTO faolla_checkout_design.offer_versions(site_id,offer_id,revision,source_kind,source_key,snapshot)
   VALUES(p_site_id,v_offer_id,v_offer_revision,p_offer#>>'{source,kind}',p_offer#>>'{checkoutBinding,sourceKey}',p_offer);
  INSERT INTO faolla_checkout_design.offer_heads VALUES(p_site_id,v_offer_id,v_offer_revision,(p_offer->>'enabled')::boolean)
   ON CONFLICT(site_id,offer_id) DO UPDATE SET revision=EXCLUDED.revision,enabled=EXCLUDED.enabled;
  SELECT coalesce(jsonb_agg(v.snapshot ORDER BY h.offer_id),'[]'::jsonb) INTO v_document
   FROM faolla_checkout_design.offer_heads h JOIN faolla_checkout_design.offer_versions v USING(site_id,offer_id,revision) WHERE h.site_id=p_site_id;
  INSERT INTO faolla_checkout_design.catalog_versions VALUES(p_site_id,p_next_version,p_expected_version,p_actor_key,v_hash,v_document,clock_timestamp());
  INSERT INTO faolla_checkout_design.catalog_heads VALUES(p_site_id,p_next_version)
   ON CONFLICT(site_id) DO UPDATE SET version=EXCLUDED.version;
  RETURN jsonb_build_object('version',p_next_version,'offers',v_document);
 END;
$$;
ALTER TABLE faolla_checkout_design.catalog_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.catalog_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.catalog_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.catalog_heads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.catalog_versions,faolla_checkout_design.catalog_heads FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_catalog_snapshot_v1(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_catalog_save_v1(text,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
