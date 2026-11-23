-- PRIVATE READ-ONLY PROPOSAL. No migration registration, role grants, writes,
-- SECURITY DEFINER, production activation or changes to original functions.
BEGIN;
CREATE FUNCTION public.faolla_member_checkout_reporting_v3(p_site_id text,p_resources jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE original jsonb;result jsonb;
BEGIN
 -- Existing exact bounded key validation and single MVCC statement snapshot.
 original:=public.faolla_member_checkout_reporting_v2(p_site_id,p_resources);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_resources) r JOIN faolla_checkout_design.bundle_results b
  ON b.site_id=p_site_id AND b.resource_kind=r->>'kind' AND b.resource_id=r->>'id'
  WHERE (b.receipt->'version'='1'::jsonb OR b.receipt->'version'='2'::jsonb AND b.receipt->>'method'='on_site'
   OR b.receipt->'version'='3'::jsonb AND b.receipt->>'purpose'='product_cart' AND b.resource_kind='order'
    AND b.receipt->>'method' IN ('points','on_site')) IS NOT TRUE) THEN RAISE EXCEPTION 'checkout_reporting_unavailable';END IF;
 WITH rows AS MATERIALIZED (
  SELECT r,n,b.receipt,b.operation_key,b.principal_key FROM jsonb_array_elements(original->'rows') WITH ORDINALITY t(r,n)
  LEFT JOIN faolla_checkout_design.bundle_results b ON b.site_id=p_site_id AND b.resource_kind=r->>'kind' AND b.resource_id=r->>'id'
 ), safe AS MATERIALIZED (
  SELECT r,n,receipt,CASE WHEN receipt->'version'='3'::jsonb THEN public.faolla_member_checkout_cart_result_v1(p_site_id,operation_key,principal_key) ELSE NULL END cart FROM rows
 ) SELECT jsonb_build_object('version',3,'siteId',p_site_id,'rows',jsonb_agg(CASE WHEN receipt->'version'='3'::jsonb THEN
  jsonb_build_object('kind',r->'kind','id',r->'id','termsMatch',NOT (cart->>'reviewRequired')::boolean,'result',NULL,'cart',cart)
  ELSE r END ORDER BY n)) INTO result FROM safe;
 -- A missing/unknown cart projection must fail, never become "unlinked".
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'rows') r WHERE r ? 'cart' AND (r->'cart' IS NULL OR r->'cart'='null'::jsonb))
  THEN RAISE EXCEPTION 'checkout_reporting_unavailable';END IF;
 RETURN result;
END;
$$;
CREATE FUNCTION public.faolla_member_checkout_original_resource_v2(p_site_id text,p_kind text,p_id text,p_principal_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE b faolla_checkout_design.bundle_results%rowtype;n integer;r jsonb;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_kind IS NULL OR p_kind NOT IN ('booking','order')
  OR p_id IS NULL OR p_id!~'^[A-Za-z0-9:_-]{1,160}$' OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
  THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 SELECT count(*) INTO n FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND resource_kind=p_kind AND resource_id=p_id AND principal_key=p_principal_key;
 IF n=0 THEN RETURN NULL;END IF;
 IF n<>1 THEN RAISE EXCEPTION 'checkout_reporting_unavailable';END IF;
 SELECT * INTO STRICT b FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND resource_kind=p_kind AND resource_id=p_id AND principal_key=p_principal_key;
 IF b.receipt->'version'='3'::jsonb AND b.receipt->>'purpose'='product_cart' AND b.resource_kind='order' THEN
  r:=public.faolla_member_checkout_cart_result_v1(p_site_id,b.operation_key,p_principal_key);
  IF r IS NULL THEN RAISE EXCEPTION 'checkout_reporting_unavailable';END IF;
  RETURN jsonb_build_object('kind','cart','result',r);
 END IF;
 r:=public.faolla_member_checkout_original_result_v1(p_site_id,b.operation_key,p_principal_key);
 IF r IS NULL THEN RAISE EXCEPTION 'checkout_reporting_unavailable';END IF;
 RETURN jsonb_build_object('kind','single','original',r);
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_reporting_v3(text,jsonb),public.faolla_member_checkout_original_resource_v2(text,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
