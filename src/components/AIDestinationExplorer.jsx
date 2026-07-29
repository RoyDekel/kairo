import React, { useState, useMemo } from 'react';
import { Sparkles, Calendar, Compass, DollarSign, Ticket, ArrowRight, Bookmark, Flame, CheckCircle, ExternalLink, MapPin, Clock } from 'lucide-react';
import { AIRPORTS } from '../utils/flightSimulator';
import { searchAIDestinations } from '../utils/aiDestinationEngine';

export default function AIDestinationExplorer({
  searchParams,
  setSearchParams,
  setActiveRoundtrip,
  setActiveTab,
  onToggleWatchlist,
  watchlist = []
}) {
  const [origin, setOrigin] = useState(searchParams.origin || 'TLV');
  const [departureDate, setDepartureDate] = useState(searchParams.departureDate || '2026-08-11');
  const [returnDate, setReturnDate] = useState(searchParams.returnDate || '2026-08-16');
  const [maxBudget, setMaxBudget] = useState(1200);
  const [selectedInterests, setSelectedInterests] = useState(['music', 'sports', 'festivals', 'culture']);

  // Toggle interest tags
  const toggleInterest = (category) => {
    if (selectedInterests.includes(category)) {
      if (selectedInterests.length > 1) {
        setSelectedInterests(selectedInterests.filter((c) => c !== category));
      }
    } else {
      setSelectedInterests([...selectedInterests, category]);
    }
  };

  const [aiRecommendations, setAiRecommendations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Compute AI destination recommendations dynamically via live Ticketmaster API
  React.useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    searchAIDestinations({
      origin,
      departureDate,
      returnDate,
      maxBudget,
      interests: selectedInterests
    })
      .then((results) => {
        if (isMounted) {
          setAiRecommendations(results);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('Error searching AI destinations:', err);
        if (isMounted) {
          setAiRecommendations([]);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [origin, departureDate, returnDate, maxBudget, selectedInterests]);

  // Handle tracking a recommended destination route on the Dashboard HUD
  const handleTrackRoute = (recommendation) => {
    const bundle = {
      outbound: recommendation.outboundFlight,
      return: recommendation.returnFlight,
      passengers: { adults: 1, children: 0, infants: 0 },
      origin: recommendation.originCode,
      destination: recommendation.destCode,
      departureDate: recommendation.departureDate,
      returnDate: recommendation.returnDate
    };

    setSearchParams({
      tripType: 'round-trip',
      origin: recommendation.originCode,
      destination: recommendation.destCode,
      departureDate: recommendation.departureDate,
      returnDate: recommendation.returnDate,
      passengers: { adults: 1, children: 0, infants: 0 },
      stops: '0'
    });

    setActiveRoundtrip(bundle);
    setActiveTab('dashboard');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* EXPLORER HEADER & CONTROL PANEL */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Sparkles size={22} style={{ color: 'var(--primary)' }} />
              AI Event & Destination Explorer
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Have specific travel dates? AI analyzes flight pricing deals and pairs them with live concerts, matches, and festivals worldwide.
            </p>
          </div>
          <div className="badge badge-info" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
            {aiRecommendations.length} Destinations Scanned
          </div>
        </div>

        {/* CONTROLS GRID */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-glass)',
          borderRadius: 'var(--radius-sm)',
          padding: '16px'
        }}>
          {/* Origin */}
          <div className="input-group">
            <label className="input-label">Origin City</label>
            <select
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              className="input-field"
            >
              {Object.values(AIRPORTS).map((a) => (
                <option key={a.code} value={a.code}>
                  {a.city} ({a.code}) - {a.country}
                </option>
              ))}
            </select>
          </div>

          {/* Departure Date */}
          <div className="input-group">
            <label className="input-label">Departure Date</label>
            <input
              type="date"
              value={departureDate}
              onChange={(e) => setDepartureDate(e.target.value)}
              className="input-field"
            />
          </div>

          {/* Return Date */}
          <div className="input-group">
            <label className="input-label">Return Date</label>
            <input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className="input-field"
            />
          </div>

          {/* Max Budget Slider */}
          <div className="input-group">
            <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Max Budget</span>
              <strong style={{ color: 'var(--primary)' }}>${maxBudget}</strong>
            </label>
            <input
              type="range"
              min="150"
              max="2000"
              step="50"
              value={maxBudget}
              onChange={(e) => setMaxBudget(Number(e.target.value))}
              style={{ accentColor: 'var(--primary)', marginTop: '8px' }}
            />
          </div>
        </div>

        {/* INTEREST CATEGORY PILLS */}
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Filter by Event Category:
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { id: 'music', label: 'Music & Concerts 🎵' },
              { id: 'sports', label: 'Sports & Football ⚽' },
              { id: 'festivals', label: 'Festivals & Nightlife 🎪' },
              { id: 'culture', label: 'Culture & Food 🏛️' }
            ].map((cat) => {
              const isSelected = selectedInterests.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleInterest(cat.id)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '20px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-glass)',
                    background: isSelected ? 'var(--primary-glow-weak)' : 'var(--bg-tertiary)',
                    color: isSelected ? 'var(--primary)' : 'var(--text-secondary)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* AI RECOMMENDATION RESULTS LIST */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {isLoading ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <Sparkles size={28} style={{ color: 'var(--primary)' }} />
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Querying Ticketmaster Discovery API...
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Checking real-time live events and flights for {departureDate} – {returnDate}
            </div>
          </div>
        ) : aiRecommendations.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <Compass size={38} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              No Verified Ticketmaster Events Found
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: '540px', margin: 0, lineHeight: 1.6 }}>
              There are currently no verified live Ticketmaster events listed for these travel dates (<strong>{departureDate}</strong> – <strong>{returnDate}</strong>) within your budget of <strong>${maxBudget}</strong>.
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              💡 Tip: Try picking dates closer to upcoming months or adjusting your budget filter!
            </p>
          </div>
        ) : (
          aiRecommendations.map((rec) => {
            const isWatched = watchlist.some((w) => w.id === rec.outboundFlight.id);

            return (
              <div
                key={rec.id}
                className="glass-panel"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  borderLeft: '4px solid var(--primary)',
                  boxShadow: 'var(--shadow-md)'
                }}
              >
                {/* CARD HEADER */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                        {rec.destination.city} ({rec.destCode})
                      </span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        — {rec.destination.country}
                      </span>
                    </div>

                    {/* PRICE SAVINGS BADGE */}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                      <span className="badge badge-success" style={{ display: 'inline-flex', gap: '4px' }}>
                        <Flame size={14} /> {rec.savingsPercent}% Below Average
                      </span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Save ~${rec.savingsAmount} compared to avg ${rec.averageMarketPrice}
                      </span>
                    </div>
                  </div>

                  {/* PRICE & AI SCORE */}
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--primary)' }}>
                      ${rec.roundtripPrice}
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}> / roundtrip</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--success)' }}>
                      ★ {rec.matchScore}% AI Match Score
                    </div>
                  </div>
                </div>

                {/* AI INSIGHT BANNER */}
                <div style={{
                  background: 'var(--primary-glow-weak)',
                  border: '1px solid var(--primary-glow)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px 16px',
                  fontSize: '0.88rem',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <Sparkles size={18} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  <div>
                    <strong>AI Travel Insight:</strong> {rec.aiInsight}
                  </div>
                </div>

                {/* MATCHED EVENTS SECTION */}
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Events Happening During Your Trip ({departureDate} – {returnDate}):
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                    {rec.matchedEvents.map((evt) => (
                      <div
                        key={evt.id}
                        style={{
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-glass)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>
                            {evt.categoryLabel}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Est. {evt.priceEstimate}
                          </span>
                        </div>

                        <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                          {evt.title}
                        </div>

                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <MapPin size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                          <span>{evt.venue}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* CARD ACTIONS */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--border-glass)' }}>
                  <button
                    onClick={() => onToggleWatchlist(rec.outboundFlight)}
                    className="btn btn-secondary"
                    style={{ padding: '8px 14px', fontSize: '0.8rem', gap: '6px' }}
                  >
                    <Bookmark size={16} style={{ color: isWatched ? 'var(--primary)' : 'inherit' }} />
                    {isWatched ? 'Saved in Watchlist' : 'Add to Watchlist'}
                  </button>

                  <button
                    onClick={() => handleTrackRoute(rec)}
                    className="btn btn-primary"
                    style={{ padding: '8px 18px', fontSize: '0.85rem' }}
                  >
                    Track Route & Telemetry
                    <ArrowRight size={16} />
                  </button>
                </div>

              </div>
            );
          })
        )}
      </div>

    </div>
  );
}
