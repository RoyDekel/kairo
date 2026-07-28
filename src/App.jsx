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

export default function App() {
  // Auth state
  const { user, isAuthenticated, signOut } = useAuth();
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

  // 1. Search Query Parameters
  const [searchParams, setSearchParams] = useState({
    tripType: 'round-trip',
    origin: 'TLV',
    destination: '',
    departureDate: '',
    returnDate: '',
    passengers: {
      adults: 1,
      children: 0,
      infants: 0
    },
    stops: '0'
  });

  // 2. Active Roundtrip Bundle State
  const [activeRoundtrip, setActiveRoundtrip] = useState(() => {
    const defaultOutbound = generateFlightsForRoute('TLV', 'KRK', '2026-08-11', 'outbound', { adults: 1 })[0];
    const defaultReturn = generateFlightsForRoute('KRK', 'TLV', '2026-08-16', 'return', { adults: 1 })[0];
    
    return {
      outbound: defaultOutbound,
      return: defaultReturn,
      passengers: { adults: 1, children: 0, infants: 0 },
      origin: 'TLV',
      destination: 'KRK',
      departureDate: '2026-08-11',
      returnDate: '2026-08-16'
    };
  });

  // 3. Active Tracked Leg (Defaults to Outbound)
  const [activeFlight, setActiveFlight] = useState(() => activeRoundtrip.outbound);
  const [selectedDate, setSelectedDate] = useState('2026-08-11');
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
        message: 'KAIRO AI engine initialized. Select "AI Event Explorer" or "Find Flights" to discover destinations.'
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
    const apiBase = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null' ? window.location.origin : 'http://localhost:3001');

    // Background ping to wake up free tier backend service on Render
    const pingBackend = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        await fetch(`${apiBase}/api/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
      } catch (err) {
        // Silent catch for background ping
      }
    };
    pingBackend();

    const fetchDefaultFlights = async () => {
      try {
        const queryParams = new URLSearchParams({
          origin: 'TLV',
          destination: 'KRK',
          departureDate: '2026-08-11',
          returnDate: '2026-08-16',
          adults: '1',
          children: '0',
          infants: '0',
          stops: '0'
        });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`${apiBase}/api/flights?${queryParams.toString()}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (active && data.outbound?.length && data.return?.length) {
            setActiveRoundtrip({
              outbound: data.outbound[0],
              return: data.return[0],
              passengers: { adults: 1, children: 0, infants: 0 },
              origin: 'TLV',
              destination: 'KRK',
              departureDate: '2026-08-11',
              returnDate: '2026-08-16'
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

  // Handle active leg switching
  const handleLegSwitch = (targetLeg) => {
    if (targetLeg === direction) return;

    setDirection(targetLeg);
    setIsSimulating(false);
    setSimulationProgress(0);

    if (targetLeg === 'outbound') {
      setSelectedDate(searchParams.departureDate);
      setActiveFlight(activeRoundtrip.outbound);
    } else {
      setSelectedDate(searchParams.returnDate);
      setActiveFlight(activeRoundtrip.return);
    }
    
    prevStatusRef.current = 'Scheduled';
  };

  // Sync active tracked flight when bundle changes
  useEffect(() => {
    if (direction === 'outbound') {
      setActiveFlight(activeRoundtrip.outbound);
      setSelectedDate(activeRoundtrip.departureDate);
    } else {
      setActiveFlight(activeRoundtrip.return);
      setSelectedDate(activeRoundtrip.returnDate);
    }
    setIsSimulating(false);
    setSimulationProgress(0);
    prevStatusRef.current = 'Scheduled';
  }, [activeRoundtrip]);

  // Telemetry simulation loop
  useEffect(() => {
    let intervalId = null;

    if (isSimulating) {
      intervalId = setInterval(() => {
        setSimulationProgress((prev) => {
          const next = prev + 0.001 * simulationSpeed;
          if (next >= 1.0) {
            setIsSimulating(false);
            return 1.0;
          }
          return next;
        });
      }, 50);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isSimulating, simulationSpeed]);

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

  // Market Engine: Fluctuate active bundle prices periodically
  useEffect(() => {
    const priceInterval = setInterval(() => {
      if (!activeRoundtrip) return;

      const isOutboundLeg = Math.random() > 0.5;
      const targetLeg = isOutboundLeg ? 'outbound' : 'return';
      const flight = activeRoundtrip[targetLeg];

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
  }, [activeRoundtrip, activeFlight.id, alerts]);

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
      passengers: { adults: 1, children: 0, infants: 0 },
      origin: flight.origin,
      destination: flight.destination,
      departureDate: dateStr,
      returnDate: dateStr
    };
    
    setSearchParams({
      origin: flight.origin,
      destination: flight.destination,
      departureDate: dateStr,
      returnDate: dateStr,
      passengers: { adults: 1, children: 0, infants: 0 }
    });
    
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
        flexWrap: 'wrap',
        gap: '16px',
        paddingBottom: '16px',
        borderBottom: '1px solid var(--border-glass)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            onClick={() => setIsNavDrawerOpen(prev => !prev)}
            className="btn-icon hamburger-btn"
            title={isNavDrawerOpen ? "Close Menu" : "Open Navigation Menu"}
            style={{
              padding: '8px',
              borderRadius: '8px',
              background: isNavDrawerOpen ? 'rgba(56, 189, 248, 0.2)' : 'var(--bg-secondary)',
              border: '1px solid var(--border-glass-bright)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease'
            }}
          >
            {isNavDrawerOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          <div 
            onClick={() => setActiveTab('landing')} 
            style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
            title="Back to KAIRO Home"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-glow)'
              }}>
                <Plane size={18} style={{ color: '#0b0f19', transform: 'rotate(45deg)' }} />
              </div>
              <h1 className="brand-gradient-text" style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                KAIRO
                <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', color: '#38bdf8', fontWeight: 600, letterSpacing: '0.5px' }}>
                  DEMO SIMULATION
                </span>
              </h1>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Smart Flight Price & Buy Timing Engine (Real-Time Demo Simulation)
            </p>
          </div>
        </div>

        {/* AUTH, NOTIFICATIONS & NAVIGATION HUD */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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
                transition: 'all 0.2s ease'
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
              className="btn btn-secondary"
              style={{ padding: '8px 14px', fontSize: '0.8rem', gap: '6px' }}
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
              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'rotate(15deg)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'rotate(0deg)'}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          <button 
            onClick={handleOpenNotifications}
            className="btn-icon" 
            style={{ position: 'relative' }}
            title="Notification logs"
          >
            <Bell size={18} />
            {showNotifBadge && (
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

      {/* SLIDE-OVER NAVIGATION DRAWER */}
      {isNavDrawerOpen && (
        <div 
          className="nav-drawer-overlay animate-fade-in"
          onClick={() => setIsNavDrawerOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(11, 15, 25, 0.65)',
            backdropFilter: 'blur(6px)',
            zIndex: 9000,
            display: 'flex'
          }}
        >
          <div 
            className="nav-drawer-panel animate-slide-right"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '320px',
              maxWidth: '85vw',
              height: '100%',
              backgroundColor: 'var(--bg-secondary)',
              borderRight: '1px solid var(--border-glass-bright)',
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
              padding: '24px 20px',
              overflowY: 'auto'
            }}
          >
            {/* Drawer Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border-glass)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'var(--shadow-glow)'
                }}>
                  <Plane size={20} style={{ color: '#0b0f19', transform: 'rotate(45deg)' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--text-primary)', letterSpacing: '0.5px' }}>KAIRO</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Flight Intelligence Workspace</div>
                </div>
              </div>

              <button 
                onClick={() => setIsNavDrawerOpen(false)}
                className="btn-icon"
                style={{ padding: '6px' }}
                title="Close Navigation"
              >
                <X size={20} />
              </button>
            </div>

            {/* Navigation Items List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', paddingLeft: '8px' }}>
                Workspace Pages
              </div>

              {[
                { id: 'ai-explorer', label: 'Should I Book? (AI Engine)', icon: <Sparkles size={18} />, requiresAuth: true },
                { id: 'dashboard', label: 'Price Radar HUD', icon: <Activity size={18} />, requiresAuth: true },
                { id: 'alternative', label: 'Compare Fares & Search', icon: <Compass size={18} />, requiresAuth: true },
                { id: 'watchlist', label: 'Watchlist Manager', icon: <Bookmark size={18} />, requiresAuth: true, badge: (watchlist || []).length },
                { id: 'alerts', label: 'Alert Center & Logs', icon: <Bell size={18} />, requiresAuth: true, badge: (alerts || []).length }
              ].map((item) => {
                const isActive = activeTab === item.id;
                const isLocked = item.requiresAuth && !user;

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setIsNavDrawerOpen(false);
                      if (isLocked) {
                        setIsAuthModalOpen(true);
                      } else {
                        setActiveTab(item.id);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: isActive ? '1px solid var(--border-glass-bright)' : '1px solid transparent',
                      backgroundColor: isActive ? 'var(--bg-tertiary)' : 'transparent',
                      color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                      fontWeight: isActive ? 700 : 500,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      textAlign: 'left'
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ color: isActive ? 'var(--primary)' : 'var(--text-muted)' }}>{item.icon}</span>
                      <span>{item.label}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: '10px',
                          backgroundColor: 'var(--primary-glow-weak)',
                          color: 'var(--primary)',
                          border: '1px solid var(--border-glass)'
                        }}>
                          {item.badge}
                        </span>
                      )}

                      {isLocked ? (
                        <span title="Requires sign in" style={{ fontSize: '0.82rem', opacity: 0.7 }}>🔒</span>
                      ) : (
                        <ChevronRight size={14} style={{ opacity: isActive ? 1 : 0.4 }} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Drawer Footer / Account Summary */}
            <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid var(--border-glass)' }}>
              {isAuthenticated ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Signed in as</div>
                  <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{user?.email}</div>
                  <button
                    onClick={() => {
                      setIsNavDrawerOpen(false);
                      signOut();
                    }}
                    className="btn btn-secondary"
                    style={{ width: '100%', marginTop: '6px', justifyContent: 'center', gap: '6px', fontSize: '0.82rem' }}
                  >
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setIsNavDrawerOpen(false);
                    setIsAuthModalOpen(true);
                  }}
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', gap: '8px', fontSize: '0.88rem' }}
                >
                  <LogIn size={16} />
                  Sign In / Register
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB VIEWS CONTROLLER */}
      <main className="animate-fade-in" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        
        {/* VIEW 0: SAAS MARKETING LANDING PAGE */}
        {activeTab === 'landing' && (
          <LandingPage
            user={user}
            onExploreAI={(params) => {
              if (params) {
                setSearchParams((prev) => ({ ...prev, ...params }));
              }
              setActiveTab('ai-explorer');
            }}
            onOpenAuth={() => setIsAuthModalOpen(true)}
            setActiveTab={setActiveTab}
          />
        )}

        {/* VIEW 0.5: AI EVENT & DESTINATION EXPLORER */}
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

        {/* VIEW 1: DASHBOARD HUD */}
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

        {/* VIEW 2: DYNAMIC SEARCH & LISTINGS */}
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
