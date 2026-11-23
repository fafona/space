-- UNINSTALLED PRIVATE PROPOSAL. No production registry, role grant or rollout.
-- Append-only audit and a final-state constraint, not a session-variable bypass.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'checkout_guard_owner_invalid';
 END IF;
END; $$;
CREATE TABLE faolla_checkout_design.merchant_cancellation_actors (
 site_id text NOT NULL,operation_key text NOT NULL,actor_key text NOT NULL CHECK(actor_key ~ '^owner:[A-Za-z0-9_-]{8,128}$'),
 PRIMARY KEY(site_id,operation_key),
 FOREIGN KEY(site_id,operation_key) REFERENCES faolla_checkout_design.bundle_cancellations(site_id,operation_key)
);
CREATE TRIGGER immutable_merchant_cancellation_actors BEFORE UPDATE OR DELETE ON faolla_checkout_design.merchant_cancellation_actors
FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();
ALTER TABLE faolla_checkout_design.merchant_cancellation_actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.merchant_cancellation_actors FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.merchant_cancellation_actors FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.faolla_checkout_resource_link_v1(p_site_id text,p_kind text,p_id text,p_principal_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype; rec jsonb; n integer;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('booking','order') OR p_id IS NULL OR p_id !~ '^[A-Za-z0-9:_-]{1,160}$'
  OR p_site_id IS NOT NULL AND p_site_id !~ '^[0-9]{8}$'
  OR p_principal_key IS NOT NULL AND p_principal_key !~ '^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
  OR p_site_id IS NULL AND (p_kind<>'booking' OR p_principal_key IS NULL) THEN RAISE EXCEPTION 'checkout_unauthorized'; END IF;
 SELECT count(*) INTO n FROM faolla_checkout_design.bundle_results WHERE resource_kind=p_kind AND resource_id=p_id AND (p_site_id IS NULL OR site_id=p_site_id);
 IF n=0 THEN RETURN NULL; END IF;
 IF n<>1 THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
 SELECT * INTO STRICT b FROM faolla_checkout_design.bundle_results WHERE resource_kind=p_kind AND resource_id=p_id AND (p_site_id IS NULL OR site_id=p_site_id);
 IF p_principal_key IS NOT NULL AND b.principal_key IS DISTINCT FROM p_principal_key THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
 WITH source AS (
  SELECT p.blocks->'records' AS records FROM public.pages p WHERE p_kind='booking' AND p.slug='__merchant_booking_records__:v1'
  UNION ALL
  SELECT p.blocks FROM public.pages p WHERE p_kind='order' AND p.merchant_id=b.site_id
   AND (p.slug~('^__merchant_orders__:'||b.site_id||':chunk:[0-9]+$') OR p.slug='__merchant_orders__:'||b.site_id
    AND NOT EXISTS(SELECT 1 FROM public.pages c WHERE c.merchant_id=b.site_id AND c.slug~('^__merchant_orders__:'||b.site_id||':chunk:[0-9]+$')))
 ), matches AS (SELECT r FROM source s CROSS JOIN LATERAL jsonb_array_elements(s.records) r WHERE r->>'id'=p_id AND r->>'siteId'=b.site_id)
 SELECT count(*),CASE WHEN count(*)=1 THEN (jsonb_agg(r))->0 ELSE NULL END INTO n,rec FROM matches;
 IF n<>1 OR rec->>'customerAccountId' IS DISTINCT FROM split_part(b.principal_key,':',2)
  OR rec->>'customerUserId' IS DISTINCT FROM split_part(b.principal_key,':',3) THEN RAISE EXCEPTION 'checkout_cancellation_review_required'; END IF;
 RETURN jsonb_build_object('siteId',b.site_id,'kind',p_kind,'id',p_id,'operationKey',b.operation_key,'record',rec,
  'result',public.faolla_member_checkout_result_v2(b.site_id,b.operation_key,b.principal_key));
END;
$$;

CREATE FUNCTION public.faolla_checkout_merchant_cancel_v1(p_site_id text,p_operation_key text,p_actor_key text,p_expected_updated_at text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype; r jsonb;
BEGIN
 IF p_site_id IS NULL OR p_site_id !~ '^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key !~ '^[a-f0-9]{64}$'
  OR p_actor_key IS NULL OR p_actor_key !~ '^owner:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_unauthorized'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 SELECT * INTO b FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_not_found'; END IF;
 -- Current owner authorization is performed/rechecked by the trusted HTTP
 -- adapter. Never accept these parameters or execute this as an API role.
 r := faolla_checkout_design.cancel_bundle(p_site_id,p_operation_key,b.principal_key,p_expected_updated_at);
 IF r->'replayed'='false'::jsonb THEN
  INSERT INTO faolla_checkout_design.merchant_cancellation_actors VALUES(p_site_id,p_operation_key,p_actor_key);
 END IF;
 RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_checkout_resource_link_v1(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.faolla_checkout_merchant_cancel_v1(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

-- Deferred so the EXISTING composite cancellation can insert its immutable
-- return receipt AFTER its resource write. On failure ALL resource/member/
-- coupon/stock/history writes roll back, including earlier trigger effects.
-- This definer is trigger-only, read-only, fixed-schema and has no dynamic SQL.
-- It needs to inspect the private ledger even for an old direct API-role page
-- writer; granting that writer private ledger access would be unsafe.
CREATE FUNCTION faolla_checkout_design.guard_legacy_resource_final_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE before_page jsonb; after_page jsonb; b faolla_checkout_design.bundle_results%rowtype;
 before_items jsonb; after_items jsonb; previous_items jsonb; next_items jsonb; rec jsonb; n integer; closed boolean;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'pages' THEN RAISE EXCEPTION 'checkout_resource_locked'; END IF;
 before_page := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 after_page := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 IF coalesce(before_page->>'slug','')<>'__merchant_booking_records__:v1' AND coalesce(after_page->>'slug','')<>'__merchant_booking_records__:v1'
  AND coalesce(before_page->>'slug','') !~ '^__merchant_orders__:[0-9]{8}(:chunk:[0-9]+)?$'
  AND coalesce(after_page->>'slug','') !~ '^__merchant_orders__:[0-9]{8}(:chunk:[0-9]+)?$' THEN RETURN NULL; END IF;
 -- Forced RLS must never hide the ledger from the enforcement trigger. A
 -- changed owner without BYPASSRLS must fail closed, not see an empty ledger.
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'checkout_resource_locked';
 END IF;
 FOR b IN SELECT * FROM faolla_checkout_design.bundle_results l WHERE
  (l.resource_kind='booking' AND (before_page->>'slug'='__merchant_booking_records__:v1' OR after_page->>'slug'='__merchant_booking_records__:v1'))
  OR (l.resource_kind='order' AND (before_page->>'slug'='__merchant_orders__:'||l.site_id OR before_page->>'slug'~('^__merchant_orders__:'||l.site_id||':chunk:[0-9]+$')
    OR after_page->>'slug'='__merchant_orders__:'||l.site_id OR after_page->>'slug'~('^__merchant_orders__:'||l.site_id||':chunk:[0-9]+$')))
 LOOP
  before_items := CASE WHEN b.resource_kind='booking' THEN before_page#>'{blocks,records}' ELSE before_page->'blocks' END;
  after_items := CASE WHEN b.resource_kind='booking' THEN after_page#>'{blocks,records}' ELSE after_page->'blocks' END;
  SELECT jsonb_agg(r) INTO previous_items FROM jsonb_array_elements(coalesce(before_items,'[]'::jsonb)) r WHERE r->>'id'=b.resource_id AND r->>'siteId'=b.site_id;
  SELECT jsonb_agg(r) INTO next_items FROM jsonb_array_elements(coalesce(after_items,'[]'::jsonb)) r WHERE r->>'id'=b.resource_id AND r->>'siteId'=b.site_id;
  IF previous_items IS NOT DISTINCT FROM next_items THEN CONTINUE; END IF;
  WITH source AS (
   SELECT p.blocks->'records' AS records FROM public.pages p WHERE b.resource_kind='booking' AND p.slug='__merchant_booking_records__:v1'
   UNION ALL
   SELECT p.blocks FROM public.pages p WHERE b.resource_kind='order' AND p.merchant_id=b.site_id
    AND (p.slug~('^__merchant_orders__:'||b.site_id||':chunk:[0-9]+$') OR p.slug='__merchant_orders__:'||b.site_id
     AND NOT EXISTS(SELECT 1 FROM public.pages c WHERE c.merchant_id=b.site_id AND c.slug~('^__merchant_orders__:'||b.site_id||':chunk:[0-9]+$')))
  ), matches AS (SELECT r FROM source s CROSS JOIN LATERAL jsonb_array_elements(s.records) r WHERE r->>'id'=b.resource_id AND r->>'siteId'=b.site_id)
  SELECT count(*),CASE WHEN count(*)=1 THEN (jsonb_agg(r))->0 ELSE NULL END INTO n,rec FROM matches;
  IF n<>1 OR rec->>'customerAccountId' IS DISTINCT FROM split_part(b.principal_key,':',2)
   OR rec->>'customerUserId' IS DISTINCT FROM split_part(b.principal_key,':',3) THEN RAISE EXCEPTION 'checkout_resource_locked'; END IF;
  IF b.receipt->'resourceTerms' IS DISTINCT FROM (CASE WHEN b.resource_kind='booking' THEN
   jsonb_build_object('appointmentAt',rec->'appointmentAt','store',rec->'store','item',rec->'item','bookingBlockId',rec->'bookingBlockId','bookingViewport',rec->'bookingViewport')
   ELSE jsonb_build_object('items',rec->'items','totalQuantity',rec->'totalQuantity','totalAmount',rec->'totalAmount') END)
   OR (b.resource_kind='booking' AND previous_items IS NOT NULL AND previous_items#>'{0,appointmentTimeZone}' IS DISTINCT FROM rec->'appointmentTimeZone')
   THEN RAISE EXCEPTION 'checkout_change_requires_review'; END IF;
  SELECT EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_cancellations c WHERE c.site_id=b.site_id AND c.operation_key=b.operation_key) INTO closed;
  IF closed IS DISTINCT FROM (rec->>'status'='cancelled') THEN RAISE EXCEPTION 'checkout_original_cancellation_required'; END IF;
  IF coalesce(rec->>'status','') NOT IN ('active','pending','confirmed','completed','no_show','cancelled') THEN RAISE EXCEPTION 'checkout_resource_locked'; END IF;
 END LOOP;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION faolla_checkout_design.guard_legacy_resource_final_state() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER checkout_resource_final_state AFTER INSERT OR UPDATE OR DELETE ON public.pages
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.guard_legacy_resource_final_state();
COMMIT;
