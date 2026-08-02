-- Durable cache for real provider flight search results (SerpApi).
--
-- Run once in the Supabase SQL editor.
--
-- Why this table exists: /api/flights called the active provider on every request with
-- no cache in front of it at all. QuoteCache records the cheapest fare AFTER a search so
-- /api/flights/estimates can borrow a real number for the discovery page, but nothing
-- ever read it back BEFORE paying for a new search -- two people (or the same person
-- refreshing) asking for the identical origin, destination, dates, passengers and cabin
-- within the same few minutes triggered two billed SerpApi calls. Unlike API-Sports or
-- Ticketmaster, SerpApi has no free daily allowance at all: every repeat call is a
-- dollar cost, not just latency.
--
-- Two tiers, the same shape as fixtures_cache/event_cache: memory first, then this
-- table, because Render's free tier spins the service down after ~15 minutes idle and a
-- memory-only cache dies with it.
--
-- One row per (origin, destination, dates, passenger mix, stops, cabin) -- the same key
-- QuoteCache already uses, plus cabin class, which materially changes what SerpApi is
-- asked for and QuoteCache omits.

create table if not exists public.flight_search_cache (
  cache_key      text        primary key,
  origin         text        not null,
  destination    text        not null,
  departure_date date,
  return_date    date,
  payload        jsonb       not null,
  expires_at     timestamptz not null,
  updated_at     timestamptz not null default now()
);

-- Expiry is checked on read, but an index keeps cleanup cheap.
create index if not exists flight_search_cache_expires_at_idx
  on public.flight_search_cache (expires_at);

-- This table is written only by the server using the service key, which bypasses RLS.
-- Enabling RLS with no policy therefore denies every anon/authenticated client while
-- leaving the server unaffected: browsers must never read or write the cache directly.
alter table public.flight_search_cache enable row level security;

-- Optional housekeeping: drop rows that expired more than a week ago.
--   delete from public.flight_search_cache where expires_at < now() - interval '7 days';
