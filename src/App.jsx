import React, { useState, useEffect, useRef } from 'react';
import { Plane, Calendar, Bookmark, Bell, Compass, Activity, Sun, Moon, LogIn, LogOut, Sparkles, Globe, ArrowRight, Zap, Menu, X, ChevronRight } from 'lucide-react';
import { 
  AIRPORTS, 
  generateFlightsForRoute,
  calculatePassengerCost,
  getFlightTelemetry 
} from './utils/flightSimulator';
import FlightMap from './components/FlightMap';
import PriceChart from './components/PriceChart';
import FlightDetails from './components/FlightDetails';
import AlternativeFlights from './components/AlternativeFlights';
import Watchlist from './components/Watchlist';
import AlertsManager from './components/AlertsManager';
import AuthModal from './components/AuthModal';
import LandingPage from './components/LandingPage';
import AIDestinationExplorer from './components/AIDestinationExplorer';
import { useAuth } from './contexts/AuthProvider';
import * as dataService from './lib/dataService';
import { getApiBase, authHeaders, fetchWithTimeout } from './lib/apiBase';
import {
  DEFAULT_ORIGIN,
  DEFAULT_DESTINATION,
  DEFAULT_DEPARTURE_DATE,
  DEFAULT_RETURN_DATE,
  createDefaultPassengers,
  createDefaultSearchParams
} from './utils/searchDefaults';

