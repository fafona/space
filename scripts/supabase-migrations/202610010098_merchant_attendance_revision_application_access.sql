-- Candidate application access, never a public/browser grant. HTTP activation
-- remains separate and default-off. Apply only with the matching v2 consumers.
begin;
set local lock_timeout='3s';

-- Fail closed on incomplete/out-of-order installs before granting anything.
do $access$ begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610010095 and name='merchant_attendance_revision_cycles')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610010096 and name='merchant_attendance_current_correction_decisions')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610010097 and name='merchant_attendance_revision_history') then
    raise exception 'attendance_application_prerequisite_required';
  end if;
end; $access$;

-- Deferred constraints run at COMMIT, after the RPC's SECURITY DEFINER scope
-- has ended. Let this private read-only consistency check use its trusted owner,
-- not the service role (which must never read/write the internal journals directly).
alter function public.faolla_attendance_revision_decision_link_v1() security definer set search_path=pg_catalog;
revoke all on function public.faolla_attendance_revision_decision_link_v1() from public,anon,authenticated,service_role;

revoke all on function public.faolla_attendance_revision_self_v2(text,uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.faolla_attendance_revision_owner_review_v3(text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.faolla_attendance_revision_decide_v2(text,uuid,uuid,jsonb,uuid,boolean) from public,anon,authenticated;
revoke all on function public.faolla_attendance_correction_decide_v2(text,uuid,uuid,jsonb,uuid,boolean) from public,anon,authenticated;
revoke all on function public.faolla_attendance_revision_history_v1(text,uuid,jsonb) from public,anon,authenticated;

grant execute on function public.faolla_attendance_revision_self_v2(text,uuid,jsonb,jsonb,boolean) to service_role;
grant execute on function public.faolla_attendance_revision_owner_review_v3(text,uuid,uuid) to service_role;
grant execute on function public.faolla_attendance_revision_decide_v2(text,uuid,uuid,jsonb,uuid,boolean) to service_role;
grant execute on function public.faolla_attendance_correction_decide_v2(text,uuid,uuid,jsonb,uuid,boolean) to service_role;
grant execute on function public.faolla_attendance_revision_history_v1(text,uuid,jsonb) to service_role;

-- Internal checks, effects, lineage helpers, legacy decision candidates and all
-- direct table writes remain private. No merchant/employee updates.
insert into public.faolla_schema_migrations(version,name) values(202610010098,'merchant_attendance_revision_application_access') on conflict(version) do nothing;
commit;
