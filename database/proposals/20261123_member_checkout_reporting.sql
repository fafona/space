-- PRIVATE READ-ONLY PROPOSAL, not a registered/installed migration.
-- Owner API reauthorizes before/after this read. No role grants, SECURITY
-- DEFINER, writes, activation, data normalization or old-entry protection.
BEGIN;
CREATE FUNCTION public.faolla_member_checkout_reporting_v1(p_site_id text,p_resources jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE v_result jsonb;
BEGIN
 IF p_site_id IS NULL OR p_site_id !~ '^[0-9]{8}$' OR jsonb_typeof(p_resources) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'checkout_reporting_invalid';
 END IF;
 IF jsonb_array_length(p_resources) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'checkout_reporting_invalid'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_resources) r WHERE jsonb_typeof(r) IS DISTINCT FROM 'object') THEN
  RAISE EXCEPTION 'checkout_reporting_invalid';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_resources) r WHERE (SELECT count(*) FROM jsonb_object_keys(r))<>2
   OR jsonb_typeof(r->'kind') IS DISTINCT FROM 'string' OR coalesce(r->>'kind','') NOT IN ('booking','order')
   OR jsonb_typeof(r->'id') IS DISTINCT FROM 'string' OR coalesce(r->>'id','') !~ '^[A-Za-z0-9:_-]{1,160}$')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_resources) r GROUP BY r->>'kind',r->>'id' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'checkout_reporting_invalid';
 END IF;
 WITH requested AS MATERIALIZED (
  SELECT r->>'kind' AS kind,r->>'id' AS id,n FROM jsonb_array_elements(p_resources) WITH ORDINALITY t(r,n)
 ), linked AS MATERIALIZED (
  SELECT r.*,b.operation_key,b.principal_key,b.receipt FROM requested r
  LEFT JOIN faolla_checkout_design.bundle_results b ON b.site_id=p_site_id AND b.resource_kind=r.kind AND b.resource_id=r.id
 ), source_pages AS MATERIALIZED (
  SELECT 'booking' AS kind,p.blocks->'records' AS records FROM public.pages p
  WHERE p.slug='__merchant_booking_records__:v1' AND EXISTS(SELECT 1 FROM linked WHERE kind='booking' AND operation_key IS NOT NULL)
  UNION ALL
  SELECT 'order',p.blocks FROM public.pages p WHERE p.merchant_id=p_site_id AND EXISTS(SELECT 1 FROM linked WHERE kind='order' AND operation_key IS NOT NULL)
   AND (p.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$') OR p.slug='__merchant_orders__:'||p_site_id
    AND NOT EXISTS(SELECT 1 FROM public.pages c WHERE c.merchant_id=p_site_id AND c.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$')))
 ), current_records AS MATERIALIZED (
  SELECT s.kind,r FROM source_pages s CROSS JOIN LATERAL jsonb_array_elements(s.records) r WHERE r->>'siteId'=p_site_id
 ), matched AS (
  SELECT l.*,CASE WHEN count(c.r)=1 AND bool_and(c.r->>'customerAccountId'=split_part(l.principal_key,':',2)
    AND c.r->>'customerUserId'=split_part(l.principal_key,':',3)) THEN (jsonb_agg(c.r))->0 ELSE NULL END AS r
  FROM linked l LEFT JOIN current_records c ON c.kind=l.kind AND c.r->>'id'=l.id
  GROUP BY l.kind,l.id,l.n,l.operation_key,l.principal_key,l.receipt
 ), projected AS (
  SELECT m.*,c.receipt AS cancelled,
   coalesce(m.r IS NOT NULL AND m.receipt ? 'resourceTerms' AND m.receipt->'resourceTerms'=CASE WHEN m.kind='booking' THEN
    jsonb_build_object('appointmentAt',m.r->'appointmentAt','store',m.r->'store','item',m.r->'item','bookingBlockId',m.r->'bookingBlockId','bookingViewport',m.r->'bookingViewport')
    ELSE jsonb_build_object('items',m.r->'items','totalQuantity',m.r->'totalQuantity','totalAmount',m.r->'totalAmount') END,false) AS terms_match
  FROM matched m LEFT JOIN faolla_checkout_design.bundle_cancellations c ON c.site_id=p_site_id AND c.operation_key=m.operation_key
 )
 SELECT jsonb_build_object('version',1,'siteId',p_site_id,'rows',jsonb_agg(jsonb_build_object('kind',kind,'id',id,'termsMatch',terms_match,
  'result',CASE WHEN operation_key IS NULL THEN NULL ELSE jsonb_build_object('version',1,'siteId',p_site_id,'operationKey',operation_key,
   'resourceKind',kind,'resourceId',id,'totalPoints',receipt->'totalPoints','couponCount',receipt->'couponCount','closed',cancelled IS NOT NULL,
   'resource',CASE WHEN r IS NULL THEN NULL ELSE jsonb_build_object('status',r->'status','updatedAt',r->'updatedAt') END,
   'cancellationPolicy',receipt->'cancellationPolicy','cancellationAvailable',false,
   'cancellation',CASE WHEN cancelled IS NULL THEN NULL ELSE jsonb_build_object('pointsReturned',cancelled->'pointsReturned',
    'couponsReturned',cancelled->'couponsReturned','stockReleased',cancelled->'stockReleased','cancelledAt',cancelled->'cancelledAt') END) END) ORDER BY n))
 INTO v_result FROM projected;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_reporting_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
