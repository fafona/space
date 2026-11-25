-- UNINSTALLED / ISOLATED COMPATIBILITY DESIGN ONLY. No production registry,
-- activation, gateway membership, credentials, public method or old RPC edit.
-- The 047 internal writer remains owner-only; no caller receives its EXECUTE.
BEGIN;
CREATE TABLE faolla_checkout_design.redemption_047_audits (
 site_id text NOT NULL CHECK(site_id ~ '^[0-9]{8}$'),
 operation_key text NOT NULL CHECK(operation_key ~ '^[a-f0-9]{64}$'),
 phase text NOT NULL CHECK(phase IN ('payment','return')),
 principal_key text NOT NULL CHECK(principal_key ~ '^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'),
 membership_id text NOT NULL,
 request_hash text,
 points numeric NOT NULL CHECK(points BETWEEN 0 AND 99999999 AND trunc(points)=points),
 mutation_sha256 text NOT NULL CHECK(mutation_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(site_id,operation_key,phase),
 FOREIGN KEY(site_id,operation_key) REFERENCES faolla_checkout_design.bundle_results(site_id,operation_key)
  DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE faolla_checkout_design.redemption_047_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE faolla_checkout_design.redemption_047_audits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON faolla_checkout_design.redemption_047_audits FROM PUBLIC,anon,authenticated,service_role,faolla_checkout_runtime,faolla_checkout_executor;
CREATE TRIGGER immutable_redemption_047_audits BEFORE UPDATE OR DELETE ON faolla_checkout_design.redemption_047_audits
 FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.reject_historical_change();

-- A financial write cannot commit on its own, even when an outer new command
-- fails AFTER calling the writer. No mutable session variable authorizes it.
CREATE FUNCTION faolla_checkout_design.guard_redemption_047_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE original faolla_checkout_design.bundle_results%rowtype; cancellation faolla_checkout_design.bundle_cancellations%rowtype;
BEGIN
 IF TG_TABLE_SCHEMA<>'faolla_checkout_design' OR TG_TABLE_NAME<>'redemption_047_audits'
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  THEN RAISE EXCEPTION 'checkout_047_context_invalid';END IF;
 SELECT * INTO original FROM faolla_checkout_design.bundle_results WHERE site_id=NEW.site_id AND operation_key=NEW.operation_key;
 IF NOT FOUND OR original.principal_key IS DISTINCT FROM NEW.principal_key
  OR original.receipt->>'membershipId' IS DISTINCT FROM NEW.membership_id THEN RAISE EXCEPTION 'checkout_047_context_required';END IF;
 IF NEW.phase='payment' THEN
  IF original.request_hash IS DISTINCT FROM NEW.request_hash
   OR jsonb_typeof(original.receipt->'totalPoints') IS DISTINCT FROM 'number'
   OR (original.receipt->>'totalPoints')::numeric IS DISTINCT FROM NEW.points
   OR EXISTS(SELECT 1 FROM public.faolla_redemption_checkouts WHERE merchant_id=NEW.site_id AND operation_id='self-checkout:'||NEW.operation_key)
   OR NOT EXISTS(SELECT 1 FROM public.faolla_redemption_operations WHERE merchant_id=NEW.site_id
    AND operation_id='self-checkout:'||NEW.operation_key AND fingerprint=NEW.request_hash AND membership_id=NEW.membership_id)
   THEN RAISE EXCEPTION 'checkout_047_context_required';END IF;
 ELSE
  SELECT * INTO cancellation FROM faolla_checkout_design.bundle_cancellations WHERE site_id=NEW.site_id AND operation_key=NEW.operation_key;
  IF NOT FOUND OR cancellation.principal_key IS DISTINCT FROM NEW.principal_key
   OR jsonb_typeof(cancellation.receipt->'pointsReturned') IS DISTINCT FROM 'number'
   OR (cancellation.receipt->>'pointsReturned')::numeric IS DISTINCT FROM NEW.points
   THEN RAISE EXCEPTION 'checkout_047_context_required';END IF;
 END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION faolla_checkout_design.guard_redemption_047_audit() FROM PUBLIC,anon,authenticated,service_role,faolla_checkout_runtime,faolla_checkout_executor;
CREATE CONSTRAINT TRIGGER redemption_047_original_required AFTER INSERT ON faolla_checkout_design.redemption_047_audits
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.guard_redemption_047_audit();

CREATE FUNCTION faolla_checkout_design.commit_redemption_047(
 p_site_id text,p_operation_key text,p_principal_key text,p_phase text,p_mutation jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE original faolla_checkout_design.bundle_results%rowtype; page public.pages%rowtype;
 before_member jsonb;after_member jsonb;new_transactions jsonb;tx jsonb;member_id text;account_id text;user_id text;
 points numeric;delta numeric;request_hash text;result jsonb;
BEGIN
 IF p_site_id IS NULL OR p_site_id!~'^[0-9]{8}$' OR p_operation_key IS NULL OR p_operation_key!~'^[a-f0-9]{64}$'
  OR p_principal_key IS NULL OR p_principal_key!~'^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$'
  OR p_phase IS NULL OR p_phase NOT IN ('payment','return') OR jsonb_typeof(p_mutation) IS DISTINCT FROM 'object'
  OR octet_length(p_mutation::text)>262144
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
  THEN RAISE EXCEPTION 'checkout_047_context_invalid';END IF;
 -- Non-financial stock/coupon saves keep the exact 047 ordinary public path.
 IF NOT (p_mutation ? 'memberships') AND NOT (p_mutation ? 'operation') THEN
  RETURN public.faolla_commit_redemption_v1(p_site_id,p_mutation);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_mutation) k WHERE k NOT IN ('settings','memberships','coupons','operation'))
  OR NOT (p_mutation ?& ARRAY['settings','memberships'])
  OR jsonb_typeof(p_mutation#>'{memberships,next}') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'checkout_047_context_invalid';END IF;
 -- Same ordering as the new outer writers; original 047 writers also retain
 -- their own unchanged merchant lock and CAS checks.
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||p_site_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||p_site_id,0));
 SELECT * INTO original FROM faolla_checkout_design.bundle_results WHERE site_id=p_site_id AND operation_key=p_operation_key;
 IF p_phase='payment' THEN
  IF FOUND OR EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_cancellations WHERE site_id=p_site_id AND operation_key=p_operation_key)
   OR NOT EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_pilots WHERE site_id=p_site_id AND enabled)
   OR jsonb_typeof(p_mutation->'operation') IS DISTINCT FROM 'object'
   OR p_mutation#>>'{operation,id}' IS DISTINCT FROM 'self-checkout:'||p_operation_key
   OR coalesce(p_mutation#>>'{operation,fingerprint}','')!~'^[a-f0-9]{64}$'
   OR EXISTS(SELECT 1 FROM public.faolla_redemption_checkouts WHERE merchant_id=p_site_id AND operation_id='self-checkout:'||p_operation_key)
   OR EXISTS(SELECT 1 FROM public.faolla_redemption_operations WHERE merchant_id=p_site_id AND operation_id='self-checkout:'||p_operation_key)
   THEN RAISE EXCEPTION 'checkout_047_context_required';END IF;
  member_id:=p_mutation#>>'{operation,membershipId}';request_hash:=p_mutation#>>'{operation,fingerprint}';
 ELSE
  IF NOT FOUND OR original.principal_key IS DISTINCT FROM p_principal_key OR p_mutation ? 'operation'
   OR EXISTS(SELECT 1 FROM faolla_checkout_design.bundle_cancellations WHERE site_id=p_site_id AND operation_key=p_operation_key)
   THEN RAISE EXCEPTION 'checkout_047_context_required';END IF;
  member_id:=original.receipt->>'membershipId';
 END IF;
 IF member_id IS NULL OR length(member_id) NOT BETWEEN 1 AND 160
  OR (SELECT count(*) FROM public.pages WHERE slug='__merchant_memberships__:'||p_site_id)<>1
  THEN RAISE EXCEPTION 'checkout_047_context_invalid';END IF;
 SELECT * INTO STRICT page FROM public.pages WHERE slug='__merchant_memberships__:'||p_site_id FOR UPDATE;
 IF page.merchant_id IS DISTINCT FROM p_site_id OR jsonb_typeof(page.blocks) IS DISTINCT FROM 'array'
  OR (SELECT count(*) FROM jsonb_array_elements(page.blocks) m WHERE m->>'id'=member_id)<>1
  OR jsonb_array_length(page.blocks)<>jsonb_array_length(p_mutation#>'{memberships,next}')
  OR (SELECT count(*) FROM jsonb_array_elements(p_mutation#>'{memberships,next}') m WHERE m->>'id'=member_id)<>1
  THEN RAISE EXCEPTION 'checkout_047_context_invalid';END IF;
 SELECT value INTO before_member FROM jsonb_array_elements(page.blocks) m WHERE m->>'id'=member_id;
 SELECT value INTO after_member FROM jsonb_array_elements(p_mutation#>'{memberships,next}') m WHERE m->>'id'=member_id;
 account_id:=split_part(p_principal_key,':',2);user_id:=split_part(p_principal_key,':',3);
 IF before_member->>'siteId' IS DISTINCT FROM p_site_id OR after_member->>'siteId' IS DISTINCT FROM p_site_id
  OR before_member->>'accountId' IS DISTINCT FROM after_member->>'accountId' OR before_member->>'userId' IS DISTINCT FROM after_member->>'userId'
  OR coalesce(before_member->>'accountId','') NOT IN ('',account_id) OR coalesce(before_member->>'userId','') NOT IN ('',user_id)
  OR coalesce(before_member->>'accountId','')='' AND coalesce(before_member->>'userId','')=''
  OR before_member->'balanceAmount' IS DISTINCT FROM after_member->'balanceAmount'
  OR jsonb_typeof(before_member->'transactions') IS DISTINCT FROM 'array' OR jsonb_typeof(after_member->'transactions') IS DISTINCT FROM 'array'
  OR (SELECT coalesce(jsonb_agg(m ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(page.blocks) WITH ORDINALITY x(m,n) WHERE m->>'id'<>member_id)
   IS DISTINCT FROM (SELECT coalesce(jsonb_agg(m ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(p_mutation#>'{memberships,next}') WITH ORDINALITY x(m,n) WHERE m->>'id'<>member_id)
  THEN RAISE EXCEPTION 'checkout_047_context_invalid';END IF;
 SELECT coalesce(jsonb_agg(t),'[]'::jsonb) INTO new_transactions FROM jsonb_array_elements(after_member->'transactions') t
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(before_member->'transactions') old WHERE old->>'id'=t->>'id');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(new_transactions) t WHERE jsonb_typeof(t->'pointDelta') IS DISTINCT FROM 'number'
  OR t->'balanceDelta' IS DISTINCT FROM '0'::jsonb OR t->>'status' IS DISTINCT FROM 'completed')
  THEN RAISE EXCEPTION 'checkout_047_context_invalid';END IF;
 SELECT coalesce(sum((t->>'pointDelta')::numeric),0) INTO delta FROM jsonb_array_elements(new_transactions) t;
 IF jsonb_typeof(before_member->'pointBalance') IS DISTINCT FROM 'number' OR jsonb_typeof(after_member->'pointBalance') IS DISTINCT FROM 'number'
  OR (after_member->>'pointBalance')::numeric-(before_member->>'pointBalance')::numeric IS DISTINCT FROM delta
  THEN RAISE EXCEPTION 'checkout_047_context_invalid';END IF;
 IF p_phase='payment' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(new_transactions) t WHERE (t->>'pointDelta')::numeric<0
   AND (t->>'operatorId' IS DISTINCT FROM 'customer:'||account_id OR t->>'type' IS DISTINCT FROM 'redeem'))
   THEN RAISE EXCEPTION 'checkout_047_context_invalid';END IF;
  SELECT coalesce(-sum((t->>'pointDelta')::numeric),0) INTO points FROM jsonb_array_elements(new_transactions) t WHERE t->>'operatorId'='customer:'||account_id;
 ELSE
  IF jsonb_array_length(new_transactions)<>1 OR delta<=0 THEN RAISE EXCEPTION 'checkout_047_context_invalid';END IF;
  tx:=new_transactions->0;
  IF tx->>'operatorId' IS DISTINCT FROM 'system' OR tx->>'type' IS DISTINCT FROM 'recharge'
   OR position('[member-checkout-return:'||p_operation_key||']' in coalesce(tx->>'note',''))=0
   THEN RAISE EXCEPTION 'checkout_047_context_invalid';END IF;
  points:=delta;
 END IF;
 -- The unique phase row is inserted BEFORE the old atomic writer. A duplicate
 -- phase never invokes it; the outer command alone handles idempotent replay.
 INSERT INTO faolla_checkout_design.redemption_047_audits VALUES(p_site_id,p_operation_key,p_phase,p_principal_key,member_id,request_hash,points,
  encode(sha256(convert_to(p_mutation::text,'UTF8')),'hex'));
 result:=public.faolla_commit_redemption_internal_v1(p_site_id,p_mutation);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION faolla_checkout_design.commit_redemption_047(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,faolla_checkout_runtime;
GRANT EXECUTE ON FUNCTION faolla_checkout_design.commit_redemption_047(text,text,text,text,jsonb) TO faolla_checkout_executor;
COMMIT;
