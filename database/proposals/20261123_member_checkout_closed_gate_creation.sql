-- UNINSTALLED PRIVATE PROPOSAL. A write-time tripwire survives closing the
-- application intent gate. No new receipt, acknowledgement, charge or rollout.
-- Keep ALL original CAS functions byte-identical. Active booking protocol v2
-- remains a prerequisite; this does not make the old file/mail mode safe.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
END;$$;

CREATE FUNCTION faolla_checkout_design.guard_closed_gate_creation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE site text;principal text;items jsonb;previous jsonb;known_ids jsonb;rec jsonb;
 last_claim faolla_checkout_design.intent_claims%rowtype;baseline regclass;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'pages' OR TG_OP NOT IN ('INSERT','UPDATE') THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
 IF coalesce(NEW.slug,'')<>'__merchant_booking_records__:v1'
  AND coalesce(NEW.slug,'')!~'^__merchant_orders__:[0-9]{8}(:chunk:[0-9]+)?$' THEN RETURN NEW;END IF;
 -- FORCE RLS must never silently hide the immutable original/claim ledger.
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
 IF NEW.slug='__merchant_booking_records__:v1' THEN
  items:=NEW.blocks->'records';previous:=CASE WHEN TG_OP='INSERT' THEN '[]'::jsonb ELSE OLD.blocks->'records' END;
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_typeof(previous) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
  SELECT coalesce(jsonb_object_agg(r->>'id',true),'{}'::jsonb) INTO known_ids FROM jsonb_array_elements(previous) r;
 ELSE
  site:=split_part(NEW.slug,':',2);
  IF NEW.merchant_id IS DISTINCT FROM site THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
  IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=site AND enabled)
   AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims WHERE site_id=site) THEN RETURN NEW;END IF;
  items:=NEW.blocks;
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
  -- The old CAS writes several chunks. Comparing only OLD on each row, or
  -- re-reading a partially rewritten store, misclassifies moved IDs as new.
  -- Snapshot canonical IDs BEFORE the first write in this transaction. A
  -- private, owner-checked TEMP table is not a caller-supplied GUC/JSON flag.
  -- ON COMMIT DROP and rollback remove this metadata; no customer fields,
  -- tokens, history, permanent table or cross-session cache are added.
  baseline:=to_regclass('pg_temp.faolla_checkout_creation_baselines');
  IF baseline IS NULL THEN
   CREATE TEMP TABLE pg_temp.faolla_checkout_creation_baselines(site_id text PRIMARY KEY,ids jsonb NOT NULL) ON COMMIT DROP;
   REVOKE ALL ON pg_temp.faolla_checkout_creation_baselines FROM PUBLIC,anon,authenticated,service_role;
   baseline:='pg_temp.faolla_checkout_creation_baselines'::regclass;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=baseline
   AND c.relnamespace=pg_my_temp_schema() AND c.relpersistence='t' AND c.relkind='r' AND r.rolname=current_user)
   OR (SELECT count(*) FROM pg_attribute WHERE attrelid=baseline AND attnum>0 AND NOT attisdropped)<>2
   OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=baseline AND attname='site_id' AND atttypid='text'::regtype AND attnotnull)
   OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=baseline AND attname='ids' AND atttypid='jsonb'::regtype AND attnotnull)
   THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
  SELECT ids INTO known_ids FROM pg_temp.faolla_checkout_creation_baselines WHERE site_id=site;
  IF NOT FOUND THEN
   IF EXISTS(SELECT 1 FROM public.pages WHERE merchant_id=site AND (slug='__merchant_orders__:'||site OR slug~('^__merchant_orders__:'||site||':chunk:[0-9]+$'))
    AND jsonb_typeof(blocks) IS DISTINCT FROM 'array') THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
   SELECT coalesce(jsonb_object_agg(r->>'id',true),'{}'::jsonb) INTO known_ids
    FROM public.pages p CROSS JOIN LATERAL jsonb_array_elements(p.blocks) r WHERE p.merchant_id=site
     AND (p.slug~('^__merchant_orders__:'||site||':chunk:[0-9]+$') OR p.slug='__merchant_orders__:'||site
      AND NOT EXISTS(SELECT 1 FROM public.pages c WHERE c.merchant_id=site AND c.slug~('^__merchant_orders__:'||site||':chunk:[0-9]+$')));
   INSERT INTO pg_temp.faolla_checkout_creation_baselines VALUES(site,known_ids);
  END IF;
 END IF;
 FOR rec IN SELECT r FROM jsonb_array_elements(items) r WHERE NOT (known_ids ? (r->>'id')) LOOP
  IF coalesce(rec->>'customerAccountId','')!~'^[0-9]{8}$' OR coalesce(rec->>'customerUserId','')!~'^[A-Za-z0-9_-]{8,128}$' THEN CONTINUE;END IF;
  IF coalesce(rec->>'siteId','')!~'^[0-9]{8}$' OR (NEW.slug<>'__merchant_booking_records__:v1' AND rec->>'siteId' IS DISTINCT FROM site) THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
  site:=rec->>'siteId';principal:='account:'||(rec->>'customerAccountId')||':'||(rec->>'customerUserId');
  IF NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=site AND enabled)
   AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims WHERE site_id=site AND principal_key=principal) THEN CONTINUE;END IF;
  -- Old CAS already owns the order lock or booking control row. Blocking on
  -- the earlier checkout lock here would invert the financial lock order.
  -- Reject immediately, rolling back the WHOLE old CAS and all its effects.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||site,0)) THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
  BEGIN
   PERFORM 1 FROM faolla_checkout_design.intent_pilots WHERE site_id=site AND enabled FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'checkout_resource_locked';END;
  IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims WHERE site_id=site AND principal_key=principal) THEN CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_results b WHERE b.site_id=site AND b.principal_key=principal
   AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_claims c WHERE c.site_id=b.site_id AND c.operation_key=b.operation_key)) THEN RAISE EXCEPTION 'checkout_intent_review_required';END IF;
  SELECT * INTO last_claim FROM faolla_checkout_design.intent_claims WHERE site_id=site AND principal_key=principal ORDER BY generation DESC LIMIT 1;
  IF FOUND AND NOT EXISTS(SELECT 1 FROM faolla_checkout_design.intent_acknowledgements a WHERE a.site_id=last_claim.site_id AND a.operation_key=last_claim.operation_key) THEN RAISE EXCEPTION 'checkout_original_pending';END IF;
 END LOOP;
 IF NEW.slug<>'__merchant_booking_records__:v1' THEN
  -- Keep original IDs for later chunk moves; also remember checked new IDs
  -- for a second write within this SAME transaction. Never persist this cache.
  SELECT known_ids||coalesce(jsonb_object_agg(r->>'id',true),'{}'::jsonb) INTO known_ids FROM jsonb_array_elements(items) r;
  UPDATE pg_temp.faolla_checkout_creation_baselines SET ids=known_ids WHERE site_id=site;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION faolla_checkout_design.guard_closed_gate_creation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER checkout_closed_gate_creation BEFORE INSERT OR UPDATE ON public.pages
 FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.guard_closed_gate_creation();
COMMIT;
