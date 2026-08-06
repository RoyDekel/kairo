import React from 'react';
import { render } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import CityLandmarkIcon from '../CityLandmarkIcon';

describe('CityLandmarkIcon Component', () => {
  test('renders landmark icon SVG for Paris (CDG)', () => {
    const { container } = render(<CityLandmarkIcon cityCode="CDG" cityName="Paris" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass('flight-destination-icon-svg');
  });

  test('renders landmark icon SVG for Bangkok (BKK)', () => {
    const { container } = render(<CityLandmarkIcon cityCode="BKK" cityName="Bangkok" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  test('renders landmark icon SVG for Tokyo (NRT)', () => {
    const { container } = render(<CityLandmarkIcon cityCode="NRT" cityName="Tokyo" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  test('renders landmark icon SVG for New York (JFK)', () => {
    const { container } = render(<CityLandmarkIcon cityCode="JFK" cityName="New York" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  test('renders fallback landmark SVG for unknown city code', () => {
    const { container } = render(<CityLandmarkIcon cityCode="XYZ" cityName="Unknown City" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
