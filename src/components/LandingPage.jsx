import React, { useState, useEffect } from 'react';
import { Sparkles, Plane, Activity, Bell, ArrowRight, CheckCircle, Zap, Ticket, Globe, Star, TrendingDown, Clock, ShieldCheck, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { AIRPORTS } from '../utils/flightSimulator';
import { getZeroClickDemoData } from '../utils/priceConfidenceEngine';

export default function LandingPage({ onExploreAI, onOpenAuth, setActiveTab }) {
  const demoData = getZeroClickDemoData();
  const [animatedStepIdx, setAnimatedStepIdx] = useState(0);
  const [activeFaq, setActiveFaq] = useState(null);

  // Animated price drop effect for Zero-Click Demo ($1086 -> $960 -> $890 -> $812)
  useEffect(() => {
    const timer = setInterval(() => {
      setAnimatedStepIdx((prev) => (prev + 1) % demoData.animatedSteps.length);
    }, 2400);
    return () => clearInterval(timer);
  }, [demoData.animatedSteps.length]);

  const toggleFaq = (idx) => {
    setActiveFaq(activeFaq === idx ? null : idx);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '48px', paddingBottom: '40px' }}>
      
      {/* HERO SECTION */}
      <section className="glass-panel" style={{
        padding: '60px 36px 48px',
        textAlign: 'center',
        background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.08), rgba(124, 58, 237, 0.08))',
        border: '1px solid var(--border-glass-bright)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)'
      }}>
        {/* BRAND BADGE */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 18px',
          borderRadius: '20px',
          background: 'var(--primary-glow-weak)',
          border: '1px solid var(--primary-glow)',
          color: 'var(--primary)',
          fontSize: '0.85rem',
          fontWeight: 800,
          marginBottom: '24px',
          letterSpacing: '0.05em'
        }}>
          <Sparkles size={16} /> KAIRO — SMART AI FLIGHT PRICE TIMING
        </div>

        {/* 5-SECOND HERO HEADLINE */}
        <h1 style={{
          fontSize: '3.2rem',
          fontWeight: 900,
          lineHeight: 1.1,
          maxWidth: '920px',
          margin: '0 auto 20px',
          letterSpacing: '-0.04em'
        }}>
          Never overpay for <span className="brand-gradient-text">flights again.</span>
        </h1>

        <p style={{
          fontSize: '1.2rem',
          color: 'var(--text-secondary)',
          maxWidth: '680px',
          margin: '0 auto 36px',
          lineHeight: 1.6,
          fontWeight: 500
        }}>
          KAIRO predicts the exact right moment to buy. AI tracks fare trends in real-time and tells you whether to <strong>Buy Now</strong> or <strong>Wait for price drops</strong>.
        </p>

        {/* HERO CTA BUTTONS */}
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveTab('ai-explorer')}
            className="btn btn-primary"
            style={{ padding: '14px 30px', fontSize: '1rem', borderRadius: 'var(--radius-md)' }}
          >
            <Sparkles size={20} />
            Try KAIRO AI Explorer
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

        {/* ============================================================ */}
        {/* ZERO-CLICK DEMO WIDGET (No user input required) */}
        {/* ============================================================ */}
        <div style={{
          marginTop: '48px',
          maxWidth: '860px',
          marginLeft: 'auto',
          marginRight: 'auto',
          background: 'var(--bg-glass)',
          border: '1px solid var(--border-glass-bright)',
          borderRadius: 'var(--radius-md)',
          padding: '24px',
          boxShadow: 'var(--shadow-lg)',
          textAlign: 'left'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Zap size={15} /> ZERO-CLICK LIVE PRICE DEMO
            </div>
            <div className="badge badge-info" style={{ fontSize: '0.75rem' }}>
              Live AI Prediction Simulation
            </div>
          </div>

          {/* DEMO METRICS GRID */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>ROUTE</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
                {demoData.routeStr}
              </div>
            </div>

            <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>CURRENT FARE</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--warning)', marginTop: '2px', transition: 'all 0.4s ease' }}>
                ${demoData.animatedSteps[animatedStepIdx]}
              </div>
            </div>

            <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>90-DAY LOWEST</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--success)', marginTop: '2px' }}>
                ${demoData.low90Day}
              </div>
            </div>

            <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>AI RECOMMENDATION</div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--warning)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={16} /> {demoData.actionHeadline}
              </div>
            </div>
          </div>

          {/* AI CONFIDENCE SCORE BANNER */}
          <div style={{
            background: 'var(--primary-glow-weak)',
            border: '1px solid var(--primary-glow)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px 18px',
            display: 'flex',
            justify: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                🔮 Prediction: Prices likely to drop by ~${demoData.expectedSavings} within {demoData.expectedDropDays}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Historical analysis indicates a <strong>{demoData.confidenceScore}% probability</strong> of lower fares before departure.
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--primary)' }}>
                {demoData.confidenceStars}
              </div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)' }}>
                {demoData.confidenceScore}% Confidence
              </div>
            </div>
          </div>

          {/* VISUAL PRICE HISTORY TREND CHART */}
          <div style={{ marginTop: '20px' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span>90-Day Price History Trend ($)</span>
              <span style={{ color: 'var(--success)' }}>Today: 23% Below Peak</span>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', height: '60px', alignItems: 'flex-end', paddingTop: '10px' }}>
              {demoData.priceHistory.map((item, i) => {
                const heightPct = Math.round(((item.price - 700) / (1320 - 700)) * 100);
                const isCurrent = item.label === 'Today';
                return (
                  <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                    <div
                      style={{
                        height: `${Math.max(15, heightPct)}%`,
                        background: isCurrent ? 'linear-gradient(180deg, var(--warning), var(--primary))' : 'var(--bg-tertiary)',
                        border: isCurrent ? '1px solid var(--warning)' : '1px solid var(--border-glass)',
                        borderRadius: '4px 4px 0 0',
                        transition: 'all 0.3s ease'
                      }}
                    />
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px' }}>{item.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </section>

      {/* HOW KAIRO WORKS (3 SIMPLE STEPS) */}
      <section className="glass-panel" style={{ padding: '40px 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>How KAIRO Helps You Buy at the Perfect Moment</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Automated price intelligence from decision to touchdown</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '24px' }}>
          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)', padding: '24px', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '16px', right: '16px', fontSize: '2rem', fontWeight: 900, color: 'var(--primary-glow)', opacity: 0.5 }}>01</div>
            <div style={{ color: 'var(--primary)', fontWeight: 800, fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '8px' }}>Step 1</div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Search or Pick Dates</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Enter your route or use our AI Explorer to pair travel dates with live concerts, sports matches, and festivals worldwide.
            </p>
          </div>

          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)', padding: '24px', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '16px', right: '16px', fontSize: '2rem', fontWeight: 900, color: 'var(--accent-glow)', opacity: 0.5 }}>02</div>
            <div style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '8px' }}>Step 2</div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Get AI Price Confidence</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              KAIRO analyzes 90-day price trends and gives you an instant <strong>Buy Now</strong> or <strong>Wait</strong> rating with up to 95% confidence.
            </p>
          </div>

          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)', padding: '24px', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '16px', right: '16px', fontSize: '2rem', fontWeight: 900, color: 'var(--success-glow)', opacity: 0.5 }}>03</div>
            <div style={{ color: 'var(--success)', fontWeight: 800, fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '8px' }}>Step 3</div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Instant Price Drop Alerts</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Save routes to your cloud watchlist. KAIRO notifies you the second fares drop to your target threshold via Supabase.
            </p>
          </div>
        </div>
      </section>

      {/* WHY CHOOSE KAIRO & SOCIAL PROOF */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
        <div className="glass-panel" style={{ padding: '32px 28px' }}>
          <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '20px' }}>Why Choose KAIRO?</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.92rem' }}>
            <li style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <CheckCircle size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <span><strong>AI Predicts Price Trends</strong> — Know whether to buy or wait.</span>
            </li>
            <li style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <CheckCircle size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <span><strong>Real-Time Fare Monitoring</strong> — Scans 32 global destination hubs.</span>
            </li>
            <li style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <CheckCircle size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <span><strong>Event Intelligence</strong> — Pair flights with concerts & football matches.</span>
            </li>
            <li style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <CheckCircle size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <span><strong>100% Free Pilot Tier</strong> — Zero spam, no credit card required.</span>
            </li>
          </ul>
        </div>

        {/* SOCIAL PROOF & CREATOR BADGE */}
        <div className="glass-panel" style={{ padding: '32px 28px', background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.05), rgba(16, 185, 129, 0.05))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <ShieldCheck size={24} style={{ color: 'var(--primary)' }} />
            <h3 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0 }}>Social Proof & Credibility</h3>
          </div>
          
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '20px' }}>
            KAIRO was engineered with precision by a <strong>Senior QA Engineering Lead</strong> with expertise in automated price algorithms and real-time telemetry systems.
          </p>

          <a
            href="https://github.com/RoyDekel/flight-tracker"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ width: '100%', gap: '8px' }}
          >
            <Globe size={18} />
            100% Open Source on GitHub
          </a>
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
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--success)' }} /> AI Buy Timing predictions</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--success)' }} /> Live Flight Radar & Telemetry</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--success)' }} /> Up to 5 Cloud Watchlist items</li>
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
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--primary)' }} /> Live Concert & Football event matching</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--primary)' }} /> Priority Price Drop alerts via Supabase</li>
              </ul>
            </div>

            <button onClick={onOpenAuth} className="btn btn-primary" style={{ width: '100%', marginTop: '32px' }}>
              <Zap size={18} /> Upgrade to Pro
            </button>
          </div>
        </div>
      </section>

      {/* PRODUCT FAQ ACCORDION */}
      <section className="glass-panel" style={{ padding: '40px 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <HelpCircle size={22} style={{ color: 'var(--primary)' }} /> Frequently Asked Questions
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Everything you need to know about KAIRO AI price tracking</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '800px', margin: '0 auto' }}>
          {[
            { q: 'Where do flight prices come from?', a: 'KAIRO aggregates flight pricing metrics and schedules across global carrier APIs and market baseline engine data.' },
            { q: 'How accurate are KAIRO AI price predictions?', a: 'KAIRO calculates 90-day historical trend indicators to estimate buy timing with an average 85%+ confidence rating.' },
            { q: 'Do you sell flight tickets directly?', a: 'No, KAIRO is an independent price timing and telemetry intelligence tool. We show you the exact best time to buy.' },
            { q: 'Is KAIRO free to use?', a: 'Yes! The Free Pilot tier provides full access to live flight radar, price timing predictions, and watchlist tracking.' }
          ].map((item, idx) => (
            <div key={idx} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              <button
                onClick={() => toggleFaq(idx)}
                style={{
                  width: '100%',
                  padding: '16px 20px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  display: 'flex',
                  justify: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <span>{item.q}</span>
                {activeFaq === idx ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {activeFaq === idx && (
                <div style={{ padding: '0 20px 16px', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
