-- Tune new-client push polling cadence and remove daypart gating.
-- Goal: detect Google Sheets updates quickly and consistently.

create or replace function public._maybe_send_new_client_push()
returns void
language plpgsql
security definer
set search_path = public, cron, extensions, net
as $$
declare
    request_id bigint;
begin
    request_id := net.http_post(
        url := 'https://btaxsfkwhsjaqdkyvcnq.functions.supabase.co/new-client-push',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
    );

    perform request_id;
end;
$$;
create or replace function public.schedule_new_client_push()
returns void
language plpgsql
security definer
set search_path = public, cron, extensions
as $$
begin
    perform public._unschedule_new_client_push();
    begin
        perform schedule('new_client_push', '*/3 * * * *', 'select public._maybe_send_new_client_push();');
    exception when undefined_function then
        null;
    end;
end;
$$;
select public.schedule_new_client_push();
