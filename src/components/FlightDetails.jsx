import { useState } from 'react';
import {
  Award, Bell, Bookmark, BookmarkCheck, Calendar,
  Globe, Users, ChevronDown, ChevronUp, ArrowRight
} from 'lucide-react';
import { AIRLINES, getSkyscannerUrl } from '../utils/flightSimulator';

const AirlineLogo = ({ flight, fallbackLogo, size = 32 }) => {
  const iata = flight.airlineCode ? flight.airlineCode.toUpperCase() : '';
  const urls = [];
  if (flight.airlineLogo) urls.push(flight.airlineLogo);
  if (iata) {
    urls.push(`https://pics.avs.io/${size}/${size}/${iata}.png`);
    urls.push(`https://www.gstatic.com/flights/airline_logos/70px/${iata}.png`);
  }

  const [urlIndex, setUrlIndex] = useState(0);

  if (urlIndex < urls.length) {
    return (
      <img
        src={urls[urlIndex]}
        alt={flight.airlineName || 'Airline'}
        onError={() => setUrlIndex((prev) => prev + 1)}
        style={{ width: `${size}px`, height: `${size}px`, objectFit: 'contain', borderRadius: '4px' }}
      />
    );
  }

  return <span style={{ fontSize: `${size * 0.45}px` }}>{fallbackLogo || '✈️'}</span>;
};

/** "1 Adult, 2 Children" */
const getPassengersText = (passengers) => {
  if (!passengers) return '1 Adult';
  const parts = [];
  if (passengers.adults > 0) parts.push(`${passengers.adults} Adult${passengers.adults > 1 ? 's' : ''}`);
  if (passengers.children > 0) parts.push(`${passengers.children} Child${passengers.children > 1 ? 'ren' : ''}`);
  if (passengers.infants > 0) parts.push(`${passengers.infants} Infant${passengers.infants > 1 ? 's' : ''}`);
  return parts.join(', ');
};

/**
 * Identity and specifics of the tracked flight.
 *
 * The buy/wait verdict moved out to BuyVerdict and the simulator to SimulatorPanel, so
 * this is now just: which flight, when, and — behind a disclosure — the full spec sheet
 * and fare breakdown. The schedule strip no longer carries its own progress bar; the
 * simulator under the map owns that, and having both was confusing.
 */
