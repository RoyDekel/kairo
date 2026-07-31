-- Durable daily call counter, enforcing the API-Sports 100/day ceiling.
--
-- Run once in the Supabase SQL editor, after fixtures_cache.sql.
--
-- Why this exists: rateLimiter.js enforced 10 requests/minute and documented — but did not
-- enforce — the 100/day cap. A rate limit controls how fast a budget is spent, not whether
-- it runs out. During the original incident the limiter paced requests perfectly, six
-- seconds apart, all the way past a hundred until the account was suspended.
--
-- The counter lives here rather than in process memory because Render's free tier restarts
-- the service constantly, and a counter that resets on every cold start enforces nothing.

create table if not exists public.api_usage_daily (
  provider  text not null,
  usage_day date not null,
  calls     integer not null default 0,
  primary key (provider, usage_day)
);

-- Written only by the server via the service key, which bypasses RLS. Enabling RLS with no
-- policy denies every anon/authenticated client while leaving the server unaffected — a
-- browser must not be able to read, reset or inflate the quota counter.
alter table public.api_usage_daily enable row level security;

/*
  Atomic increment, returning the count AFTER incrementing.

  This has to happen inside the database. A read-then-write from the application would let
  concurrent requests — and separate Render instances — each read 99, each conclude they
  are within budget, and each proceed. That is the same class of race as the cache
  stampede that caused the original suspension, so it is worth being explicit about.
*/
create or replace function public.increment_api_usage(p_provider text, p_day date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.api_usage_daily (provider, usage_day, calls)
       values (p_provider, p_day, 1)
  on conflict (provider, usage_day)
    do update set calls = api_usage_daily.calls + 1
    returning calls into new_count;

  return new_count;
end;
$$;

-- Handy for checking today's spend by hand:
--   select * from public.api_usage_daily order by usage_day desc limit 7;
