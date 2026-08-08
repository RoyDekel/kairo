// The default React import went with the React.Fragment the old step indicator
// needed; JSX itself compiles through the automatic runtime and does not use it.
import { useState, useEffect, useRef } from 'react';
import {
  Filter, Sparkles, ArrowRight, Check, Globe,
  Users, ChevronDown, ShieldAlert, ArrowLeftRight
} from 'lucide-react';
import { AIRLINES, getSkyscannerUrl } from '../utils/flightSimulator';
import CustomDatePicker from './CustomDatePicker';
import AirportAutocomplete from './AirportAutocomplete';
import { useAuth } from '../contexts/authContext';
import { getApiBase, authHeaders, fetchWithTimeout } from '../lib/apiBase';

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

function formatDateDMY(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

export default function AlternativeFlights({
  setSelectedDate,
  setActiveFlight,
  // New props for dynamic search
  searchParams,
  setSearchParams,
  setActiveRoundtrip,
  setActiveTab
}) {
  const { session } = useAuth();

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getLocalDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Search inputs local states
  const [tripType, setTripType] = useState(searchParams.tripType || 'round-trip');
  const [localOrigin, setLocalOrigin] = useState(searchParams.origin);
  const [localDestination, setLocalDestination] = useState(searchParams.destination);
  const [localDepDate, setLocalDepDate] = useState(searchParams.departureDate);
  const [localRetDate, setLocalRetDate] = useState(searchParams.returnDate);
  const [localStops, setLocalStops] = useState(searchParams.stops || '0');
  const [localTravelClass, setLocalTravelClass] = useState(searchParams.travelClass || 'ALL');

  // Multi-city legs state
  const [localLegs, setLocalLegs] = useState([
    { id: 1, origin: searchParams.origin || 'TLV', destination: searchParams.destination || 'KRK', depDate: searchParams.departureDate || '' },
    { id: 2, origin: searchParams.destination || 'KRK', destination: 'LHR', depDate: searchParams.returnDate || '' }
  ]);

  const updateLeg = (id, field, value) => {
    setLocalLegs(prev => prev.map(leg => leg.id === id ? { ...leg, [field]: value } : leg));
  };

  const addLeg = () => {
    if (localLegs.length >= 5) return;
    const lastLeg = localLegs[localLegs.length - 1];
    const newLeg = {
      id: Date.now(),
      origin: lastLeg.destination || 'KRK',
      destination: '',
      depDate: ''
    };
    setLocalLegs(prev => [...prev, newLeg]);
  };

  const removeLeg = (id) => {
    if (localLegs.length <= 2) return;
    setLocalLegs(prev => prev.filter(leg => leg.id !== id));
  };

  // Passenger dropdown states
  const [showPassengerDropdown, setShowPassengerDropdown] = useState(false);
  const [localAdults, setLocalAdults] = useState(searchParams.passengers.adults);
  const [localChildren, setLocalChildren] = useState(searchParams.passengers.children);
  const [localInfants, setLocalInfants] = useState(searchParams.passengers.infants);

  const passengerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (passengerRef.current && !passengerRef.current.contains(event.target)) {
        setShowPassengerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Sorting & Filtering local states
  const [sortKey, setSortKey] = useState('price'); // 'price', 'duration'
  const [filterCarrier, setFilterCarrier] = useState('ALL');

  // Booking Flow Steps: 1 = Outbound Selection, 2 = Return Selection, 3 = Confirmation Bundle
  const [bookingStep, setBookingStep] = useState(1);
  const [selectedOutbound, setSelectedOutbound] = useState(null);
  const [selectedReturn, setSelectedReturn] = useState(null);

  // Error validation states
  const [errorMsg, setErrorMsg] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // State for flights retrieved from server
  const [outboundFlights, setOutboundFlights] = useState([]);
  const [returnFlights, setReturnFlights] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    setCurrentPage(1);
  }, [bookingStep, searchParams, filterCarrier, sortKey]);

  // Re-hydrate the search form whenever shared state changes underneath it (for example
  // after "Whento Go" hands off a destination). The form intentionally keeps local
  // draft state so edits aren't committed until Search is pressed — this effect is what
  // stops that draft from going stale relative to the rest of the app.
  useEffect(() => {
    setTripType(searchParams.tripType || 'round-trip');
    setLocalOrigin(searchParams.origin || '');
    setLocalDestination(searchParams.destination || '');
    setLocalDepDate(searchParams.departureDate || '');
    setLocalRetDate(searchParams.returnDate || '');
    setLocalStops(searchParams.stops || '0');
    setLocalTravelClass(searchParams.travelClass || 'ALL');
    setLocalAdults(searchParams.passengers?.adults ?? 1);
    setLocalChildren(searchParams.passengers?.children ?? 0);
    setLocalInfants(searchParams.passengers?.infants ?? 0);
  }, [searchParams]);

  // Fetch flights when search parameters change
  useEffect(() => {
    let active = true;
    const fetchFlights = async () => {
      if (!searchParams.destination) {
        setOutboundFlights([]);
        setReturnFlights([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setApiError('');
      try {
        const queryParams = new URLSearchParams({
          origin: searchParams.origin,
          destination: searchParams.destination,
          departureDate: searchParams.departureDate,
          returnDate: searchParams.returnDate,
          adults: searchParams.passengers.adults,
          children: searchParams.passengers.children,
          infants: searchParams.passengers.infants,
          stops: searchParams.stops || '0',
          travelClass: searchParams.travelClass || 'ALL'
        });
        // Google Flights is scraped live by SerpApi on an uncached query, which can take
        // a long time — the backend itself now gives up after 45s (serpapiProvider.js).
        // This must stay comfortably above that so the backend's own timeout/fallback
        // fires first and the client gets a real (if simulated) JSON response, instead of
        // the client aborting first and discarding a search the backend was still running.
        const res = await fetchWithTimeout(`${getApiBase()}/api/flights?${queryParams.toString()}`, {
          timeoutMs: 50000,
          headers: authHeaders(session?.access_token)
        });

        if (!res.ok) {
          let errMsg = `Server returned status ${res.status}`;
          try {
            const errData = await res.json();
            if (errData && errData.error) {
              errMsg = errData.error;
            }
          } catch {
            // Body was not JSON. errMsg already holds the status-code fallback above, which
            // is the best description available — keep it and throw that.
          }
          throw new Error(errMsg);
        }

        const data = await res.json();
        if (active) {
          setOutboundFlights(data.outbound || []);
          setReturnFlights(data.return || []);
        }
      } catch (err) {
        if (active) {
          console.error("Failed to fetch flights from server:", err);
          setApiError(err.message || "Failed to fetch flights from the server.");
          setOutboundFlights([]);
          setReturnFlights([]);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    fetchFlights();

    return () => {
      active = false;
    };
  }, [searchParams]);

  // Handle Search Submission
  const handleSearch = (e) => {
    e.preventDefault();

    if (tripType === 'round-trip') {
      if (!localDestination) {
        setErrorMsg('Please select a destination.');
        return;
      }
      if (localOrigin === localDestination) {
        setErrorMsg('Departure and Arrival airports cannot be the same.');
        return;
      }
      if (!localDepDate) {
        setErrorMsg('Please select a departure date.');
        return;
      }
      if (!localRetDate) {
        setErrorMsg('Please select a return date.');
        return;
      }
      if (new Date(localRetDate) <= new Date(localDepDate)) {
        setErrorMsg('Return date must be after the departure date.');
        return;
      }
    } else if (tripType === 'one-way') {
      if (!localDestination) {
        setErrorMsg('Please select a destination.');
        return;
      }
      if (localOrigin === localDestination) {
        setErrorMsg('Departure and Arrival airports cannot be the same.');
        return;
      }
      if (!localDepDate) {
        setErrorMsg('Please select a departure date.');
        return;
      }
    } else if (tripType === 'multi-city') {
      for (let i = 0; i < localLegs.length; i++) {
        const leg = localLegs[i];
        if (!leg.destination) {
          setErrorMsg(`Please select a destination for Flight ${i + 1}.`);
          return;
        }
        if (leg.origin === leg.destination) {
          setErrorMsg(`Flight ${i + 1}: Departure and Arrival airports cannot be the same.`);
          return;
        }
        if (!leg.depDate) {
          setErrorMsg(`Please select a departure date for Flight ${i + 1}.`);
          return;
        }
      }
    }

    setErrorMsg('');

    // Update global search parameters
    const newParams = {
      tripType,
      origin: tripType === 'multi-city' ? localLegs[0].origin : localOrigin,
      destination: tripType === 'multi-city' ? localLegs[0].destination : localDestination,
      departureDate: tripType === 'multi-city' ? localLegs[0].depDate : localDepDate,
      returnDate: tripType === 'round-trip' ? localRetDate : '',
      multiCityLegs: tripType === 'multi-city' ? localLegs : [],
      passengers: {
        adults: localAdults,
        children: localChildren,
        infants: localInfants
      },
      stops: localStops,
      travelClass: localTravelClass
    };

    setSearchParams(newParams);

    // Reset booking flow
    setBookingStep(1);
    setSelectedOutbound(null);
    setSelectedReturn(null);
  };

  // Handle Swapping Departure and Arrival Airports
  const handleSwapAirports = () => {
    if (!localDestination) {
      setLocalDestination(localOrigin);
      setLocalOrigin('');
      return;
    }
    const temp = localOrigin;
    setLocalOrigin(localDestination);
    setLocalDestination(temp);
  };

  // Get active list depending on current step
  const activeFlightList = bookingStep === 1 ? outboundFlights : returnFlights;

  // Filter & Sort flights
  const filteredFlights = activeFlightList.filter(flight => {
    if (filterCarrier === 'ALL') return true;
    return flight.airlineName === filterCarrier;
  });

  const parseDurationToMinutes = (durationStr) => {
    if (!durationStr) return 0;
    const match = durationStr.match(/(\d+)h\s*(\d+)m/i);
    if (!match) return 0;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  };

  const sortedFlights = [...filteredFlights].sort((a, b) => {
    if (sortKey === 'price') {
      return a.price - b.price;
    } else if (sortKey === 'duration') {
      const aDur = a.durationVal != null ? a.durationVal : parseDurationToMinutes(a.duration);
      const bDur = b.durationVal != null ? b.durationVal : parseDurationToMinutes(b.duration);
      return aDur - bDur;
    }
    return 0;
  });

  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(sortedFlights.length / ITEMS_PER_PAGE);
  const paginatedFlights = sortedFlights.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const cheapestPrice = activeFlightList.length > 0
    ? Math.min(...activeFlightList.map(f => f.price))
    : 0;

  // Selection handlers
  const handleSelectOutbound = (flight) => {
    setSelectedOutbound(flight);
    setBookingStep(2);
    setFilterCarrier('ALL'); // Reset filter for return leg
  };

  const handleSelectReturn = (flight) => {
    setSelectedReturn(flight);
    setBookingStep(3);
  };

  // Confirm and start tracking the roundtrip bundle
  const handleConfirmBundle = () => {
    const roundtripBundle = {
      outbound: selectedOutbound,
      return: selectedReturn,
      passengers: searchParams.passengers,
      origin: searchParams.origin,
      destination: searchParams.destination,
      departureDate: searchParams.departureDate,
      returnDate: searchParams.returnDate
    };

    setActiveRoundtrip(roundtripBundle);

    // Set active flight to outbound to display on map first
    setActiveFlight(selectedOutbound);
    setSelectedDate(searchParams.departureDate);

    // Navigate to Dashboard HUD
    setActiveTab('dashboard');
  };

  const skyscannerUrl = bookingStep === 1
    ? getSkyscannerUrl(searchParams.origin, searchParams.destination, searchParams.departureDate)
    : getSkyscannerUrl(searchParams.destination, searchParams.origin, searchParams.returnDate);

  const totalPassengers = localAdults + localChildren + localInfants;

  const getClassLabel = (val) => {
    switch (val) {
      case '1': return 'Economy';
      case '2': return 'Premium Economy';
      case '3': return 'Business';
      case '4': return 'First';
      default: return 'All Classes';
    }
  };

  const popoverCounterBtnStyle = (disabled) => ({
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '1px solid var(--border-glass-bright)',
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    fontSize: '1rem',
    fontWeight: 700,
    userSelect: 'none'
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      {/* 1. DYNAMIC SEARCH PANEL FRAME */}
      <div className="glass-panel" style={{ padding: '24px', overflow: 'visible', boxSizing: 'border-box' }}>
        {/* Header Title */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Globe size={22} style={{ color: 'var(--primary)' }} />
              Search & Compare Fares
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
              Already know your route? Compare carriers, times and fares, then build your bundle.
            </p>
          </div>
        </div>

        <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

          {/* Top Control Bar: Trip Type, Passengers, Direct Flights */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px 16px',
            background: 'var(--bg-tertiary, rgba(255, 255, 255, 0.04))',
            padding: '10px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border-glass-bright, rgba(255, 255, 255, 0.12))',
            boxSizing: 'border-box',
            width: '100%'
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', width: '100%' }}>
              {/* Trip Type Selector */}
              {isMobile ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '24px',
                  width: '100%',
                  borderBottom: '1px solid var(--border-glass-bright, rgba(255, 255, 255, 0.12))',
                  marginBottom: '8px',
                  boxSizing: 'border-box'
                }}>
                  {[
                    { value: 'round-trip', label: 'Round-trip' },
                    { value: 'one-way', label: 'One-way' },
                    { value: 'multi-city', label: 'Multi-city' }
                  ].map((opt) => {
                    const isActive = tripType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setTripType(opt.value)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: '8px 0 12px 0',
                          fontSize: '0.92rem',
                          fontWeight: isActive ? '700' : '500',
                          color: isActive ? 'var(--text-primary, #ffffff)' : 'var(--text-secondary, #94a3b8)',
                          cursor: 'pointer',
                          position: 'relative',
                          outline: 'none',
                          transition: 'all 0.15s ease',
                          marginBottom: '-1px',
                          borderBottom: isActive ? '2px solid var(--text-primary, #ffffff)' : '2px solid transparent'
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label htmlFor="trip-type-select" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Trip Type:
                  </label>
                  <select
                    id="trip-type-select"
                    aria-label="Trip Type"
                    value={tripType}
                    onChange={(e) => setTripType(e.target.value)}
                    className="input-field"
                    style={{
                      padding: '0 28px 0 12px',
                      height: '46px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      borderRadius: '6px',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-glass-bright)',
                      cursor: 'pointer',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      boxSizing: 'border-box'
                    }}
                  >
                    <option value="round-trip">Round trip</option>
                    <option value="one-way">One-way</option>
                    <option value="multi-city">Multi-City</option>
                  </select>
                </div>
              )}

              {/* Unified Passengers & Cabin Class Selector */}
              <div className="input-group" ref={passengerRef} style={{ position: 'relative', margin: 0 }}>
                <button
                  type="button"
                  onClick={() => setShowPassengerDropdown(!showPassengerDropdown)}
                  className="input-field"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--bg-secondary)',
                    gap: '8px',
                    padding: '0 12px',
                    height: '46px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    border: '1px solid var(--border-glass-bright)',
                    borderRadius: '6px',
                    boxSizing: 'border-box'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Users size={16} style={{ color: 'var(--primary)' }} />
                    {totalPassengers} Passenger{totalPassengers > 1 ? 's' : ''}, {getClassLabel(localTravelClass)}
                  </span>
                  <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
                </button>

                {showPassengerDropdown && (
                  <div className="passenger-popover" style={{ minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '4px' }}>Travelers</div>

                    {/* Adults */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Adults</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Age 12+</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          disabled={localAdults <= 1}
                          onClick={() => setLocalAdults((prev) => Math.max(1, prev - 1))}
                          style={popoverCounterBtnStyle(localAdults <= 1)}
                        >
                          -
                        </button>
                        <span style={{ minWidth: '20px', textAlign: 'center', fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                          {localAdults}
                        </span>
                        <button
                          type="button"
                          disabled={totalPassengers >= 9}
                          onClick={() => setLocalAdults((prev) => prev + 1)}
                          style={popoverCounterBtnStyle(totalPassengers >= 9)}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Children */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Children</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Age 2-11</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          disabled={localChildren <= 0}
                          onClick={() => setLocalChildren((prev) => Math.max(0, prev - 1))}
                          style={popoverCounterBtnStyle(localChildren <= 0)}
                        >
                          -
                        </button>
                        <span style={{ minWidth: '20px', textAlign: 'center', fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                          {localChildren}
                        </span>
                        <button
                          type="button"
                          disabled={totalPassengers >= 9}
                          onClick={() => setLocalChildren((prev) => prev + 1)}
                          style={popoverCounterBtnStyle(totalPassengers >= 9)}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Infants */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Infants</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Under age 2</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          disabled={localInfants <= 0}
                          onClick={() => setLocalInfants((prev) => Math.max(0, prev - 1))}
                          style={popoverCounterBtnStyle(localInfants <= 0)}
                        >
                          -
                        </button>
                        <span style={{ minWidth: '20px', textAlign: 'center', fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                          {localInfants}
                        </span>
                        <button
                          type="button"
                          disabled={totalPassengers >= 9}
                          onClick={() => setLocalInfants((prev) => prev + 1)}
                          style={popoverCounterBtnStyle(totalPassengers >= 9)}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Divider */}
                    <div style={{ borderTop: '1px solid var(--border-glass-bright)', margin: '8px 0' }} />

                    {/* Cabin Class */}
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '6px' }}>Cabin Class</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                      {[
                        { value: 'ALL', label: 'All Classes' },
                        { value: '1', label: 'Economy' },
                        { value: '2', label: 'Premium Economy' },
                        { value: '3', label: 'Business' },
                        { value: '4', label: 'First' }
                      ].map((cls) => {
                        const isActive = localTravelClass === cls.value;
                        return (
                          <button
                            key={cls.value}
                            type="button"
                            onClick={() => setLocalTravelClass(cls.value)}
                            style={{
                              padding: '6px 10px',
                              fontSize: '0.75rem',
                              fontWeight: isActive ? 700 : 500,
                              borderRadius: '20px',
                              cursor: 'pointer',
                              border: isActive ? '1px solid var(--primary)' : '1px solid var(--border-glass-bright)',
                              background: isActive ? 'rgba(0, 242, 254, 0.08)' : 'transparent',
                              color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                              transition: 'all 0.2s'
                            }}
                          >
                            {cls.label}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowPassengerDropdown(false)}
                      className="btn btn-primary"
                      style={{ padding: '6px 0', fontSize: '0.8rem', marginTop: '6px', width: '100%' }}
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Direct flights checkbox */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={localStops === '1'}
                onChange={(e) => setLocalStops(e.target.checked ? '1' : '0')}
                style={{
                  width: '16px',
                  height: '16px',
                  accentColor: 'var(--primary)',
                  cursor: 'pointer'
                }}
              />
              <span>Direct flights only</span>
            </label>
          </div>

          {/* Input Fields Row for Round trip and One-way */}
          {tripType !== 'multi-city' ? (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              gap: '16px 12px',
              width: '100%',
              boxSizing: 'border-box'
            }}>
              <div className="airports-row-container">
                {/* Departure Airport Autocomplete */}
                <AirportAutocomplete
                  id="departure-airport-select"
                  label="Departure Airport"
                  value={localOrigin}
                  onChange={setLocalOrigin}
                  placeholder="Where from?"
                  style={{ flex: '1' }}
                />

                {/* Circular Swap Button (Desktop) */}
                <button
                  type="button"
                  onClick={handleSwapAirports}
                  title="Swap Departure and Arrival Airports"
                  aria-label="Swap Departure and Arrival Airports"
                  className="swap-button swap-button-desktop"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--primary)';
                    e.currentTarget.style.color = 'var(--primary)';
                    e.currentTarget.style.boxShadow = '0 0 12px var(--primary-glow-weak)';
                    e.currentTarget.style.transform = 'rotate(180deg)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-glass-bright)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
                    e.currentTarget.style.transform = 'rotate(0deg)';
                  }}
                >
                  <ArrowLeftRight size={18} />
                </button>

                {/* Circular Swap Button (Mobile) */}
                <button
                  type="button"
                  onClick={handleSwapAirports}
                  title="Swap Departure and Arrival Airports"
                  aria-label="Swap Departure and Arrival Airports"
                  className="swap-button swap-button-mobile"
                >
                  <ArrowLeftRight size={18} />
                </button>

                {/* Arrival Airport Autocomplete */}
                <AirportAutocomplete
                  id="arrival-airport-select"
                  label="Arrival Airport"
                  value={localDestination}
                  onChange={setLocalDestination}
                  placeholder="Where to?"
                  style={{ flex: '1' }}
                />
              </div>

              {/* Departure Date */}
              <div style={{ flex: '1 1 140px', minWidth: '130px' }}>
                <CustomDatePicker
                  label="Departure Date"
                  value={localDepDate}
                  onChange={(newDate) => {
                    setLocalDepDate(newDate);
                    if (localRetDate && newDate > localRetDate) {
                      setLocalRetDate(newDate);
                    }
                  }}
                  minDate={getLocalDateString()}
                  relatedDate={localRetDate}
                  isReturnDate={false}
                />
              </div>

              {/* Return Date - Only rendered for Round Trip */}
              {tripType === 'round-trip' && (
                <div style={{ flex: '1 1 140px', minWidth: '130px' }}>
                  <CustomDatePicker
                    label="Return Date"
                    value={localRetDate}
                    onChange={(newDate) => setLocalRetDate(newDate)}
                    minDate={localDepDate || getLocalDateString()}
                    relatedDate={localDepDate}
                    isReturnDate={true}
                  />
                </div>
              )}
            </div>
          ) : (
            /* Multi-City Leg Rows */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
              {localLegs.map((leg, index) => (
                <div key={leg.id} style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'flex-end',
                  gap: '12px',
                  padding: '12px 14px',
                  background: 'var(--bg-secondary, rgba(255, 255, 255, 0.02))',
                  border: '1px solid var(--border-glass, rgba(255, 255, 255, 0.08))',
                  borderRadius: '8px',
                  boxSizing: 'border-box'
                }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '8px', minWidth: '65px' }}>
                    Flight {index + 1}
                  </span>

                  {/* Multi-city From Autocomplete */}
                  <AirportAutocomplete
                    id={`leg-${leg.id}-origin`}
                    label="From"
                    value={leg.origin}
                    onChange={(val) => updateLeg(leg.id, 'origin', val)}
                    placeholder="Where from?"
                    style={{ flex: '1 1 170px', minWidth: '140px' }}
                  />

                  {/* Multi-city To Autocomplete */}
                  <AirportAutocomplete
                    id={`leg-${leg.id}-destination`}
                    label="To"
                    value={leg.destination}
                    onChange={(val) => updateLeg(leg.id, 'destination', val)}
                    placeholder="Where to?"
                    style={{ flex: '1 1 170px', minWidth: '140px' }}
                  />

                  <div style={{ flex: '1 1 140px', minWidth: '130px' }}>
                    <CustomDatePicker
                      label="Date"
                      value={leg.depDate}
                      onChange={(newDate) => updateLeg(leg.id, 'depDate', newDate)}
                      minDate={getLocalDateString()}
                    />
                  </div>

                  {localLegs.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeLeg(leg.id)}
                      title="Remove flight leg"
                      style={{
                        marginBottom: '2px',
                        padding: '8px 12px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#ef4444',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 600
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}

              {localLegs.length < 5 && (
                <button
                  type="button"
                  onClick={addLeg}
                  style={{
                    alignSelf: 'flex-start',
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-glass-bright)',
                    borderRadius: '6px',
                    color: 'var(--primary)',
                    cursor: 'pointer'
                  }}
                >
                  + Add Flight Leg
                </button>
              )}
            </div>
          )}

          {/* Validation errors */}
          {errorMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', fontSize: '0.8rem' }}>
              <ShieldAlert size={14} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Search Button Container */}
          <div className="search-button-container">
            <button type="submit" className="btn btn-primary" style={{ minWidth: '180px', padding: '12px' }}>
              Search Flights
            </button>
          </div>
        </form>
      </div>

      {/* 2. STEP BOOKING SELECTION FLOW */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/*
          Step Indicator Header.

          Renders a position ("Step 2 of 3"), the current step's name, and a
          segmented bar — instead of laying every step's number and label out in
          a row. The row version had two problems: on a phone it wrapped into the
          broken arrangement of a lone "1" above the words "Select Outbound", and
          in multi-city the step list is localLegs.length + 1 entries long, so
          five legs produced six labelled nodes that no width could hold.

          This layout is indifferent to the count: only the active step is named,
          and the bar grows a segment per step.
        */}
        {searchParams.destination ? (() => {
          const steps = tripType === 'one-way'
            ? [
              { step: 1, label: 'Select Flight' },
              { step: 2, label: 'Confirm Flight' }
            ]
            : tripType === 'multi-city'
              ? [
                ...localLegs.map((leg, idx) => ({ step: idx + 1, label: `Flight ${idx + 1}` })),
                { step: localLegs.length + 1, label: 'Confirm Package' }
              ]
              : [
                { step: 1, label: 'Select Outbound' },
                { step: 2, label: 'Select Return' },
                { step: 3, label: 'Confirm Bundle' }
              ];

          const total = steps.length;
          const current = steps.find((s) => s.step === bookingStep) || steps[0];
          const nextUp = steps.find((s) => s.step === bookingStep + 1);

          return (
            <div className="booking-stepper">
              <div className="booking-stepper-head">
                <div>
                  <div className="booking-stepper-position">
                    Step {current.step} of {total}
                  </div>
                  <div className="booking-stepper-label">{current.label}</div>
                </div>
                {nextUp && (
                  <div className="booking-stepper-next">
                    Next: {nextUp.label}
                  </div>
                )}
              </div>

              <div
                className="booking-stepper-track"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={total}
                aria-valuenow={current.step}
                aria-valuetext={`Step ${current.step} of ${total}: ${current.label}`}
              >
                {steps.map((item) => (
                  <span
                    key={item.step}
                    className={
                      'booking-stepper-segment'
                      + (bookingStep > item.step ? ' is-complete' : '')
                      + (bookingStep === item.step ? ' is-current' : '')
                    }
                  />
                ))}
              </div>
            </div>
          );
        })() : null}

        {/* STEP 1 & 2: LISTINGS VIEW */}
        {searchParams.destination && (bookingStep === 1 || bookingStep === 2) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Show Selected Outbound in Step 2 Header */}
            {bookingStep === 2 && selectedOutbound && (
              <div className="glass-panel" style={{ background: 'rgba(5, 150, 105, 0.04)', borderColor: 'rgba(5, 150, 105, 0.25)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 700, textTransform: 'uppercase' }}>Selected Outbound Leg</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '2px' }}>
                    {selectedOutbound.airlineName} ({selectedOutbound.flightNumber}) • {selectedOutbound.departureTime} → {selectedOutbound.arrivalTime}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Route: {selectedOutbound.origin} → {selectedOutbound.destination} • Fare: ${selectedOutbound.price} / adult
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedOutbound(null);
                    setBookingStep(1);
                  }}
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                >
                  Change Outbound
                </button>
              </div>
            )}

            {/* Skyscanner Aggregator Banner - only show when searched & results retrieved */}
            {searchParams.destination && !isLoading && (outboundFlights.length > 0 || returnFlights.length > 0) && (
              <div style={{
                background: 'rgba(0, 180, 216, 0.08)',
                border: '1px solid rgba(0, 180, 216, 0.2)',
                borderRadius: 'var(--radius-sm)',
                padding: '14px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <Globe size={20} style={{ color: '#00e1ff' }} />
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      Compare on Skyscanner Aggregator
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      Search Skyscanner directly for {bookingStep === 1 ? searchParams.origin : searchParams.destination} → {bookingStep === 1 ? searchParams.destination : searchParams.origin} flights on {formatDateDMY(bookingStep === 1 ? searchParams.departureDate : searchParams.returnDate)}.
                    </div>
                  </div>
                </div>
                <a
                  href={skyscannerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn"
                  style={{
                    padding: '6px 14px',
                    fontSize: '0.8rem',
                    background: 'linear-gradient(135deg, #00b4d8, #0077b6)',
                    color: '#fff',
                    fontWeight: 600,
                    textDecoration: 'none'
                  }}
                >
                  Compare on Skyscanner
                </a>
              </div>
            )}

            {/* LISTINGS FILTER CONTROLS */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Sort:</span>
                <div style={{ display: 'flex', background: 'var(--bg-tertiary)', borderRadius: '6px', border: '1px solid var(--border-glass)', padding: '2px' }}>
                  <button onClick={() => setSortKey('price')} style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', background: sortKey === 'price' ? 'var(--bg-secondary)' : 'transparent', color: sortKey === 'price' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer', fontSize: '0.75rem' }}>
                    Cheapest
                  </button>
                  <button onClick={() => setSortKey('duration')} style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', background: sortKey === 'duration' ? 'var(--bg-secondary)' : 'transparent', color: sortKey === 'duration' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer', fontSize: '0.75rem' }}>
                    Shortest
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Filter size={14} style={{ color: 'var(--text-secondary)' }} />
                <select
                  value={filterCarrier}
                  onChange={(e) => setFilterCarrier(e.target.value)}
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: '6px', color: 'var(--text-primary)', padding: '4px 12px 4px 8px', fontFamily: 'var(--font-sans)', outline: 'none', cursor: 'pointer' }}
                >
                  <option value="ALL">All Carriers</option>
                  {Array.from(new Set(activeFlightList.map(f => f.airlineName))).map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* LISTINGS CARD GRID */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {isLoading ? (
                <div style={{ textAlign: 'center', padding: '50px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                  <div className="pulse-target" style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--primary)' }}></div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Searching live itineraries from server... this can take up to 45s for a real-time fare check.</span>
                </div>
              ) : apiError ? (
                <div style={{ textAlign: 'center', padding: '30px', backgroundColor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-sm)', color: '#f87171', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                  <ShieldAlert size={24} />
                  <span style={{ fontWeight: 600 }}>Error loading flights</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{apiError}</span>
                </div>
              ) : paginatedFlights.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-secondary)' }}>
                  No flights available matching your carrier filter.
                </div>
              ) : (
                paginatedFlights.map((flight) => {
                  const isCheapest = flight.price === cheapestPrice;
                  // Unknown carrier codes fall back to a neutral plane glyph, not a
                  // specific airline's logo (matches Watchlist/FlightDetails).
                  const airline = AIRLINES[flight.airlineCode] || { name: 'Unknown', logo: '✈️', color: 'var(--primary)' };

                  return (
                    <div
                      key={flight.id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.01)',
                        border: '1px solid var(--border-glass)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '18px 24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '20px',
                        position: 'relative'
                      }}
                    >
                      {/* Deal tag overlay */}
                      {isCheapest && (
                        <span style={{ position: 'absolute', top: '-10px', left: '16px', background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', padding: '2px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Sparkles size={10} /> Cheapest Deal
                        </span>
                      )}

                      {/* Airline info */}
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: '1 1 200px', minWidth: '160px', maxWidth: '260px' }}>
                        <div style={{ width: '38px', height: '38px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', border: '1px solid var(--border-glass)', flexShrink: 0, overflow: 'hidden' }}>
                          <AirlineLogo flight={flight} fallbackLogo={airline.logo} size={32} />
                        </div>
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{flight.airlineName}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                            <span><span className="num">{flight.flightNumber}</span>{flight.planeType && ` • ${flight.planeType}`}</span>
                            {flight.cabinClass && (
                              <span
                                style={{
                                  fontSize: '0.66rem',
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  background: flight.cabinClass === 'Business' || flight.cabinClass === 'First'
                                    ? 'rgba(168, 85, 247, 0.18)'
                                    : flight.cabinClass === 'Premium Economy'
                                    ? 'rgba(14, 165, 233, 0.18)'
                                    : 'rgba(255, 255, 255, 0.08)',
                                  color: flight.cabinClass === 'Business' || flight.cabinClass === 'First'
                                    ? '#c084fc'
                                    : flight.cabinClass === 'Premium Economy'
                                    ? '#38bdf8'
                                    : 'var(--text-secondary)',
                                  border: '1px solid var(--border-glass)',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {flight.cabinClass}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Timeline */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flex: '1 1 220px', minWidth: '180px', maxWidth: '280px', justifyContent: 'center' }}>
                        <div style={{ textAlign: 'left' }}>
                          <div className="num" style={{ fontWeight: 700, fontSize: '1.05rem' }}>{flight.departureTime}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{flight.origin}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '60px' }}>
                          <span className="num" style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{flight.duration}</span>
                          <div style={{ width: '50px', height: '1.5px', background: 'var(--border-glass)', margin: '4px 0', position: 'relative' }}>
                            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--text-muted)', position: 'absolute', top: '-1.2px', right: 0 }}></div>
                          </div>
                          <span className="num" style={{ fontSize: '0.65rem', color: 'var(--success)', fontWeight: 600 }}>{flight.stops}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="num" style={{ fontWeight: 700, fontSize: '1.05rem' }}>{flight.arrivalTime}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{flight.destination}</div>
                        </div>
                      </div>

                      {/* Fare display */}
                      <div style={{ textAlign: 'center', flex: '0 0 120px' }}>
                        <div className="num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--primary)' }}>
                          ${flight.price}
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                          per adult
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px', fontWeight: 600 }}>
                          Total: <span className="num">${flight.passengerCosts.total}</span>
                        </div>
                      </div>

                      {/* Select Leg button */}
                      <div style={{ flex: '0 0 auto' }}>
                        {bookingStep === 1 ? (
                          <button
                            onClick={() => handleSelectOutbound(flight)}
                            className="btn btn-primary"
                            style={{ padding: '8px 16px', fontSize: '0.8rem' }}
                          >
                            Select Outbound
                          </button>
                        ) : (
                          <button
                            onClick={() => handleSelectReturn(flight)}
                            className="btn btn-primary"
                            style={{ padding: '8px 16px', fontSize: '0.8rem' }}
                          >
                            Select Return
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

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
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
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
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
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
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
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

          </div>
        )}

        {/* STEP CONFIRMATION FRAME (Roundtrip / One-Way) */}
        {((tripType === 'round-trip' && bookingStep === 3 && selectedOutbound && selectedReturn) ||
          (tripType === 'one-way' && bookingStep === 2 && selectedOutbound)) && (
            <div className="glass-panel animate-fade-in" style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

              {/* Header info */}
              <div style={{ textAlign: 'center' }}>
                <span className="badge badge-success" style={{ padding: '4px 12px', fontSize: '0.75rem', marginBottom: '8px' }}>
                  {tripType === 'one-way' ? 'One-Way Configured' : 'Roundtrip Configured'}
                </span>
                <h4 style={{ fontSize: '1.4rem', fontWeight: 800 }}>
                  {tripType === 'one-way' ? 'Confirm Your One-Way Flight' : 'Confirm Your Roundtrip Bundle'}
                </h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Review details and activate telemetry HUD maps
                </p>
              </div>

              {/* Grid display outbound / return side-by-side */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: tripType === 'one-way' ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '20px'
              }}>
                {/* Outbound Ticket Card */}
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase' }}>Outbound Leg</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{selectedOutbound.airlineName}</span>
                    <span className="num" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{selectedOutbound.flightNumber}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.1)', padding: '10px', borderRadius: '4px' }}>
                    <div>
                      <div className="num" style={{ fontWeight: 700, fontSize: '0.9rem' }}>{selectedOutbound.departureTime}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{selectedOutbound.origin}</div>
                    </div>
                    <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                    <div>
                      <div className="num" style={{ fontWeight: 700, fontSize: '0.9rem' }}>{selectedOutbound.arrivalTime}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{selectedOutbound.destination}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <span>Date: <span className="num">{formatDateDMY(searchParams.departureDate)}</span></span>
                    <span>Duration: <span className="num">{selectedOutbound.duration}</span></span>
                  </div>
                </div>

                {/* Return Ticket Card (Roundtrip only) */}
                {tripType === 'round-trip' && selectedReturn && (
                  <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase' }}>Return Leg</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{selectedReturn.airlineName}</span>
                      <span className="num" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{selectedReturn.flightNumber}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.1)', padding: '10px', borderRadius: '4px' }}>
                      <div>
                        <div className="num" style={{ fontWeight: 700, fontSize: '0.9rem' }}>{selectedReturn.departureTime}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{selectedReturn.origin}</div>
                      </div>
                      <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                      <div>
                        <div className="num" style={{ fontWeight: 700, fontSize: '0.9rem' }}>{selectedReturn.arrivalTime}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{selectedReturn.destination}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      <span>Date: <span className="num">{formatDateDMY(searchParams.returnDate)}</span></span>
                      <span>Duration: <span className="num">{selectedReturn.duration}</span></span>
                    </div>
                  </div>
                )}
              </div>

              {/* Detailed passenger cost breakdown card */}
              <div style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-glass-bright)',
                borderRadius: 'var(--radius-sm)',
                padding: '20px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Passenger Pricing Details</div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {/* Adults */}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      Adults (<span className="num">{searchParams.passengers.adults}</span> × <span className="num">${selectedOutbound.price}</span>{selectedReturn ? <> + <span className="num">${selectedReturn.price}</span></> : ''})
                    </span>
                    <span className="num" style={{ color: '#fff', fontWeight: 600 }}>
                      ${searchParams.passengers.adults * (selectedOutbound.price + (selectedReturn ? selectedReturn.price : 0))}
                    </span>
                  </div>

                  {/* Children */}
                  {searchParams.passengers.children > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Children (<span className="num">{searchParams.passengers.children}</span>)</span>
                      <span className="num" style={{ color: '#fff', fontWeight: 600 }}>
                        ${selectedOutbound.passengerCosts.children + (selectedReturn ? selectedReturn.passengerCosts.children : 0)}
                      </span>
                    </div>
                  )}

                  {/* Infants */}
                  {searchParams.passengers.infants > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Infants (<span className="num">{searchParams.passengers.infants}</span>)</span>
                      <span className="num" style={{ color: '#fff', fontWeight: 600 }}>
                        ${selectedOutbound.passengerCosts.infants + (selectedReturn ? selectedReturn.passengerCosts.infants : 0)}
                      </span>
                    </div>
                  )}
                </div>

                <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '10px', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Total Fare:</span>
                  <span className="num" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)', filter: 'drop-shadow(0 0 6px var(--primary-glow-weak))' }}>
                    ${selectedOutbound.passengerCosts.total + (selectedReturn ? selectedReturn.passengerCosts.total : 0)}
                  </span>
                </div>
              </div>

              {/* Action Buttons Row */}
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '8px' }}>
                <button
                  onClick={() => {
                    if (tripType === 'one-way') {
                      setSelectedOutbound(null);
                      setBookingStep(1);
                    } else {
                      setSelectedReturn(null);
                      setBookingStep(2);
                    }
                  }}
                  className="btn btn-secondary"
                  style={{ minWidth: '150px' }}
                >
                  Go Back
                </button>

                <button
                  onClick={handleConfirmBundle}
                  className="btn btn-primary"
                  style={{ minWidth: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  <Check size={16} /> {tripType === 'one-way' ? 'Track One-Way Flight' : 'Track Roundtrip Bundle'}
                </button>
              </div>

            </div>
          )}

      </div>

    </div>
  );
}
