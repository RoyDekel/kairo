-- Precomputed BUY/WAIT verdicts for the featured-hub routes, written nightly by
-- server/jobs/forecastBatch.js so /api/flights does not compute a forecast on the request
-- path.
--
-- Run once in the Supabase SQL editor.
--
-- Why this table exists: forecastRoute() runs a ~1,000-row read, a daily-index rebuild, and
-- (once HF_ENDPOINT_URL is set) a 4s-timeout call to a Chronos endpoint — all inside the
-- user's /api/flights request. On Render's free tier the HF endpoint cold-starts slower
-- than 4s, so live calls would abort into seasonal-naive on nearly every request. Computing
-- off the request path, nightly, is the only way the endpoint is usable at all.
--
-- One row per (route, currency). The payload is the full forecastRoute() return object,
-- stored verbatim so the read path can hand it downstream unchanged. The scalar columns are
-- lifted out of that payload for staleness, price-drift gating, and operability.

create table if not exists public.forecast_cache (
  route                  text        not null,          -- 'TLV-CDG'
  currency               text        not null default 'USD',
  provider               text,                          -- FORECAST_PROVIDER lock in effect, for observability
  verdict                text,                          -- 'BUY_NOW' | 'WAIT' | null (insufficient-history tiers)
  reason                 text        not null,          -- forecastRoute reason: seasonal_naive_forecast, basic_statistics, ...
  confidence_score       integer,                       -- null on tiers 1/2, by design
  computed_current_price numeric,                       -- the assumed price the verdict was computed against (latest observation)
  sample_size            integer,
  distinct_days          integer,
  payload                jsonb       not null,          -- the whole forecastRoute() return object
  computed_at            timestamptz not null default now(),
  primary key (route, currency)
);

-- Housekeeping / staleness sweeps read by recency.
create index if not exists forecast_cache_computed_at_idx
  on public.forecast_cache (computed_at);

-- Written only by the server using the service key, which bypasses RLS. Enabling RLS with
-- no policy denies every anon/authenticated client while leaving the server unaffected —
-- browsers must never read or write this cache directly.
alter table public.forecast_cache enable row level security;

-- Optional housekeeping: drop verdicts no batch has refreshed in a fortnight (a route
-- dropped from the featured set).
--   delete from public.forecast_cache where computed_at < now() - interval '14 days';
