import '@testing-library/jest-dom';
import { vi, beforeEach, beforeAll, afterAll } from 'vitest';
import React from 'react';

// Clear localStorage between runs
beforeEach(() => {
  window.localStorage.clear();
});

// Mock Leaflet
const mockMap = {
  setView: vi.fn().mockReturnThis(),
  fitBounds: vi.fn().mockReturnThis(),
  remove: vi.fn(),
  off: vi.fn(),
};

const mockLayer = {
  addTo: vi.fn().mockReturnThis(),
  setUrl: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

const mockMarker = {
  addTo: vi.fn().mockReturnThis(),
  setLatLng: vi.fn().mockReturnThis(),
  setIcon: vi.fn().mockReturnThis(),
  bindTooltip: vi.fn().mockReturnThis(),
  setTooltipContent: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

const mockPolyline = {
  addTo: vi.fn().mockReturnThis(),
  setLatLngs: vi.fn().mockReturnThis(),
  setStyle: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

vi.mock('leaflet', () => ({
  default: {
    map: vi.fn(() => mockMap),
    tileLayer: vi.fn(() => mockLayer),
    marker: vi.fn(() => mockMarker),
    polyline: vi.fn(() => mockPolyline),
    divIcon: vi.fn((options) => options),
    latLngBounds: vi.fn((bounds) => bounds),
    control: {
      zoom: vi.fn(() => mockLayer)
    }
  }
}));

// Mock Chart.js
vi.mock('chart.js', () => ({
  Chart: {
    register: vi.fn(),
  },
  CategoryScale: vi.fn(),
  LinearScale: vi.fn(),
  PointElement: vi.fn(),
  LineElement: vi.fn(),
  Title: vi.fn(),
  Tooltip: vi.fn(),
  Legend: vi.fn(),
  Filler: vi.fn(),
}));

// Mock react-chartjs-2
vi.mock('react-chartjs-2', () => ({
  Line: ({ data, options }) => {
    return React.createElement(
      'div',
      { 'data-testid': 'mock-line-chart' },
      `Mock Chart.js Line Chart (datapoints: ${data.datasets[0].data.length})`
    );
  },
}));

// Filter out expected offline network fallback console logs in unit tests
const originalWarn = console.warn;
const originalError = console.error;

console.warn = (...args) => {
  const fullText = args.map((a) => (typeof a === 'string' ? a : a?.stack || a?.message || String(a))).join(' ');
  if (
    fullText.includes('Failed to fetch') ||
    fullText.includes('Event intelligence service unavailable') ||
    fullText.includes('Could not upgrade estimate') ||
    fullText.includes('sticking with local simulation defaults') ||
    fullText.includes('ECONNREFUSED') ||
    fullText.includes('fetch failed')
  ) {
    return;
  }
  originalWarn(...args);
};

console.error = (...args) => {
  const fullText = args.map((a) => (typeof a === 'string' ? a : a?.stack || a?.message || String(a))).join(' ');
  if (
    fullText.includes('Failed to load') ||
    fullText.includes('Failed to save') ||
    fullText.includes('invalid input syntax for type uuid') ||
    fullText.includes('ECONNREFUSED') ||
    fullText.includes('fetch failed')
  ) {
    return;
  }
  originalError(...args);
};


