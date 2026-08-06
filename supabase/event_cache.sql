-- Durable cache for merged event lookups ("When to Go" discovery page).
--
-- Run once in the Supabase SQL editor.
--
-- Why this table exists: EventCache lived only in process memory and advertised a
-- six-hour TTL. On Render's free tier the service spins down after ~15 minutes idle, so
-- the effective TTL was "until nobody uses the app for a quarter of an hour" -- and every
-- wake-up re-ran the full Ticketmaster / API-Sports fan-out for dates a user had already
-- searched. Against Ticketmaster's 5,000/day budget that is the most wasteful thing the
-- product does.
--
-- One row per (provider, destination, window). The key deliberately contains nothing
-- per-user, so two people searching Barcelona for the same dates share one row and only a
-- genuinely cold window pays the rate-limited fan-out.
--
-- Only answers are stored: `ok` and `empty`. An `unavailable` result (rate limited,
-- upstream 500) stays in process memory with its one-minute TTL, because sharing a
-- transient failure across every instance and every user is exactly the wrong thing to
-- make durable.

create table if not exists public.event_cache (
  cache_key   text        primary key,
  destination text        not null,
  start_date  date,
  end_date    date,
  status      text        not null,
  payload     jsonb       not null,
  expires_at  timestamptz not null,
  updated_at  timestamptz not null default now()
);

-- Expiry is checked on read, but an index keeps cleanup cheap.
create index if not exists event_cache_expires_at_idx
  on public.event_cache (expires_at);

-- This table is written only by the server using the service key, which bypasses RLS.
-- Enabling RLS with no policy therefore denies every anon/authenticated client while
-- leaving the server unaffected: browsers must never read or write the cache directly.
alter table public.event_cache enable row level security;

-- Optional housekeeping: drop rows that expired more than a week ago.
--   delete from public.event_cache where expires_at < now() - interval '7 days';
