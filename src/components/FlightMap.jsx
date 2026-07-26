import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AIRPORTS } from '../utils/flightSimulator';

export default function FlightMap({ telemetry, activeFlight, theme }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const tileLayerRef = useRef(null);
  const planeMarkerRef = useRef(null);
  const pathLineRef = useRef(null);
  const fullPathRef = useRef(null);
  const originMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);

  // Retrieve coordinates dynamically based on selected flight route
  const origin = AIRPORTS[activeFlight.origin] || AIRPORTS.TLV;
  const destination = AIRPORTS[activeFlight.destination] || AIRPORTS.KRK;
  
  const startCoords = origin.coords;
  const endCoords = destination.coords;

  // Custom airport markers
  const originIcon = L.divIcon({
    html: `
      <div style="background: var(--primary-glow-weak); border: 2px solid var(--primary); width: 14px; height: 14px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px var(--primary-glow);">
        <div style="background: var(--primary); width: 6px; height: 6px; border-radius: 50%;"></div>
      </div>
    `,
    className: 'airport-marker-origin',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  const destIcon = L.divIcon({
    html: `
      <div style="background: var(--accent-glow); border: 2px solid var(--accent); width: 14px; height: 14px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px var(--accent-glow);">
        <div style="background: var(--accent); width: 6px; height: 6px; border-radius: 50%;"></div>
      </div>
    `,
    className: 'airport-marker-dest',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  const createPlaneIcon = (heading) => {
    return L.divIcon({
      html: `
        <div style="transform: rotate(${heading - 45}deg); transition: transform 0.2s ease; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="var(--primary)" stroke="var(--bg-secondary)" stroke-width="1.2" width="30" height="30" style="filter: drop-shadow(0 0 6px var(--primary-glow));">
            <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L14 19v-5.5L21 16z"/>
          </svg>
        </div>
      `,
      className: 'plane-marker',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Center map initially around midpoint
    const midpoint = [
      (startCoords[0] + endCoords[0]) / 2,
      (startCoords[1] + endCoords[1]) / 2
    ];

    const map = L.map(mapContainerRef.current, {
      center: midpoint,
      zoom: 4,
      zoomControl: false,
      attributionControl: false
    });

    // Move zoom control to bottom right to prevent overlapping HUD overlays
    if (L.control && L.control.zoom) {
      L.control.zoom({ position: 'bottomright' }).addTo(map);
    }

    mapRef.current = map;

    const tileUrl = theme === 'dark' 
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

    const tileLayer = L.tileLayer(tileUrl, {
      maxZoom: 19
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    // Draw full route line (dotted)
    const fullPath = L.polyline([startCoords, endCoords], {
      color: theme === 'dark' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(15, 23, 42, 0.15)',
      weight: 2,
      dashArray: '5, 8'
    }).addTo(map);
    fullPathRef.current = fullPath;

    // Draw active flight coverage path line
    const activePath = L.polyline([startCoords, [telemetry.latitude, telemetry.longitude]], {
      color: theme === 'dark' ? '#00f2fe' : '#0284c7',
      weight: 3.5,
      opacity: 0.85
    }).addTo(map);
    pathLineRef.current = activePath;

    // Airport Markers
    const originMarker = L.marker(startCoords, { icon: originIcon }).addTo(map);
    originMarker.bindTooltip(`<b>${origin.city} (${origin.code})</b><br>${origin.name}`, { direction: 'top', className: 'map-tooltip' });
    originMarkerRef.current = originMarker;
    
    const destMarker = L.marker(endCoords, { icon: destIcon }).addTo(map);
    destMarker.bindTooltip(`<b>${destination.city} (${destination.code})</b><br>${destination.name}`, { direction: 'top', className: 'map-tooltip' });
    destMarkerRef.current = destMarker;

    // Active Plane Marker
    const planeMarker = L.marker([telemetry.latitude, telemetry.longitude], {
      icon: createPlaneIcon(telemetry.heading)
    }).addTo(map);
    planeMarkerRef.current = planeMarker;

    // Adjust zoom and bounds to fit route perfectly
    const bounds = L.latLngBounds([startCoords, endCoords]);
    map.fitBounds(bounds, { padding: [50, 50] });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update Tile Layer and lines styling when Theme changes
  useEffect(() => {
    if (!mapRef.current) return;
    
    if (tileLayerRef.current) {
      const tileUrl = theme === 'dark' 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
      tileLayerRef.current.setUrl(tileUrl);
    }
    
    if (fullPathRef.current) {
      fullPathRef.current.setStyle({
        color: theme === 'dark' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(15, 23, 42, 0.15)'
      });
    }
    
    if (pathLineRef.current) {
      pathLineRef.current.setStyle({
        color: theme === 'dark' ? '#00f2fe' : '#0284c7'
      });
    }
  }, [theme]);

  // Update Map Bounds and Markers when flight changes
  useEffect(() => {
    if (!mapRef.current) return;

    const currentCoords = [telemetry.latitude, telemetry.longitude];

    // Update airport markers coordinates and tooltips
    if (originMarkerRef.current) {
      originMarkerRef.current.setLatLng(startCoords);
      originMarkerRef.current.setTooltipContent(`<b>${origin.city} (${origin.code})</b><br>${origin.name}`);
    }
    if (destMarkerRef.current) {
      destMarkerRef.current.setLatLng(endCoords);
      destMarkerRef.current.setTooltipContent(`<b>${destination.city} (${destination.code})</b><br>${destination.name}`);
    }

    // Update full route line path
    if (fullPathRef.current) {
      fullPathRef.current.setLatLngs([startCoords, endCoords]);
    }

    // Fit map view to new bounds
    const bounds = L.latLngBounds([startCoords, endCoords]);
    mapRef.current.fitBounds(bounds, { padding: [50, 50], animate: true });

    // Force updates to plane and tracking path
    if (planeMarkerRef.current) {
      planeMarkerRef.current.setLatLng(currentCoords);
    }
    if (pathLineRef.current) {
      pathLineRef.current.setLatLngs([startCoords, currentCoords]);
    }
  }, [activeFlight.id, startCoords, endCoords]);

  // Update Plane Marker & Path when Telemetry changes
  useEffect(() => {
    if (!mapRef.current) return;

    const currentCoords = [telemetry.latitude, telemetry.longitude];

      if (planeMarkerRef.current) {
      planeMarkerRef.current.setLatLng(currentCoords);
      planeMarkerRef.current.setIcon(createPlaneIcon(telemetry.heading));
      planeMarkerRef.current.setTooltipContent(`
        <b>${activeFlight.flightNumber}</b><br>
        Status: <span style="color: var(--primary); font-weight: bold">${telemetry.status}</span><br>
        Speed: ${telemetry.speed} km/h<br>
        Alt: ${telemetry.altitude} ft
      `);
    }

    if (pathLineRef.current) {
      pathLineRef.current.setLatLngs([startCoords, currentCoords]);
    }
  }, [telemetry.latitude, telemetry.longitude, telemetry.heading, telemetry.speed, telemetry.altitude, telemetry.status, startCoords]);

  return (
    <div className="glass-panel" style={{ padding: 0, height: '420px', display: 'flex', flexDirection: 'column' }}>
      
      {/* Telemetry Header HUD Overlay */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        zIndex: 500,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px'
      }}>
        <div style={{
          background: 'var(--bg-glass)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-glass)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 14px',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Active Route</div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {activeFlight.origin} <span style={{ color: 'var(--primary)', fontSize: '0.9rem' }}>✈</span> {activeFlight.destination}
          </div>
        </div>

        {telemetry.status !== 'Scheduled' && (
          <div style={{
            background: 'var(--bg-glass)',
            backdropFilter: 'blur(8px)',
            border: '1px solid var(--border-glass)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 14px',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            gap: '12px'
          }}>
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Alt</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)' }}>{telemetry.altitude.toLocaleString()} ft</div>
            </div>
            <div style={{ borderLeft: '1px solid var(--border-glass)', paddingLeft: '12px' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Speed</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)' }}>{telemetry.speed} km/h</div>
            </div>
            <div style={{ borderLeft: '1px solid var(--border-glass)', paddingLeft: '12px' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Dist Rem</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)' }}>{telemetry.distanceRemaining} km</div>
            </div>
          </div>
        )}
      </div>

      {/* Telemetry Status RightHUD Overlay */}
      <div style={{
        position: 'absolute',
        top: '16px',
        right: '16px',
        zIndex: 500,
        pointerEvents: 'none'
      }}>
        <div style={{
          background: 'var(--bg-glass)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-glass)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 14px',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: telemetry.status === 'Landed' ? 'var(--success)' : telemetry.status === 'Scheduled' ? 'var(--text-muted)' : 'var(--primary)',
            boxShadow: telemetry.status !== 'Scheduled' && telemetry.status !== 'Landed' ? '0 0 8px var(--primary)' : 'none'
          }}></span>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase' }}>
            {telemetry.status}
          </span>
        </div>
      </div>

      {/* Map DOM Element */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', flexGrow: 1 }} />

      <style>{`
        .map-tooltip {
          background-color: var(--bg-secondary) !important;
          border: 1px solid var(--border-glass) !important;
          color: var(--text-primary) !important;
          border-radius: var(--radius-sm) !important;
          box-shadow: var(--shadow-sm) !important;
          font-family: var(--font-sans);
          font-size: 0.75rem;
          padding: 4px 8px;
          z-index: 1000 !important;
        }
        .map-tooltip::before {
          border-top-color: var(--bg-secondary) !important;
        }
        .map-tooltip-plane {
          background-color: var(--bg-primary) !important;
          border: 1.5px solid var(--primary) !important;
          color: var(--text-primary) !important;
          border-radius: var(--radius-sm) !important;
          box-shadow: 0 0 10px var(--primary-glow-weak) !important;
          font-family: var(--font-sans);
          font-size: 0.75rem;
          padding: 6px 10px;
          z-index: 1000 !important;
        }
        .map-tooltip-plane::before {
          border-top-color: var(--primary) !important;
        }
      `}</style>
    </div>
  );
}
