-- PRIVATE, UNINSTALLED. Bounded own untracked-original inventory only.
-- No claims/acknowledgements, grants, pilot enrollment or financial writes.
BEGIN;
CREATE FUNCTION public.faolla_member_checkout_history_inventory_v1(p_site_id text,p_principal_key text,p_after text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b record;v jsonb;items jsonb:='[]'::jsonb;last_key text;next_key text:=NULL;n integer:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_history_unavailable';END IF;
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
  OR p_after IS NOT NULL AND p_after!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'checkout_invalid_request';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0)) THEN RAISE EXCEPTION 'checkout_history_busy';END IF;
 -- Exact dual principal; immutable key order, not transaction chronology.
 -- Read at most 11 keys and project at most 10 complete originals.
 FOR b IN SELECT r.operation_key FROM faolla_checkout_design.bundle_results r
  WHERE r.site_id=p_site_id AND r.principal_key=p_principal_key AND (p_after IS NULL OR r.operation_key COLLATE "C">p_after COLLATE "C")
   AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims c WHERE c.site_id=r.site_id AND c.operation_key=r.operation_key)
  ORDER BY r.operation_key COLLATE "C" LIMIT 11
 LOOP
  n:=n+1;IF n=11 THEN next_key:=last_key;EXIT;END IF;
  v:=faolla_checkout_design.intent_original_view(p_site_id,b.operation_key,p_principal_key);
  IF v IS NULL OR jsonb_typeof(v->'original') IS DISTINCT FROM 'object' OR jsonb_typeof(v->'reviewRequired') IS DISTINCT FROM 'boolean'
   THEN RAISE EXCEPTION 'checkout_history_unavailable';END IF;
  items:=items||jsonb_build_array(jsonb_build_object('operationKey',b.operation_key,'original',v->'original','reviewRequired',v->'reviewRequired'));
  last_key:=b.operation_key;
 END LOOP;
 RETURN jsonb_build_object('version',1,'siteId',p_site_id,'after',p_after,'items',items,'nextCursor',next_key);
END;
$$;
REVOKE ALL ON FUNCTION public.faolla_member_checkout_history_inventory_v1(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
