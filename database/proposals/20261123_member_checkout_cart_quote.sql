-- ISOLATED PROPOSAL ONLY. No registered migration, production grants or flags.
-- Quote only: no cart commit, nonce, resource, member, coupon or stock writes.
BEGIN;
CREATE TABLE faolla_checkout_design.cart_quote_pilots (
 site_id text PRIMARY KEY CHECK(site_id ~ '^[0-9]{8}$'), enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE faolla_checkout_design.cart_quote_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.cart_quote_pilots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE faolla_checkout_design.cart_quote_pilots FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.faolla_member_checkout_cart_quote_snapshot_v1(p_site_id text,p_principal_key text,p_request_hash text,p_offer_ids jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE v_result jsonb;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
   OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' OR jsonb_typeof(p_offer_ids) IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'checkout_invalid_cart'; END IF;
 IF jsonb_array_length(p_offer_ids) NOT BETWEEN 1 AND 20 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_offer_ids) x
   WHERE jsonb_typeof(x) IS DISTINCT FROM 'string' OR x#>>'{}' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
   OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(p_offer_ids) x)<>jsonb_array_length(p_offer_ids) THEN RAISE EXCEPTION 'checkout_invalid_cart'; END IF;
 -- STABLE uses the calling statement's MVCC snapshot throughout. In
 -- particular do NOT call the legacy VOLATILE submission_rows helper, nor
 -- issue one independent RPC/read for each line. No locks or writer effects.
 IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_pilots WHERE site_id=p_site_id AND enabled)
   OR NOT EXISTS(SELECT 1 FROM faolla_checkout_design.cart_quote_pilots WHERE site_id=p_site_id AND enabled)
   THEN RAISE EXCEPTION 'checkout_disabled'; END IF;
 WITH offers AS MATERIALIZED (
   SELECT h.offer_id,v.snapshot FROM faolla_checkout_design.offer_heads h JOIN faolla_checkout_design.offer_versions v USING(site_id,offer_id,revision)
   WHERE h.site_id=p_site_id AND h.enabled AND p_offer_ids ? h.offer_id::text
 ), rows AS MATERIALIZED (
   SELECT p.id,p.slug,
    ((p.merchant_id IS NULL AND p.slug='__platform_merchant_snapshot__') OR
      (p.merchant_id=p_site_id AND (p.slug IS NULL OR left(p.slug,2)<>'__' OR p.slug='__merchant_catalog__:'||p_site_id))) AS source,
    jsonb_build_object('id',p.id,'merchant_id',p.merchant_id,'slug',p.slug,'blocks',p.blocks,'updated_at',p.updated_at,'created_at',to_jsonb(p)->'created_at') AS raw
   FROM public.pages p WHERE (p.merchant_id IS NULL AND p.slug='__platform_merchant_snapshot__') OR
    (p.merchant_id=p_site_id AND (p.slug IS NULL OR left(p.slug,2)<>'__' OR p.slug IN ('__merchant_catalog__:'||p_site_id,
      '__merchant_memberships__:'||p_site_id,'__merchant_membership_settings__:'||p_site_id,'__merchant_coupons__:'||p_site_id)))
 )
 SELECT jsonb_build_object('version',1,'purpose','product_cart_quote','siteId',p_site_id,'principalKey',p_principal_key,'requestHash',p_request_hash,
  'databaseNow',statement_timestamp(),'offers',(SELECT coalesce(jsonb_agg(snapshot ORDER BY offer_id),'[]'::jsonb) FROM offers),
  'sourceRows',(SELECT coalesce(jsonb_agg(raw ORDER BY slug,id),'[]'::jsonb) FROM rows WHERE source),
  'domainRows',(SELECT coalesce(jsonb_agg(raw ORDER BY slug,id),'[]'::jsonb) FROM rows WHERE NOT source)) INTO v_result;
 IF jsonb_array_length(v_result->'offers')<>jsonb_array_length(p_offer_ids) THEN RAISE EXCEPTION 'checkout_offer_not_found'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_result->'offers') o WHERE o#>>'{source,kind}' IS DISTINCT FROM 'order')
   THEN RAISE EXCEPTION 'checkout_cart_products_only'; END IF;
 IF octet_length(v_result::text)>16777216 THEN RAISE EXCEPTION 'checkout_snapshot_too_large'; END IF;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_cart_quote_snapshot_v1(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
