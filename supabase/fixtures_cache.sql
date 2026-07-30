-- Durable cache for API-Sports daily fixture payloads.
--
-- Run once in the Supabase SQL editor.
--
-- Why this table exists: the fixture cache used to live only in process memory, and
-- Render's free tier spins the service down after ~15 minutes idle. The advertised
-- six-hour TTL was therefore fiction — almost every search was a cold start paying the
-- full API cost, against an allowance of 100 requests per day.
--
-- One row per calendar date. A single /fixtures?date= response covers every fixture on
-- Earth for that day, so this is shared by all 32 destinations and all users.

create table if not exists public.fixtures_cache (
  fixture_date date primary key,
  payload      jsonb       not null,
  expires_at   timestamptz not null,
  updated_at   timestamptz not null default now()
);

-- Expiry is checked on read, but an index keeps cleanup cheap.
create index if not exists fixtures_cache_expires_at_idx
  on public.fixtures_cache (expires_at);

-- This table is written only by the server using the service key, which bypasses RLS.
-- Enabling RLS with no policy therefore denies every anon/authenticated client while
-- leaving the server unaffected: browsers must never read or write the cache directly.
alter table public.fixtures_cache enable row level security;

-- Optional housekeeping: drop rows that expired more than a week ago.
--   delete from public.fixtures_cache where expires_at < now() - interval '7 days';
