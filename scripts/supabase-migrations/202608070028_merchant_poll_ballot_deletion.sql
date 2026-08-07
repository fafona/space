-- Allow the server-side service role to remove a merchant's poll results.
-- The public API still requires an authenticated merchant session and exact
-- merchant/poll scoping before issuing the delete.

begin;

grant delete on table public.merchant_poll_ballots to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608070028, 'merchant_poll_ballot_deletion')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
