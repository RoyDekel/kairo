import React, { useState, useEffect } from 'react';
import { Bell, Trash2, ShieldAlert, CheckCircle, Info, PlusCircle, Send } from 'lucide-react';
import { getApiBase, authHeaders, fetchWithTimeout } from '../lib/apiBase';

export default function AlertsManager({ 
  alerts, 
  setAlerts, 
  notifications, 
  setNotifications, 
  activeFlight,
  flightDatabase,
  accessToken
}) {
  const [targetPrice, setTargetPrice] = useState(Math.round(activeFlight.price * 0.95));
  const [alertType, setAlertType] = useState('price-drop'); // 'price-drop', 'status-change'
  const [notifChannel, setNotifChannel] = useState('telegram'); // 'telegram' | 'email'
  const [channelTarget, setChannelTarget] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Load server-persisted alerts on mount.
  //
  // Runs only once a session token exists: /api/alerts is behind requireAuth, so
  // firing this without a Bearer token just collects a 401.
  useEffect(() => {
    if (!accessToken) return;

    const fetchServerAlerts = async () => {
      try {
        const resp = await fetchWithTimeout(`${getApiBase()}/api/alerts`, {
          headers: authHeaders(accessToken),
          timeoutMs: 5000
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.alerts && data.alerts.length > 0) {
            // Merge server alerts into local state (avoid duplicates by id)
            const localIds = new Set(alerts.map(a => a.id));
            const serverAlerts = data.alerts
              .filter(sa => !localIds.has(String(sa.id)))
              .map(sa => ({
                id: String(sa.id),
                serverId: sa.id,
                flightNumber: `${sa.origin}-${sa.destination}`,
                flightId: sa.route,
                type: 'price-drop',
                thresholdPrice: Number(sa.target_price),
                isActive: sa.is_active,
                channel: sa.channel,
                channelTarget: sa.channel_target,
                createdAt: new Date(sa.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                serverSynced: true
              }));
            if (serverAlerts.length > 0) {
              setAlerts(prev => [...serverAlerts, ...prev]);
            }
          }
        }
      } catch {
        // Silent — local alerts still work
      }
    };
    fetchServerAlerts();
  }, [accessToken]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Create new alert rule (local + server-side persistence)
  const handleCreateAlert = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    
    const localId = Date.now().toString();
    const newAlert = {
      id: localId,
      serverId: null,
      flightNumber: activeFlight.flightNumber,
      flightId: activeFlight.id,
      type: alertType,
      thresholdPrice: alertType === 'price-drop' ? Number(targetPrice) : null,
      isActive: true,
      channel: notifChannel,
      channelTarget: channelTarget || null,
      createdAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    };

    setAlerts([newAlert, ...alerts]);

    // Persist to server for background evaluation. Only price-drop alerts have a
    // server-side counterpart — status-change alerts are still evaluated in the browser.
    if (alertType === 'price-drop' && accessToken) {
      try {
        const resp = await fetchWithTimeout(`${getApiBase()}/api/alerts`, {
          method: 'POST',
          headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: activeFlight.origin,
            destination: activeFlight.destination,
            targetPrice: Number(targetPrice),
            channel: notifChannel,
            channelTarget: channelTarget || undefined
          }),
          timeoutMs: 5000
        });

        if (resp.ok) {
          // Record the row id the server assigned, so a later delete can address the
          // right row. Without it, DELETE would be sent the local Date.now() id and
          // silently match nothing.
          const data = await resp.json();
          const serverId = data?.alert?.id ?? null;
          if (serverId !== null) {
            setAlerts(prev => prev.map(a => (
              a.id === localId ? { ...a, serverId, serverSynced: true } : a
            )));
          }
          setSuccessMsg('Alert saved — you will be notified even when offline!');
        } else {
          setSuccessMsg('Alert saved locally (server sync pending).');
        }
      } catch {
        setSuccessMsg('Alert saved locally (server sync pending).');
      }
    } else {
      setSuccessMsg('Alert successfully configured!');
    }
    
    setIsSaving(false);
    setTimeout(() => setSuccessMsg(''), 4000);

    // Create an initial system notification confirming the alert creation
    const channelLabel = notifChannel === 'telegram' ? 'Telegram' : 'Email';
    const confirmNotif = {
      id: `system-${Date.now()}`,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      flightNumber: activeFlight.flightNumber,
      type: 'system',
      message: `Watching ${activeFlight.flightNumber} for ${alertType === 'price-drop' ? `price drops below $${targetPrice}` : 'status updates'}. Notifications via ${channelLabel}.`
    };
    setNotifications([confirmNotif, ...notifications]);
  };

  // Delete an alert rule (local + server)
  const handleDeleteAlert = async (id) => {
    const target = alerts.find(alert => alert.id === id);
    setAlerts(alerts.filter(alert => alert.id !== id));

    // Also deactivate on the server, but only for alerts that actually have a row
    // there. A purely local alert has no serverId and nothing to deactivate.
    const serverId = target?.serverId;
    if (!serverId || !accessToken) return;

    try {
      await fetchWithTimeout(`${getApiBase()}/api/alerts/${serverId}`, {
        method: 'DELETE',
        headers: authHeaders(accessToken),
        timeoutMs: 5000
      });
    } catch {
      // Silent — local delete still takes effect
    }
  };

  // Clear all notification logs
  const handleClearNotifications = () => {
    setNotifications([]);
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Header */}
      <div>
        <h3 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bell size={18} style={{ color: 'var(--primary)' }} />
          Smart Alerts & Notification Feed
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Configure custom triggers and review live flight and pricing event logs
        </p>
      </div>

      <div className="alerts-manager-grid">
        
        {/* CREATE & MANAGE ALERTS LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Create Alert Card Form */}
          <form onSubmit={handleCreateAlert} style={{
            background: 'rgba(255, 255, 255, 0.01)',
            border: '1px solid var(--border-glass)',
            borderRadius: 'var(--radius-sm)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <PlusCircle size={15} style={{ color: 'var(--primary)' }} />
              Create Alert for {activeFlight.flightNumber}
            </div>

            {/* Alert Type Selector */}
            <div className="input-group">
              <span className="input-label">Alert Trigger</span>
              <div style={{ display: 'flex', background: 'var(--bg-tertiary)', borderRadius: '6px', border: '1px solid var(--border-glass)', padding: '2px' }}>
                <button
                  type="button"
                  onClick={() => setAlertType('price-drop')}
                  style={{
                    flex: 1,
                    padding: '6px',
                    borderRadius: '4px',
                    border: 'none',
                    background: alertType === 'price-drop' ? 'var(--bg-secondary)' : 'transparent',
                    color: alertType === 'price-drop' ? 'var(--primary)' : 'var(--text-secondary)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: '0.75rem'
                  }}
                >
                  Price Drop
                </button>
                <button
                  type="button"
                  onClick={() => setAlertType('status-change')}
                  style={{
                    flex: 1,
                    padding: '6px',
                    borderRadius: '4px',
                    border: 'none',
                    background: alertType === 'status-change' ? 'var(--bg-secondary)' : 'transparent',
                    color: alertType === 'status-change' ? 'var(--primary)' : 'var(--text-secondary)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: '0.75rem'
                  }}
                >
                  Status Change
                </button>
              </div>
            </div>

            {/* Conditional input if Price Drop Alert is selected */}
            {alertType === 'price-drop' ? (
              <div className="input-group">
                <span className="input-label">Notify if price drops below ($):</span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input 
                    type="number"
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(Number(e.target.value))}
                    className="input-field"
                    style={{ flexGrow: 1, padding: '8px 12px' }}
                    min="1"
                    required
                  />
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Current: ${activeFlight.price}
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', background: 'rgba(0, 242, 254, 0.05)', padding: '10px', borderRadius: '4px', border: '1px solid rgba(0, 242, 254, 0.1)' }}>
                <Info size={14} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '2px' }} />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  You will receive real-time notifications on departure, delays, descent, and landing phases when simulation is running.
                </span>
              </div>
            )}

            {/* Notification Channel Selector */}
            {alertType === 'price-drop' && (
              <>
                <div className="input-group">
                  <span className="input-label">Notification Channel</span>
                  <div style={{ display: 'flex', background: 'var(--bg-tertiary)', borderRadius: '6px', border: '1px solid var(--border-glass)', padding: '2px' }}>
                    <button
                      type="button"
                      onClick={() => setNotifChannel('telegram')}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '4px',
                        border: 'none',
                        background: notifChannel === 'telegram' ? 'var(--bg-secondary)' : 'transparent',
                        color: notifChannel === 'telegram' ? 'var(--primary)' : 'var(--text-secondary)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px'
                      }}
                    >
                      <Send size={12} /> Telegram
                    </button>
                    <button
                      type="button"
                      onClick={() => setNotifChannel('email')}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '4px',
                        border: 'none',
                        background: notifChannel === 'email' ? 'var(--bg-secondary)' : 'transparent',
                        color: notifChannel === 'email' ? 'var(--primary)' : 'var(--text-secondary)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: '0.75rem'
                      }}
                    >
                      ✉ Email
                    </button>
                  </div>
                </div>

                <div className="input-group">
                  <span className="input-label">
                    {notifChannel === 'telegram' ? 'Telegram Chat ID' : 'Email Address'}
                  </span>
                  <input
                    type={notifChannel === 'email' ? 'email' : 'text'}
                    value={channelTarget}
                    onChange={(e) => setChannelTarget(e.target.value)}
                    className="input-field"
                    style={{ padding: '8px 12px' }}
                    placeholder={notifChannel === 'telegram' ? 'e.g. 123456789' : 'you@example.com'}
                  />
                  {notifChannel === 'telegram' && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Send /start to @KairoPriceBot then forward the chat ID here.
                    </span>
                  )}
                </div>
              </>
            )}

            {/* Success message banner */}
            {successMsg && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>
                <CheckCircle size={14} />
                {successMsg}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ padding: '8px 0', fontSize: '0.85rem' }} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Set Notification'}
            </button>
          </form>

          {/* ACTIVE RULES LIST */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Active Rules ({alerts.length})
            </div>
            
            {alerts.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                No active notifications configured.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-glass)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                        {alert.flightNumber}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {alert.type === 'price-drop' 
                          ? `Price drops below $${alert.thresholdPrice}` 
                          : 'Status updates tracking'}
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDeleteAlert(alert.id)}
                      style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', transition: 'color 0.2s' }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* NOTIFICATION LOGS RIGHT COLUMN */}
        <div className="alerts-log-column">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Notifications Log Feed ({notifications.length})
            </div>
            {notifications.length > 0 && (
              <button 
                onClick={handleClearNotifications}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Clear All
              </button>
            )}
          </div>

          {/* Log List */}
          <div style={{
            flexGrow: 1,
            maxHeight: '340px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            {notifications.length === 0 ? (
              <div style={{
                flexGrow: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                gap: '8px',
                textAlign: 'center',
                padding: '40px 0'
              }}>
                <ShieldAlert size={28} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                <span style={{ fontSize: '0.8rem' }}>No notifications received yet.<br />Try triggering the simulation or lowering alert price.</span>
              </div>
            ) : (
              notifications.map((log) => {
                let badgeColor = 'var(--primary-glow-weak)';
                let textColor = 'var(--primary)';
                if (log.type === 'alert') {
                  badgeColor = 'var(--success-glow)';
                  textColor = '#34d399';
                } else if (log.type === 'system') {
                  badgeColor = 'rgba(255, 255, 255, 0.05)';
                  textColor = 'var(--text-secondary)';
                } else if (log.type === 'status-alert') {
                  badgeColor = 'var(--primary-glow-weak)';
                  textColor = 'var(--primary)';
                }

                return (
                  <div
                    key={log.id}
                    className="animate-fade-in"
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--border-glass)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      wordBreak: 'break-word'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        backgroundColor: badgeColor,
                        color: textColor,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        textTransform: 'uppercase'
                      }}>
                        {log.type === 'alert' ? 'Price Alert' : log.type === 'status-alert' ? 'Flight Status' : 'System'}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{log.time}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                      <strong>{log.flightNumber}</strong>: {log.message}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
