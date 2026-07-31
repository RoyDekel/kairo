import React, { useState } from 'react';
import { ArrowRight, Bookmark, CheckCircle, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { getPriceConfidenceInsight } from '../utils/priceConfidenceEngine';
import CityLandmarkIcon from './CityLandmarkIcon';

/** Max events shown inline when collapsed. */
const MAX_VISIBLE_EVENTS = 3;

/** "2026-08-13" -> "13 Aug". Compact by design; the year is implied by the search dates. */
function formatEventDate(dateStr) {
  if (!dateStr) return null;
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * A single "When to Go" result.
 */
export default function DestinationCard({
  recommendation,
  isWatched,
  isTracking,
  isAnyTracking,
  onTrack,
  onToggleWatchlist
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const rec = recommendation;
  const isEstimate = rec.priceSource === 'estimate';

  // Buy/wait verdict for the roundtrip total.
  const insight = getPriceConfidenceInsight({ id: rec.id, price: rec.roundtripPrice }, rec.roundtripPrice);
  const isWait = insight.recommendation === 'WAIT';

  const verdictDetail = isWait
    ? `drop of ~$${insight.expectedSavings} expected in ${insight.expectedDropDays}`
    : `near the 90-day low of $${insight.low90Day}`;

  const totalEvents = rec.matchedEvents ? rec.matchedEvents.length : 0;
  const visibleEvents = isExpanded
    ? rec.matchedEvents
    : (rec.matchedEvents ? rec.matchedEvents.slice(0, MAX_VISIBLE_EVENTS) : []);
  const hiddenEventCount = totalEvents - MAX_VISIBLE_EVENTS;

  return (
    <div className="glass-panel dest-card">
      {/* LEFT: THE FARE DECISION */}
      <div>
        <div className="dest-card-headline">
          <div className="dest-card-avatar flight-destination-icon" aria-hidden="true" title={`${rec.destination.city} landmark`}>
            <CityLandmarkIcon cityCode={rec.destCode} cityName={rec.destination.city} size={22} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="dest-card-city">{rec.destination.city}</h3>
            <div className="dest-card-sub">
              <span style={{ fontFamily: 'var(--font-mono)' }}>{rec.destCode}</span>
              <span aria-hidden="true">·</span>
              <span>{rec.destination.country}</span>
              <span aria-hidden="true">·</span>
              <span title={`KAIRO match score: ${rec.matchScore} out of 100`}>★ {rec.matchScore}% match</span>
            </div>
          </div>
        </div>

        <div className="dest-card-price-row">
          <div className="dest-card-price">
            {isEstimate && <span className="dest-card-price-est">est. </span>}
            ${rec.roundtripPrice}
          </div>
          {rec.savingsPercent > 0 && (
            <span className="badge badge-success" style={{ textTransform: 'none', letterSpacing: 0 }}>
              {rec.savingsPercent}% below usual
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', margin: '6px 0 12px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '12px', borderRight: '1px solid var(--border-glass, rgba(255, 255, 255, 0.15))' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
              <path d="M17 2 L21 6 L17 10"/><path d="M3 6 h18"/><path d="M7 22 L3 18 L7 14"/><path d="M21 18 H3"/>
            </svg>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Roundtrip</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '12px', borderRight: '1px solid var(--border-glass, rgba(255, 255, 255, 0.15))' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>${rec.averageMarketPrice}</span>
            <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', fontWeight: 600 }}>usual</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isEstimate ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                <path d="M3 3 v18 h18"/><path d="M7 15 l4-5 3 3 5-7"/>
              </svg>
            ) : (
              <CheckCircle size={14} style={{ color: 'var(--success)' }} />
            )}
            <span
              style={{
                fontSize: '0.82rem',
                color: isEstimate ? 'var(--text-muted)' : 'var(--success)',
                fontWeight: 600
              }}
              title={
                isEstimate
                  ? 'Modelled estimate. Track this fare to fetch the live quote.'
                  : 'Confirmed live fare — matches Search & Compare exactly.'
              }
            >
              {isEstimate ? 'Estimate' : 'Live Fare'}
            </span>
          </div>
        </div>

        <div className="dest-card-verdict">
          <span
            className={`dest-card-verdict-pill ${isWait ? 'dest-card-verdict-wait' : 'dest-card-verdict-buy'}`}
            title={
              isEstimate
                ? 'Based on the estimated fare. Track this fare for a verdict on the live price.'
                : `KAIRO confidence: ${insight.confidenceScore}%`
            }
          >
            {isWait ? 'Wait' : 'Buy now'}
          </span>
          <span className="dest-card-verdict-text">{verdictDetail}</span>
        </div>
      </div>

      {/* RIGHT: WHAT'S ON WHILE YOU'RE THERE */}
      <div className="dest-card-events">
        {/*
          Rare-timing badge. Deliberately not a third number — the card already shows a
          match score and the verdict shows a confidence percentage. It renders only when
          the timing is genuinely unusual, and its scarcity is what gives it weight.
        */}
        {rec.occasion && (
          <div className={`occasion occasion-${rec.occasion.tier}`}>
            <span className="occasion-tag">
              {rec.occasion.tier === 'rare' ? '⭐ Rare timing' : 'Notable timing'}
            </span>
            <span className="occasion-text">{rec.occasion.headline}</span>
          </div>
        )}

        <div className="dest-card-events-label">While you're there</div>

        {visibleEvents.map((evt) => (
          <div key={evt.id} className="dest-card-event">
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span className="dest-card-event-title">{evt.title}</span>
                {evt.categoryLabel && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: '12px',
                      background: 'var(--primary-glow-weak, rgba(2, 132, 199, 0.12))',
                      color: 'var(--primary, #0284c7)',
                      border: '1px solid var(--border-glass, rgba(255, 255, 255, 0.1))',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center'
                    }}
                  >
                    {evt.categoryLabel}
                  </span>
                )}
              </div>
              <div className="dest-card-event-meta">
                {evt.venue}
                {evt.date ? ` · ${formatEventDate(evt.date)}` : ''}
              </div>
            </div>
            {evt.url ? (
              <a
                href={evt.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: '20px',
                  background: 'var(--primary-glow-weak, rgba(2, 132, 199, 0.12))',
                  color: 'var(--primary, #0284c7)',
                  border: '1px solid var(--border-glass, rgba(255, 255, 255, 0.15))',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  transition: 'all 0.2s ease'
                }}
                title="View event & buy tickets"
              >
                <span>Tickets</span>
                <ExternalLink size={12} />
              </a>
            ) : (
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(`${evt.title} ${evt.venue} tickets`)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: '20px',
                  background: 'var(--bg-tertiary, rgba(255, 255, 255, 0.05))',
                  color: 'var(--text-secondary, #94a3b8)',
                  border: '1px solid var(--border-glass, rgba(255, 255, 255, 0.1))',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  transition: 'all 0.2s ease'
                }}
                title="Search tickets for this event"
              >
                <span>Find Tickets</span>
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        ))}

        {totalEvents > MAX_VISIBLE_EVENTS && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="dest-card-more-btn"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-glass, rgba(255, 255, 255, 0.1))',
              borderRadius: '16px',
              color: 'var(--primary, #0284c7)',
              fontSize: '0.78rem',
              fontWeight: 700,
              padding: '6px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              margin: '6px 0 2px 0',
              alignSelf: 'flex-start'
            }}
          >
            <span>
              {isExpanded
                ? 'Show fewer events'
                : `+${hiddenEventCount} more event${hiddenEventCount > 1 ? 's' : ''} during your trip`}
            </span>
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}

        <div className="dest-card-actions">
          <button
            onClick={() => onTrack(rec)}
            disabled={isAnyTracking}
            className="btn btn-primary"
            style={{
              padding: '9px 18px',
              fontSize: '0.85rem',
              opacity: isAnyTracking && !isTracking ? 0.5 : 1,
              cursor: isAnyTracking ? 'wait' : 'pointer'
            }}
          >
            {isTracking ? 'Fetching live fare...' : 'Track this fare'}
            {!isTracking && <ArrowRight size={15} />}
          </button>

          <button
            onClick={() => onToggleWatchlist({
              ...rec.outboundFlight,
              origin: rec.originCode,
              destination: rec.destCode,
              departureDate: rec.departureDate,
              returnDate: rec.returnDate,
              price: rec.roundtripPrice || rec.outboundFlight?.price
            })}
            className="btn btn-secondary"
            style={{ padding: '9px 16px', fontSize: '0.85rem' }}
            title={isWatched ? 'Remove from watchlist' : 'Save to watchlist'}
          >
            <Bookmark
              size={15}
              style={{ color: isWatched ? 'var(--primary)' : 'inherit' }}
              fill={isWatched ? 'currentColor' : 'none'}
            />
            {isWatched ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
