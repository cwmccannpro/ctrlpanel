-- ============================================================
-- AI usage ledger: per-user daily requests and spend on the server's Anthropic
-- key (backend/aiGuard.js). Safe to run more than once.
--
-- Server-only, like google_tokens: RLS is on with NO policy and the browser
-- roles have no grants, so the table is readable only through
-- GET /api/ai/usage. The two functions are SECURITY DEFINER but executable by
-- service_role ONLY (not public/anon/authenticated), so they can't be called
-- through /rest/v1/rpc/* by a signed-in or anonymous browser.
-- Day buckets are UTC.
-- ============================================================
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(12,4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;
grant all on table public.ai_usage to service_role;

-- Reserve one request and its estimated cost for today, or refuse when either
-- daily cap would be exceeded. Row-locked, so concurrent calls can't overshoot.
create or replace function public.ai_usage_reserve(p_user uuid, p_est_usd numeric, p_max_usd numeric, p_max_requests integer)
returns table (allowed boolean, reason text, out_day date, out_requests integer, out_cost_usd numeric)
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'utc')::date;
  u public.ai_usage;
begin
  insert into public.ai_usage (user_id, day) values (p_user, d) on conflict (user_id, day) do nothing;
  select * into u from public.ai_usage a where a.user_id = p_user and a.day = d for update;
  if u.requests >= p_max_requests then
    return query select false, 'requests'::text, d, u.requests, u.cost_usd;
    return;
  end if;
  if u.cost_usd + p_est_usd > p_max_usd then
    return query select false, 'spend'::text, d, u.requests, u.cost_usd;
    return;
  end if;
  update public.ai_usage a
    set requests = a.requests + 1, cost_usd = a.cost_usd + p_est_usd, updated_at = now()
    where a.user_id = p_user and a.day = d
    returning * into u;
  return query select true, ''::text, d, u.requests, u.cost_usd;
end;
$$;

-- Replace the reserved estimate with the real cost (delta) and add token counts.
create or replace function public.ai_usage_settle(p_user uuid, p_day date, p_delta_usd numeric, p_input bigint, p_output bigint)
returns void
language sql security definer set search_path = public as $$
  update public.ai_usage a
    set cost_usd = greatest(0, a.cost_usd + p_delta_usd),
        input_tokens = a.input_tokens + greatest(p_input, 0),
        output_tokens = a.output_tokens + greatest(p_output, 0),
        updated_at = now()
    where a.user_id = p_user and a.day = p_day;
$$;

revoke all on function public.ai_usage_reserve(uuid, numeric, numeric, integer) from public, anon, authenticated;
revoke all on function public.ai_usage_settle(uuid, date, numeric, bigint, bigint) from public, anon, authenticated;
grant execute on function public.ai_usage_reserve(uuid, numeric, numeric, integer) to service_role;
grant execute on function public.ai_usage_settle(uuid, date, numeric, bigint, bigint) to service_role;
