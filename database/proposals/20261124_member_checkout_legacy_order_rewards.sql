-- PRIVATE, UNINSTALLED. A rollback writer must not award/reverse the legacy
-- order-completion reward for an original already settled by this ledger.
-- No legacy function replacement, repair, rollout registry or role grants.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'checkout_guard_owner_invalid';
 END IF;
END; $$;
CREATE FUNCTION faolla_checkout_design.guard_legacy_checkout_order_rewards()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous_page jsonb;next_page jsonb;s text;previous_members jsonb;next_members jsonb;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'pages' THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
 previous_page:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 next_page:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 FOR s IN SELECT DISTINCT p->>'merchant_id' FROM jsonb_array_elements(jsonb_build_array(previous_page,next_page)) p
  WHERE p->>'merchant_id'~'^[0-9]{8}$' AND p->>'slug'='__merchant_memberships__:'||(p->>'merchant_id')
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
   RAISE EXCEPTION 'checkout_resource_locked';
  END IF;
  -- The old CAS holds the order/member lock first; never wait on the inverse
  -- checkout lock. Its whole transaction, including histories, must roll back.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||s,0)) THEN
   RAISE EXCEPTION 'checkout_resource_locked';
  END IF;
  previous_members:=CASE WHEN previous_page->>'merchant_id'=s AND previous_page->>'slug'='__merchant_memberships__:'||s
   THEN previous_page->'blocks' ELSE '[]'::jsonb END;
  next_members:=CASE WHEN next_page->>'merchant_id'=s AND next_page->>'slug'='__merchant_memberships__:'||s
   THEN next_page->'blocks' ELSE '[]'::jsonb END;
  IF current_setting('transaction_isolation')<>'read committed'
   OR jsonb_typeof(previous_members) IS DISTINCT FROM 'array' OR jsonb_typeof(next_members) IS DISTINCT FROM 'array' THEN
   IF EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_results WHERE site_id=s AND resource_kind='order') THEN
    RAISE EXCEPTION 'checkout_resource_locked';
   END IF;
   CONTINUE;
  END IF;
  -- Extract/group markers once rather than scanning every member transaction
  -- for every historical checkout. Join only CHANGED reward IDs to the
  -- existing (site_id,resource_kind,resource_id) unique index. No balance-wide
  -- freeze: unrelated purchases, recharges and checkout debit/return writers
  -- keep their existing behavior; unchanged historical markers are not repaired.
  IF EXISTS(
   WITH versions AS (
    SELECT 'before' AS version,previous_members AS members UNION ALL SELECT 'after',next_members
   ), marked AS (
    SELECT version,marker[1] AS resource_id,
     jsonb_build_object('memberId',m->'id','accountId',m->'accountId','userId',m->'userId','transaction',tx) AS reward
    FROM versions CROSS JOIN LATERAL jsonb_array_elements(members) m CROSS JOIN LATERAL jsonb_array_elements(
     CASE WHEN jsonb_typeof(m->'transactions')='array' THEN m->'transactions' ELSE '[]'::jsonb END) tx
    CROSS JOIN LATERAL regexp_matches(concat_ws(chr(10),tx->>'note',tx->>'cancellationOperationMarker'),
     $marker$\[(?:order-points|order-points-reversal):([A-Za-z0-9:_-]{1,160})\]$marker$,'g') marker
   ), grouped AS (
    SELECT version,resource_id,jsonb_agg(reward ORDER BY reward::text) AS rewards FROM marked GROUP BY version,resource_id
   ), before_rewards AS (SELECT * FROM grouped WHERE version='before'),after_rewards AS (SELECT * FROM grouped WHERE version='after'),changed AS (
    SELECT coalesce(b.resource_id,a.resource_id) AS resource_id FROM before_rewards b FULL JOIN after_rewards a USING(resource_id)
     WHERE b.rewards IS DISTINCT FROM a.rewards
   )
   SELECT 1 FROM changed c JOIN faolla_checkout_design.bundle_results b ON b.resource_id=c.resource_id AND b.resource_kind='order' AND b.site_id=s
  ) THEN RAISE EXCEPTION 'checkout_resource_locked';END IF;
 END LOOP;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION faolla_checkout_design.guard_legacy_checkout_order_rewards() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER checkout_legacy_order_rewards AFTER INSERT OR UPDATE OR DELETE ON public.pages
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.guard_legacy_checkout_order_rewards();
COMMIT;
