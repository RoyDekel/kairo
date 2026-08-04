import React, { useState } from 'react';
import { Sparkles, Compass, WifiOff, Search, AlertTriangle } from 'lucide-react';
import { AIRPORTS } from '../utils/flightSimulator';
import { searchAIDestinations, fetchAuthoritativeQuote, DiscoveryUnavailableError } from '../utils/aiDestinationEngine';
import DestinationCard from './DestinationCard';
import CustomDatePicker from './CustomDatePicker';
import { useAuth } from '../contexts/AuthProvider';
import {
  DEFAULT_ORIGIN,
  DEFAULT_DEPARTURE_DATE,
  DEFAULT_RETURN_DATE,
  getTodayDateString,
  createDefaultPassengers
} from '../utils/searchDefaults';

const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';

const sortedAirports = Object.values(AIRPORTS)
  .filter(a => !isTestEnv || ['TLV', 'KRK', 'LHR', 'CDG', 'JFK', 'DXB', 'FCO', 'NRT', 'ATH', 'LAX', 'SIN', 'HND', 'AMS', 'SYD', 'BCN', 'HKG', 'MAD', 'BER', 'MUC', 'VIE', 'PRG', 'BUD', 'LIS', 'DUB', 'MXP', 'ZRH', 'MIA', 'ICN', 'BKK', 'CPH', 'EDI', 'GIG'].includes(a.code))
  .sort((a, b) => {
    const cityA = a.city || '';
    const cityB = b.city || '';
    return cityA.localeCompare(cityB);
  });

