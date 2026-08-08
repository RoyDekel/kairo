import { useState } from 'react';
import { Bookmark, Plane, Calendar, Trash2, ArrowRight, Eye } from 'lucide-react';
import { AIRLINES } from '../utils/flightSimulator';

const AirlineLogo = ({ flight, fallbackLogo, size = 32 }) => {
  const iata = flight.airlineCode ? flight.airlineCode.toUpperCase() : '';
  const urls = [];
  if (flight.airlineLogo) urls.push(flight.airlineLogo);
  if (iata) {
    urls.push(`https://pics.avs.io/${size}/${size}/${iata}.png`);
    urls.push(`https://www.gstatic.com/flights/airline_logos/70px/${iata}.png`);
  }

  const [urlIndex, setUrlIndex] = useState(0);

  const handleError = () => {
    setUrlIndex((prev) => prev + 1);
  };

  if (urlIndex < urls.length) {
    return (
      <img
        src={urls[urlIndex]}
        alt={flight.airlineName || 'Airline'}
        onError={handleError}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          objectFit: 'contain',
          borderRadius: '4px'
        }}
      />
    );
  }

  return <span style={{ fontSize: `${size * 0.45}px` }}>{fallbackLogo || '✈️'}</span>;
};

export default function Watchlist({ 
  watchlist, 
  onRemoveFromWatchlist, 
  onTrackFlight,
  activeFlight
}) {

  // Format date helper
  const formatDateShort = (dateStr) => {
    if (!dateStr) return 'Flexible';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Header */}
      <div>
        <h3 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bookmark size={18} style={{ color: 'var(--primary)' }} />
          Your Flight Watchlist
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Track and compare saved options across different airlines and dates
        </p>
      </div>

      {watchlist.length === 0 ? (
        // Empty State
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 20px',
          background: 'rgba(255, 255, 255, 0.01)',
          border: '1px dashed var(--border-glass)',
          borderRadius: 'var(--radius-sm)',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          gap: '12px'
        }}>
          <Bookmark size={40} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
              Your watchlist is empty
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px', maxWidth: '300px' }}>
              Add flights to your watchlist using the "Track" button in the alternative flights schedule or the flight details panel.
            </div>
          </div>
        </div>
      ) : (
        // Watchlist Cards Grid
        <div className="flights-grid" style={{ marginTop: 0 }}>
          {watchlist.map((flight) => {
            const airline = AIRLINES[flight.airlineCode] || { name: 'Unknown', logo: '✈️', color: 'var(--primary)' };
            const isActive = activeFlight.id === flight.id;
            
            // Prefer explicit flight.departureDate first; fallback to ID timestamp
            const dateStr = flight.departureDate || (flight.id ? flight.id.split('-').slice(-3).join('-') : '');

            return (
              <div
                key={flight.id}
                style={{
                  background: isActive ? 'rgba(0, 242, 254, 0.03)' : 'var(--bg-tertiary)',
                  border: isActive ? '1.5px solid var(--primary)' : '1px solid var(--border-glass)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  position: 'relative',
                  transition: 'transform 0.2s ease, border-color 0.2s ease',
                  boxShadow: isActive ? '0 0 15px rgba(0, 242, 254, 0.05)' : 'none'
                }}
              >
                {/* Date Badge Overlay */}
                <span style={{
                  position: 'absolute',
                  top: '-10px',
                  right: '16px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-glass)',
                  color: 'var(--text-primary)',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: 'var(--shadow-sm)'
                }}>
                  <Calendar size={10} style={{ color: 'var(--primary)' }} />
                  <span className="num">{formatDateShort(dateStr)}</span>
                </span>

                {/* Airline & Flight Number */}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.1rem',
                    border: '1px solid var(--border-glass)',
                    overflow: 'hidden'
                  }}>
                    <AirlineLogo flight={flight} fallbackLogo={airline.logo} size={28} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                      <span className="num">{flight.flightNumber}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {[flight.airlineName, flight.planeType].filter(Boolean).join(' • ')}
                    </div>
                  </div>
                </div>

                {/* Time & Route summary */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.1)', padding: '8px 12px', borderRadius: '4px' }}>
                  <div>
                    <div className="num" style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{flight.departureTime}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{flight.origin || 'TLV'}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span className="num" style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{flight.duration}</span>
                    <Plane size={10} style={{ color: 'var(--text-muted)', transform: 'rotate(90deg)' }} />
                    <span className="num" style={{ fontSize: '0.6rem', color: 'var(--primary)' }}>{flight.stops}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="num" style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{flight.arrivalTime}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{flight.destination || 'KRK'}</div>
                  </div>
                </div>

                {/* Price Display */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Current Price:</span>
                  <span className="num" style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--primary)' }}>
                    ${flight.price}
                  </span>
                </div>

                {/* Actions row */}
                <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border-glass)', paddingTop: '12px', marginTop: '4px' }}>
                  
                  {/* Track active */}
                  {isActive ? (
                    <button
                      className="btn"
                      disabled
                      style={{
                        flexGrow: 1,
                        background: 'rgba(0, 242, 254, 0.05)',
                        color: 'var(--primary)',
                        border: '1px solid var(--primary)',
                        padding: '6px 0',
                        fontSize: '0.75rem',
                        cursor: 'default',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px'
                      }}
                    >
                      <Eye size={12} /> Active Tracking
                    </button>
                  ) : (
                    <button
                      onClick={() => onTrackFlight(flight, dateStr)}
                      className="btn btn-primary"
                      style={{
                        flexGrow: 1,
                        padding: '6px 0',
                        fontSize: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px'
                      }}
                    >
                      Track Now <ArrowRight size={12} />
                    </button>
                  )}

                  {/* Remove button */}
                  <button
                    onClick={() => onRemoveFromWatchlist(flight.id)}
                    className="btn btn-secondary"
                    style={{ width: '32px', height: '32px', padding: 0 }}
                    title="Remove from watchlist"
                  >
                    <Trash2 size={14} style={{ color: 'var(--text-secondary)' }} />
                  </button>

                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
