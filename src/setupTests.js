import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';
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
