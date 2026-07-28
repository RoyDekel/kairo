import React, { useState } from 'react';
import { 
  Plane, Clock, ShieldAlert, Award, 
  Play, Pause, RotateCcw, Bell, 
  Bookmark, BookmarkCheck, Calendar, Info, Globe, Users, Sparkles 
} from 'lucide-react';
import { AIRLINES, getSkyscannerUrl } from '../utils/flightSimulator';
import { getPriceConfidenceInsight } from '../utils/priceConfidenceEngine';

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

export default function FlightDetails({ 
  activeFlight, 
  telemetry, 
  isSimulating, 
  simulationProgress, 
  setSimulationProgress, 
  setIsSimulating, 
  simulationSpeed, 
  setSimulationSpeed, 
  onToggleWatchlist, 
  isWatched, 
  selectedDate,
  onOpenAlertModal,
  // Added roundtrip context
  activeRoundtrip
}) {
  const airlineInfo = AIRLINES[activeFlight.airlineCode] || { name: 'Unknown', logo: '✈️', color: 'var(--primary)' };

  // Format date helper
  const formatDate = (dateStr) => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(dateStr).toLocaleDateString('en-US', options);
  };

  const progressPercent = Math.round(simulationProgress * 100);

  // Skyscanner Link
  const skyscannerUrl = getSkyscannerUrl(activeFlight.origin, activeFlight.destination, selectedDate);

  // Passenger summary text helper
  const getPassengersText = (passengers) => {
    if (!passengers) return '1 Adult';
    const parts = [];
    if (passengers.adults > 0) parts.push(`${passengers.adults} Adult${passengers.adults > 1 ? 's' : ''}`);
    if (passengers.children > 0) parts.push(`${passengers.children} Child${passengers.children > 1 ? 'ren' : ''}`);
    if (passengers.infants > 0) parts.push(`${passengers.infants} Infant${passengers.infants > 1 ? 's' : ''}`);
    return parts.join(', ');
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-glass)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
            boxShadow: `0 0 12px ${airlineInfo.color}25`,
            overflow: 'hidden'
          }}>
            <AirlineLogo flight={activeFlight} fallbackLogo={airlineInfo.logo} size={40} />
          </div>
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {activeFlight.flightNumber}
              <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>{activeFlight.cabinClass}</span>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {activeFlight.airlineName} • {activeFlight.planeType}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button 
            onClick={() => onToggleWatchlist(activeFlight)}
            className="btn btn-secondary" 
            style={{ padding: '8px 12px', fontSize: '0.85rem', color: isWatched ? 'var(--primary)' : 'var(--text-primary)' }}
            title={isWatched ? "Remove from watchlist" : "Add to watchlist"}
          >
            {isWatched ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
            {isWatched ? "Watched" : "Track"}
          </button>
          
          <button 
            onClick={onOpenAlertModal}
            className="btn btn-secondary" 
            style={{ padding: '8px 12px', fontSize: '0.85rem' }}
            title="Configure alerts"
          >
            <Bell size={16} />
            Alerts
          </button>

          <a 
            href={skyscannerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
            style={{ 
              padding: '8px 12px', 
              fontSize: '0.85rem',
              background: 'rgba(0, 180, 216, 0.15)',
              color: '#00e1ff',
              border: '1px solid rgba(0, 180, 216, 0.3)',
              boxShadow: '0 0 8px rgba(0, 180, 216, 0.15)'
            }}
            title="Search this flight route on Skyscanner"
          >
            <Globe size={16} />
            Skyscanner
          </a>
        </div>
      </div>

      <div style={{ borderBottom: '1px solid var(--border-glass)' }}></div>

      {/* Schedule Info */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          <Calendar size={14} />
          {formatDate(selectedDate)}
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ textAlign: 'left', minWidth: '100px' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
              {activeFlight.departureTime}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px' }}>
              {activeFlight.origin}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Terminal 3, Gate B4
            </div>
          </div>

          <div style={{ flexGrow: 1, padding: '0 20px', position: 'relative' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              {activeFlight.duration}
            </div>
            
            {/* Visual flight progress bar */}
            <div style={{
              height: '3px',
              backgroundColor: 'var(--bg-tertiary)',
              borderRadius: '2px',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <div style={{
                position: 'absolute',
                left: 0,
                height: '100%',
                width: `${progressPercent}%`,
                backgroundColor: 'var(--primary)',
                boxShadow: '0 0 8px var(--primary-glow)'
              }}></div>
              <Plane size={14} style={{
                color: 'var(--primary)',
                position: 'absolute',
                left: `calc(${progressPercent}% - 7px)`,
                transform: 'rotate(90deg)',
                filter: 'drop-shadow(0 0 4px var(--primary-glow))',
                transition: 'left 0.15s linear'
              }} />
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600, marginTop: '6px' }}>
              {activeFlight.stops}
            </div>
          </div>

          <div style={{ textAlign: 'right', minWidth: '100px' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
              {activeFlight.arrivalTime}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px' }}>
              {activeFlight.destination}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Terminal 1, Gate 5
            </div>
          </div>
        </div>
      </div>

      {/* Specifications Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid var(--border-glass)',
        borderRadius: 'var(--radius-sm)',
        padding: '12px'
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Luggage Allowance</div>
          <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)', marginTop: '2px' }}>
            {activeFlight.baggage}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Reliability Rating</div>
          <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Award size={14} style={{ color: 'var(--warning)' }} />
            {activeFlight.reliability}
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '8px', marginTop: '4px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Route Code</div>
          <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)', marginTop: '2px' }}>
            {activeFlight.terminal}
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '8px', marginTop: '4px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Seat Availability</div>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: activeFlight.seatsRemaining <= 3 ? 'var(--danger)' : 'var(--success)', marginTop: '2px' }}>
            {activeFlight.seatsRemaining} seats left
          </div>
        </div>
      </div>

      {/* Passenger count and combined cost card */}
      <div style={{
        backgroundColor: 'var(--bg-tertiary)',
        border: '1px solid var(--border-glass-bright)',
        borderRadius: 'var(--radius-sm)',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          <Users size={15} style={{ color: 'var(--primary)' }} />
          <span>Cost Summary ({getPassengersText(activeRoundtrip?.passengers)})</span>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Flight Ticket Fare:
          </span>
          <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)' }}>
            ${activeFlight.passengerCosts.total}
          </span>
        </div>

        {activeRoundtrip && (
          <div style={{ borderTop: '1px dashed var(--border-glass)', paddingTop: '8px', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Roundtrip Package Total:
            </span>
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#34d399', filter: 'drop-shadow(0 0 4px rgba(52, 211, 153, 0.2))' }}>
              ${activeRoundtrip.outbound.passengerCosts.total + activeRoundtrip.return.passengerCosts.total}
            </span>
          </div>
        )}
      </div>

      {/* KAIRO AI PRICE CONFIDENCE & BUY TIMING INSIGHT */}
      {(() => {
        const priceInsight = getPriceConfidenceInsight(activeFlight, activeFlight.price);
        return (
          <div style={{
            background: 'var(--primary-glow-weak)',
            border: '1px solid var(--primary-glow)',
            borderRadius: 'var(--radius-sm)',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={16} style={{ color: 'var(--primary)' }} />
                <span>KAIRO AI Buy Timing Recommendation</span>
              </div>

              <div style={{
                padding: '4px 10px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: 800,
                backgroundColor: priceInsight.recommendation === 'BUY_NOW' ? 'var(--success-glow)' : 'var(--warning-glow)',
                color: priceInsight.recommendation === 'BUY_NOW' ? 'var(--success)' : 'var(--warning)',
                border: priceInsight.recommendation === 'BUY_NOW' ? '1px solid var(--success)' : '1px solid var(--warning)'
              }}>
                {priceInsight.actionHeadline}
              </div>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              {priceInsight.summary}
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', paddingTop: '6px', borderTop: '1px dashed var(--border-glass)' }}>
              <span>90-Day Range: ${priceInsight.low90Day} – ${priceInsight.high90Day}</span>
              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                {priceInsight.confidenceStars} ({priceInsight.confidenceScore}% Confidence)
              </span>
            </div>
          </div>
        );
      })()}

      <div style={{ borderBottom: '1px solid var(--border-glass)' }}></div>

      {/* Simulator HUD Control Center */}
      <div>
        <h4 style={{ fontSize: '0.95rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
          <Clock size={16} style={{ color: 'var(--primary)' }} />
          Flight Live Simulator
        </h4>

        {/* Simulation Stats Panel */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.2fr 1fr',
          gap: '8px',
          textAlign: 'center',
          marginBottom: '16px'
        }}>
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', padding: '6px' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Phase</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)' }}>
              {telemetry.status}
            </div>
          </div>
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', padding: '6px' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Coordinates</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {telemetry.latitude.toFixed(4)}°, {telemetry.longitude.toFixed(4)}°
            </div>
          </div>
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', padding: '6px' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>ETA / REM</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {telemetry.timeRemaining > 0 ? `${telemetry.timeRemaining} min` : 'Arrived'}
            </div>
          </div>
        </div>

        {/* Progress Slider */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifySpace: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
            <span>{activeFlight.origin}</span>
            <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{progressPercent}% Complete</span>
            <span>{activeFlight.destination}</span>
          </div>
          <input 
            type="range" 
            min="0" 
            max="1" 
            step="0.005" 
            value={simulationProgress} 
            onChange={(e) => {
              setSimulationProgress(parseFloat(e.target.value));
              setIsSimulating(false);
            }}
            style={{
              width: '100%',
              height: '5px',
              borderRadius: '3px',
              background: 'var(--bg-tertiary)',
              outline: 'none',
              cursor: 'pointer',
              accentColor: 'var(--primary)'
            }}
          />
        </div>

        {/* Controls Row */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          
          {/* Play / Pause */}
          <button 
            onClick={() => setIsSimulating(!isSimulating)}
            className="btn btn-primary"
            style={{ flexGrow: 1, height: '40px', padding: '0' }}
          >
            {isSimulating ? <Pause size={16} /> : <Play size={16} />}
            <span>{isSimulating ? 'Pause Simulation' : 'Start Simulation'}</span>
          </button>

          {/* Reset */}
          <button 
            onClick={() => {
              setSimulationProgress(0);
              setIsSimulating(false);
            }}
            className="btn btn-secondary"
            style={{ width: '40px', height: '40px', padding: 0 }}
            title="Reset flight simulation"
          >
            <RotateCcw size={16} />
          </button>

          {/* Speed Selection */}
          <div style={{ display: 'flex', background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)', padding: '2px' }}>
            {[1, 5, 20].map((speed) => (
              <button
                key={speed}
                onClick={() => setSimulationSpeed(speed)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  background: simulationSpeed === speed ? 'var(--bg-secondary)' : 'transparent',
                  color: simulationSpeed === speed ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {speed}x
              </button>
            ))}
          </div>

        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <Info size={12} />
          <span>Starting simulation moves the flight in real time. Drag the slider to review flight phases.</span>
        </div>

      </div>

    </div>
  );
}
