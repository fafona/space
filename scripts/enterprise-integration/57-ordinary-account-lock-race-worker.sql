\set ON_ERROR_STOP on
\pset pager off

begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

\if :ordinary_staff_writer
  set local role service_role;
  do $$
  begin
    perform public.faolla_create_ordinary_account_authorization_v1(
      'd6000000-0000-4000-8000-000000000001'::uuid,
      'personal',
      '50010108'
    );
  exception when others then
    if sqlerrm = 'ordinary_account_staff_identity_forbidden' then
      raise exception 'ordinary_staff_race_conflict';
    end if;
    raise;
  end;
  $$;
\elif :staff_ordinary_writer
  do $$
  begin
    insert into public.merchant_enterprise_staff_identities (
      auth_user_id,
      email_hash
    ) values (
      'd6000000-0000-4000-8000-000000000001'::uuid,
      repeat('3', 64)
    );
  exception when others then
    if sqlerrm = 'merchant_enterprise_staff_identity_conflict' then
      raise exception 'ordinary_staff_race_conflict';
    end if;
    raise;
  end;
  $$;
\elif :ordinary_delete_writer
  set local role service_role;
  do $$
  begin
    perform public.faolla_create_ordinary_account_authorization_v1(
      'd6000000-0000-4000-8000-000000000002'::uuid,
      'personal',
      '50010109'
    );
  exception when others then
    if sqlerrm = 'ordinary_account_auth_user_not_found' then
      raise exception 'ordinary_auth_delete_race_conflict';
    end if;
    raise;
  end;
  $$;
\elif :delete_ordinary_writer
  do $$
  begin
    delete from auth.users
     where id = 'd6000000-0000-4000-8000-000000000002'::uuid;
  exception when others then
    if sqlerrm = 'ordinary_account_auth_user_delete_forbidden' then
      raise exception 'ordinary_auth_delete_race_conflict';
    end if;
    raise;
  end;
  $$;
\elif :bound_bootstrap_writer
  set local role service_role;
  select public.faolla_bootstrap_ordinary_account_authorization_v1(
    'd6000000-0000-4000-8000-000000000003'::uuid,
    'personal'
  );
\elif :delete_bound_writer
  do $$
  begin
    delete from auth.users
     where id = 'd6000000-0000-4000-8000-000000000003'::uuid;
  exception when others then
    if sqlerrm = 'ordinary_account_auth_user_delete_forbidden' then
      raise exception 'ordinary_bound_delete_race_conflict';
    end if;
    raise;
  end;
  $$;
\elif :system_ordinary_writer
  set local role service_role;
  do $$
  begin
    perform public.faolla_create_ordinary_account_authorization_v1(
      'd3500000-0000-4000-8000-000000000001'::uuid,
      'personal',
      '50010110'
    );
  exception when others then
    if sqlerrm = 'ordinary_account_system_site_forbidden' then
      raise exception 'ordinary_system_site_race_conflict';
    end if;
    raise;
  end;
  $$;
\elif :system_staff_writer
  do $$
  begin
    insert into public.merchant_enterprise_staff_identities (
      auth_user_id,
      email_hash
    ) values (
      'd3500000-0000-4000-8000-000000000001'::uuid,
      repeat('4', 64)
    );
  exception when others then
    if sqlerrm = 'merchant_enterprise_staff_identity_conflict' then
      raise exception 'ordinary_system_site_race_conflict';
    end if;
    raise;
  end;
  $$;
\else
  \quit 88
\endif

commit;
