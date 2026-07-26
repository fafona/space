begin;

create unique index if not exists merchant_customers_legacy_membership_unique_idx
  on public.merchant_customers(merchant_id, legacy_membership_id)
  where legacy_membership_id is not null;

create or replace function public.faolla_upsert_merchant_membership_ledger_v1(
  p_mutations jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mutation jsonb;
  v_customer jsonb;
  v_entry jsonb;
  v_merchant_id text;
  v_membership_id text;
  v_customer_id uuid;
  v_reverses_entry_id uuid;
  v_inserted integer;
  v_count integer := 0;
begin
  if jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'invalid_membership_ledger_mutations_payload';
  end if;

  for v_mutation in
    select value
      from jsonb_array_elements(p_mutations)
  loop
    v_customer := v_mutation -> 'customer';
    if jsonb_typeof(v_customer) <> 'object' then
      raise exception 'invalid_membership_customer_payload';
    end if;

    v_merchant_id := nullif(btrim(v_customer ->> 'merchant_id'), '');
    v_membership_id := nullif(btrim(v_customer ->> 'legacy_membership_id'), '');
    if v_merchant_id is null or v_membership_id is null then
      raise exception 'invalid_membership_customer_identity';
    end if;

    v_customer_id := null;
    insert into public.merchant_customers (
      merchant_id,
      legacy_membership_id,
      member_no,
      account_id,
      auth_user_id,
      email,
      phone,
      display_name,
      status,
      profile,
      created_at,
      updated_at
    )
    values (
      v_merchant_id,
      v_membership_id,
      nullif(btrim(v_customer ->> 'member_no'), ''),
      nullif(btrim(v_customer ->> 'account_id'), ''),
      nullif(btrim(v_customer ->> 'auth_user_id'), ''),
      nullif(lower(btrim(v_customer ->> 'email')), ''),
      nullif(btrim(v_customer ->> 'phone'), ''),
      coalesce(v_customer ->> 'display_name', ''),
      case when v_customer ->> 'status' = 'archived' then 'archived' else 'active' end,
      coalesce(v_customer -> 'profile', '{}'::jsonb),
      coalesce(nullif(v_customer ->> 'created_at', '')::timestamptz, now()),
      coalesce(nullif(v_customer ->> 'updated_at', '')::timestamptz, now())
    )
    on conflict (merchant_id, legacy_membership_id)
      where legacy_membership_id is not null
    do update
    set
      member_no = excluded.member_no,
      account_id = excluded.account_id,
      auth_user_id = excluded.auth_user_id,
      email = excluded.email,
      phone = excluded.phone,
      display_name = excluded.display_name,
      status = excluded.status,
      profile = excluded.profile,
      updated_at = excluded.updated_at
    where excluded.updated_at >= merchant_customers.updated_at
    returning id into v_customer_id;

    if v_customer_id is null then
      select id
        into v_customer_id
        from public.merchant_customers
       where merchant_id = v_merchant_id
         and legacy_membership_id = v_membership_id;
    end if;

    if jsonb_typeof(v_mutation -> 'entries') = 'array' then
      for v_entry in
        select value
          from jsonb_array_elements(v_mutation -> 'entries')
      loop
        if nullif(btrim(v_entry ->> 'idempotency_key'), '') is null
           or nullif(btrim(v_entry ->> 'reference_id'), '') is null then
          raise exception 'invalid_membership_ledger_entry_identity';
        end if;

        v_reverses_entry_id := null;
        if nullif(btrim(v_entry ->> 'reverses_idempotency_key'), '') is not null then
          select id
            into v_reverses_entry_id
            from public.merchant_account_ledger
           where merchant_id = v_merchant_id
             and idempotency_key = btrim(v_entry ->> 'reverses_idempotency_key');
        end if;

        insert into public.merchant_account_ledger (
          merchant_id,
          customer_id,
          account_type,
          delta,
          balance_after,
          currency,
          entry_type,
          reference_type,
          reference_id,
          idempotency_key,
          reverses_entry_id,
          actor_id,
          note,
          metadata,
          created_at
        )
        values (
          v_merchant_id,
          v_customer_id,
          v_entry ->> 'account_type',
          (v_entry ->> 'delta')::bigint,
          nullif(v_entry ->> 'balance_after', '')::bigint,
          nullif(upper(btrim(v_entry ->> 'currency')), ''),
          coalesce(nullif(btrim(v_entry ->> 'entry_type'), ''), 'legacy_membership'),
          coalesce(nullif(btrim(v_entry ->> 'reference_type'), ''), 'legacy_membership_transaction'),
          coalesce(v_entry ->> 'reference_id', ''),
          btrim(v_entry ->> 'idempotency_key'),
          v_reverses_entry_id,
          coalesce(v_entry ->> 'actor_id', ''),
          coalesce(v_entry ->> 'note', ''),
          coalesce(v_entry -> 'metadata', '{}'::jsonb),
          coalesce(nullif(v_entry ->> 'created_at', '')::timestamptz, now())
        )
        on conflict (merchant_id, idempotency_key) do nothing;

        get diagnostics v_inserted = row_count;
        v_count := v_count + v_inserted;
      end loop;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.faolla_upsert_merchant_membership_ledger_v1(jsonb) from public;
grant execute on function public.faolla_upsert_merchant_membership_ledger_v1(jsonb) to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607250003, 'membership_ledger_shadow_write_rpc')
on conflict (version) do nothing;

commit;
