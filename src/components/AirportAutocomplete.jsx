import React, { useState, useEffect, useRef } from 'react';
import { AIRPORTS, FEATURED_HUBS } from '../../shared/catalog.js';

export default function AirportAutocomplete({ label, value, onChange, placeholder, id, style }) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const containerRef = useRef(null);

  // Sync with prop value on change or when focus changes
  useEffect(() => {
    if (!isFocused && value && AIRPORTS[value]) {
      const airport = AIRPORTS[value];
      setQuery(`${airport.city} (${value})`);
    }
  }, [value, isFocused]);

  // Handle click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter and sort suggestions
  const getSuggestions = () => {
    const trimmedQuery = query.trim().toLowerCase();

    // If query is too short or empty and input is focused, show featured hubs
    if (trimmedQuery.length < 2) {
      return FEATURED_HUBS.map(code => AIRPORTS[code]).filter(Boolean);
    }

    // Filter all airports
    const filtered = Object.values(AIRPORTS).filter(a => {
      const code = (a.code || '').toLowerCase();
      const city = (a.city || '').toLowerCase();
      const country = (a.country || '').toLowerCase();
      const name = (a.name || '').toLowerCase();
      
      return code.includes(trimmedQuery) || 
             city.includes(trimmedQuery) || 
             country.includes(trimmedQuery) || 
             name.includes(trimmedQuery);
    });

    // Sort by match relevance: exact code match first, then starts-with city, etc.
    return filtered
      .sort((a, b) => {
        const queryLower = trimmedQuery;
        const codeA = a.code.toLowerCase();
        const codeB = b.code.toLowerCase();
        const cityA = a.city.toLowerCase();
        const cityB = b.city.toLowerCase();

        // Exact code match
        if (codeA === queryLower) return -1;
        if (codeB === queryLower) return 1;

        // Starts with code
        if (codeA.startsWith(queryLower) && !codeB.startsWith(queryLower)) return -1;
        if (codeB.startsWith(queryLower) && !codeA.startsWith(queryLower)) return 1;

        // Starts with city
        if (cityA.startsWith(queryLower) && !cityB.startsWith(queryLower)) return -1;
        if (cityB.startsWith(queryLower) && !cityA.startsWith(queryLower)) return 1;

        return cityA.localeCompare(cityB);
      })
      .slice(0, 8); // Limit to 8 suggestions for clean layout
  };

  const handleFocus = () => {
    setIsFocused(true);
    setShowSuggestions(true);
    // Clear search query so user can start typing immediately
    setQuery('');
  };

  const handleBlur = () => {
    // Timeout to let click handler on suggestion execute first
    setTimeout(() => {
      setIsFocused(false);
    }, 200);
  };

  const handleSelect = (airportCode) => {
    const airport = AIRPORTS[airportCode];
    if (airport) {
      setQuery(`${airport.city} (${airportCode})`);
      onChange(airportCode);
    }
    setShowSuggestions(false);
  };

  const suggestions = showSuggestions ? getSuggestions() : [];

  return (
    <div 
      ref={containerRef} 
      className="input-group" 
      style={{ 
        position: 'relative', 
        ...(style || {})
      }}
    >
      {label && (
        <label className="input-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          id={id}
          type="text"
          value={query}
          placeholder={placeholder || 'Enter destination...'}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => {
            const val = e.target.value;
            setQuery(val);
            const cleaned = val.trim().toUpperCase();
            if (cleaned.length === 3 && AIRPORTS[cleaned]) {
              onChange(cleaned);
            }
          }}
          className="input-field"
          style={{
            textOverflow: 'ellipsis'
          }}
          autoComplete="off"
        />
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 'var(--z-popover)',
            background: 'var(--bg-glass, rgba(30, 41, 59, 0.9))',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid var(--border-glass-bright, rgba(255, 255, 255, 0.1))',
            borderRadius: 'var(--radius-md, 8px)',
            boxShadow: 'var(--shadow-lg, 0 10px 25px -5px rgba(0, 0, 0, 0.3))',
            maxHeight: '260px',
            overflowY: 'auto',
            padding: '4px'
          }}
        >
          {/* Header context */}
          <div style={{ 
            fontSize: '0.7rem', 
            color: 'var(--text-muted, #94a3b8)', 
            fontWeight: 700, 
            padding: '6px 12px 4px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            marginBottom: '4px'
          }}>
            {query.trim().length < 2 ? 'Popular Destinations' : 'Search Results'}
          </div>

          {suggestions.map((airport) => (
            <button
              key={airport.code}
              type="button"
              onMouseDown={() => handleSelect(airport.code)}
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm, 4px)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.2s ease',
                color: 'var(--text-primary, #f8fafc)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-glass-hover, rgba(255, 255, 255, 0.1))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                  {airport.city}
                </span>
                <span style={{ 
                  background: 'var(--primary-glow, rgba(99, 102, 241, 0.2))', 
                  color: 'var(--primary, #818cf8)', 
                  fontWeight: 800, 
                  fontSize: '0.75rem', 
                  padding: '2px 6px', 
                  borderRadius: '4px' 
                }}>
                  {airport.code}
                </span>
              </div>
              <div style={{ 
                fontSize: '0.75rem', 
                color: 'var(--text-muted, #94a3b8)', 
                marginTop: '2px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                width: '100%'
              }}>
                {airport.name}, {airport.country}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
