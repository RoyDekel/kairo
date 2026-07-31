import React, { useState, useEffect } from 'react';
import { Sparkles, Plane, Activity, Bell, ArrowRight, CheckCircle, Zap, Ticket, Globe, Star, TrendingDown, Clock, ShieldCheck, HelpCircle, ChevronDown, ChevronUp, Share2, Copy } from 'lucide-react';
import { AIRPORTS } from '../utils/flightSimulator';
import { getZeroClickDemoData } from '../utils/priceConfidenceEngine';
import { useAuth } from '../contexts/AuthProvider';
import PriceHistoryGraph from './PriceHistoryGraph';

export default function LandingPage({ onOpenAuth, setActiveTab }) {
  const { user } = useAuth();
  const demoData = getZeroClickDemoData();
  const [animatedStepIdx, setAnimatedStepIdx] = useState(0);
  const [activeFaq, setActiveFaq] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '48px', paddingBottom: '40px', position: 'relative' }}>
      {toastMsg && (
        <div className="animate-fade-in" style={{
          position: 'fixed',
          top: '80px',
          right: '24px',
          zIndex: 9999,
          background: 'linear-gradient(135deg, #059669, #10b981)',
          color: '#ffffff',
          padding: '12px 20px',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-lg)',
          fontSize: '0.88rem',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <CheckCircle size={18} />
          <span>{toastMsg}</span>
        </div>
      )}

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
          <Sparkles size={16} /> FLIGHT PRICE TIMING
        </div>

        {/* OUTCOME-FOCUSED HERO HEADLINE & BRAND POSITIONING */}
        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>
          "We don't help you find flights. We help you know when to buy them."
        </div>

        <h1 style={{
          fontSize: '3.2rem',
          fontWeight: 800,
          lineHeight: 1.1,
          maxWidth: '920px',
          margin: '0 auto 20px',
          letterSpacing: '-0.04em'
        }}>
          Don't guess. <span className="brand-gradient-text">Know when to book.</span>
        </h1>

        <p style={{
          fontSize: '1.25rem',
          color: 'var(--text-secondary)',
          maxWidth: '680px',
          margin: '0 auto 36px',
          lineHeight: 1.6,
          fontWeight: 500
        }}>
          Get instant AI Buy or Wait decisions backed by 90-day price trends and 95% historical confidence.
        </p>

        {/* HERO CTA BUTTONS — Displayed ONLY when user is NOT logged in */}
        {!user && (
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={onOpenAuth}
              style={{
                background: 'linear-gradient(135deg, #0284c7, #1d4ed8)',
                border: 'none',
                borderRadius: '50px',
                color: '#ffffff',
                padding: '12px 28px',
                fontSize: '0.95rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 14px rgba(2, 132, 199, 0.4)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <Sparkles size={18} />
              <span>Discover When to Go</span>
              <ArrowRight size={18} />
            </button>
          </div>
        )}

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

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  setToastMsg('KAIRO Deal link copied to clipboard! 📋');
                  setTimeout(() => setToastMsg(null), 3000);
                }}
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '0.78rem', gap: '6px' }}
                title="Share this flight deal with friends"
              >
                <Share2 size={14} />
                Share Deal
              </button>

              <div className="badge badge-info" style={{ fontSize: '0.75rem' }}>
                Live AI Simulation
              </div>
            </div>
          </div>

          {/* TOAST NOTIFICATION */}
          {toastMsg && (
            <div className="animate-fade-in" style={{
              background: 'var(--success-glow)',
              border: '1px solid var(--success)',
              color: 'var(--success)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 14px',
              fontSize: '0.8rem',
              fontWeight: 700,
              marginBottom: '16px',
              textAlign: 'center'
            }}>
              {toastMsg}
            </div>
          )}

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
              <div className="num" style={{ fontSize: '1.35rem', fontWeight: 600, color: '#b45309', marginTop: '2px', transition: 'all 0.4s ease' }}>
                ${demoData.animatedSteps[animatedStepIdx]}
              </div>
            </div>

            <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>90-DAY LOWEST</div>
              <div className="num" style={{ fontSize: '1.35rem', fontWeight: 600, color: '#059669', marginTop: '2px' }}>
                ${demoData.low90Day}
              </div>
            </div>

            <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>AI RECOMMENDATION</div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: '#b45309', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
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
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '20px'
          }}>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                🔮 KAIRO Prediction: Prices likely to drop by ~${demoData.expectedSavings} within {demoData.expectedDropDays}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Historical analysis indicates an <strong className="num">{demoData.confidenceScore}% probability</strong> of lower fares before departure.
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--primary)' }}>
                {demoData.confidenceStars}
              </div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)' }}>
                <span className="num">{demoData.confidenceScore}%</span> Confidence
              </div>
            </div>
          </div>

          {/* INTERACTIVE 90-DAY SVG PRICE HISTORY GRAPH */}
          <PriceHistoryGraph priceHistory={demoData.priceHistory} />

        </div>
      </section>

      {/* HOW KAIRO WORKS (3 SIMPLE STEPS) */}
      <section className="glass-panel" style={{ padding: '40px 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 700 }}>How KAIRO Helps You Buy at the Perfect Moment</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Automated price intelligence from decision to touchdown</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '20px' }}>
          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)', padding: '16px 24px 24px' }}>
            <div style={{ color: 'var(--primary)', fontWeight: 800, fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '8px' }}>Step 1</div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Search or Pick Dates</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Know your route? Use <strong>Search &amp; Compare</strong>. Only know your dates? <strong>Where to Go</strong> pairs them with live concerts, matches, and festivals worldwide.
            </p>
          </div>

          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)', padding: '16px 24px 24px' }}>
            <div style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '8px' }}>Step 2</div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Get AI Price Confidence</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              KAIRO analyzes 90-day price trends and gives you an instant <strong>Buy Now</strong> or <strong>Wait</strong> rating with up to 95% confidence.
            </p>
          </div>

          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)', padding: '16px 24px 24px' }}>
            <div style={{ color: '#059669', fontWeight: 800, fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '8px' }}>Step 3</div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Instant Price Drop Alerts</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Save routes to your cloud watchlist. KAIRO notifies you the second fares drop to your target threshold.
            </p>
          </div>
        </div>
      </section>

      {/* WHY CHOOSE KAIRO */}
      <section className="glass-panel" style={{ padding: '36px 32px' }}>
        <h3 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '20px', textAlign: 'center' }}>Why Choose KAIRO?</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', background: 'var(--bg-tertiary)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
            <CheckCircle size={20} style={{ color: '#059669', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>AI Predicts Price Trends</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Know whether to buy now or wait for expected price drops.</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', background: 'var(--bg-tertiary)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
            <CheckCircle size={20} style={{ color: '#059669', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Real-Time Fare Monitoring</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Scans 32 global destination hubs continuously.</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', background: 'var(--bg-tertiary)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
            <CheckCircle size={20} style={{ color: '#059669', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Event Intelligence</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Pairs cheap flight deals with live concerts & sports matches.</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', background: 'var(--bg-tertiary)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
            <CheckCircle size={20} style={{ color: '#059669', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>100% Free Pilot Tier</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Zero spam, no credit card required to get started.</div>
            </div>
          </div>
        </div>
      </section>

      {/* SAAS PRICING TIERS */}
      <section className="glass-panel" style={{ padding: '48px 32px', textAlign: 'center' }}>
        <div style={{ marginBottom: '36px' }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 700 }}>Pricing</h2>
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
            justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Free</div>
                <div className="num" style={{ fontSize: '2rem', fontWeight: 600, margin: '12px 0 6px' }}>$0 <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 400 }}>/ forever</span></div>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '24px', textAlign: 'center' }}>Essential tools to track flights and browse basic recommendations.</p>

              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.88rem' }}>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: '#059669' }} /> AI Buy Timing predictions</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: '#059669' }} /> Live Flight Radar & Telemetry</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: '#059669' }} /> Up to 5 Cloud Watchlist items</li>
              </ul>
            </div>

            <button onClick={onOpenAuth} className="btn btn-secondary" style={{ width: '100%', marginTop: '32px' }}>
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
            justifyContent: 'space-between',
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
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pro</div>
                <div className="num" style={{ fontSize: '2rem', fontWeight: 600, margin: '12px 0 6px' }}>$9 <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 400 }}>/ month</span></div>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '24px', textAlign: 'center' }}>Unlimited AI event matching, priority price alerts & cloud sync.</p>

              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.88rem' }}>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--primary)' }} /> <strong>Unlimited</strong> AI Destination queries</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--primary)' }} /> Live Concert & Football event matching</li>
                <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><CheckCircle size={16} style={{ color: 'var(--primary)' }} /> Priority Price Drop alerts & real-time cloud sync</li>
              </ul>
            </div>

            <button
              onClick={() => {
                if (user) {
                  setToastMsg('⚡ Pro Membership Activated! Unlimited AI Queries & Priority Sync Enabled.');
                  setTimeout(() => setToastMsg(null), 4000);
                } else {
                  onOpenAuth();
                }
              }}
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '32px' }}
            >
              <Zap size={18} /> {user ? 'Activate Pro Membership' : 'Upgrade to Pro'}
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
            { q: 'Is KAIRO free to use?', a: 'Yes! The Free tier provides full access to live flight radar, price timing predictions, and watchlist tracking.' }
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
                  justifyContent: 'space-between',
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
