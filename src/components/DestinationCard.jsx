import React, { useState } from 'react';
import { ArrowRight, Bookmark, CheckCircle, ExternalLink, ChevronDown, ChevronUp, Calendar, MapPin, Info } from 'lucide-react';
import { destinationFareVerdict } from '../utils/destinationFareVerdict';
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

/** Convert ISO country code or country name to 2-letter lowercase code for flag image */
function getCountryCode(countryCode, countryName = '') {
  if (countryCode && countryCode.length === 2) return countryCode.toLowerCase();
  const name = (countryName || '').toLowerCase();
  if (name.includes('uk') || name.includes('united kingdom') || name.includes('britain')) return 'gb';
  if (name.includes('spain')) return 'es';
  if (name.includes('france')) return 'fr';
  if (name.includes('germany')) return 'de';
  if (name.includes('italy')) return 'it';
  if (name.includes('united states') || name.includes('usa')) return 'us';
  if (name.includes('israel')) return 'il';
  if (name.includes('japan')) return 'jp';
  if (name.includes('thailand')) return 'th';
  if (name.includes('netherlands')) return 'nl';
  if (name.includes('poland')) return 'pl';
  if (name.includes('greece')) return 'gr';
  if (name.includes('singapore')) return 'sg';
  if (name.includes('australia')) return 'au';
  if (name.includes('austria')) return 'at';
  if (name.includes('czech')) return 'cz';
  if (name.includes('hungary')) return 'hu';
  if (name.includes('portugal')) return 'pt';
  if (name.includes('ireland')) return 'ie';
  if (name.includes('switzerland')) return 'ch';
  if (name.includes('korea')) return 'kr';
  if (name.includes('denmark')) return 'dk';
  if (name.includes('brazil')) return 'br';
  if (name.includes('emirates') || name.includes('uae')) return 'ae';
  return null;
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
  const [showInfoPopover, setShowInfoPopover] = useState(false);
  const rec = recommendation;
  const isEstimate = rec.priceSource === 'estimate';

  /*
    Buy/wait verdict for the roundtrip total, from this route's own recorded history.

    This previously called getPriceConfidenceInsight with a hand-built object that had no
    `insights` key, so the engine returned its "no history" stub on every render: the pill
    said "Buy now" unconditionally and the detail line ended at a bare "$". See
    destinationFareVerdict.js for the full account.
  */
  const verdict = destinationFareVerdict({
    roundtripPrice: rec.roundtripPrice,
    historicalPercentile: rec.historicalPercentile,
    historicalSampleSize: rec.historicalSampleSize,
    typicalPrice: rec.routeTypicalPrice ?? rec.typicalPrice,
    priceSource: rec.priceSource
  });

  /*
    The score explains itself.

    A bare "81% match" was unfalsifiable — and, as it turned out, constant. Every component
    now names the evidence it came from, so a user who disagrees with the number can see
    which part they disagree with.
  */
  const matchBreakdown = rec.matchBreakdown || [];
  const matchTooltip = matchBreakdown.length
    ? [`KAIRO match score: ${rec.matchScore} out of 100`, ...matchBreakdown.map(
      (c) => `• ${c.label} ${c.points}/${c.max} — ${c.detail}`
    )].join('\n')
    : `KAIRO match score: ${rec.matchScore} out of 100`;

  const confidence = rec.matchConfidence || { level: 'high', gaps: [] };

  const totalEvents = rec.matchedEvents ? rec.matchedEvents.length : 0;
  const visibleEvents = isExpanded
    ? rec.matchedEvents
    : (rec.matchedEvents ? rec.matchedEvents.slice(0, MAX_VISIBLE_EVENTS) : []);
  const hiddenEventCount = totalEvents - MAX_VISIBLE_EVENTS;

  return (
    <div className="glass-panel dest-card">
      {/* LEFT: THE FARE DECISION */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', gap: '14px', padding: '4px 0' }}>
        <div className="dest-card-headline">
          <div className="dest-card-avatar flight-destination-icon" aria-hidden="true" title={`${rec.destination.city} landmark`}>
            <CityLandmarkIcon cityCode={rec.destCode} cityName={rec.destination.city} size={22} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h3 className="dest-card-city" style={{ margin: 0 }}>{rec.destination.city}</h3>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(16, 185, 129, 0.14)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  whiteSpace: 'nowrap'
                }}
                title={matchTooltip}
              >
                ★ <span className="num">{rec.matchScore}%</span> Match
              </span>
              {/*
                Confidence sits BESIDE the score rather than inside it. A 90 built on a live
                fare and full event coverage and a 90 built on a modelled fare are the same
                claim about the destination and different claims about what we know, and
                blending them yields a number that answers neither question.
              */}
              {confidence.level !== 'high' && confidence.gaps.length > 0 && (
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setShowInfoPopover((prev) => !prev)}
                    style={{
                      fontSize: '0.66rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: 'rgba(148, 163, 184, 0.14)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-glass, rgba(255, 255, 255, 0.15))',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.2s ease'
                    }}
                    title="Click to view evidence details"
                  >
                    <span>{confidence.level === 'Medium' || confidence.level === 'medium' ? 'Partial evidence' : 'Limited evidence'}</span>
                    <Info size={11} style={{ color: 'var(--primary, #0284c7)', opacity: 0.9 }} />
                  </button>

                  {showInfoPopover && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        left: '0',
                        zIndex: 100,
                        minWidth: '220px',
                        maxWidth: '280px',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: 'var(--bg-secondary, #1e293b)',
                        border: '1px solid var(--border-glass, rgba(255, 255, 255, 0.2))',
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
                        fontSize: '0.75rem',
                        color: 'var(--text-primary)',
                        backdropFilter: 'blur(12px)'
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: '6px', color: 'var(--text-primary)', fontSize: '0.78rem' }}>
                        Based on partial evidence:
                      </div>
                      {confidence.gaps.map((gap, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', marginTop: '4px', color: 'var(--text-secondary)' }}>
                          <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>•</span>
                          <span>{gap}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="dest-card-sub" style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 800,
                  fontSize: '0.72rem',
                  padding: '2px 7px',
                  borderRadius: '6px',
                  background: 'rgba(2, 132, 199, 0.14)',
                  color: 'var(--primary, #0284c7)',
                  border: '1px solid rgba(2, 132, 199, 0.3)',
                  letterSpacing: '0.05em'
                }}
              >
                {rec.destCode}
              </span>
              <span style={{ fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                {getCountryCode(rec.destination.countryCode, rec.destination.country) && (
                  <img
                    src={`https://flagcdn.com/w40/${getCountryCode(rec.destination.countryCode, rec.destination.country)}.png`}
                    srcSet={`https://flagcdn.com/w80/${getCountryCode(rec.destination.countryCode, rec.destination.country)}.png 2x`}
                    width="18"
                    height="13"
                    alt={rec.destination.country}
                    style={{
                      borderRadius: '2px',
                      objectFit: 'cover',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      display: 'inline-block'
                    }}
                  />
                )}
                <span>{rec.destination.country}</span>
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="dest-card-price-row" style={{ margin: '0 0 6px 0' }}>
            <div className="dest-card-price num">
              ${rec.roundtripPrice}
            </div>
            {/*
              Shown only when there is a recorded baseline to be below. The old badge was
              always present and always said 26%, because "usual" was defined as this very
              fare times 1.35.
            */}
            {rec.savingsPercent > 0 && (
              <span
                className="badge badge-success"
                style={{ textTransform: 'none', letterSpacing: 0, padding: '4px 10px', fontSize: '0.78rem' }}
                title={`Typical fare $${rec.typicalPrice}, median of ${rec.historicalSampleSize} recorded quotes for this route`}
              >
                <span className="num">{rec.savingsPercent}%</span>{" "}Below usual
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', margin: '6px 0 12px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '12px', borderRight: '1px solid var(--border-glass, rgba(255, 255, 255, 0.15))' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                <path d="M17 2 L21 6 L17 10" /><path d="M3 6 h18" /><path d="M7 22 L3 18 L7 14" /><path d="M21 18 H3" />
              </svg>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Roundtrip</span>
            </div>

            {rec.typicalPrice && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '12px', borderRight: '1px solid var(--border-glass, rgba(255, 255, 255, 0.15))' }}>
                <span className="num" style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>${rec.typicalPrice}</span>
                <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', fontWeight: 600 }}>usual</span>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isEstimate ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                  <path d="M3 3 v18 h18" /><path d="M7 15 l4-5 3 3 5-7" />
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
              className={`dest-card-verdict-pill dest-card-verdict-${verdict.tone}`}
              title={verdict.tooltip}
            >
              {verdict.label}
            </span>
            <span className="dest-card-verdict-text" title={verdict.tooltip}>
              {verdict.detail}
            </span>
          </div>
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

        <div className="dest-card-events-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Calendar size={14} style={{ color: 'var(--primary, #0284c7)' }} />
          <span>While you're there</span>
        </div>

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
              <div className="dest-card-event-meta" style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}>
                <MapPin size={12} style={{ color: '#ef4444', flexShrink: 0 }} />
                <span>
                  {evt.venue}
                  {evt.date && (
                    <>
                      {' · '}
                      <span className="num">{formatEventDate(evt.date)}</span>
                    </>
                  )}
                </span>
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
              {isExpanded ? (
                'Show fewer events'
              ) : (
                <>
                  +<span className="num">{hiddenEventCount}</span> more event{hiddenEventCount > 1 ? 's' : ''} during your trip
                </>
              )}
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
