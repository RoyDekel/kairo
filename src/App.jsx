import { useState, useEffect, useRef } from 'react';
import { Bell, Sun, Moon, LogIn, LogOut, Zap, Sparkles, ArrowRight, CheckCircle } from 'lucide-react';
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
import BuyVerdict from './components/BuyVerdict';
import SimulatorPanel from './components/SimulatorPanel';
import { useAuth } from './contexts/authContext';
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

/*
  Single source of truth for the workspace tabs. Rendered twice: as text links in
  the desktop header, and as a sticky horizontal pill rail on mobile. Ordered as
  the actual user funnel: discover a destination -> pick a flight -> get the
  buy/wait verdict -> save it.
*/
const NAV_ITEMS = [
  { id: 'ai-explorer', label: 'When to Go' },
  { id: 'alternative', label: 'Search & Compare' },
  { id: 'dashboard', label: 'Should I Book?' },
  { id: 'watchlist', label: 'Watchlist' }
];

const MOBILE_QUERY = '(max-width: 768px)';

/*
  Reports whether the viewport is phone-sized, and keeps reporting as it changes.

  The mobile chrome is gated on this in JavaScript rather than hidden with CSS,
  because the alternative is rendering both navigations and hiding one. That puts
  every section label in the DOM twice, which makes any query for a label
  ambiguous -- for the test suite, and for anything else that reads the document.

  Defensive on two fronts. matchMedia is absent under jsdom, where the desktop
  layout is the right assumption. And addListener/removeListener is the only
  subscription API on Safari below 14 -- which is exactly the class of browser
  this mobile work is aimed at, so falling back to it is not hypothetical.
*/
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const mql = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }

    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}

