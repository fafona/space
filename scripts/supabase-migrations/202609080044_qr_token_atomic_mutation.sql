begin;

-- Keep the existing document and token values in place: no copy from history,
-- backup, or another store can reintroduce a token revoked by reset.
-- A duplicate legacy row is ambiguous. Stop rather than choose or merge it.
do $qr_token_preflight$
begin
  if exists (select 1 from public.faolla_schema_migrations
              where version = 202609080044 and name <> 'qr_token_atomic_mutation') then
    raise exception 'qr_token_migration_registry_conflict';
  end if;
  if (select count(*) from public.pages
       where merchant_id is null and slug = '__faolla_qr_tokens__') > 1 then
    raise exception 'qr_token_store_duplicate_rows';
  end if;
end;
$qr_token_preflight$;

create unique index if not exists pages_faolla_qr_tokens_unique_idx
  on public.pages(slug)
  where merchant_id is null and slug = '__faolla_qr_tokens__';

do $qr_token_index_postcondition$
begin
  if not exists (
    select 1 from pg_catalog.pg_index as metadata
     where metadata.indexrelid = to_regclass('public.pages_faolla_qr_tokens_unique_idx')
       and metadata.indrelid = 'public.pages'::regclass
       and metadata.indisunique and metadata.indisvalid and metadata.indisready
       and metadata.indnkeyatts = 1 and metadata.indnatts = 1
       and metadata.indexprs is null
       and pg_catalog.pg_get_indexdef(metadata.indexrelid, 1, true) = 'slug'
       and pg_catalog.pg_get_expr(metadata.indpred, metadata.indrelid)
         = '((merchant_id IS NULL) AND (slug = ''__faolla_qr_tokens__''::text))'
  ) then
    raise exception 'qr_token_unique_index_invalid';
  end if;
end;
$qr_token_index_postcondition$;

create or replace function public.faolla_mutate_qr_token_v1(
  p_account_type text,
  p_account_id text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $qr_token_mutation$
declare
  v_page public.pages%rowtype;
  v_blocks jsonb;
  v_entries jsonb;
  v_key text;
  v_entry jsonb;
  v_token text;
  v_updated_at text;
  v_row_count integer;
begin
  if p_account_type is null or p_account_type not in ('merchant', 'personal')
     or p_account_id is null or p_account_id !~ '^[0-9]{8}$'
     or p_action is null or p_action not in ('ensure', 'reset') then
    raise exception 'invalid_qr_token_mutation';
  end if;

  -- The unique index serializes first creation. A conflicting insert must
  -- never replace another transaction's entries.
  insert into public.pages(merchant_id, slug, blocks)
  values (null, '__faolla_qr_tokens__',
          '{"type":"faolla_qr_tokens","version":1,"entries":{}}'::jsonb)
  on conflict (slug)
    where merchant_id is null and slug = '__faolla_qr_tokens__'
  do nothing;

  select * into strict v_page
    from public.pages
   where merchant_id is null and slug = '__faolla_qr_tokens__'
   for update;

  v_blocks := v_page.blocks;
  if v_blocks is null or jsonb_typeof(v_blocks) <> 'object'
     or (v_blocks ? 'entries' and jsonb_typeof(v_blocks -> 'entries') <> 'object') then
    raise exception 'qr_token_store_corrupt';
  end if;
  v_entries := coalesce(v_blocks -> 'entries', '{}'::jsonb);
  v_key := p_account_type || ':' || p_account_id;
  v_entry := v_entries -> v_key;
  if jsonb_typeof(v_entry) = 'object' and jsonb_typeof(v_entry -> 'token') = 'string' then
    v_token := left(btrim(v_entry ->> 'token'), 128);
  end if;
  if p_action = 'ensure' and coalesce(v_token, '') <> '' then
    if jsonb_typeof(v_entry -> 'updatedAt') = 'string' then
      v_updated_at := left(btrim(v_entry ->> 'updatedAt'), 64);
    end if;
    return jsonb_build_object('token', v_token, 'updatedAt',
      coalesce(nullif(v_updated_at, ''), '1970-01-01T00:00:00.000Z'));
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '');
  v_updated_at := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_entry := jsonb_build_object('token', v_token, 'updatedAt', v_updated_at);
  v_blocks := jsonb_set(v_blocks, '{entries}', v_entries || jsonb_build_object(v_key, v_entry), true);
  update public.pages set blocks = v_blocks
   where id = v_page.id and merchant_id is null and slug = '__faolla_qr_tokens__';
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'qr_token_mutation_not_persisted';
  end if;
  return v_entry;
end;
$qr_token_mutation$;

-- Normalize existing/default grants on this RPC only. Do not change any
-- platform default privileges or the ordinary-account RPC allowlist.
do $qr_token_rpc_acl$
declare
  v_grantee record;
begin
  for v_grantee in
    select distinct acl.grantee, role_metadata.rolname
      from pg_catalog.pg_proc as metadata
      cross join lateral pg_catalog.aclexplode(coalesce(
        metadata.proacl, pg_catalog.acldefault('f', metadata.proowner))) as acl
      left join pg_catalog.pg_roles as role_metadata on role_metadata.oid = acl.grantee
     where metadata.oid = 'public.faolla_mutate_qr_token_v1(text,text,text)'::regprocedure
       and acl.grantee <> metadata.proowner
  loop
    if v_grantee.grantee = 0 then
      revoke all on function public.faolla_mutate_qr_token_v1(text,text,text) from public cascade;
    else
      execute format('revoke all on function public.faolla_mutate_qr_token_v1(text,text,text) from %I cascade',
                     v_grantee.rolname);
    end if;
  end loop;
end;
$qr_token_rpc_acl$;

revoke all on function public.faolla_mutate_qr_token_v1(text, text, text) from public, anon, authenticated;
grant execute on function public.faolla_mutate_qr_token_v1(text, text, text)
  to service_role;

insert into public.faolla_schema_migrations(version, name)
values (202609080044, 'qr_token_atomic_mutation')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
