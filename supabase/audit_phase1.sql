-- Phase 1 verification — run in the Supabase SQL editor after a live search.
--
-- PREREQUISITE: run supabase/00_preflight_schema.sql first.
--
-- If that reports anything MISSING, run the migration file it names before continuing.
-- `column "currency" does not exist` here means supabase/fare_observations.sql was never
-- applied — which also means the server has been silently failing to record every fare
-- since Phase 0 deployed, because FareHistory catches its own write errors by design.
--
-- The point of these queries is that "the app looks normal" cannot distinguish a working
-- fli provider from a silent fallback to the simulated one. The UI renders both the same
-- way. fare_observations can tell them apart, because FareHistory refuses to record a
-- simulated quote — so the presence or absence of a row IS the signal.


-- 1. Did the search actually reach a real provider?
--
-- A row here means a non-simulated provider quoted a fare. NO ROW after a search means
-- the provider threw and the simulated fallback served the page — which is the failure
-- mode that looks completely normal on screen.
select
  observed_at,
  route,
  provider,
  currency,
  collected_by,
  roundtrip_price
from public.fare_observations
order by observed_at desc
limit 20;


-- 2. Which providers have ever written, and in which currency?
--
-- 'fli' rows appearing from the deploy onward is the confirmation you want.
-- More than one currency for the same route means the median in FareHistory is
-- comparing numbers that are not comparable — see FARE_CURRENCY in .env.example.
select
  provider,
  currency,
  count(*)                as observations,
  min(observed_at)        as first_seen,
  max(observed_at)        as last_seen,
  round(min(roundtrip_price)) as cheapest,
  round(avg(roundtrip_price)) as mean,
  round(max(roundtrip_price)) as dearest
from public.fare_observations
group by provider, currency
order by last_seen desc;


-- 3. CONTAMINATION CHECK — rows written by the pre-fix fli provider.
--
-- The first implementation priced every return leg at a hardcoded $200 and stored the
-- passenger-multiplied total in `price`. Both inflate roundtrip_price, and neither is
-- distinguishable from a real quote once written.
--
-- On Render this probably wrote nothing: the provider shelled out to a `python` binary
-- that does not exist in a Node image, so it returned no flights and the recording branch
-- never ran. Local development is the real exposure — searches run there with Python and
-- fli installed DID write inflated rows.
--
-- Replace the timestamp with the moment the fix was deployed.
select
  observed_at,
  route,
  roundtrip_price,
  currency
from public.fare_observations
where provider = 'fli'
  and observed_at < timestamptz '2026-08-02 18:00:00+00'   -- <<< set to your deploy time
order by observed_at;

-- If the query above returns rows, delete them. A fabricated fare cannot be corrected
-- after the fact — nothing records what it should have been — so removal is the only
-- option, and it is cheap while the table is still small.
--
--   delete from public.fare_observations
--   where provider = 'fli'
--     and observed_at < timestamptz '2026-08-02 18:00:00+00';


-- 4. Progress toward a usable baseline.
--
-- FareHistory.MIN_OBSERVATIONS = 5. Below that it returns null and the UI is expected to
-- say "no history yet" rather than invent a percentile. This shows how far each route is
-- from producing a real verdict — and how slowly it moves while observations depend on
-- someone happening to search. That gap is what Phase 2's collector exists to close.
select
  route,
  count(*)                        as observations,
  count(*) >= 5                   as verdict_possible,
  round(min(roundtrip_price))     as cheapest_seen,
  max(observed_at)                as last_seen
from public.fare_observations
where observed_at > now() - interval '90 days'
group by route
order by observations desc, route;


-- 5. Cached search results, including any empty payloads left by the broken provider.
--
-- The pre-fix provider returned {outbound: [], return: []} on failure, which reads as a
-- successful result: server.js cached it and served "no flights" for the full 30-minute
-- TTL. Those entries expire on their own, so this is only interesting if run shortly
-- after the bad deploy — but an empty payload showing up later means something is still
-- returning empty instead of throwing.
select
  cache_key,
  updated_at,
  expires_at,
  expires_at > now()                              as still_live,
  jsonb_array_length(coalesce(payload->'outbound', '[]'::jsonb)) as outbound_count,
  jsonb_array_length(coalesce(payload->'return',   '[]'::jsonb)) as return_count
from public.flight_search_cache
order by updated_at desc
limit 20;

-- Flush anything cached empty:
--   delete from public.flight_search_cache
--   where jsonb_array_length(coalesce(payload->'outbound', '[]'::jsonb)) = 0;
