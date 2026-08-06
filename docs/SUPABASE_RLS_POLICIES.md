# Supabase Row Level Security (RLS) Configuration Guide

To ensure that unauthenticated users or malicious API requests using the public anonymous key (`VITE_SUPABASE_ANON_KEY`) cannot read, write, or tamper with user data outside their own authenticated account, execute the following SQL in your **Supabase Dashboard → SQL Editor**.

---

## 1. Enable Row Level Security (RLS) on All Tables

```sql
-- Enable Row Level Security
ALTER TABLE IF EXISTS watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_preferences ENABLE ROW LEVEL SECURITY;
```

---

## 2. Add Ownership Verification Policies (`auth.uid() = user_id`)

```sql
-- Watchlist Policy: Users can only access and manage their own watchlist items
DROP POLICY IF EXISTS "Users manage their own watchlist" ON watchlist;
CREATE POLICY "Users manage their own watchlist"
ON watchlist
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Alerts Policy: Users can only access and manage their own alerts
DROP POLICY IF EXISTS "Users manage their own alerts" ON alerts;
CREATE POLICY "Users manage their own alerts"
ON alerts
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Notifications Policy: Users can only access their own notification logs
DROP POLICY IF EXISTS "Users manage their own notifications" ON notifications;
CREATE POLICY "Users manage their own notifications"
ON notifications
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- User Preferences Policy: Users can only manage their own preferences
DROP POLICY IF EXISTS "Users manage their own preferences" ON user_preferences;
CREATE POLICY "Users manage their own preferences"
ON user_preferences
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

---

## What This Protects
- **Data Isolation**: A logged-in user can only read and mutate rows where `user_id` matches their own Supabase authentication UID (`auth.uid()`).
- **Anon Key Security**: Anyone attempting to query Supabase directly via terminal or browser console using the public anon key without a valid user JWT session will receive empty data or access denied.
