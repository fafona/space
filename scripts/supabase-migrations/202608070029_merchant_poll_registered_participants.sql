-- Preserve guest/member ballots while allowing authenticated Faolla users to
-- participate in polls that do not require a merchant membership.

begin;

alter table public.merchant_poll_ballots
  drop constraint if exists merchant_poll_ballots_participant_type_check;

alter table public.merchant_poll_ballots
  add constraint merchant_poll_ballots_participant_type_check
  check (participant_type in ('member', 'registered', 'guest'));

insert into public.faolla_schema_migrations (version, name)
values (202608070029, 'merchant_poll_registered_participants')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
