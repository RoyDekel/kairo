import React, { useState } from 'react';
import { Sparkles, Compass, WifiOff } from 'lucide-react';
import { AIRPORTS } from '../utils/flightSimulator';
import { searchAIDestinations, fetchAuthoritativeQuote, DiscoveryUnavailableError } from '../utils/aiDestinationEngine';
import DestinationCard from './DestinationCard';
import { useAuth } from '../contexts/AuthProvider';
import {
  DEFAULT_ORIGIN,
  DEFAULT_DEPARTURE_DATE,
  DEFAULT_RETURN_DATE,
  createDefaultPassengers
} from '../utils/searchDefaults';

export default function AIDestinationExplorer({
  searchParams,
  setSearchParams,
  setActiveRoundtrip,
  setActiveTab,
  onToggleWatchlist,
  watchlist = []
}) {
  const { session } = useAuth();

  // Origin and dates live in the app-wide `searchParams` rather than in local state.
  // Previously this component kept its own copy and only wrote back on "Track Route",
  // so changing dates here left "Search & Compare" showing stale values.
  const origin = searchParams.origin || DEFAULT_ORIGIN;
  const departureDate = searchParams.departureDate || DEFAULT_DEPARTURE_DATE;
  const returnDate = searchParams.returnDate || DEFAULT_RETURN_DATE;

  const patchSearchParams = (patch) => setSearchParams((prev) => ({ ...prev, ...patch }));

  const setOrigin = (value) => patchSearchParams({ origin: value });
  const setDepartureDate = (value) => patchSearchParams({ departureDate: value });
  const setReturnDate = (value) => patchSearchParams({ returnDate: value });

  // Budget and interests are discovery-only concerns, so they stay local.
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
  const [isBackendUnavailable, setIsBackendUnavailable] = useState(false);
  // Destination currently being upgraded from estimate to live quote (null when idle).
  const [trackingDestCode, setTrackingDestCode] = useState(null);

  const accessToken = session?.access_token;

  // Compute AI destination recommendations via the backend event intelligence endpoint.
  // Debounced because `maxBudget` is a range slider — without this, every pixel of drag
  // fired a fresh round of network requests.
  React.useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const debounceId = setTimeout(() => {
      searchAIDestinations({
        origin,
        departureDate,
        returnDate,
        maxBudget,
        interests: selectedInterests,
        accessToken
      })
        .then((results) => {
          if (!isMounted) return;
          setAiRecommendations(results);
          setIsBackendUnavailable(false);
          setIsLoading(false);
        })
        .catch((err) => {
          if (!isMounted) return;
          // Distinguish "backend unreachable" from "genuinely no events", otherwise a
          // cold Render instance looks identical to an empty result set.
          if (err instanceof DiscoveryUnavailableError) {
            console.warn('Event intelligence service unavailable:', err.message);
            setIsBackendUnavailable(true);
          } else {
            console.error('Error searching AI destinations:', err);
            setIsBackendUnavailable(false);
          }
          setAiRecommendations([]);
          setIsLoading(false);
        });
    }, 400);

    return () => {
      isMounted = false;
      clearTimeout(debounceId);
    };
  }, [origin, departureDate, returnDate, maxBudget, selectedInterests, accessToken]);

  // Hand the chosen destination off to the "Should I Book?" verdict view.
  const handleTrackRoute = async (recommendation) => {
    setTrackingDestCode(recommendation.destCode);

    // Writes the discovered destination back into shared state, so "Search & Compare"
    // opens pre-filled with exactly the route the user just picked.
    setSearchParams((prev) => ({
      ...prev,
      tripType: 'round-trip',
      origin: recommendation.originCode,
      destination: recommendation.destCode,
      departureDate: recommendation.departureDate,
      returnDate: recommendation.returnDate,
      passengers: createDefaultPassengers(),
      stops: '0'
    }));

    // Upgrade the card's estimate to a real quote before showing the buy/wait verdict.
    // Recommending BUY NOW against a modelled price would be misleading, and this call
    // also warms the server cache so the card itself switches to "live fare" on the
    // next scan. Falls back to the estimate if the real search is unavailable.
    let outbound = recommendation.outboundFlight;
    let returnFlight = recommendation.returnFlight;

    try {
      const quote = await fetchAuthoritativeQuote({
        origin: recommendation.originCode,
        destination: recommendation.destCode,
        departureDate: recommendation.departureDate,
        returnDate: recommendation.returnDate,
        passengers: createDefaultPassengers(),
        accessToken
      });

      if (quote?.outbound) {
        outbound = quote.outbound;
        returnFlight = quote.return || returnFlight;
      }
    } catch (err) {
      console.warn('Could not upgrade estimate to a live quote; tracking the estimate instead:', err);
    }

    setActiveRoundtrip({
      outbound,
      return: returnFlight,
      passengers: createDefaultPassengers(),
      origin: recommendation.originCode,
      destination: recommendation.destCode,
      departureDate: recommendation.departureDate,
      returnDate: recommendation.returnDate
    });

    setTrackingDestCode(null);
    setActiveTab('dashboard');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* EXPLORER HEADER & CONTROL PANEL */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Compass size={22} style={{ color: 'var(--primary)' }} />
              Where to Go
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Got dates but no destination? KAIRO scans every route from your origin and pairs the cheapest fares with live concerts, matches, and festivals.
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
              Scanning destinations and live events...
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Checking real-time live events and flights for {departureDate} – {returnDate}
            </div>
          </div>
        ) : isBackendUnavailable ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <WifiOff size={38} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Event Intelligence Service Unreachable
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: '540px', margin: 0, lineHeight: 1.6 }}>
              KAIRO couldn't reach the event intelligence backend, so destination recommendations are paused. The service may still be warming up.
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              💡 Give it a few seconds and adjust any filter to retry — or head to <strong>Search & Compare</strong> if you already know your route.
            </p>
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
          aiRecommendations.map((rec) => (
            <DestinationCard
              key={rec.id}
              recommendation={rec}
              isWatched={watchlist.some((w) => w.id === rec.outboundFlight.id)}
              isTracking={trackingDestCode === rec.destCode}
              isAnyTracking={trackingDestCode !== null}
              onTrack={handleTrackRoute}
              onToggleWatchlist={onToggleWatchlist}
            />
          ))
        )}
      </div>

    </div>
  );
}
