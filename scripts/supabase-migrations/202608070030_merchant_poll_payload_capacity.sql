-- Keep poll payloads bounded while allowing the configured maximum of
-- 30 questions, 36 choices per question and multi-byte response text.

begin;

alter table public.merchant_poll_ballots
  drop constraint if exists merchant_poll_ballots_answers_check;

alter table public.merchant_poll_ballots
  add constraint merchant_poll_ballots_answers_check
  check (jsonb_typeof(answers) = 'array' and pg_column_size(answers) <= 2097152);

alter table public.merchant_poll_ballots
  drop constraint if exists merchant_poll_ballots_poll_snapshot_check;

alter table public.merchant_poll_ballots
  add constraint merchant_poll_ballots_poll_snapshot_check
  check (jsonb_typeof(poll_snapshot) = 'object' and pg_column_size(poll_snapshot) <= 2097152);

insert into public.faolla_schema_migrations (version, name)
values (202608070030, 'merchant_poll_payload_capacity')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
