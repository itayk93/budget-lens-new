-- Allow server flows that currently use publishable key fallback to write messenger sync tables.
-- This keeps parity with existing app tables that allow anon access.

drop policy if exists authenticated_full_access on public.messenger_sync_state;
create policy messenger_sync_state_full_access
on public.messenger_sync_state
for all
to anon, authenticated
using (true)
with check (true);
drop policy if exists authenticated_full_access on public.messenger_sync_runs;
drop policy if exists messenger_sync_runs_full_access on public.messenger_sync_runs;
create policy messenger_sync_runs_full_access
on public.messenger_sync_runs
for all
to anon, authenticated
using (true)
with check (true);
drop policy if exists authenticated_full_access on public.messenger_threads;
drop policy if exists messenger_threads_full_access on public.messenger_threads;
create policy messenger_threads_full_access
on public.messenger_threads
for all
to anon, authenticated
using (true)
with check (true);
drop policy if exists authenticated_full_access on public.messenger_messages;
drop policy if exists messenger_messages_full_access on public.messenger_messages;
create policy messenger_messages_full_access
on public.messenger_messages
for all
to anon, authenticated
using (true)
with check (true);