export default function FlightDetails({
  activeFlight,
  onToggleWatchlist,
  isWatched,
  selectedDate,
  onOpenAlertModal,
  activeRoundtrip,
  direction,
  onSwitchLeg
}) {
  const [showDetails, setShowDetails] = useState(false);

  const airlineInfo = AIRLINES[activeFlight?.airlineCode] || { name: 'Unknown', logo: '✈️', color: 'var(--primary)' };
  const skyscannerUrl = getSkyscannerUrl(activeFlight?.origin || 'TLV', activeFlight?.destination || 'KRK', selectedDate);

  const formatDate = (dateStr) =>
    new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const hasReturnLeg = Boolean(activeRoundtrip?.return);

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

      {/* Which leg of the bundle are we looking at */}
      {hasReturnLeg && (
        <div className="leg-toggle" role="group" aria-label="Select flight leg">
          {[
            { id: 'outbound', label: 'Outbound', route: `${activeRoundtrip.origin} → ${activeRoundtrip.destination}` },
            { id: 'return', label: 'Return', route: `${activeRoundtrip.destination} → ${activeRoundtrip.origin}` }
          ].map((leg) => (
            <button
              key={leg.id}
              type="button"
              onClick={() => onSwitchLeg(leg.id)}
              className={`leg-toggle-btn ${direction === leg.id ? 'is-active' : ''}`}
              aria-pressed={direction === leg.id}
            >
              <span style={{ fontWeight: 700 }}>{leg.label}</span>
              <span className="leg-toggle-route">{leg.route}</span>
            </button>
          ))}
        </div>
      )}

      {/* Identity */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{
            width: '46px',
            height: '46px',
            borderRadius: '10px',
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-glass)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0
          }}>
            <AirlineLogo flight={activeFlight} fallbackLogo={airlineInfo.logo} size={38} />
          </div>
          <div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {activeFlight.flightNumber}
              <span className="badge badge-info" style={{ fontSize: '0.62rem' }}>{activeFlight.cabinClass}</span>
            </div>
            {/* Aircraft type is not always reported; joining on filtered parts avoids a
                dangling "EL AL Israel Airlines • " with nothing after the separator. */}
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {[activeFlight.airlineName, activeFlight.planeType].filter(Boolean).join(' • ')}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => onToggleWatchlist(activeFlight)}
            className="btn btn-secondary"
            style={{ padding: '7px 12px', fontSize: '0.82rem', color: isWatched ? 'var(--primary)' : 'var(--text-primary)' }}
            title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            {isWatched ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
            {isWatched ? 'Watched' : 'Track'}
          </button>

          <button
            onClick={onOpenAlertModal}
            className="btn btn-secondary"
            style={{ padding: '7px 12px', fontSize: '0.82rem' }}
            title="Configure alerts"
          >
            <Bell size={15} />
            Alerts
          </button>

          <a
            href={skyscannerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ padding: '7px 12px', fontSize: '0.82rem' }}
            title="Search this route on Skyscanner"
          >
            <Globe size={15} />
            Skyscanner
          </a>
        </div>
      </div>

      {/* Schedule strip */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
          <Calendar size={13} />
          {formatDate(selectedDate)}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div className="num" style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              {activeFlight.departureTime}
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '3px' }}>
              {activeFlight.origin}
            </div>
          </div>

          <div style={{ flexGrow: 1, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '0.75rem' }}>{activeFlight.duration}</div>
            <ArrowRight size={16} style={{ margin: '2px auto', display: 'block', opacity: 0.5 }} />
            <div style={{ fontSize: '0.72rem', color: 'var(--success)', fontWeight: 600 }}>{activeFlight.stops}</div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div className="num" style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              {activeFlight.arrivalTime}
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '3px' }}>
              {activeFlight.destination}
            </div>
          </div>
        </div>
      </div>

      {/* Everything below is reference material, not part of the decision */}
      <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '14px' }}>
        <button
          type="button"
          onClick={() => setShowDetails((prev) => !prev)}
          className="details-toggle"
          aria-expanded={showDetails}
        >
          Flight details and fare breakdown
          {showDetails ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        {showDetails && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '14px' }}>
            {/*
              Not every provider reports every field.

              Google Flights' shopping response carries no baggage allowance, no on-time
              rating and no seat count, so the fli provider sends null rather than
              inventing plausible-looking values. These render "Not reported" instead.

              The seat-count line in particular must not fall through to the numeric
              comparison: `null <= 3` is true in JavaScript, which painted a red
              "null seats left" scarcity warning on flights whose availability we simply
              do not know.
            */}
            <div className="spec-grid">
              <div>
                <div className="spec-label">Luggage allowance</div>
                <div className="spec-value">{activeFlight.baggage || 'Not reported'}</div>
              </div>
              <div>
                <div className="spec-label">Reliability rating</div>
                <div className="spec-value" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Award size={13} style={{ color: 'var(--warning)' }} />
                  {activeFlight.reliability || 'Not reported'}
                </div>
              </div>
              <div>
                <div className="spec-label">Terminals</div>
                <div className="spec-value">{activeFlight.terminal || 'Not reported'}</div>
              </div>
              <div>
                <div className="spec-label">Seat availability</div>
                {typeof activeFlight.seatsRemaining === 'number' ? (
                  <div
                    className="spec-value"
                    style={{ color: activeFlight.seatsRemaining <= 3 ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}
                  >
                    {activeFlight.seatsRemaining} seats left
                  </div>
                ) : (
                  <div className="spec-value">Not reported</div>
                )}
              </div>
            </div>

            <div style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-sm)',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '9px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                <Users size={14} style={{ color: 'var(--primary)' }} />
                <span>Cost summary ({getPassengersText(activeRoundtrip?.passengers)})</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>This leg</span>
                <span className="num" style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  ${activeFlight.passengerCosts.total}
                </span>
              </div>

              {hasReturnLeg && (
                <div style={{ borderTop: '1px dashed var(--border-glass)', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Roundtrip total</span>
                  <span className="num" style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--success)' }}>
                    ${activeRoundtrip.outbound.passengerCosts.total + activeRoundtrip.return.passengerCosts.total}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
