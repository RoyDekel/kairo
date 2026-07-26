import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar, Filter, Sparkles, ArrowRight, Check, Globe,
  Users, ChevronDown, User, ShieldAlert, ArrowLeftRight
} from 'lucide-react';
import { AIRPORTS, AIRLINES, generateFlightsForRoute, getSkyscannerUrl } from '../utils/flightSimulator';

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

export default function AlternativeFlights({
  selectedDate,
  setSelectedDate,
  activeFlight,
  setActiveFlight,
  onToggleWatchlist,
  watchlist,
  // New props for dynamic search
  searchParams,
  setSearchParams,
  activeRoundtrip,
  setActiveRoundtrip,
  setActiveTab
}) {
  const getLocalDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Search inputs local states
  const [localOrigin, setLocalOrigin] = useState(searchParams.origin);
  const [localDestination, setLocalDestination] = useState(searchParams.destination);
  const [localDepDate, setLocalDepDate] = useState(searchParams.departureDate);
  const [localRetDate, setLocalRetDate] = useState(searchParams.returnDate);
  const [localStops, setLocalStops] = useState(searchParams.stops || '0');

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
  const [outboundFlights, setOutboundFlights] = useState(() =>
    searchParams.destination
      ? generateFlightsForRoute(
          searchParams.origin,
          searchParams.destination,
          searchParams.departureDate,
          'outbound',
          searchParams.passengers
        )
      : []
  );
  const [returnFlights, setReturnFlights] = useState(() =>
    searchParams.destination
      ? generateFlightsForRoute(
          searchParams.destination,
          searchParams.origin,
          searchParams.returnDate,
          'return',
          searchParams.passengers
        )
      : []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    setCurrentPage(1);
  }, [bookingStep, searchParams, filterCarrier, sortKey]);

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
          stops: searchParams.stops || '0'
        });
        const apiBase = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null' ? window.location.origin : 'http://localhost:3001');
        const res = await fetch(`${apiBase}/api/flights?${queryParams.toString()}`);
        if (!res.ok) {
          throw new Error(`Server returned status ${res.status}`);
        }
        
        const data = await res.json();
        if (active) {
          setOutboundFlights(data.outbound || []);
          setReturnFlights(data.return || []);
        }
      } catch (err) {
        if (active) {
          console.warn("Failed to fetch flights from server, falling back to local simulation:", err);
          setOutboundFlights(generateFlightsForRoute(
            searchParams.origin,
            searchParams.destination,
            searchParams.departureDate,
            'outbound',
            searchParams.passengers
          ));
          setReturnFlights(generateFlightsForRoute(
            searchParams.destination,
            searchParams.origin,
            searchParams.returnDate,
            'return',
            searchParams.passengers
          ));
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

    setErrorMsg('');

    // Update global search parameters
    const newParams = {
      origin: localOrigin,
      destination: localDestination,
      departureDate: localDepDate,
      returnDate: localRetDate,
      passengers: {
        adults: localAdults,
        children: localChildren,
        infants: localInfants
      },
      stops: localStops
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      {/* 1. DYNAMIC ROUNDTRIP SEARCH PANEL FRAME */}
      <div className="glass-panel" style={{ padding: '28px', overflow: 'visible' }}>
        <h3 style={{ fontSize: '1.25rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Globe size={20} style={{ color: 'var(--primary)' }} />
          Roundtrip Flight Search
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '24px' }}>
          Find and build premium roundtrip connections between key global terminals
        </p>

        <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Unified flex inputs row (prevents track collisions across all screens) */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: '16px 12px',
            width: '100%'
          }}>
            {/* Origin Select */}
            <div className="input-group" style={{ flex: '1 1 200px', minWidth: '170px' }}>
              <label className="input-label" htmlFor="departure-airport-select">Departure Airport</label>
              <select
                id="departure-airport-select"
                value={localOrigin}
                onChange={(e) => setLocalOrigin(e.target.value)}
                className="input-field"
                style={{
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none'
                }}
              >
                {Object.keys(AIRPORTS).map(code => (
                  <option key={code} value={code}>
                    {AIRPORTS[code].city} ({AIRPORTS[code].code}) - {AIRPORTS[code].country}
                  </option>
                ))}
              </select>
            </div>

            {/* Circular Swap Button */}
            <button
              type="button"
              onClick={handleSwapAirports}
              title="Swap Departure and Arrival Airports"
              aria-label="Swap Departure and Arrival Airports"
              style={{
                marginBottom: '2px',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: 'var(--bg-tertiary, rgba(255, 255, 255, 0.06))',
                border: '1px solid var(--border-glass-bright, rgba(255, 255, 255, 0.2))',
                color: 'var(--text-primary, #ffffff)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                flexShrink: 0
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--primary)';
                e.currentTarget.style.color = 'var(--primary)';
                e.currentTarget.style.boxShadow = '0 0 12px var(--primary-glow-weak)';
                e.currentTarget.style.transform = 'rotate(180deg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-glass-bright, rgba(255, 255, 255, 0.2))';
                e.currentTarget.style.color = 'var(--text-primary, #ffffff)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
                e.currentTarget.style.transform = 'rotate(0deg)';
              }}
            >
              <ArrowLeftRight size={18} />
            </button>

            {/* Destination Select */}
            <div className="input-group" style={{ flex: '1 1 200px', minWidth: '170px' }}>
              <label className="input-label" htmlFor="arrival-airport-select">Arrival Airport</label>
              <select
                id="arrival-airport-select"
                value={localDestination}
                onChange={(e) => setLocalDestination(e.target.value)}
                className="input-field"
                style={{
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none'
                }}
              >
                <option value="" disabled hidden>Select a destination</option>
                {Object.keys(AIRPORTS).map(code => (
                  <option key={code} value={code}>
                    {AIRPORTS[code].city} ({AIRPORTS[code].code}) - {AIRPORTS[code].country}
                  </option>
                ))}
              </select>
            </div>

            {/* Departure Date */}
            <div className="input-group" style={{ flex: '1 1 140px', minWidth: '130px' }}>
              <label className="input-label">Departure Date</label>
              <input
                type={localDepDate ? "date" : "text"}
                placeholder="Departure"
                value={localDepDate}
                onFocus={(e) => {
                  e.target.type = "date";
                  try {
                    e.target.showPicker();
                  } catch (err) {}
                }}
                onBlur={(e) => {
                  if (!localDepDate) {
                    e.target.type = "text";
                  }
                }}
                onChange={(e) => setLocalDepDate(e.target.value)}
                className="input-field"
                min={getLocalDateString()}
              />
            </div>

            {/* Return Date */}
            <div className="input-group" style={{ flex: '1 1 140px', minWidth: '130px' }}>
              <label className="input-label">Return Date</label>
              <input
                type={localRetDate ? "date" : "text"}
                placeholder="Return"
                value={localRetDate}
                onFocus={(e) => {
                  e.target.type = "date";
                  try {
                    e.target.showPicker();
                  } catch (err) {}
                }}
                onBlur={(e) => {
                  if (!localRetDate) {
                    e.target.type = "text";
                  }
                }}
                onChange={(e) => setLocalRetDate(e.target.value)}
                className="input-field"
                min={localDepDate || getLocalDateString()}
              />
            </div>

            {/* Passengers Selector with Dropdown Overlay */}
            <div className="input-group" ref={passengerRef} style={{ flex: '1 1 150px', minWidth: '140px', position: 'relative' }}>
              <label className="input-label">Passengers</label>
              <button
                type="button"
                onClick={() => setShowPassengerDropdown(!showPassengerDropdown)}
                className="input-field"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'var(--bg-tertiary)',
                  textAlign: 'left',
                  cursor: 'pointer'
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users size={16} style={{ color: 'var(--primary)' }} />
                  {totalPassengers} Passenger{totalPassengers > 1 ? 's' : ''}
                </span>
                <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
              </button>

              {/* Passenger Dropdown Submenu Frame */}
              {showPassengerDropdown && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-glass-bright)',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 600,
                  marginTop: '6px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  {/* Adults */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Adults</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Age 12+</div>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="9"
                      value={localAdults}
                      onChange={(e) => setLocalAdults(Math.max(1, Number(e.target.value)))}
                      style={{ width: '50px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: '4px', color: '#fff', padding: '4px', textAlign: 'center' }}
                    />
                  </div>

                  {/* Children */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Children</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Age 2-11</div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="9"
                      value={localChildren}
                      onChange={(e) => setLocalChildren(Math.max(0, Number(e.target.value)))}
                      style={{ width: '50px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: '4px', color: '#fff', padding: '4px', textAlign: 'center' }}
                    />
                  </div>

                  {/* Infants */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Infants</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Under age 2</div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={localInfants}
                      onChange={(e) => setLocalInfants(Math.max(0, Number(e.target.value)))}
                      style={{ width: '50px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-glass)', borderRadius: '4px', color: '#fff', padding: '4px', textAlign: 'center' }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowPassengerDropdown(false)}
                    className="btn btn-primary"
                    style={{ padding: '6px 0', fontSize: '0.8rem', marginTop: '4px' }}
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Validation errors */}
          {errorMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', fontSize: '0.8rem' }}>
              <ShieldAlert size={14} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Direct flights checkbox and Search Button Container */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap', gap: '12px' }}>
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
            <button type="submit" className="btn btn-primary" style={{ minWidth: '180px', padding: '12px' }}>
              Search Flights
            </button>
          </div>
        </form>
      </div>

      {/* 2. DWO-STEP BOOKING SELECTION FLOW */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Step Indicator Header */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)', padding: '12px 16px' }}>
          {[
            { step: 1, label: 'Select Outbound' },
            { step: 2, label: 'Select Return' },
            { step: 3, label: 'Confirm Bundle' }
          ].map((item) => {
            const isCompleted = bookingStep > item.step;
            const isCurrent = bookingStep === item.step;
            return (
              <React.Fragment key={item.step}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: isCompleted ? 'var(--success)' : isCurrent ? 'var(--primary)' : 'var(--bg-tertiary)',
                    color: isCompleted || isCurrent ? '#0b0f19' : 'var(--text-secondary)',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {isCompleted ? '✓' : item.step}
                  </span>
                  <span style={{ fontSize: '0.8rem', fontWeight: isCurrent ? 600 : 400, color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {item.label}
                  </span>
                </div>
                {item.step < 3 && <div style={{ flexGrow: 0.1, height: '1.5px', background: 'var(--border-glass)' }}></div>}
              </React.Fragment>
            );
          })}
        </div>

        {/* STEP 1 & 2: LISTINGS VIEW */}
        {(bookingStep === 1 || bookingStep === 2) && (
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

            {/* Skyscanner Aggregator Banner */}
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
                    Search Skyscanner directly for {bookingStep === 1 ? searchParams.origin : searchParams.destination} → {bookingStep === 1 ? searchParams.destination : searchParams.origin} flights on {bookingStep === 1 ? searchParams.departureDate : searchParams.returnDate}.
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
              {!searchParams.destination ? (
                <div style={{ textAlign: 'center', padding: '50px 0', color: 'var(--text-secondary)' }}>
                  Please select a destination airport above and click "Search Flights" to find listings.
                </div>
              ) : isLoading ? (
                <div style={{ textAlign: 'center', padding: '50px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                  <div className="pulse-target" style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--primary)' }}></div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Searching live itineraries from server...</span>
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
                  const airline = AIRLINES[flight.airlineCode] || AIRLINES.LO;

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
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{flight.flightNumber} • {flight.planeType}</div>
                        </div>
                      </div>

                      {/* Timeline */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flex: '1 1 220px', minWidth: '180px', maxWidth: '280px', justifyContent: 'center' }}>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{flight.departureTime}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{flight.origin}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '60px' }}>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{flight.duration}</span>
                          <div style={{ width: '50px', height: '1.5px', background: 'var(--border-glass)', margin: '4px 0', position: 'relative' }}>
                            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--text-muted)', position: 'absolute', top: '-1.2px', right: 0 }}></div>
                          </div>
                          <span style={{ fontSize: '0.65rem', color: 'var(--success)', fontWeight: 600 }}>{flight.stops}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{flight.arrivalTime}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{flight.destination}</div>
                        </div>
                      </div>

                      {/* Fare display */}
                      <div style={{ textAlign: 'center', flex: '0 0 120px' }}>
                        <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--primary)' }}>
                          ${flight.price}
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                          per adult
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px', fontWeight: 600 }}>
                          Total: ${flight.passengerCosts.total}
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

        {/* STEP 3: BUNDLE CONFIRMATION FRAME */}
        {bookingStep === 3 && selectedOutbound && selectedReturn && (
          <div className="glass-panel animate-fade-in" style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

            {/* Header info */}
            <div style={{ textAlign: 'center' }}>
              <span className="badge badge-success" style={{ padding: '4px 12px', fontSize: '0.75rem', marginBottom: '8px' }}>Roundtrip Configured</span>
              <h4 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Confirm Your Roundtrip Bundle</h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Review details and activate telemetry HUD maps
              </p>
            </div>

            {/* Grid display outbound / return side-by-side */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '20px'
            }}>
              {/* Outbound Ticket Card */}
              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase' }}>Outbound Leg</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{selectedOutbound.airlineName}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{selectedOutbound.flightNumber}</span>
                </div>
                <div style={{ display: 'flex', justify: 'space-between', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.1)', padding: '10px', borderRadius: '4px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{selectedOutbound.departureTime}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{selectedOutbound.origin}</div>
                  </div>
                  <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{selectedOutbound.arrivalTime}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{selectedOutbound.destination}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <span>Date: {searchParams.departureDate}</span>
                  <span>Duration: {selectedOutbound.duration}</span>
                </div>
              </div>

              {/* Return Ticket Card */}
              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase' }}>Return Leg</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{selectedReturn.airlineName}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{selectedReturn.flightNumber}</span>
                </div>
                <div style={{ display: 'flex', justify: 'space-between', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.1)', padding: '10px', borderRadius: '4px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{selectedReturn.departureTime}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{selectedReturn.origin}</div>
                  </div>
                  <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{selectedReturn.arrivalTime}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{selectedReturn.destination}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <span>Date: {searchParams.returnDate}</span>
                  <span>Duration: {selectedReturn.duration}</span>
                </div>
              </div>
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
                  <span>Adults ({searchParams.passengers.adults} × Outbound: ${selectedOutbound.price} + Return: ${selectedReturn.price})</span>
                  <span style={{ color: '#fff', fontWeight: 600 }}>
                    ${searchParams.passengers.adults * (selectedOutbound.price + selectedReturn.price)}
                  </span>
                </div>

                {/* Children */}
                {searchParams.passengers.children > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Children ({searchParams.passengers.children} × Outbound: ${selectedOutbound.passengerCosts.children / searchParams.passengers.children} + Return: ${selectedReturn.passengerCosts.children / searchParams.passengers.children})</span>
                    <span style={{ color: '#fff', fontWeight: 600 }}>
                      ${selectedOutbound.passengerCosts.children + selectedReturn.passengerCosts.children}
                    </span>
                  </div>
                )}

                {/* Infants */}
                {searchParams.passengers.infants > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Infants ({searchParams.passengers.infants} × Outbound: ${selectedOutbound.passengerCosts.infants / searchParams.passengers.infants} + Return: ${selectedReturn.passengerCosts.infants / searchParams.passengers.infants})</span>
                    <span style={{ color: '#fff', fontWeight: 600 }}>
                      ${selectedOutbound.passengerCosts.infants + selectedReturn.passengerCosts.infants}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '10px', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Total Combined Cost:</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)', filter: 'drop-shadow(0 0 6px var(--primary-glow-weak))' }}>
                  ${selectedOutbound.passengerCosts.total + selectedReturn.passengerCosts.total}
                </span>
              </div>
            </div>

            {/* Action Buttons Row */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '8px' }}>
              <button
                onClick={() => {
                  setSelectedReturn(null);
                  setBookingStep(2);
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
                <Check size={16} /> Track Roundtrip Bundle
              </button>
            </div>

          </div>
        )}

      </div>

    </div>
  );
}
