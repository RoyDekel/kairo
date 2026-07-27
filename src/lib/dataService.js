import { supabase } from './supabaseClient';

/**
 * Dual-mode data service.
 * - If user is authenticated → read/write from Supabase.
 * - If guest (no auth) → fall back to localStorage.
 */

// ─── Watchlist ────────────────────────────────────────────

export async function loadWatchlist(userId) {
  if (!supabase || !userId) {
    const saved = localStorage.getItem('watchlist');
    return saved ? JSON.parse(saved) : [];
  }

  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load watchlist from Supabase:', error.message);
    const saved = localStorage.getItem('watchlist');
    return saved ? JSON.parse(saved) : [];
  }

  return data.map((row) => ({
    ...row.flight_data,
    _supabaseId: row.id,
  }));
}

export async function saveWatchlistItem(userId, flight) {
  if (!supabase || !userId) {
    const saved = localStorage.getItem('watchlist');
    const list = saved ? JSON.parse(saved) : [];
    if (!list.some((w) => w.id === flight.id)) {
      list.push(flight);
      localStorage.setItem('watchlist', JSON.stringify(list));
    }
    return;
  }

  const { error } = await supabase
    .from('watchlist')
    .upsert(
      {
        user_id: userId,
        flight_id: flight.id,
        flight_data: flight,
      },
      { onConflict: 'user_id,flight_id' }
    );

  if (error) {
    console.error('Failed to save watchlist item:', error.message);
  }
}

export async function removeWatchlistItem(userId, flightId) {
  if (!supabase || !userId) {
    const saved = localStorage.getItem('watchlist');
    const list = saved ? JSON.parse(saved) : [];
    localStorage.setItem('watchlist', JSON.stringify(list.filter((w) => w.id !== flightId)));
    return;
  }

  const { error } = await supabase
    .from('watchlist')
    .delete()
    .eq('user_id', userId)
    .eq('flight_id', flightId);

  if (error) {
    console.error('Failed to remove watchlist item:', error.message);
  }
}

// ─── Alerts ───────────────────────────────────────────────

const DEFAULT_ALERTS = [
  {
    id: 'seed-alert-1',
    flightNumber: 'W6 5122',
    flightId: 'W6-100-outbound-2026-08-11',
    type: 'price-drop',
    thresholdPrice: 130,
    isActive: true,
    createdAt: '12:00 PM',
  },
  {
    id: 'seed-alert-2',
    flightNumber: 'W6 5122',
    flightId: 'W6-100-outbound-2026-08-11',
    type: 'status-change',
    thresholdPrice: null,
    isActive: true,
    createdAt: '12:00 PM',
  },
];

export async function loadAlerts(userId) {
  if (!supabase || !userId) {
    const saved = localStorage.getItem('alerts');
    return saved ? JSON.parse(saved) : DEFAULT_ALERTS;
  }

  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load alerts from Supabase:', error.message);
    const saved = localStorage.getItem('alerts');
    return saved ? JSON.parse(saved) : DEFAULT_ALERTS;
  }

  return data.map((row) => ({
    id: row.id,
    flightNumber: row.flight_number,
    flightId: row.flight_id,
    type: row.alert_type,
    thresholdPrice: row.threshold_price ? Number(row.threshold_price) : null,
    isActive: row.is_active,
    createdAt: new Date(row.created_at).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  }));
}