export default function App() {
  // Auth state
  const { user, session, isAuthenticated, loading: authLoading, signOut } = useAuth();
  const userId = user?.id;

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalInitialMode, setAuthModalInitialMode] = useState('signin');
  const [authModalNotice, setAuthModalNotice] = useState('');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  // Post-email-confirmation toast (top-right, auto-dismiss) -- see LandingPage.jsx for the
  // sibling pattern this mirrors.
  const [confirmationToastMsg, setConfirmationToastMsg] = useState(null);

  /*
    Handles the redirect Supabase sends the browser back to after the user clicks the
    confirmation link in the signup email -- see EMAIL_CONFIRMATION_REDIRECT_URL in
    AuthProvider.jsx, which pins that link to `?confirmed=true` on this exact page (no
    client-side router here; it's a query string on the single SPA mount, not a route).

    `authLoading` is AuthProvider's own getSession() resolving -- that round trip IS the
    "short check" the confirmation flow needs, so there's no reason to add a second timer:
    once it flips false, isAuthenticated reflects whatever Supabase actually did with the
    link. A valid, unused link leaves the browser signed in (welcome toast); an
    expired-or-already-used one does not (fall back to the sign-in modal with an
    explanation instead of leaving the user looking at a dead landing page).
  */
  useEffect(() => {
    if (authLoading) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('confirmed') !== 'true') return;

    // Strip the param immediately so a refresh or back-navigation doesn't replay this.
    params.delete('confirmed');
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);

    if (isAuthenticated) {
      setConfirmationToastMsg('Email confirmed! Welcome to KAIRO.');
      setTimeout(() => setConfirmationToastMsg(null), 5000);
    } else {
      setAuthModalInitialMode('signin');
      setAuthModalNotice(
        'That confirmation link has expired or was already used. Sign in below, or sign up again to get a new link.'
      );
      setIsAuthModalOpen(true);
    }
  }, [authLoading, isAuthenticated]);

  // Mobile chrome: which navigation to render, the contextual bottom CTA, and
  // keeping the active nav pill inside the horizontally scrolling rail.
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [scrolledPastHero, setScrolledPastHero] = useState(false);
  const activePillRef = useRef(null);

  const handleSignOut = async () => {
    await signOut();
    setActiveTab('landing');
    setIsUserMenuOpen(false);
  };

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

    /*
      Keep the browser's own toolbar tint in sync with the page. Without this a
      light page sits under a dark address bar on Safari, Chrome Android and
      Samsung Internet, which reads as a rendering bug to the user.
    */
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', theme === 'dark' ? '#0b0f19' : '#f1f5f9');
    }

    dataService.savePreferences(userId, { theme });
  }, [theme, userId]);

  // 1. Search Query Parameters — the single source of truth for origin/destination/dates.
  //    Both "When to Go" and "Search & Compare" read and write this object so the two
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
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [simulationProgress, setSimulationProgress] = useState(0); // 0.0 to 1.0
  const [simulationSpeed, setSimulationSpeed] = useState(5); // 1x, 5x, 20x
  const [liveTelemetry, setLiveTelemetry] = useState(null);
  const [telemetrySource, setTelemetrySource] = useState('simulated');

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
        message: 'KAIRO AI engine initialized. Start at "When to Go" to discover destinations, or "Search & Compare" if you already know your route.'
      }
    ];
  });

  // 6. Navigation Tabs (Default page: SaaS Landing Page)
  const [activeTab, setActiveTab] = useState('landing');
  const [showNotifBadge, setShowNotifBadge] = useState(false);

  // Auto-redirect authenticated user on login to AI Event Explorer workspace
  useEffect(() => {
    if (user && activeTab === 'landing') {
      setActiveTab('ai-explorer');
    }
  }, [user, activeTab]);

  /*
    Tracks whether the landing hero — and its own "Discover When to Go" button —
    has scrolled out of sight. 320px is just past the hero fold on a 390x844
    viewport. Passive listener + rAF so this never blocks scrolling on a mid-range
    Android device, and the state update happens inside the rAF callback rather
    than in the effect body so it cannot cascade a synchronous re-render.
  */
  useEffect(() => {
    let queued = false;
    const evaluate = () => {
      queued = false;
      setScrolledPastHero(window.scrollY > 320);
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(evaluate);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /*
    The rail scrolls horizontally, so on a narrow screen the active tab can sit
    outside the visible track. Pull it back into view whenever it changes.
  */
  useEffect(() => {
    const pill = activePillRef.current;
    if (!pill || typeof pill.scrollIntoView !== 'function') return;
    pill.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activeTab]);

  /*
    Derived, not stored: the CTA belongs to the landing view only, and duplicating
    that condition into state would just be another thing to keep in sync.
  */
  const showMobileCta = isMobile && activeTab === 'landing' && scrolledPastHero;

  const prevStatusRef = useRef('Scheduled');

  // Retrieve GPS Coordinates for active telemetry
  const originAirport = AIRPORTS[activeFlight?.origin] || AIRPORTS.TLV;
  const destinationAirport = AIRPORTS[activeFlight?.destination] || AIRPORTS.KRK;

  // Compute flight path telemetry: either live transponder feed or client-side simulator.
  const telemetry = (telemetrySource === 'live' && liveTelemetry)
    ? (() => {
        const lat1 = originAirport.coords[0];
        const lon1 = originAirport.coords[1];
        const lat2 = destinationAirport.coords[0];
        const lon2 = destinationAirport.coords[1];

        const rLat1 = (lat1 * Math.PI) / 180;
        const rLon1 = (lon1 * Math.PI) / 180;
        const rLat2 = (lat2 * Math.PI) / 180;
        const rLon2 = (lon2 * Math.PI) / 180;

        const d = 2 * Math.asin(
          Math.sqrt(
            Math.sin((rLat1 - rLat2) / 2) ** 2 +
            Math.cos(rLat1) * Math.cos(rLat2) * Math.sin((rLon1 - rLon2) / 2) ** 2
          )
        );

        const totalDistance = Math.round(6371 * d);
        const lat = liveTelemetry.latitude;
        const lon = liveTelemetry.longitude;
        
        // Calculate distance remaining to destination
        const rLat = (lat * Math.PI) / 180;
        const rLon = (lon * Math.PI) / 180;
        const dRem = 2 * Math.asin(
          Math.sqrt(
            Math.sin((rLat - rLat2) / 2) ** 2 +
            Math.cos(rLat) * Math.cos(rLat2) * Math.sin((rLon - rLon2) / 2) ** 2
          )
        );
        const distanceRemaining = Math.max(0, Math.round(6371 * dRem));
        const progress = Math.min(100, Math.max(0, Math.round(((totalDistance - distanceRemaining) / totalDistance) * 100)));

        return {
          latitude: lat,
          longitude: lon,
          heading: liveTelemetry.heading,
          altitude: liveTelemetry.altitude,
          speed: liveTelemetry.speed,
          status: liveTelemetry.status,
          progress,
          distanceRemaining,
          timeRemaining: Math.round((distanceRemaining / Math.max(1, liveTelemetry.speed || 780)) * 60),
          source: 'live'
        };
      })()
    : {
        ...getFlightTelemetry(
          simulationProgress,
          originAirport.coords,
          destinationAirport.coords
        ),
        source: 'simulated'
      };

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
    setTelemetrySource('simulated');
    setLiveTelemetry(null);
  }, [routeSignature]);

  // Live flight telemetry polling loop from OpenSky Network
  useEffect(() => {
    if (!isSimulating || !activeFlight?.flightNumber) {
      setTelemetrySource('simulated');
      setLiveTelemetry(null);
      return undefined;
    }

    const apiBase = getApiBase();
    
    const fetchLiveCoords = async () => {
      try {
        const queryParams = new URLSearchParams({
          flightNumber: activeFlight.flightNumber,
          origin: activeFlight.origin,
          destination: activeFlight.destination
        });
        
        const resp = await fetchWithTimeout(
          `${apiBase}/api/telemetry/live?${queryParams.toString()}`,
          { headers: authHeaders(), timeoutMs: 5000 }
        );
        
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.telemetry) {
            setLiveTelemetry(data.telemetry);
            setTelemetrySource('live');
            return;
          }
        }
      } catch {
        // Silently fall back to simulated telemetry
      }
      
      setTelemetrySource('simulated');
      setLiveTelemetry(null);
    };

    fetchLiveCoords();
    const intervalId = setInterval(fetchLiveCoords, 15000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isSimulating, activeFlight?.flightNumber, activeFlight?.origin, activeFlight?.destination]);

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
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', gap: '24px', flexGrow: 1 }}>

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

        {/* WORKSPACE NAVIGATION — desktop only; mobile uses the pill rail below. */}
        {!isMobile && (
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
            "Should I Book?" points at the dashboard because that is where the buy-timing
            engine (priceConfidenceEngine) actually renders its BUY NOW / WAIT verdict.
          */}
          {NAV_ITEMS.map((item) => {
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
        )}

        {/* AUTH, NOTIFICATIONS & THEME ACTIONS */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
          {/*
            Pro Plan / Pricing quick link.

            Desktop only. At 390px the header carries five items -- logo, this
            chip, avatar, theme, notifications -- and this is the only one that
            is an upsell rather than a control, so it is the one that gives way.
            It moves into the account menu below, where it stays reachable
            without competing with the app's own controls for the top bar.
          */}
          {isAuthenticated && !isMobile && (
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

                  {/* The header chip's mobile home. Rendered here only where the
                      chip itself is not, so the entry never appears twice. */}
                  {isMobile && (
                    <button
                      type="button"
                      className="user-dropdown-pro"
                      onClick={() => {
                        setActiveTab('landing');
                        setIsUserMenuOpen(false);
                      }}
                    >
                      <Zap size={14} />
                      Pro Plan
                    </button>
                  )}

                  <button
                    onClick={handleSignOut}
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

      {/*
        MOBILE NAVIGATION RAIL — mobile only (see .mobile-nav-rail in index.css).

        Replaces the old fixed bottom dock. A bottom dock collides with the browser's
        own toolbar, which sits at the BOTTOM of the screen in Safari iOS 15+,
        Firefox Android and Samsung Internet, and it jitters while that toolbar
        collapses on scroll. This rail pins to the top instead, where no browser
        chrome competes with it, and costs ~52px instead of the dock's ~50px plus
        the safe-area inset stacked on top of the browser bar.

        It stays pinned while scrolling so navigation is never out of reach. The
        logo row above it scrolls away, since it has no function after first paint.
      */}
      {isMobile && (
      <nav className="mobile-nav-rail" aria-label="Sections">
        <div className="mobile-nav-rail-track">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            /*
              The watchlist count is only meaningful once there is an account
              behind it. Signed out, the list still holds whatever localStorage
              kept from a previous session, so showing a badge would advertise
              someone else's saved routes to whoever picks up the phone — and it
              promises content behind a tab that only opens the sign-in modal.
            */
            const count = (item.id === 'watchlist' && isAuthenticated)
              ? (watchlist || []).length
              : 0;

            return (
              <button
                key={item.id}
                type="button"
                ref={isActive ? activePillRef : undefined}
                className={`mobile-nav-pill${isActive ? ' active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  if (!user) {
                    setIsAuthModalOpen(true);
                  } else {
                    setActiveTab(item.id);
                  }
                }}
              >
                {item.label}
                {count > 0 && <span className="mobile-nav-pill-count">{count}</span>}
              </button>
            );
          })}
        </div>
      </nav>
      )}

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

        {/* VIEW 1: "WHEN TO GO" — DESTINATION DISCOVERY (destination is the OUTPUT) */}
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

        {/* VIEW 3: "SHOULD I BOOK?" — VERDICT FIRST, THEN SUPPORTING EVIDENCE */}
        {activeTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* The page's namesake answer leads, full width. */}
            <BuyVerdict
              activeFlight={activeFlight}
              activeRoundtrip={activeRoundtrip}
              selectedDate={selectedDate}
            />

            <div className="dashboard-grid">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <FlightMap
                    telemetry={telemetry}
                    activeFlight={activeFlight}
                    theme={theme}
                  />
                  {/* Sits with the map because the map is all it controls. */}
                  <SimulatorPanel
                    isOpen={isSimulatorOpen}
                    onToggleOpen={() => setIsSimulatorOpen((prev) => !prev)}
                    activeFlight={activeFlight}
                    isSimulating={isSimulating}
                    setIsSimulating={setIsSimulating}
                    simulationProgress={simulationProgress}
                    setSimulationProgress={setSimulationProgress}
                    simulationSpeed={simulationSpeed}
                    setSimulationSpeed={setSimulationSpeed}
                  />
                </div>
                <PriceChart
                  activeFlight={activeFlight}
                  theme={theme}
                />
              </div>

              <div>
                <FlightDetails
                  activeFlight={activeFlight}
                  onToggleWatchlist={handleToggleWatchlist}
                  isWatched={(watchlist || []).some(w => w?.id === activeFlight?.id)}
                  selectedDate={selectedDate}
                  onOpenAlertModal={() => setActiveTab('alerts')}
                  activeRoundtrip={activeRoundtrip}
                  direction={direction}
                  onSwitchLeg={setDirection}
                />
              </div>
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
            accessToken={session?.access_token}
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
        onClose={() => {
          setIsAuthModalOpen(false);
          setAuthModalNotice('');
        }}
        initialMode={authModalInitialMode}
        notice={authModalNotice}
      />

      {/*
        EMAIL-CONFIRMATION TOAST — fixed top-right, auto-dismiss. Mirrors the toast pattern
        in LandingPage.jsx (this app has no shared toast component to reuse yet).
      */}
      {confirmationToastMsg && (
        <div className="animate-fade-in" style={{
          position: 'fixed',
          top: '80px',
          right: '24px',
          zIndex: 'var(--z-modal)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--success-glow)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 18px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <CheckCircle size={18} color="var(--success)" />
          <span>{confirmationToastMsg}</span>
        </div>
      )}

      {/*
        MOBILE CONTEXTUAL CTA — mobile only, landing page only.

        The bottom of a phone screen is the only area the thumb reaches comfortably.
        Rather than spending it on lateral navigation the user rarely performs, it is
        reserved for the single action that matters on this view. It appears once the
        hero's own button has scrolled out of sight, so the two never compete.
      */}
      {showMobileCta && (
        <>
          <div className="mobile-cta-spacer" aria-hidden="true" />
          <div className="mobile-cta-bar">
            <button
              type="button"
              className="mobile-cta-btn"
              onClick={() => {
                if (!user) {
                  setIsAuthModalOpen(true);
                } else {
                  setActiveTab('ai-explorer');
                }
              }}
            >
              <Sparkles size={18} aria-hidden="true" />
              <span>Discover When to Go</span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </>
      )}

    </div>
  );
}
