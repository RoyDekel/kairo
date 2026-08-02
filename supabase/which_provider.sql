-- Which provider actually served each cached search?
--
-- ONE statement, so the Supabase SQL editor shows it. (Pasting a multi-statement script
-- displays only the last result, which is why audit_phase1.sql appeared to return nothing
-- but the cache table.)
--
-- No need to wait for fare_observations: flight_search_cache already stores the raw
-- provider payload, and every provider stamps its own prefix into the flight id.
--
--   FLI-...            the free Google Flights provider — Phase 1 is live
--   SERPAPI-...        still on the paid provider
--   SIMULATED-...      invented fares. The app looks completely normal while serving
--                      these, which is exactly why this query exists.
--   TRAVELPAYOUTS-...  the shared generator in constants.js
--
-- Note only real provider results are ever cached — server.js skips the write when
-- `results.warning` is set. So a TRAVELPAYOUTS- row here means simulation was the ACTIVE
-- provider, not a fallback.

select
  cache_key,
  updated_at,
  expires_at > now()                                  as still_serving,
  split_part(payload->'outbound'->0->>'id', '-', 1)   as provider_prefix,
  payload->'outbound'->0->>'airlineName'              as first_airline,
  payload->'outbound'->0->>'price'                    as first_price,
  -- The simulated generator always reports these; the fli provider always sends null,
  -- because Google's shopping response does not carry them. A fast second opinion.
  payload->'outbound'->0->>'seatsRemaining'           as seats_remaining,
  payload->'outbound'->0->>'baggage'                  as baggage,
  payload->'outbound'->0->>'planeType'                as plane_type
from public.flight_search_cache
order by updated_at desc
limit 20;


-- ------------------------------------------------------------------------------------
-- IF THE PREFIX IS NOT 'FLI'
--
-- Check, in this order:
--
--   1. FLI_ENABLED / FLIGHT_PROVIDER in the Render environment. These live in Render's
--      dashboard, NOT in the repo — deploying .env.example changes nothing. If
--      SERPAPI_KEY is set and FLIGHT_PROVIDER is unset, autodetect picks fli only when
--      FLI_ENABLED === 'true' exactly (the string, not 1 or yes).
--
--   2. The Render startup log. FlightSearchService prints its choice at boot:
--         Active Strategy Provider: [FLI]
--      If it says [SERPAPI] or [SIMULATED], the environment is the problem, not the code.
--
--   3. Whether you were served from cache. Entries live 30 minutes, so a repeat search on
--      the same route/dates/passengers never reaches any provider. `still_serving = true`
--      above means the next identical search will be answered from this row.
--      To force a real call, either change a date by one day or clear the entry:
--
--        delete from public.flight_search_cache where cache_key = '<paste it here>';
--
--      Note the in-process memory tier survives until the next deploy or spin-down, so a
--      delete here may not take effect immediately on a warm instance.