function formatDateDMY(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

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
  const origin = searchParams.origin || DEFAULT_ORIGIN;
  const departureDate = searchParams.departureDate || DEFAULT_DEPARTURE_DATE;
  const returnDate = searchParams.returnDate || DEFAULT_RETURN_DATE;

  const [validationError, setValidationError] = useState('');

  const patchSearchParams = (patch) => {
    setValidationError('');
    setSearchParams((prev) => ({ ...prev, ...patch }));
  };

  const setOrigin = (value) => patchSearchParams({ origin: value });
  const setDepartureDate = (value) => patchSearchParams({ departureDate: value });
  const setReturnDate = (value) => patchSearchParams({ returnDate: value });

  // Budget and interests are discovery-only concerns, so they stay local.
  const [maxBudget, setMaxBudget] = useState(1200);
  const [selectedInterests, setSelectedInterests] = useState(['music', 'sports', 'festivals', 'culture']);

  const handleMaxBudgetChange = (value) => {
    setValidationError('');
    setMaxBudget(value);
  };

  // Toggle interest tags
  const toggleInterest = (category) => {
    setValidationError('');
    if (selectedInterests.includes(category)) {
      if (selectedInterests.length > 1) {
        setSelectedInterests(selectedInterests.filter((c) => c !== category));
      }
    } else {
      setSelectedInterests([...selectedInterests, category]);
    }
  };

  const [aiRecommendations, setAiRecommendations] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  /*
    Match by default: the page's purpose is to answer "where should I go on these dates",
    and the cheapest fare to a city with nothing on is not an answer to that. Cheapest is
    one click away for users who are shopping on price, mirroring the Search & Compare
    control so the two pages behave the same way.
  */
  const [sortKey, setSortKey] = useState('match'); // 'match' | 'price'
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isBackendUnavailable, setIsBackendUnavailable] = useState(false);
  // Destination currently being upgraded from estimate to live quote (null when idle).
  const [trackingDestCode, setTrackingDestCode] = useState(null);

  const accessToken = session?.access_token;

  // Perform AI destination search on user CTA click with full validations.
  const handleSearch = () => {
    setValidationError('');

    if (!origin) {
      setValidationError('Please select an origin city.');
      return;
    }
    if (!departureDate) {
      setValidationError('Please select a departure date.');
      return;
    }
    if (!returnDate) {
      setValidationError('Please select a return date.');
      return;
    }
    if (new Date(returnDate) <= new Date(departureDate)) {
      setValidationError('Return date must be after the departure date.');
      return;
    }
    if (isNaN(maxBudget) || maxBudget < 150) {
      setValidationError('Max budget must be at least $150.');
      return;
    }

    setIsLoading(true);
    setHasSearched(true);

    searchAIDestinations({
      origin,
      departureDate,
      returnDate,
      maxBudget,
      interests: selectedInterests,
      accessToken
    })
      .then((results) => {
        setAiRecommendations(results);
        setCurrentPage(1);
        setIsBackendUnavailable(false);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err instanceof DiscoveryUnavailableError) {
          console.warn('Event intelligence service unavailable:', err.message);
          setIsBackendUnavailable(true);
        } else {
          console.error('Error searching AI destinations:', err);
          setIsBackendUnavailable(false);
        }
        setAiRecommendations([]);
        setCurrentPage(1);
        setIsLoading(false);
      });
  };

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

  const ITEMS_PER_PAGE = 10;

  // Sorted before slicing, so page 1 holds the actual top of the chosen order rather than
  // the first ten of the previous one.
  const sortedRecommendations = [...aiRecommendations].sort((a, b) =>
    sortKey === 'price'
      ? a.roundtripPrice - b.roundtripPrice || b.matchScore - a.matchScore
      : b.matchScore - a.matchScore || a.roundtripPrice - b.roundtripPrice
  );

  const changeSort = (key) => {
    setSortKey(key);
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(sortedRecommendations.length / ITEMS_PER_PAGE);
  const paginatedRecommendations = sortedRecommendations.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* EXPLORER HEADER & CONTROL PANEL */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'visible' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Compass size={22} style={{ color: 'var(--primary)' }} />
              When to Go
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Got dates but no destination? KAIRO scans every route from your origin and pairs the cheapest fares with live concerts, matches, and festivals.
            </p>
          </div>
          <div className="badge badge-info" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
            {hasSearched ? `${aiRecommendations.length} Destinations Scanned` : 'Click Search Routes to scan'}
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
          padding: '16px',
          overflow: 'visible',
          position: 'relative',
          zIndex: 10
        }}>
          {/* Origin */}
          <div className="input-group">
            <label className="input-label">Origin City</label>
            <select
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              className="input-field"
            >
              {sortedAirports.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.city} ({a.code}) - {a.country}
                </option>
              ))}
            </select>
          </div>

          {/* Departure Date */}
          <CustomDatePicker
            label="Departure Date"
            value={departureDate}
            onChange={(newDate) => {
              setDepartureDate(newDate);
              if (returnDate && newDate > returnDate) {
                setReturnDate(newDate);
              }
            }}
            minDate={getTodayDateString()}
            relatedDate={returnDate}
            isReturnDate={false}
          />

          {/* Return Date */}
          <CustomDatePicker
            label="Return Date"
            value={returnDate}
            onChange={(newDate) => setReturnDate(newDate)}
            minDate={departureDate || getTodayDateString()}
            relatedDate={departureDate}
            isReturnDate={true}
          />

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
              onChange={(e) => handleMaxBudgetChange(Number(e.target.value))}
              style={{ accentColor: 'var(--primary)', marginTop: '8px' }}
            />
          </div>
        </div>

        {/* VALIDATION ERROR ALERT BANNER */}
        {validationError && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#ef4444',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <AlertTriangle size={18} />
            <span>{validationError}</span>
          </div>
        )}

        {/* INTEREST CATEGORY PILLS AND CTA BUTTON */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          {hasSearched && !isLoading && aiRecommendations.length > 0 && (
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
          )}

          <button
            type="button"
            onClick={handleSearch}
            disabled={isLoading}
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px 28px',
              fontSize: '0.95rem',
              fontWeight: 700,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.75 : 1,
              boxShadow: '0 4px 14px rgba(59, 130, 246, 0.3)',
              marginLeft: 'auto'
            }}
          >
            <Search size={18} />
            {isLoading ? 'Searching Routes...' : 'Search Routes'}
          </button>
        </div>
      </div>

      {/* AI RECOMMENDATION RESULTS LIST */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {!hasSearched ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '56px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'var(--primary-glow-weak)',
              border: '1px solid var(--border-glass)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '4px'
            }}>
              <Compass size={34} style={{ color: 'var(--primary)' }} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              Ready to Find Your Next Trip?
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', maxWidth: '560px', margin: 0, lineHeight: 1.6 }}>
              Click <strong>Search Routes</strong> above to scan all available destinations, live concerts, matches, and festivals for your selected dates (<strong>{formatDateDMY(departureDate)}</strong> – <strong>{formatDateDMY(returnDate)}</strong>).
            </p>
          </div>
        ) : isLoading ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <Sparkles size={28} style={{ color: 'var(--primary)' }} />
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Scanning destinations and live events...
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Checking real-time live events and flights for {formatDateDMY(departureDate)} – {formatDateDMY(returnDate)}
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
            <button
              type="button"
              onClick={handleSearch}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '8px', padding: '8px 16px', fontSize: '0.85rem' }}
            >
              <Search size={14} />
              Retry Search
            </button>
          </div>
        ) : aiRecommendations.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <Compass size={38} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              No Verified Ticketmaster Events Found
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: '540px', margin: 0, lineHeight: 1.6 }}>
              There are currently no verified live Ticketmaster events listed for these travel dates (<strong>{formatDateDMY(departureDate)}</strong> – <strong>{formatDateDMY(returnDate)}</strong>) within your budget of <strong>${maxBudget}</strong>.
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              💡 Tip: Try picking dates closer to upcoming months or adjusting your budget filter!
            </p>
          </div>
        ) : (
          <>
            {/* SORT CONTROL — same shape as the Search & Compare listings control. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', margin: '0 0 4px 2px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Sort:</span>
              <div style={{ display: 'flex', background: 'var(--bg-tertiary)', borderRadius: '6px', border: '1px solid var(--border-glass)', padding: '2px' }}>
                <button
                  onClick={() => changeSort('match')}
                  aria-pressed={sortKey === 'match'}
                  style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', background: sortKey === 'match' ? 'var(--bg-secondary)' : 'transparent', color: sortKey === 'match' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer', fontSize: '0.75rem' }}
                >
                  Best match
                </button>
                <button
                  onClick={() => changeSort('price')}
                  aria-pressed={sortKey === 'price'}
                  style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', background: sortKey === 'price' ? 'var(--bg-secondary)' : 'transparent', color: sortKey === 'price' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer', fontSize: '0.75rem' }}
                >
                  Cheapest
                </button>
              </div>
            </div>

            {paginatedRecommendations.map((rec) => (
              <DestinationCard
                key={rec.id}
                recommendation={rec}
                isWatched={watchlist.some((w) => w.id === rec.outboundFlight.id)}
                isTracking={trackingDestCode === rec.destCode}
                isAnyTracking={trackingDestCode !== null}
                onTrack={handleTrackRoute}
                onToggleWatchlist={onToggleWatchlist}
              />
            ))}

            {/* PAGINATION CONTROLS */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '8px',
                marginTop: '24px',
                paddingTop: '16px',
                borderTop: '1px solid var(--border-glass)'
              }}>
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  className="btn btn-secondary"
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.8rem',
                    opacity: currentPage === 1 ? 0.5 : 1,
                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
                  }}
                >
                  Previous
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    type="button"
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className="btn"
                    style={{
                      padding: '6px 12px',
                      fontSize: '0.8rem',
                      backgroundColor: currentPage === page ? 'var(--primary)' : 'var(--bg-tertiary)',
                      color: currentPage === page ? '#0b0f19' : 'var(--text-secondary)',
                      border: currentPage === page ? '1px solid var(--primary)' : '1px solid var(--border-glass)',
                      borderRadius: 'var(--radius-sm)',
                      fontWeight: currentPage === page ? '600' : 'normal',
                      cursor: 'pointer'
                    }}
                  >
                    {page}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  className="btn btn-secondary"
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.8rem',
                    opacity: currentPage === totalPages ? 0.5 : 1,
                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

    </div>
  );
}
