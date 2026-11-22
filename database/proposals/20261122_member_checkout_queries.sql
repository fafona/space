-- Uninstalled, default-denied adapters for isolated HTTP/database acceptance.
-- SECURITY INVOKER throughout. No browser or service-role grants here.
BEGIN;
CREATE FUNCTION public.faolla_member_checkout_result_v2(p_site_id text,p_operation_key text,p_principal_key text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH owned AS (
  SELECT b.*,c.receipt AS cancellation FROM faolla_checkout_design.bundle_results b
  LEFT JOIN faolla_checkout_design.bundle_cancellations c USING(site_id,operation_key)
  WHERE b.site_id=p_site_id AND b.operation_key=p_operation_key AND b.principal_key=p_principal_key
    AND p_site_id ~ '^[0-9]{8}$' AND p_operation_key ~ '^[a-f0-9]{64}$' AND p_principal_key ~ '^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
 ), sources AS (
  SELECT b.resource_id,b.resource_kind,p.blocks FROM owned b JOIN public.pages p ON
   (b.resource_kind='booking' AND p.slug='__merchant_booking_records__:v1') OR
   (b.resource_kind='order' AND p.merchant_id=b.site_id AND
    (p.slug~('^__merchant_orders__:'||b.site_id||':chunk:[0-9]+$') OR
     p.slug='__merchant_orders__:'||b.site_id AND NOT EXISTS(SELECT 1 FROM public.pages chunk WHERE chunk.slug~('^__merchant_orders__:'||b.site_id||':chunk:[0-9]+$'))))
 ), records AS (
  SELECT r FROM sources s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN s.resource_kind='booking' THEN s.blocks->'records' ELSE s.blocks END) r
  WHERE r->>'id'=s.resource_id AND r->>'siteId'=p_site_id
    AND r->>'customerAccountId'=split_part(p_principal_key,':',2) AND r->>'customerUserId'=split_part(p_principal_key,':',3)
 ), resource AS (SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(r))->0 ELSE NULL END AS r FROM records)
 SELECT jsonb_build_object('version',1,'siteId',b.site_id,'operationKey',b.operation_key,'resourceKind',b.resource_kind,'resourceId',b.resource_id,
   'totalPoints',b.receipt->'totalPoints','couponCount',b.receipt->'couponCount','closed',b.cancellation IS NOT NULL,
   'resource',CASE WHEN r.r IS NOT NULL THEN jsonb_build_object('status',r.r->'status','updatedAt',r.r->'updatedAt') ELSE NULL END,
   'cancellationPolicy',b.receipt->'cancellationPolicy',
   'cancellationAvailable',coalesce(b.cancellation IS NULL AND b.receipt ? 'cancellationPolicy' AND r.r->>'status' IN ('active','pending','confirmed')
     AND b.receipt->'resourceTerms'=(CASE WHEN b.resource_kind='booking' THEN
       jsonb_build_object('appointmentAt',r.r->'appointmentAt','store',r.r->'store','item',r.r->'item','bookingBlockId',r.r->'bookingBlockId','bookingViewport',r.r->'bookingViewport')
       ELSE jsonb_build_object('items',r.r->'items','totalQuantity',r.r->'totalQuantity','totalAmount',r.r->'totalAmount') END)
     AND (b.resource_kind='order' OR statement_timestamp()<=(b.receipt#>>'{cancellationPolicy,cancellableUntil}')::timestamptz),false),
   'cancellation',CASE WHEN b.cancellation IS NOT NULL THEN jsonb_build_object('pointsReturned',b.cancellation->'pointsReturned',
     'couponsReturned',b.cancellation->'couponsReturned','stockReleased',b.cancellation->'stockReleased','cancelledAt',b.cancellation->'cancelledAt') ELSE NULL END)
 FROM owned b CROSS JOIN resource r;
$$;
CREATE FUNCTION public.faolla_member_checkout_cancel_v2(p_site_id text,p_operation_key text,p_principal_key text,p_expected_updated_at text)
RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT faolla_checkout_design.cancel_bundle(p_site_id,p_operation_key,p_principal_key,p_expected_updated_at);
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_result_v2(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_cancel_v2(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
