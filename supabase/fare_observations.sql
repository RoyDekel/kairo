-- Every real fare KAIRO has ever seen, so "below the usual price" can stop being a guess.
--
-- Run once in the Supabase SQL editor.
--
-- Why this table exists: the discovery page advertised a saving against
-- `averageMarketPrice = roundtripPrice * 1.35`. That benchmark is the fare itself, so the
-- saving was algebraically fixed at 26% for every route, every date and every price, and
-- the match score built on top of it could only ever return 81 or 66. A percentage that
-- cannot vary is not a measurement.
--
-- Only fares a real provider actually quoted are written here. Simulated estimates are
-- excluded on purpose: seeding the history with modelled numbers would produce a baseline
-- that measures the model rather than the market, which is the same mistake in a slower
-- form.
--
-- The table starts empty and is useful from roughly the fifth observation of a route. Until
-- then the API reports no historical percentile and the UI says so, rather than inventing
-- one.

create table if not exists public.fare_observations (
  id              bigserial   primary key,
  route           text        not null,          -- 'TLV-BCN', for the percentile lookup
  origin          text        not null,
  destination     text        not null,
  departure_date  date,
  return_date     date,
  trip_nights     integer,
  roundtrip_price numeric     not null,
  provider        text        not null,
  currency        text        not null default 'USD',
  collected_by    text        not null default 'user_search', -- 'user_search' | 'collector'
  observed_at     timestamptz not null default now()
);

-- Schema migration for existing tables created before Phase 0:
alter table public.fare_observations add column if not exists currency text not null default 'USD';
alter table public.fare_observations add column if not exists collected_by text not null default 'user_search';

-- The read is always "recent observations for these routes in a specific currency".
create index if not exists fare_observations_route_observed_idx
  on public.fare_observations (route, observed_at desc);

create index if not exists fare_observations_route_currency_idx
  on public.fare_observations (route, currency, observed_at desc);

-- Written only by the server using the service key, which bypasses RLS. Enabling RLS with
-- no policy denies every anon/authenticated client while leaving the server unaffected.
alter table public.fare_observations enable row level security;

-- Optional housekeeping: the percentile only reads a 90-day window.
--   delete from public.fare_observations where observed_at < now() - interval '400 days';
