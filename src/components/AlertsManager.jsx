import React, { useState } from 'react';
import { Bell, Trash2, ShieldAlert, CheckCircle, Info, PlusCircle } from 'lucide-react';

export default function AlertsManager({ 
  alerts, 
  setAlerts, 
  notifications, 
  setNotifications, 
  activeFlight,
  flightDatabase
}) {
  const [targetPrice, setTargetPrice] = useState(Math.round(activeFlight.price * 0.95));
  const [alertType, setAlertType] = useState('price-drop'); // 'price-drop', 'status-change'
  const [successMsg, setSuccessMsg] = useState('');

  // Create new alert rule
  const handleCreateAlert = (e) => {
    e.preventDefault();
    
    const newAlert = {
      id: Date.now().toString(),
      flightNumber: activeFlight.flightNumber,
      flightId: activeFlight.id,
      type: alertType,
      thresholdPrice: alertType === 'price-drop' ? Number(targetPrice) : null,
      isActive: true,
      createdAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    };

    setAlerts([newAlert, ...alerts]);
    
    // Show success message
    setSuccessMsg('Alert successfully configured!');
    setTimeout(() => setSuccessMsg(''), 3000);

    // Create an initial system notification confirming the alert creation
    const confirmNotif = {
      id: `system-${Date.now()}`,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      flightNumber: activeFlight.flightNumber,
      type: 'system',
      message: `Watching ${activeFlight.flightNumber} for ${alertType === 'price-drop' ? `price drops below $${targetPrice}` : 'status updates'}.`
    };
    setNotifications([confirmNotif, ...notifications]);
  };

  // Delete an alert rule
  const handleDeleteAlert = (id) => {
    setAlerts(alerts.filter(alert => alert.id !== id));
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

            {/* Success message banner */}
            {successMsg && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>
                <CheckCircle size={14} />
                {successMsg}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ padding: '8px 0', fontSize: '0.85rem' }}>
              Set Notification
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
