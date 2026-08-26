import { useState, useEffect } from 'react';
import { Bell, Trash2, ShieldAlert, CheckCircle, Info, PlusCircle, Send } from 'lucide-react';
import { getApiBase, authHeaders, fetchWithTimeout } from '../lib/apiBase';

export default function AlertsManager({ 
  alerts, 
  setAlerts, 
  notifications, 
  setNotifications, 
  activeFlight,
  accessToken
}) {
  const [targetPrice, setTargetPrice] = useState(Math.round(activeFlight.price * 0.95));
  const [alertType, setAlertType] = useState('price-drop'); // 'price-drop', 'status-change'
  const [notifChannel, setNotifChannel] = useState('telegram'); // 'telegram' | 'email'
  const [telegramChatId, setTelegramChatId] = useState(() => localStorage.getItem('kairo_telegram_chat_id') || '');
  const [emailAddress, setEmailAddress] = useState(() => localStorage.getItem('kairo_email_address') || '');
  /*
    The delivery address is not independent state: it is whichever of the two saved
    credentials the chosen channel points at. It used to be a fourth useState kept in step
    with the other three by an effect, which cost a second committed render on every channel
    switch and on every mount that found a saved chat ID in localStorage -- invisible work in
    that second case, since the "Connected to Telegram" card reads the credential directly.

    Deriving it also removes the chance of the mirror going stale: there is now exactly one
    place each address is stored, so the form and the submitted alert cannot disagree.
  */
  const [connectCode] = useState(() => Math.random().toString(36).substring(2, 7).toUpperCase());
  const [isPolling, setIsPolling] = useState(false);
  const [manualSetup, setManualSetup] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
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
            // Find most recent telegram and email values to autofill
            const lastTelegramAlert = data.alerts.find(sa => sa.channel === 'telegram' && sa.channel_target);
            if (lastTelegramAlert && !localStorage.getItem('kairo_telegram_chat_id')) {
              setTelegramChatId(lastTelegramAlert.channel_target);
              localStorage.setItem('kairo_telegram_chat_id', lastTelegramAlert.channel_target);
            }
            const lastEmailAlert = data.alerts.find(sa => sa.channel === 'email' && sa.channel_target);
            if (lastEmailAlert && !localStorage.getItem('kairo_email_address')) {
              setEmailAddress(lastEmailAlert.channel_target);
              localStorage.setItem('kairo_email_address', lastEmailAlert.channel_target);
            }

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

  const channelTarget = notifChannel === 'telegram' ? telegramChatId : emailAddress;

  // Helper change handler to persist variables to storage
  const handleChannelTargetChange = (val) => {
    setErrorMsg('');
    if (notifChannel === 'telegram') {
      setTelegramChatId(val);
      localStorage.setItem('kairo_telegram_chat_id', val);
    } else {
      setEmailAddress(val);
      localStorage.setItem('kairo_email_address', val);
    }
  };

  // Polling Telegram verification status
  useEffect(() => {
    if (!isPolling || channelTarget) return;

    const intervalId = setInterval(async () => {
      try {
        const headers = accessToken ? authHeaders(accessToken) : {};
        const resp = await fetchWithTimeout(
          `${getApiBase()}/api/telegram/resolve-code?code=${connectCode}`,
          {
            headers,
            timeoutMs: 3000
          }
        );

        if (resp.ok) {
          const data = await resp.json();
          if (data.found && data.chatId) {
            handleChannelTargetChange(data.chatId);
            setIsPolling(false);
            setSuccessMsg(`Successfully connected to Telegram!`);
            setTimeout(() => setSuccessMsg(''), 4000);
          }
        }
      } catch (err) {
        console.error('Failed to poll telegram verification status:', err);
      }
    }, 2500);

    // Stop polling after 3 minutes to avoid infinite loops
    const timeoutId = setTimeout(() => {
      setIsPolling(false);
    }, 180000);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [isPolling, connectCode, accessToken, channelTarget]);

  // Create new alert rule (local + server-side persistence)
  const handleCreateAlert = async (e) => {
    e.preventDefault();

    // A price-drop alert with no delivery address cannot notify anyone, so refuse
    // it here rather than storing something that looks active and never fires.
    if (alertType === 'price-drop' && !channelTarget.trim()) {
      setSuccessMsg('');
      setErrorMsg(notifChannel === 'telegram'
        ? 'Connect Telegram or enter your chat ID so the alert can reach you.'
        : 'Enter an email address so the alert can reach you.');
      return;
    }

    setErrorMsg('');
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
            channelTarget: channelTarget.trim()
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
        } else if (resp.status === 400) {
          // The server rejected the alert outright, so say that rather than
          // "sync pending" — nothing is pending and retrying will not help.
          const data = await resp.json().catch(() => ({}));
          setErrorMsg(data.error || 'The server rejected this alert.');
          setAlerts(prev => prev.filter(a => a.id !== localId));
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
              Create Alert for <span className="num">{activeFlight.flightNumber}</span>
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
                    Current: <span className="num">${activeFlight.price}</span>
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

                {notifChannel === 'email' ? (
                  <div className="input-group">
                    <span className="input-label">
                      Email Address
                      <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>
                    </span>
                    <input
                      type="email"
                      value={channelTarget}
                      onChange={(e) => handleChannelTargetChange(e.target.value)}
                      className="input-field"
                      style={{ padding: '8px 12px' }}
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                ) : (
                  <div className="input-group">
                    <style>{`
                      @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                      }
                    `}</style>
                    <span className="input-label">
                      Telegram Notifications
                    </span>
                    
                    <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {/* Connection status card */}
                      {telegramChatId ? (
                        <div style={{
                          background: 'rgba(16, 185, 129, 0.08)',
                          border: '1px solid rgba(16, 185, 129, 0.2)',
                          borderRadius: '6px',
                          padding: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: 600, fontSize: '0.8rem' }}>
                            <CheckCircle size={16} /> Connected to Telegram
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Chat ID: <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px' }}>{telegramChatId}</code>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              handleChannelTargetChange('');
                              setManualSetup(true);
                            }}
                            style={{
                              alignSelf: 'flex-start',
                              background: 'transparent',
                              border: 'none',
                              color: '#ef4444',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              padding: '0',
                              marginTop: '4px',
                              textDecoration: 'underline'
                            }}
                          >
                            Disconnect / Change Account
                          </button>
                        </div>
                      ) : (
                        <div style={{
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-glass)',
                          borderRadius: '8px',
                          padding: '14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px'
                        }}>
                          <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                            ⚡ Connect Telegram Instantly
                          </div>
                          
                          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                            Open our Telegram bot <strong style={{ color: 'var(--primary)' }}>@KAIRO_Flights_bot</strong> and click <strong>"Start"</strong> to automatically detect your Chat ID.
                          </p>

                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '4px' }}>
                            <a
                              href={`https://t.me/KAIRO_Flights_bot?start=${connectCode}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => setIsPolling(true)}
                              className="btn btn-primary"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                textDecoration: 'none',
                                padding: '8px 16px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                                border: 'none',
                                color: '#000',
                                borderRadius: '4px'
                              }}
                            >
                              <Send size={12} /> Connect via Telegram
                            </a>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Verification Code:</span>
                              <span className="num" style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', fontSize: '0.85rem', color: 'var(--primary)' }}>{connectCode}</span>
                            </div>
                          </div>

                          {isPolling && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                              <div style={{
                                width: '12px',
                                height: '12px',
                                border: '2px solid rgba(0, 242, 254, 0.2)',
                                borderTop: '2px solid var(--primary)',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                              }} />
                              <span>Waiting for you to press "Start" in Telegram...</span>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => setManualSetup(!manualSetup)}
                            style={{
                              alignSelf: 'flex-start',
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-muted)',
                              fontSize: '0.7rem',
                              cursor: 'pointer',
                              padding: 0,
                              textDecoration: 'underline',
                              marginTop: '4px'
                            }}
                          >
                            {manualSetup ? "Hide Manual Setup" : "Or enter Chat ID manually"}
                          </button>
                        </div>
                      )}

                      {/* Manual setup form */}
                      {(manualSetup || !telegramChatId) && (
                        <div style={{
                          display: (manualSetup || !telegramChatId) ? 'block' : 'none',
                          marginTop: '6px',
                          borderTop: '1px dashed var(--border-glass)',
                          paddingTop: '10px'
                        }}>
                          <span className="input-label" style={{ fontSize: '0.75rem', marginBottom: '4px', display: 'block' }}>
                            Telegram Chat ID <span style={{ color: '#ef4444' }}>*</span>
                          </span>
                          <input
                            type="text"
                            value={channelTarget}
                            onChange={(e) => handleChannelTargetChange(e.target.value)}
                            className="input-field"
                            style={{ padding: '8px 12px', width: '100%', boxSizing: 'border-box' }}
                            placeholder="e.g. 1498739130"
                            required={!telegramChatId}
                          />
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                            Send /start to @KAIRO_Flights_bot then paste the chat ID here.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Validation / rejection banner */}
            {errorMsg && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}>
                <ShieldAlert size={14} />
                {errorMsg}
              </div>
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
                      <div className="num" style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                        {alert.flightNumber}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {alert.type === 'price-drop' ? (
                          <>
                            Price drops below <span className="num">${alert.thresholdPrice}</span>
                          </>
                        ) : (
                          'Status updates tracking'
                        )}
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
              Notifications Log Feed (<span className="num">{notifications.length}</span>)
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
                      <span className="num" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{log.time}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                      <strong className="num">{log.flightNumber}</strong>: {log.message}
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
