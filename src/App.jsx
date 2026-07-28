import React, { useState, useEffect, useRef } from 'react';
import { Plane, Calendar, Bookmark, Bell, Compass, Activity, Sun, Moon, LogIn, LogOut, Sparkles, Globe } from 'lucide-react';
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

  const prevStatusRef = useRef('Scheduled');

  // Retrieve GPS Coordinates for active telemetry
  const originAirport = AIRPORTS[activeFlight.origin] || AIRPORTS.TLV;
  const destinationAirport = AIRPORTS[activeFlight.destination] || AIRPORTS.KRK;
  
  const telemetry = getFlightTelemetry(
    simulationProgress, 
    originAirport.coords, 
    destinationAirport.coords
  );

  // Fetch initial default flights from the server to align with the client-server pattern
  useEffect(() => {
    let active = true;
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
        const apiBase = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null' ? window.location.origin : 'http://localhost:3001');
        const res = await fetch(`${apiBase}/api/flights?${queryParams.toString()}`);
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
  }, []);

  // Cloud / Local data loading effect when user changes
  useEffect(() => {
    let active = true;
    const loadUserData = async () => {
      if (userId) {
        await dataService.migrateLocalStorage(userId);
      }
      const [wList, aList, nList, prefs] = await Promise.all([
        dataService.loadWatchlist(userId),
        dataService.loadAlerts(userId),
        dataService.loadNotifications(userId),
        dataService.loadPreferences(userId)
      ]);

      if (active) {
        setWatchlist(wList);
        setAlerts(aList);
        setNotifications(nList);
        if (prefs?.theme) setTheme(prefs.theme);
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
        <div 
          onClick={() => setActiveTab('landing')} 
          style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
          title="Back to AeroTrack Home"
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
            <h1 className="brand-gradient-text" style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>
              KAIRO
            </h1>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Smart AI Flight Price & Buy Timing Engine
          </p>
        </div>

        {/* AUTH, NOTIFICATIONS & NAVIGATION HUD */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {/* Landing / Web App Mode Switcher */}
          {activeTab === 'landing' ? (
            <button
              onClick={() => setActiveTab('ai-explorer')}
              className="btn btn-primary"
              style={{ padding: '8px 16px', fontSize: '0.8rem', gap: '6px' }}
            >
              <Sparkles size={16} />
              Launch Web App
            </button>
          ) : (
            <button
              onClick={() => setActiveTab('landing')}
              className="btn btn-secondary"
              style={{ padding: '8px 14px', fontSize: '0.8rem', gap: '6px' }}
              title="Return to Product Home"
            >
              <Globe size={16} />
              Product Home
            </button>
          )}

          {/* Auth Button or User Avatar */}
          {isAuthenticated ? (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="user-avatar-btn"
                title={user.email}
              >
                {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
              </button>
              {isUserMenuOpen && (
                <div className="user-dropdown animate-fade-in">
                  <div className="user-dropdown-email">{user.email}</div>
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

      {/* DASHBOARD TAB BAR (Only shown when inside the App views) */}
      {activeTab !== 'landing' && (
        <nav style={{
          display: 'flex',
          gap: '8px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-glass)',
          borderRadius: 'var(--radius-md)',
          padding: '6px',
          overflowX: 'auto'
        }}>
          {[
            { id: 'ai-explorer', label: 'AI Event Explorer', icon: <Sparkles size={16} /> },
            { id: 'dashboard', label: 'Dashboard HUD', icon: <Activity size={16} /> },
            { id: 'alternative', label: 'Find Flights', icon: <Compass size={16} /> },
            { id: 'watchlist', label: 'Watchlist', icon: <Bookmark size={16} /> },
            { id: 'alerts', label: 'Alert Center', icon: <Bell size={16} /> }
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="btn"
                style={{
                  backgroundColor: isActive ? 'var(--bg-tertiary)' : 'transparent',
                  color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                  border: isActive ? '1px solid var(--border-glass-bright)' : '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 18px',
                  fontSize: '0.85rem',
                  flexGrow: 1
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* TAB VIEWS CONTROLLER */}
      <main className="animate-fade-in" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        
        {/* VIEW 0: SAAS MARKETING LANDING PAGE */}
        {activeTab === 'landing' && (
          <LandingPage
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
            watchlist={watchlist}
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
                isWatched={watchlist.some(w => w.id === activeFlight.id)}
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
            watchlist={watchlist}
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
            watchlist={watchlist}
            onRemoveFromWatchlist={handleRemoveFromWatchlist}
            onTrackFlight={handleTrackFromWatchlist}
            activeFlight={activeFlight}
          />
        )}

        {/* VIEW 4: ALERTS CONFIG & LOGS */}
        {activeTab === 'alerts' && (
          <AlertsManager
            alerts={alerts}
            setAlerts={setAlerts}
            notifications={notifications}
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