export default function App() {
  // Auth state
  const { user, session, isAuthenticated, signOut } = useAuth();
  const userId = user?.id;

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false);

  // 0. Theme State
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark-theme');
    } else {
      document.documentElement.classList.remove('dark-theme');
    }
    dataService.savePreferences(userId, { theme });
  }, [theme, userId]);

  // 1. Search Query Parameters — the single source of truth for origin/destination/dates.
  //    Both "Where to Go" and "Search & Compare" read and write this object so the two
  //    pages can never show different routes or dates for the same session.
  const [searchParams, setSearchParams] = useState(createDefaultSearchParams);

  // 2. Active Roundtrip Bundle State
  const [activeRoundtrip, setActiveRoundtrip] = useState(() => {
    const defaultOutbound = generateFlightsForRoute(DEFAULT_ORIGIN, DEFAULT_DESTINATION, DEFAULT_DEPARTURE_DATE, 'outbound', { adults: 1 })[0];
    const defaultReturn = generateFlightsForRoute(DEFAULT_DESTINATION, DEFAULT_ORIGIN, DEFAULT_RETURN_DATE, 'return', { adults: 1 })[0];

    return {
      outbound: defaultOutbound,
      return: defaultReturn,
      passengers: createDefaultPassengers(),
      origin: DEFAULT_ORIGIN,
      destination: DEFAULT_DESTINATION,
      departureDate: DEFAULT_DEPARTURE_DATE,
      returnDate: DEFAULT_RETURN_DATE
    };
  });

  // 3. Active Tracked Leg (Defaults to Outbound)
  const [activeFlight, setActiveFlight] = useState(() => activeRoundtrip.outbound);
  const [selectedDate, setSelectedDate] = useState(DEFAULT_DEPARTURE_DATE);
  const [direction, setDirection] = useState('outbound'); // 'outbound' or 'return'

  // 4. Simulation State
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationProgress, setSimulationProgress] = useState(0); // 0.0 to 1.0
  const [simulationSpeed, setSimulationSpeed] = useState(5); // 1x, 5x, 20x

  // 5. Watchlist, Alerts & Notifications
  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem('watchlist');
    return saved ? JSON.parse(saved) : [];
  });
  const [alerts, setAlerts] = useState(() => {
    const saved = localStorage.getItem('alerts');
    return saved ? JSON.parse(saved) : [
      {
        id: 'seed-alert-1',
        flightNumber: 'W6 5122',
        flightId: 'W6-100-outbound-2026-08-11',
        type: 'price-drop',
        thresholdPrice: 130,
        isActive: true,
        createdAt: '12:00 PM'
      },
      {
        id: 'seed-alert-2',
        flightNumber: 'W6 5122',
        flightId: 'W6-100-outbound-2026-08-11',
        type: 'status-change',
        thresholdPrice: null,
        isActive: true,
        createdAt: '12:00 PM'
      }
    ];
  });
  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem('notifications');
    return saved ? JSON.parse(saved) : [
      {
        id: 'seed-notif-1',
        time: '12:00 PM',
        flightNumber: 'W6 5122',
        type: 'system',
        message: 'KAIRO AI engine initialized. Start at "Where to Go" to discover destinations, or "Search & Compare" if you already know your route.'
      }
    ];
  });

  // 6. Navigation Tabs (Default page: SaaS Landing Page)
  const [activeTab, setActiveTab] = useState('landing');
  const [showNotifBadge, setShowNotifBadge] = useState(false);
  const hasAutoRedirectedRef = useRef(false);

  // Auto-redirect authenticated user on login to AI Event Explorer workspace
  useEffect(() => {
    if (user && activeTab === 'landing') {
      setActiveTab('ai-explorer');
    }
  }, [user, activeTab]);

  const prevStatusRef = useRef('Scheduled');

  // Retrieve GPS Coordinates for active telemetry
  const originAirport = AIRPORTS[activeFlight?.origin] || AIRPORTS.TLV;
  const destinationAirport = AIRPORTS[activeFlight?.destination] || AIRPORTS.KRK;
  
  const telemetry = getFlightTelemetry(
    simulationProgress, 
    originAirport.coords, 
    destinationAirport.coords
  );

  // Fetch initial default flights from the server to align with the client-server pattern
  useEffect(() => {
    if (!user) return;
    let active = true;
    const apiBase = getApiBase();

    // Background ping to wake up free tier backend service on Render
    const pingBackend = async () => {
      try {
        await fetchWithTimeout(`${apiBase}/api/health`, { timeoutMs: 4000 });
      } catch {
        // Silent catch for background ping
      }
    };
    pingBackend();

    const fetchDefaultFlights = async () => {
      try {
        const queryParams = new URLSearchParams({
          origin: DEFAULT_ORIGIN,
          destination: DEFAULT_DESTINATION,
          departureDate: DEFAULT_DEPARTURE_DATE,
          returnDate: DEFAULT_RETURN_DATE,
          adults: '1',
          children: '0',
          infants: '0',
          stops: '0'
        });
        const res = await fetchWithTimeout(`${apiBase}/api/flights?${queryParams.toString()}`, {
          timeoutMs: 4000,
          headers: authHeaders(session?.access_token)
        });

        if (res.ok) {
          const data = await res.json();
          if (active && data.outbound?.length && data.return?.length) {
            setActiveRoundtrip({
              outbound: data.outbound[0],
              return: data.return[0],
              passengers: createDefaultPassengers(),
              origin: DEFAULT_ORIGIN,
              destination: DEFAULT_DESTINATION,
              departureDate: DEFAULT_DEPARTURE_DATE,
              returnDate: DEFAULT_RETURN_DATE
            });
          }
        }
      } catch (err) {
        console.warn("Failed to fetch initial flights from server, sticking with local simulation defaults:", err);
      }
    };
    
    fetchDefaultFlights();
    return () => {
      active = false;
    };
  }, [user]);

  // Cloud / Local data loading effect when user changes
  useEffect(() => {
    let active = true;
    const loadUserData = async () => {
      if (userId) {
        try {
          await dataService.migrateLocalStorage(userId);
        } catch (err) {
          console.warn('Migration error fallback:', err);
        }
      }
      try {
        const [wList, aList, nList, prefs] = await Promise.all([
          dataService.loadWatchlist(userId),
          dataService.loadAlerts(userId),
          dataService.loadNotifications(userId),
          dataService.loadPreferences(userId)
        ]);

        if (active) {
          setWatchlist(Array.isArray(wList) ? wList : []);
          setAlerts(Array.isArray(aList) ? aList : []);
          setNotifications(Array.isArray(nList) ? nList : []);
          if (prefs?.theme) setTheme(prefs.theme);
        }
      } catch (err) {
        console.error('Data loading error fallback:', err);
      }
    };

    loadUserData();
    return () => {
      active = false;
    };
  }, [userId]);

  /*
    NOTE: `direction` currently only ever holds 'outbound' — nothing in the UI calls
    setDirection, so the return leg cannot be viewed on this page. The state and the
    sync effect below are already wired for it; only a leg toggle in the UI is missing.
  */

  // Keep the tracked leg in sync with the bundle. This must keep running on every
  // activeRoundtrip change so live price ticks from the market engine reach the UI.
  useEffect(() => {
    if (direction === 'outbound') {
      setActiveFlight(activeRoundtrip.outbound);
      setSelectedDate(activeRoundtrip.departureDate);
    } else {
      setActiveFlight(activeRoundtrip.return);
      setSelectedDate(activeRoundtrip.returnDate);
    }
  }, [activeRoundtrip, direction]);

  /*
    Identity of the route being tracked.

    Deliberately derived from the flight IDs and dates rather than the activeRoundtrip
    object: the market engine replaces that object every 8 seconds to tick a price, but
    the route itself is unchanged. Resetting the simulation on the object reference meant
    a run at the default 5x speed (10s to complete) was always destroyed at ~80%, and a
    1x run never got past ~16%.
  */
  const routeSignature = [
    activeRoundtrip?.outbound?.id,
    activeRoundtrip?.return?.id,
    activeRoundtrip?.departureDate,
    activeRoundtrip?.returnDate,
    direction
  ].join('|');

  // Reset the simulation only when the actual route (or tracked leg) changes.
  useEffect(() => {
    setIsSimulating(false);
    setSimulationProgress(0);
    prevStatusRef.current = 'Scheduled';
  }, [routeSignature]);

  // Telemetry simulation loop. The updater stays pure — stopping at the end is handled
  // by the effect below, because calling setState inside another setState's updater is
  // not safe (updaters can be invoked more than once).
  useEffect(() => {
    if (!isSimulating) return undefined;

    const intervalId = setInterval(() => {
      setSimulationProgress((prev) => Math.min(1, prev + 0.001 * simulationSpeed));
    }, 50);

    return () => clearInterval(intervalId);
  }, [isSimulating, simulationSpeed]);

  // Halt the run once the aircraft has arrived.
  useEffect(() => {
    if (isSimulating && simulationProgress >= 1) {
      setIsSimulating(false);
    }
  }, [isSimulating, simulationProgress]);

  // Monitor flight status updates to trigger notifications
  useEffect(() => {
    const currentStatus = telemetry.status;
    const prevStatus = prevStatusRef.current;

    if (currentStatus !== prevStatus) {
      const statusRules = alerts.filter(
        (a) => a.flightNumber === activeFlight.flightNumber && a.type === 'status-change'
      );

      if (statusRules.length > 0) {
        const newNotif = {
          id: `status-shift-${Date.now()}`,
          time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          flightNumber: activeFlight.flightNumber,
          type: 'status-alert',
          message: `Flight status updated to: ${currentStatus.toUpperCase()}`
        };

        setNotifications((prev) => [newNotif, ...prev]);
        setShowNotifBadge(true);
      }

      prevStatusRef.current = currentStatus;
    }
  }, [telemetry.status, alerts, activeFlight.flightNumber]);

  /*
    Market Engine: fluctuate active bundle prices periodically.

    Reads state through refs so the interval is created once rather than being torn down
    and recreated on every price tick, alert edit, or leg switch. The old dependency list
    ([activeRoundtrip, activeFlight.id, alerts]) restarted the 8s timer constantly.
  */
  const activeRoundtripRef = useRef(activeRoundtrip);
  const alertsRef = useRef(alerts);

  useEffect(() => {
    activeRoundtripRef.current = activeRoundtrip;
  }, [activeRoundtrip]);

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  useEffect(() => {
    const priceInterval = setInterval(() => {
      const activeRoundtrip = activeRoundtripRef.current;
      const alerts = alertsRef.current;
      if (!activeRoundtrip) return;

      const isOutboundLeg = Math.random() > 0.5;
      const targetLeg = isOutboundLeg ? 'outbound' : 'return';
      const flight = activeRoundtrip[targetLeg];
      if (!flight) return;

      const change = Math.random() > 0.55 ? 5 : -5;
      const nextPrice = Math.max(50, flight.price + change);

      if (flight.price !== nextPrice) {
        const updatedCosts = calculatePassengerCost(nextPrice, activeRoundtrip.passengers);

        setActiveRoundtrip((prev) => {
          const copy = { ...prev };
          copy[targetLeg] = {
            ...flight,
            price: nextPrice,
            passengerCosts: updatedCosts
          };
          return copy;
        });

        // Trigger alerts check
        const triggeredRules = alerts.filter(
          (a) => a.flightId === flight.id && a.type === 'price-drop' && nextPrice <= a.thresholdPrice
        );

        if (triggeredRules.length > 0 && change < 0) {
          triggeredRules.forEach((rule) => {
            const priceNotif = {
              id: `price-drop-${Date.now()}-${rule.id}`,
              time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
              flightNumber: flight.flightNumber,
              type: 'alert',
              message: `Price dropped to $${nextPrice}! (Threshold $${rule.thresholdPrice} met)`
            };

            setNotifications((prev) => [priceNotif, ...prev]);
            setShowNotifBadge(true);
          });
        }
      }
    }, 8000);

    return () => clearInterval(priceInterval);
  }, []);

  // Watchlist Actions
  const handleToggleWatchlist = async (flight) => {
    const exists = watchlist.some((w) => w.id === flight.id);
    if (exists) {
      setWatchlist((prev) => prev.filter((w) => w.id !== flight.id));
      await dataService.removeWatchlistItem(userId, flight.id);
    } else {
      setWatchlist((prev) => [...prev, flight]);
      await dataService.saveWatchlistItem(userId, flight);
    }
  };

  const handleRemoveFromWatchlist = async (id) => {
    setWatchlist((prev) => prev.filter((w) => w.id !== id));
    await dataService.removeWatchlistItem(userId, id);
  };

  const handleTrackFromWatchlist = (flight, dateStr) => {
    // If tracking from watchlist, reset the roundtrip bundle to focus on this single saved option
    const newMockBundle = {
      outbound: flight,
      return: { ...flight, id: flight.id + '-ret', direction: 'return', origin: flight.destination, destination: flight.origin, departureTime: '18:00', arrivalTime: '21:50' },
      passengers: createDefaultPassengers(),
      origin: flight.origin,
      destination: flight.destination,
      departureDate: dateStr,
      returnDate: dateStr
    };

    // Keep the full searchParams shape so the other pages don't fall back to defaults.
    setSearchParams((prev) => ({
      ...prev,
      tripType: 'round-trip',
      origin: flight.origin,
      destination: flight.destination,
      departureDate: dateStr,
      returnDate: dateStr,
      passengers: createDefaultPassengers()
    }));


    setDirection('outbound');
    setActiveRoundtrip(newMockBundle);
    setActiveTab('dashboard');
  };

  const handleOpenNotifications = () => {
    setActiveTab('alerts');
    setShowNotifBadge(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flexGrow: 1 }}>
      
      {/* HEADER SECTION */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'nowrap',
        gap: '16px',
        paddingBottom: '16px',
        borderBottom: '1px solid var(--border-glass)'
      }}>
        {/* LOGO & BRAND MARK */}
        <div 
          onClick={() => setActiveTab('landing')} 
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
          title="Back to KAIRO Home"
        >
          <svg viewBox="0 0 512 512" style={{ width: '34px', height: '34px', display: 'block', flexShrink: 0 }} aria-label="Kairo">
            <rect width="512" height="512" rx="128" fill="#171A21" />
            <rect x="16" y="16" width="480" height="480" rx="112" fill="none" stroke="#2B4BDB" strokeWidth="12" opacity="0.5" />
            <path d="M 170 120 L 170 392 M 170 256 L 340 120 M 170 256 L 340 392" fill="none" stroke="#2B4BDB" strokeWidth="48" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 330 190 L 370 210 L 350 250 Z" fill="#EF5F3C" />
          </svg>
          <h1 className="brand-gradient-text" style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
            KAIRO
          </h1>
        </div>

        {/* WORKSPACE NAVIGATION PILLS */}
        <nav style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'nowrap',
          flex: '1 1 auto',
          minWidth: 0,
          justifyContent: 'center',
          overflowX: 'auto'
        }}>
          {/*
            Ordered as the actual user funnel: discover a destination -> pick a flight ->
            get the buy/wait verdict -> save it -> get notified.
            "Should I Book?" points at the dashboard because that is where the buy-timing
            engine (priceConfidenceEngine) actually renders its BUY NOW / WAIT verdict.
          */}
          {[
            { id: 'ai-explorer', label: 'Where to Go' },
            { id: 'alternative', label: 'Search & Compare' },
            { id: 'dashboard', label: 'Should I Book?' },
            { id: 'watchlist', label: 'Watchlist' },
            { id: 'alerts', label: 'Alerts' }
          ].map((item) => {
            const isActive = activeTab === item.id;
            const isSignedOut = !user;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (isSignedOut) {
                    setIsAuthModalOpen(true);
                  } else {
                    setActiveTab(item.id);
                  }
                }}
                title={isSignedOut ? 'Sign in to continue' : undefined}
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: '1px solid transparent',
                  background: 'transparent',
                  color: isSignedOut ? '#64748b' : isActive ? 'var(--primary)' : 'var(--text-primary)',
                  fontFamily: 'inherit',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'color 0.2s ease'
                }}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* AUTH, NOTIFICATIONS & THEME ACTIONS */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
          {/* Pro Plan / Pricing Quick Link for Logged-In Users */}
          {isAuthenticated && (
            <button
              onClick={() => setActiveTab('landing')}
              style={{
                background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.15), rgba(249, 115, 22, 0.15))',
                border: '1px solid rgba(234, 179, 8, 0.4)',
                borderRadius: '50px',
                color: '#eab308',
                padding: '6px 14px',
                fontSize: '0.78rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap'
              }}
              title="View Pro Plans & Pricing"
            >
              <Zap size={14} style={{ color: '#eab308' }} />
              <span>Pro Plan</span>
            </button>
          )}

          {/* Auth Button or User Avatar */}
          {isAuthenticated ? (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="user-avatar-btn"
                title={user?.email || 'User Account'}
              >
                {user?.email ? user.email.charAt(0).toUpperCase() : 'U'}
              </button>
              {isUserMenuOpen && (
                <div className="user-dropdown animate-fade-in">
                  <div className="user-dropdown-email">{user?.email || 'Signed In'}</div>
                  <button
                    onClick={() => {
                      setActiveTab('landing');
                      setIsUserMenuOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 14px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border-glass)',
                      color: 'var(--primary)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      width: '100%',
                      textAlign: 'left'
                    }}
                  >
                    <Zap size={14} />
                    Upgrade to Pro / Pricing
                  </button>
                  <button
                    onClick={() => {
                      signOut();
                      setIsUserMenuOpen(false);
                    }}
                    className="user-dropdown-signout"
                  >
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setIsAuthModalOpen(true)}
              style={{
                padding: '8px 12px',
                fontSize: '0.85rem',
                fontWeight: 600,
                gap: '6px',
                whiteSpace: 'nowrap',
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer'
              }}
              title="Sign in to sync watchlists and alerts to the cloud"
            >
              <LogIn size={16} />
              Sign In
            </button>
          )}

          <button
            onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
            className="btn-icon"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            style={{
              background: 'transparent',
              border: '1px solid transparent',
              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'rotate(15deg)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'rotate(0deg)'}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          <button 
            onClick={user ? handleOpenNotifications : undefined}
            disabled={!user}
            className="btn-icon" 
            style={{
              position: 'relative',
              background: 'transparent',
              border: '1px solid transparent',
              opacity: user ? 1 : 0.4,
              cursor: user ? 'pointer' : 'not-allowed',
              color: user ? 'var(--text-primary)' : 'var(--text-muted)'
            }}
            title={user ? "Notification alerts" : "Sign in to view notification alerts"}
          >
            <Bell size={18} />
            {user && showNotifBadge && (
              <span className="pulse-target" style={{
                position: 'absolute',
                top: '2px',
                right: '2px',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: 'var(--primary)',
                border: '2px solid var(--bg-primary)'
              }}></span>
            )}
          </button>
        </div>
      </header>



      {/* TAB VIEWS CONTROLLER */}
      <main className="animate-fade-in" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        
        {/* VIEW 0: SAAS MARKETING LANDING PAGE */}
        {activeTab === 'landing' && (
          <LandingPage
            user={user}
            onOpenAuth={() => setIsAuthModalOpen(true)}
            setActiveTab={setActiveTab}
          />
        )}

        {/* VIEW 1: "WHERE TO GO" — DESTINATION DISCOVERY (destination is the OUTPUT) */}
        {activeTab === 'ai-explorer' && (
          <AIDestinationExplorer
            searchParams={searchParams}
            setSearchParams={setSearchParams}
            setActiveRoundtrip={setActiveRoundtrip}
            setActiveTab={setActiveTab}
            onToggleWatchlist={handleToggleWatchlist}
            watchlist={watchlist || []}
          />
        )}

        {/* VIEW 3: "SHOULD I BOOK?" — BUY/WAIT VERDICT + LIVE TELEMETRY HUD */}
        {activeTab === 'dashboard' && (
          <div className="dashboard-grid">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <FlightMap 
                telemetry={telemetry} 
                activeFlight={activeFlight} 
                theme={theme}
              />
              <PriceChart 
                activeFlight={activeFlight} 
                theme={theme}
              />
            </div>

            <div>
              <FlightDetails 
                activeFlight={activeFlight}
                telemetry={telemetry}
                isSimulating={isSimulating}
                simulationProgress={simulationProgress}
                setSimulationProgress={setSimulationProgress}
                setIsSimulating={setIsSimulating}
                simulationSpeed={simulationSpeed}
                setSimulationSpeed={setSimulationSpeed}
                onToggleWatchlist={handleToggleWatchlist}
                isWatched={(watchlist || []).some(w => w?.id === activeFlight?.id)}
                selectedDate={selectedDate}
                onOpenAlertModal={() => setActiveTab('alerts')}
                activeRoundtrip={activeRoundtrip}
              />
            </div>
          </div>
        )}

        {/* VIEW 2: "SEARCH & COMPARE" — FARE SHOPPING ON A KNOWN ROUTE (destination is an INPUT) */}
        {activeTab === 'alternative' && (
          <AlternativeFlights
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            activeFlight={activeFlight}
            setActiveFlight={setActiveFlight}
            onToggleWatchlist={handleToggleWatchlist}
            watchlist={watchlist || []}
            searchParams={searchParams}
            setSearchParams={setSearchParams}
            activeRoundtrip={activeRoundtrip}
            setActiveRoundtrip={setActiveRoundtrip}
            setActiveTab={setActiveTab}
          />
        )}

        {/* VIEW 3: WATCHLIST MANAGER */}
        {activeTab === 'watchlist' && (
          <Watchlist
            watchlist={watchlist || []}
            onRemoveFromWatchlist={handleRemoveFromWatchlist}
            onTrackFlight={handleTrackFromWatchlist}
            activeFlight={activeFlight}
          />
        )}

        {/* VIEW 4: ALERTS CONFIG & LOGS */}
        {activeTab === 'alerts' && (
          <AlertsManager
            alerts={alerts || []}
            setAlerts={setAlerts}
            notifications={notifications || []}
            setNotifications={setNotifications}
            activeFlight={activeFlight}
            flightDatabase={{}} // Not strictly required as inputs now read activeFlight dynamically
          />
        )}

      </main>

      {/* FOOTER */}
      <footer style={{
        textAlign: 'center',
        padding: '24px 0 10px',
        borderTop: '1px solid var(--border-glass)',
        fontSize: '0.75rem',
        color: 'var(--text-muted)'
      }}>
        KAIRO Smart Flight Intelligence © 2026. Predict the exact right moment to buy.
      </footer>

      {/* AUTH MODAL */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

    </div>
  );
}