export async function saveAlert(userId, alert) {
  if (!supabase || !userId) {
    const saved = localStorage.getItem('alerts');
    const list = saved ? JSON.parse(saved) : [];
    list.unshift(alert);
    localStorage.setItem('alerts', JSON.stringify(list));
    return alert;
  }

  const { data, error } = await supabase
    .from('alerts')
    .insert({
      user_id: userId,
      flight_number: alert.flightNumber,
      flight_id: alert.flightId,
      alert_type: alert.type,
      threshold_price: alert.thresholdPrice,
      is_active: alert.isActive ?? true,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to save alert:', error.message);
    return alert;
  }

  return {
    id: data.id,
    flightNumber: data.flight_number,
    flightId: data.flight_id,
    type: data.alert_type,
    thresholdPrice: data.threshold_price ? Number(data.threshold_price) : null,
    isActive: data.is_active,
    createdAt: new Date(data.created_at).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

export async function deleteAlert(userId, alertId) {
  if (!supabase || !userId) {
    const saved = localStorage.getItem('alerts');
    const list = saved ? JSON.parse(saved) : [];
    localStorage.setItem('alerts', JSON.stringify(list.filter((a) => a.id !== alertId)));
    return;
  }

  const { error } = await supabase
    .from('alerts')
    .delete()
    .eq('id', alertId)
    .eq('user_id', userId);

  if (error) {
    console.error('Failed to delete alert:', error.message);
  }
}

export async function updateAlertStatus(userId, alertId, isActive) {
  if (!supabase || !userId) {
    const saved = localStorage.getItem('alerts');
    const list = saved ? JSON.parse(saved) : [];
    const updated = list.map((a) => (a.id === alertId ? { ...a, isActive } : a));
    localStorage.setItem('alerts', JSON.stringify(updated));
    return;
  }

  const { error } = await supabase
    .from('alerts')
    .update({ is_active: isActive })
    .eq('id', alertId)
    .eq('user_id', userId);

  if (error) {
    console.error('Failed to update alert status:', error.message);
  }
}

// ─── Notifications ────────────────────────────────────────

const DEFAULT_NOTIFICATIONS = [
  {
    id: 'seed-notif-1',
    time: '12:00 PM',
    flightNumber: 'W6 5122',
    type: 'system',
    message:
      'AeroTrack dynamic engine initialized. Select the "Find Flights" tab to query new destinations.',
  },
];

export async function loadNotifications(userId) {
  if (!supabase || !userId) {
    const saved = localStorage.getItem('notifications');
    return saved ? JSON.parse(saved) : DEFAULT_NOTIFICATIONS;
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Failed to load notifications from Supabase:', error.message);
    const saved = localStorage.getItem('notifications');
    return saved ? JSON.parse(saved) : DEFAULT_NOTIFICATIONS;
  }

  return data.map((row) => ({
    id: row.id,
    time: new Date(row.created_at).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    flightNumber: row.flight_number || '',
    type: row.notification_type,
    message: row.message,
  }));
}

export async function saveNotification(userId, notification) {
  if (!supabase || !userId) {
    const saved = localStorage.getItem('notifications');
    const list = saved ? JSON.parse(saved) : [];
    list.unshift(notification);
    localStorage.setItem('notifications', JSON.stringify(list));
    return notification;
  }

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      flight_number: notification.flightNumber || null,
      notification_type: notification.type,
      message: notification.message,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to save notification:', error.message);
    return notification;
  }

  return {
    id: data.id,
    time: new Date(data.created_at).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    flightNumber: data.flight_number || '',
    type: data.notification_type,
    message: data.message,
  };
}

export async function clearNotifications(userId) {
  if (!supabase || !userId) {
    localStorage.setItem('notifications', JSON.stringify([]));
    return;
  }

  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('Failed to clear notifications:', error.message);
  }
}

// ─── User Preferences ────────────────────────────────────

export async function loadPreferences(userId) {
  if (!supabase || !userId) {
    return {
      theme: localStorage.getItem('theme') || 'light',
      defaultAirport: 'TLV',
    };
  }

  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    // No preferences row yet — return defaults
    return {
      theme: localStorage.getItem('theme') || 'light',
      defaultAirport: 'TLV',
    };
  }

  return {
    theme: data.theme || 'light',
    defaultAirport: data.default_airport || 'TLV',
  };
}

export async function savePreferences(userId, prefs) {
  if (!supabase || !userId) {
    if (prefs.theme) localStorage.setItem('theme', prefs.theme);
    return;
  }

  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      {
        user_id: userId,
        theme: prefs.theme,
        default_airport: prefs.defaultAirport,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('Failed to save preferences:', error.message);
  }
}

// ─── First-Login Migration ───────────────────────────────

export async function migrateLocalStorage(userId) {
  if (!supabase || !userId) return;

  const migrated = localStorage.getItem(`migrated_${userId}`);
  if (migrated) return; // Already migrated

  try {
    // Migrate watchlist
    const localWatchlist = localStorage.getItem('watchlist');
    if (localWatchlist) {
      const items = JSON.parse(localWatchlist);
      for (const flight of items) {
        await saveWatchlistItem(userId, flight);
      }
    }

    // Migrate alerts (skip seed alerts)
    const localAlerts = localStorage.getItem('alerts');
    if (localAlerts) {
      const items = JSON.parse(localAlerts);
      for (const alert of items) {
        if (!alert.id.startsWith('seed-')) {
          await supabase.from('alerts').insert({
            user_id: userId,
            flight_number: alert.flightNumber,
            flight_id: alert.flightId,
            alert_type: alert.type,
            threshold_price: alert.thresholdPrice,
            is_active: alert.isActive ?? true,
          });
        }
      }
    }

    // Migrate notifications (skip seed notifications)
    const localNotifications = localStorage.getItem('notifications');
    if (localNotifications) {
      const items = JSON.parse(localNotifications);
      for (const notif of items) {
        if (!notif.id.startsWith('seed-')) {
          await supabase.from('notifications').insert({
            user_id: userId,
            flight_number: notif.flightNumber || null,
            notification_type: notif.type,
            message: notif.message,
          });
        }
      }
    }

    // Migrate theme preference
    const theme = localStorage.getItem('theme');
    if (theme) {
      await savePreferences(userId, { theme, defaultAirport: 'TLV' });
    }

    // Mark as migrated to prevent duplicates
    localStorage.setItem(`migrated_${userId}`, 'true');
    console.log('localStorage data migrated to Supabase successfully.');
  } catch (err) {
    console.error('Migration error:', err);
  }
}
