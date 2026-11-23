-- PRIVATE presentation proposal only; not a registered migration or ACL.
BEGIN;
CREATE FUNCTION public.faolla_member_checkout_original_result_v1(p_site_id text,p_operation_key text,p_principal_key text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN b.receipt->'version'='2'::jsonb AND b.receipt->>'method'='on_site' THEN
  jsonb_build_object('method','on_site','result',public.faolla_member_checkout_on_site_result_v1(p_site_id,p_operation_key,p_principal_key))
 WHEN b.receipt->'version'='1'::jsonb THEN
  jsonb_build_object('method','points','result',public.faolla_member_checkout_result_v2(p_site_id,p_operation_key,p_principal_key))
 ELSE NULL END
 FROM faolla_checkout_design.bundle_results b WHERE b.site_id=p_site_id AND b.operation_key=p_operation_key AND b.principal_key=p_principal_key
  AND p_site_id~'^[0-9]{8}$' AND p_operation_key~'^[a-f0-9]{64}$' AND p_principal_key~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$';
$$;
-- The existing points projection is unchanged. Its raw cash rows are replaced
-- BEFORE they can leave SQL. All functions are STABLE in one read snapshot.
CREATE FUNCTION public.faolla_member_checkout_reporting_v2(p_site_id text,p_resources jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH original AS MATERIALIZED (SELECT public.faolla_member_checkout_reporting_v1(p_site_id,p_resources) AS value),
 rows AS (
  SELECT r,n,b.receipt,b.operation_key,b.principal_key FROM original CROSS JOIN LATERAL jsonb_array_elements(value->'rows') WITH ORDINALITY t(r,n)
  LEFT JOIN faolla_checkout_design.bundle_results b ON b.site_id=p_site_id AND b.resource_kind=r->>'kind' AND b.resource_id=r->>'id'
 ), safe AS (
  SELECT r,n,CASE WHEN receipt->>'method'='on_site' THEN public.faolla_member_checkout_on_site_result_v1(p_site_id,operation_key,principal_key) ELSE NULL END AS cash FROM rows
 ) SELECT jsonb_build_object('version',2,'siteId',p_site_id,'rows',jsonb_agg(CASE WHEN cash IS NULL THEN r ELSE
  jsonb_build_object('kind',r->'kind','id',r->'id','termsMatch',cash->'termsMatch','result',NULL,'onSite',cash) END ORDER BY n)) FROM safe;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_original_result_v1(text,text,text),public.faolla_member_checkout_reporting_v2(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.faolla_member_checkout_original_resource_v1(p_site_id text,p_kind text,p_id text,p_principal_key text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT public.faolla_member_checkout_original_result_v1(b.site_id,b.operation_key,b.principal_key)
 FROM faolla_checkout_design.bundle_results b WHERE b.site_id=p_site_id AND b.resource_kind=p_kind AND b.resource_id=p_id AND b.principal_key=p_principal_key
  AND p_site_id~'^[0-9]{8}$' AND p_kind IN ('booking','order') AND p_id~'^[A-Za-z0-9:_-]{1,160}$' AND p_principal_key~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$';
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_original_resource_v1(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
