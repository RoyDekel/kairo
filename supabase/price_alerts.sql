-- Server-side price alerts, so a price drop that happens while the browser is
-- closed still fires a notification.
--
-- Run once in the Supabase SQL editor.
--
-- AlertsManager.jsx has always managed alerts in localStorage. That means:
--   1. Nobody evaluates them when the tab is closed.
--   2. They are lost on a cache clear.
--   3. They cannot be checked against new fare observations on the server.
--
-- This table moves the source of truth to Supabase. The server reads it after
-- each fare collector sweep and fires notifications for any alert whose route
-- now has a fare at or below the target price.

create table if not exists public.price_alerts (
  id               bigserial    primary key,
  user_id          uuid         not null,
  route            text         not null,          -- 'TLV-BCN'
  origin           text         not null,
  destination      text         not null,
  target_price     numeric      not null,
  channel          text         not null default 'telegram',  -- 'telegram' | 'email'
  channel_target   text,                            -- telegram chat_id or email address
  is_active        boolean      not null default true,
  last_notified_at timestamptz,
  created_at       timestamptz  not null default now()
);

-- The evaluator reads "active alerts whose route matches a fresh observation".
create index if not exists price_alerts_active_route_idx
  on public.price_alerts (route, is_active)
  where is_active = true;

-- Written only by the server using the service key, which bypasses RLS.
alter table public.price_alerts enable row level security;
