-- Synthetic disposable database only. Run after the additive guest migration.
create table public.guest_chat_legacy_sentinel (id text primary key, value text);
insert into public.guest_chat_legacy_sentinel values ('original','unchanged');
do $$
declare a jsonb; b jsonb; tid uuid; other uuid; n bigint; i integer; req uuid:=gen_random_uuid();
begin
  assert exists(select 1 from public.faolla_schema_migrations where version=202611160215 and name='merchant_guest_chat');
  a:=public.merchant_guest_chat_create_session(repeat('a',64),repeat('1',64));
  b:=public.merchant_guest_chat_create_session(repeat('b',64),repeat('2',64));
  assert a->>'guestNumber' ~ '^[1-9][0-9]{7}$';
  assert a->>'guestNumber' <> b->>'guestNumber';
  assert public.merchant_guest_chat_create_session(repeat('a',64),repeat('1',64))=a;
  tid:=public.merchant_guest_chat_send('99990001',null,repeat('a',64),'guest',req,'visitor says hello',null);
  assert public.merchant_guest_chat_send('99990001',null,repeat('a',64),'guest',req,'visitor says hello',null)=tid;
  assert (select count(*) from public.merchant_guest_chat_messages where thread_id=tid)=1;
  assert (select unread from public.merchant_guest_chat_list('99990001',null,null,'merchant',0))=1;
  assert (select guest_number from public.merchant_guest_chat_list('99990001',null,null,'merchant',0))=a->>'guestNumber';
  assert not exists(select 1 from public.merchant_guest_chat_list('99990001',(b->>'id')::uuid,tid,'guest',0));
  assert not exists(select 1 from public.merchant_guest_chat_list('99990002',null,tid,'merchant',0));
  begin
    perform public.merchant_guest_chat_send('99990001',null,repeat('a',64),'guest',req,'changed text',null);
    raise exception 'expected idempotency rejection';
  exception when raise_exception then if sqlerrm <> 'guest_chat_idempotency_conflict' then raise; end if; end;
  begin
    perform public.merchant_guest_chat_send('99990002',tid,null,'merchant',gen_random_uuid(),'wrong merchant','owner:other');
    raise exception 'expected tenant rejection';
  exception when raise_exception then if sqlerrm <> 'guest_chat_not_found' then raise; end if; end;
  perform public.merchant_guest_chat_send('99990001',tid,null,'merchant',gen_random_uuid(),'merchant reply','owner:synthetic');
  assert (select unread from public.merchant_guest_chat_list('99990001',(a->>'id')::uuid,tid,'guest',0))=1;
  select max(sequence) into n from public.merchant_guest_chat_messages where thread_id=tid;
  begin
    perform public.merchant_guest_chat_mark_read('99990001',tid,repeat('b',64),'guest',n);
    raise exception 'expected visitor isolation';
  exception when raise_exception then if sqlerrm <> 'guest_chat_unauthorized' then raise; end if; end;
  perform public.merchant_guest_chat_mark_read('99990001',tid,repeat('a',64),'guest',999999999999999999);
  perform public.merchant_guest_chat_mark_read('99990001',tid,null,'merchant',n);
  assert (select unread from public.merchant_guest_chat_list('99990001',(a->>'id')::uuid,tid,'guest',0))=0;
  perform public.merchant_guest_chat_send('99990001',tid,null,'merchant',gen_random_uuid(),'new reply after oversized read cursor','owner:synthetic');
  assert (select unread from public.merchant_guest_chat_list('99990001',(a->>'id')::uuid,tid,'guest',0))=1;
  for i in 2..20 loop perform public.merchant_guest_chat_send('99990001',null,repeat('a',64),'guest',gen_random_uuid(),'rate fixture',null); end loop;
  begin
    perform public.merchant_guest_chat_send('99990001',null,repeat('a',64),'guest',gen_random_uuid(),'rate exceeded',null);
    raise exception 'expected durable message rate limit';
  exception when raise_exception then if sqlerrm <> 'guest_chat_rate_limited' then raise; end if; end;
  -- An acknowledged retry still works at the limit.
  assert public.merchant_guest_chat_send('99990001',null,repeat('a',64),'guest',req,'visitor says hello',null)=tid;
  update public.merchant_guest_chat_sessions set expires_at=now()-interval '1 second' where id=(b->>'id')::uuid;
  begin
    perform public.merchant_guest_chat_send('99990001',null,repeat('b',64),'guest',gen_random_uuid(),'expired',null);
    raise exception 'expected expired credential rejection';
  exception when raise_exception then if sqlerrm <> 'guest_chat_unauthorized' then raise; end if; end;
  for i in 1..20 loop perform public.merchant_guest_chat_create_session(md5('creation-'||i)||md5('creation-'||i),repeat('3',64)); end loop;
  begin
    perform public.merchant_guest_chat_create_session(repeat('c',64),repeat('3',64));
    raise exception 'expected durable session rate limit';
  exception when raise_exception then if sqlerrm <> 'guest_chat_rate_limited' then raise; end if; end;
  assert (select value from public.guest_chat_legacy_sentinel where id='original')='unchanged';
end $$;
-- Neither public client role can read messages, allocate identity or write.
do $$
declare r text; t text; f text;
begin
  foreach r in array array['anon','authenticated'] loop
    foreach t in array array['merchant_guest_chat_sessions','merchant_guest_chat_threads','merchant_guest_chat_messages'] loop
      assert not has_table_privilege(r,'public.'||t,'select');
      assert not has_table_privilege(r,'public.'||t,'insert');
      assert not has_table_privilege(r,'public.'||t,'update');
      assert not has_table_privilege(r,'public.'||t,'delete');
      assert (select relrowsecurity from pg_class where oid=('public.'||t)::regclass);
    end loop;
    foreach f in array array['merchant_guest_chat_create_session(text,text)','merchant_guest_chat_send(text,uuid,text,text,uuid,text,text)','merchant_guest_chat_mark_read(text,uuid,text,text,bigint)','merchant_guest_chat_list(text,uuid,uuid,text,integer)'] loop
      assert not has_function_privilege(r,'public.'||f,'execute');
      assert has_function_privilege('service_role','public.'||f,'execute');
    end loop;
  end loop;
end $$;
