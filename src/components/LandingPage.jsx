import React, { useState } from 'react';
import { Compass, Plane, Sparkles, Activity, Bell, Shield, ArrowRight, CheckCircle, Zap, Ticket, Calendar, Globe, Star } from 'lucide-react';
import { AIRPORTS } from '../utils/flightSimulator';

export default function LandingPage({ onExploreAI, onOpenAuth, setActiveTab }) {
  const [quickOrigin, setQuickOrigin] = useState('TLV');
  const [quickDepDate, setQuickDepDate] = useState('2026-08-11');
  const [quickRetDate, setQuickRetDate] = useState('2026-08-16');

  const handleQuickSearch = (e) => {
    e.preventDefault();
    if (onExploreAI) {
      onExploreAI({ origin: quickOrigin, departureDate: quickDepDate, returnDate: quickRetDate });
    } else {
      setActiveTab('ai-explorer');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '48px', paddingBottom: '32px' }}>
      
      {/* HERO SECTION */}
      <section className="glass-panel" style={{
        padding: '56px 40px',
        textAlign: 'center',
        background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.08), rgba(124, 58, 237, 0.08))',
        border: '1px solid var(--border-glass-bright)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)'
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 16px',
          borderRadius: '20px',
          background: 'var(--primary-glow-weak)',
          border: '1px solid var(--primary-glow)',
          color: 'var(--primary)',
          fontSize: '0.85rem',
          fontWeight: 700,
          marginBottom: '20px'
        }}>
          <Sparkles size={16} /> AI-Powered Travel Intelligence Platform
        </div>

        <h1 style={{
          fontSize: '2.8rem',
          fontWeight: 900,
          lineHeight: 1.15,
          maxWidth: '900px',
          margin: '0 auto 20px',
          letterSpacing: '-0.03em'
        }}>
          Find Destinations Tuned to <span className="brand-gradient-text">Live Events & Price Drops</span>
        </h1>

        <p style={{
          fontSize: '1.1rem',
          color: 'var(--text-secondary)',
          maxWidth: '680px',
          margin: '0 auto 36px',
          lineHeight: 1.6
        }}>
          Don't know where to fly? Enter your travel dates and let our AI engine pair flight deals with live concerts, Premier League matches, music festivals, and cultural events worldwide.
        </p>

        {/* HERO CTA BUTTONS */}
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveTab('ai-explorer')}
            className="btn btn-primary"
            style={{ padding: '14px 28px', fontSize: '1rem', borderRadius: 'var(--radius-md)' }}
          >
            <Sparkles size={20} />
            Try AI Event Explorer
            <ArrowRight size={18} />
          </button>
          
          <button
            onClick={onOpenAuth}
            className="btn btn-secondary"
            style={{ padding: '14px 28px', fontSize: '1rem', borderRadius: 'var(--radius-md)' }}
          >
            Sign In / Get Started Free
          </button>
        </div>

        {/* QUICK SEARCH MICRO-DEMO WIDGET */}
        <div style={{
          marginTop: '44px',
          maxWidth: '840px',
          marginLeft: 'auto',
          marginRight: 'auto',
          background: 'var(--bg-glass)',
          border: '1px solid var(--border-glass-bright)',
          borderRadius: 'var(--radius-md)',
          padding: '20px',
          boxShadow: 'var(--shadow-md)'
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '14px', textAlign: 'left' }}>
            ⚡ Interactive Quick Search Preview
          </div>
          <form onSubmit={handleQuickSearch} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 180px', textAlign: 'left' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Departure City</label>
              <select
                value={quickOrigin}
                onChange={(e) => setQuickOrigin(e.target.value)}
                className="input-field"
                style={{ width: '100%', padding: '10px 14px' }}
              >
                {Object.values(AIRPORTS).map(a => (
                  <option key={a.code} value={a.code}>{a.city} ({a.code})</option>
                ))}
              </select>
            </div>

            <div style={{ flex: '1 1 160px', textAlign: 'left' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Depart Date</label>
              <input
                type="date"
                value={quickDepDate}
                onChange={(e) => setQuickDepDate(e.target.value)}
                className="input-field"
                style={{ width: '100%', padding: '10px 14px' }}
              />
            </div>

            <div style={{ flex: '1 1 160px', textAlign: 'left' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Return Date</label>
              <input
                type="date"
                value={quickRetDate}
                onChange={(e) => setQuickRetDate(e.target.value)}
                className="input-field"
                style={{ width: '100%', padding: '10px 14px' }}
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ padding: '11px 22px' }}>
              <Compass size={18} /> Inspire Me
            </button>
          </form>
        </div>
      </section>

      {/* VALUE PROPOSITION GRID */}
      <section>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>Why Travel Enthusiasts Choose AeroTrack</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Engineered for modern travelers who value smart insights and real-time tracking</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
          <div className="glass-panel" style={{ padding: '32px 24px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--primary-glow-weak)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', marginBottom: '20px' }}>
              <Ticket size={26} />
            </div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '10px' }}>AI Event Matching</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Our AI engine checks concerts, sports, and festivals happening across 30+ major global hubs during your exact trip dates.
            </p>
          </div>

          <div className="glass-panel" style={{ padding: '32px 24px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--accent-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', marginBottom: '20px' }}>
              <Activity size={26} />
            </div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '10px' }}>Live Flight Telemetry</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Track live radar coordinates, altitude, speed, and GPS progress on interactive Leaflet maps with flight path arcs.
            </p>
          </div>

          <div className="glass-panel" style={{ padding: '32px 24px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--success-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--success)', marginBottom: '20px' }}>
              <Bell size={26} />
            </div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '10px' }}>Cloud Price Alerts</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Set custom price thresholds and receive instant cloud notifications powered by Supabase when fares drop.
            </p>
          </div>
        </div>
      </section>

      {/* SAAS PRICING TIERS */}
      <section className="glass-panel" style={{ padding: '48px 32px', textAlign: 'center' }}>
        <div style={{ marginBottom: '36px' }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>Simple, Transparent Pricing</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Start for free and upgrade as your travel needs grow</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '28px', maxWidth: '800px', margin: '0 auto' }}>
          
          {/* FREE PLAN */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-glass)',
            borderRadius: 'var(--radius-md)',
            padding: '32px 24px',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            justify: 'space-between'
          }}>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Free Pilot</div>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, margin: '12px 0 6px' }}>$0 <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 400 }}>/ forever</span></div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '24px' }}>Essential tools to track flights and browse basic recommendations.</p>
              
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.88rem' }}>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--success)' }} /> 3 AI Destination queries / day</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--success)' }} /> Live Flight Telemetry & Radar</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--success)' }} /> Up to 5 Watchlist items</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--success)' }} /> Standard Price Drop notifications</li>
              </ul>
            </div>

            <button onClick={() => setActiveTab('ai-explorer')} className="btn btn-secondary" style={{ width: '100%', marginTop: '32px' }}>
              Get Started Free
            </button>
          </div>

          {/* PRO PLAN */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '2px solid var(--primary)',
            borderRadius: 'var(--radius-md)',
            padding: '32px 24px',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            justify: 'space-between',
            position: 'relative',
            boxShadow: 'var(--shadow-glow)'
          }}>
            <div style={{
              position: 'absolute',
              top: '-14px',
              right: '24px',
              background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
              color: '#0b0f19',
              padding: '4px 14px',
              borderRadius: '12px',
              fontSize: '0.75rem',
              fontWeight: 800,
              textTransform: 'uppercase'
            }}>
              Most Popular
            </div>

            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pro Traveler</div>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, margin: '12px 0 6px' }}>$9 <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 400 }}>/ month</span></div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '24px' }}>Unlimited AI event matching, priority price alerts & cloud sync.</p>
              
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.88rem' }}>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--primary)' }} /> <strong>Unlimited</strong> AI Destination queries</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--primary)' }} /> Concerts, Sports & Festival event matching</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--primary)' }} /> Unlimited Cloud Watchlists & Supabase sync</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--primary)' }} /> Priority SMS & Email price drop alerts</li>
              </ul>
            </div>

            <button onClick={onOpenAuth} className="btn btn-primary" style={{ width: '100%', marginTop: '32px' }}>
              <Zap size={18} /> Upgrade to Pro
            </button>
          </div>

        </div>
      </section>

    </div>
  );
}
