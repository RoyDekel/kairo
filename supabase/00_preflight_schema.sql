-- Preflight — run this FIRST, before the audit and after any deploy that touches Supabase.
--
-- Every file in supabase/ is applied by hand in the SQL editor. Nothing in the app checks
-- that this happened, and nothing fails loudly when it did not: FareHistory catches its
-- own write errors on purpose, because losing one observation must never cost a user
-- their search. The cost of that correct decision is that a missing column looks exactly
-- like an empty table for as long as nobody looks.
--
-- This query is the "did I actually run the migrations" check.


-- 1. Which tables exist?
with expected(table_name, defined_in) as (
  values
    ('fare_observations',   'supabase/fare_observations.sql'),
    ('flight_search_cache', 'supabase/flight_search_cache.sql'),
    ('event_cache',         'supabase/event_cache.sql'),
    ('fixtures_cache',      'supabase/fixtures_cache.sql'),
    ('api_usage_daily',     'supabase/api_usage_daily.sql')
)
select
  e.table_name,
  e.defined_in,
  case when t.tablename is null then 'MISSING — run this file' else 'ok' end as status
from expected e
left join pg_tables t
  on t.schemaname = 'public' and t.tablename = e.table_name
order by status desc, e.table_name;


-- 2. Which columns exist on fare_observations?
--
-- `currency` and `collected_by` were added by Phase 0. The server writes both on EVERY
-- insert, so while they are missing PostgREST rejects the row, FareHistory swallows the
-- error, and the fare baseline silently records nothing at all. `statsForRoutes` also
-- filters on `currency`, so every historical percentile comes back null and the UI
-- correctly reports "no history yet" — for a reason that has nothing to do with history.
with expected(column_name, added_by) as (
  values
    ('route',           'initial'),
    ('origin',          'initial'),
    ('destination',     'initial'),
    ('departure_date',  'initial'),
    ('return_date',     'initial'),
    ('trip_nights',     'initial'),
    ('roundtrip_price', 'initial'),
    ('provider',        'initial'),
    ('observed_at',     'initial'),
    ('currency',        'Phase 0'),
    ('collected_by',    'Phase 0')
)
select
  e.column_name,
  e.added_by,
  case when c.column_name is null then 'MISSING' else 'ok' end as status
from expected e
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name  = 'fare_observations'
 and c.column_name = e.column_name
order by status desc, e.added_by, e.column_name;


-- 3. If anything above says MISSING, run the file named in column 2 and re-run this.
--
--    supabase/fare_observations.sql is idempotent — `create table if not exists` plus
--    `add column if not exists` — so running it on an existing table only adds what is
--    absent and cannot lose data.
--
-- Once everything reads 'ok', run supabase/audit_phase1.sql.
