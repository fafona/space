-- PRIVATE, UNINSTALLED READ-ONLY PROPOSAL. No migration registration, role
-- grants, identity backfill, legacy draft adoption, claim/ack or business write.
BEGIN;
CREATE FUNCTION public.faolla_member_checkout_legacy_review_v1(p_site_id text,p_block_id text,p_request_id text,p_principal_key text,p_not_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE deadline timestamptz;s jsonb;rec jsonb;v jsonb;account_id text;user_id text;created_stamp timestamptz;updated_stamp timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_legacy_review_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_block_id IS NULL OR p_block_id!~'^[A-Za-z0-9:_-]{1,160}$'
  OR p_request_id IS NULL OR p_request_id!~'^[A-Za-z0-9:_-]{1,160}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_legacy_review_invalid';END IF;
 deadline:=p_not_after::timestamptz;
 IF deadline IS NULL OR NOT isfinite(deadline) OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '15 seconds' THEN RAISE EXCEPTION 'checkout_legacy_review_expired';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0))
  OR NOT pg_try_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_legacy_review_busy';END IF;
 account_id:=split_part(p_principal_key,':',2);user_id:=split_part(p_principal_key,':',3);
 -- Canonical chunk/root selection, duplicate checks, ownership and ledger
 -- exclusion all use ONE statement snapshot. Never combine two HTTP reads.
 WITH heads AS MATERIALIZED(
  SELECT p.id,p.slug FROM public.pages p WHERE p.merchant_id=p_site_id
   AND (p.slug='__merchant_orders__:'||p_site_id OR p.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$')) ORDER BY p.slug,p.id LIMIT 1001
 ), canonical AS MATERIALIZED(
  SELECT p.blocks FROM heads h JOIN public.pages p ON p.id=h.id WHERE
   h.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$') OR NOT EXISTS(SELECT 1 FROM heads c WHERE c.slug~('^__merchant_orders__:'||p_site_id||':chunk:[0-9]+$'))
 ), bounds AS MATERIALIZED(
  SELECT (SELECT count(*) FROM heads)<=1000
   AND NOT EXISTS(SELECT 1 FROM canonical WHERE jsonb_typeof(blocks) IS DISTINCT FROM 'array')
   AND coalesce(sum(octet_length(blocks::text)),0)<=8388608
   AND coalesce(sum(CASE WHEN jsonb_typeof(blocks)='array' THEN jsonb_array_length(blocks) ELSE 0 END),0)<=10000 AS safe FROM canonical
 ), records AS MATERIALIZED(
  SELECT e.r FROM canonical c CROSS JOIN bounds b CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN b.safe THEN c.blocks ELSE '[]'::jsonb END) e(r)
 ), matches AS MATERIALIZED(
  SELECT r FROM records WHERE jsonb_typeof(r)='object' AND r->>'clientRequestId'=p_request_id LIMIT 3
 ), candidate AS MATERIALIZED(SELECT r FROM matches LIMIT 1)
 SELECT jsonb_build_object('safe',(SELECT safe FROM bounds),'count',(SELECT count(*) FROM matches),'record',(SELECT r FROM candidate),
  'idCount',(SELECT count(*) FROM records WHERE r->>'id'=(SELECT r->>'id' FROM candidate)),
  'linked',EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_results b WHERE b.site_id=p_site_id AND b.resource_kind='order' AND b.resource_id=(SELECT r->>'id' FROM candidate))) INTO s;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'checkout_legacy_review_expired';END IF;
 IF s->>'safe' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'checkout_legacy_review_unavailable';END IF;
 v:=jsonb_build_object('version',1,'siteId',p_site_id,'blockId',p_block_id,'requestId',p_request_id,'order',NULL);rec:=s->'record';
 -- Missing, foreign, ambiguous, partly bound and financial records have the
 -- same unconfirmed response. No email/guest/name/product matching fallback.
 IF s->>'count'<>'1' OR s->>'idCount'<>'1' OR s->>'linked'='true' OR rec ? 'checkoutOperationKey'
  OR jsonb_typeof(rec->'clientRequestId') IS DISTINCT FROM 'string' OR jsonb_typeof(rec->'siteId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(rec->'blockId') IS DISTINCT FROM 'string' OR jsonb_typeof(rec->'customerAccountId') IS DISTINCT FROM 'string' OR jsonb_typeof(rec->'customerUserId') IS DISTINCT FROM 'string'
  OR rec->>'siteId' IS DISTINCT FROM p_site_id OR rec->>'blockId' IS DISTINCT FROM p_block_id
  OR rec->>'customerAccountId' IS DISTINCT FROM account_id OR rec->>'customerUserId' IS DISTINCT FROM user_id THEN RETURN v;END IF;
 IF jsonb_typeof(rec->'id') IS DISTINCT FROM 'string' OR (rec->>'id')!~'^[A-Za-z0-9:_-]{1,160}$'
  OR jsonb_typeof(rec->'status') IS DISTINCT FROM 'string' OR rec->>'status' NOT IN ('pending','confirmed','completed','cancelled')
  OR jsonb_typeof(rec->'createdAt') IS DISTINCT FROM 'string' OR jsonb_typeof(rec->'updatedAt') IS DISTINCT FROM 'string'
  OR (rec->>'createdAt')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  OR (rec->>'updatedAt')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'checkout_legacy_review_unavailable';END IF;
 created_stamp:=(rec->>'createdAt')::timestamptz;updated_stamp:=(rec->>'updatedAt')::timestamptz;
 IF NOT isfinite(created_stamp) OR NOT isfinite(updated_stamp) OR updated_stamp<created_stamp THEN RAISE EXCEPTION 'checkout_legacy_review_unavailable';END IF;
 RETURN v||jsonb_build_object('order',jsonb_build_object('id',rec->>'id','status',rec->>'status',
  'createdAt',to_char(created_stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt',to_char(updated_stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_legacy_review_v1(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
