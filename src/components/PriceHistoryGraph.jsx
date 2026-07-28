import React, { useState } from 'react';
import { TrendingDown, Award } from 'lucide-react';

export default function PriceHistoryGraph({ priceHistory = [] }) {
  const [hoveredNode, setHoveredNode] = useState(null);

  if (!priceHistory || priceHistory.length === 0) return null;

  // Graph Dimensions
  const svgWidth = 600;
  const svgHeight = 180;
  const padding = 35;

  const prices = priceHistory.map((d) => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  // Map data points to SVG coordinates
  const points = priceHistory.map((item, index) => {
    const x = padding + (index / (priceHistory.length - 1)) * (svgWidth - padding * 2);
    // Invert Y axis for SVG (higher price = lower Y value)
    const y = svgHeight - padding - ((item.price - minPrice) / priceRange) * (svgHeight - padding * 2);
    return { ...item, x, y };
  });

  // Create SVG path string for smooth line
  const pathD = points.reduce((acc, pt, idx) => {
    if (idx === 0) return `M ${pt.x} ${pt.y}`;
    const prev = points[idx - 1];
    const cx = (prev.x + pt.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${pt.y}, ${pt.x} ${pt.y}`;
  }, '');

  // Fill area path under curve
  const areaD = `${pathD} L ${points[points.length - 1].x} ${svgHeight - 15} L ${points[0].x} ${svgHeight - 15} Z`;

  return (
    <div style={{
      background: 'rgba(11, 15, 25, 0.6)',
      border: '1px solid var(--border-glass-bright)',
      borderRadius: 'var(--radius-md)',
      padding: '20px',
      position: 'relative'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <TrendingDown size={16} style={{ color: 'var(--success)' }} />
          <span>90-Day Price Trend History ($)</span>
        </div>

        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Award size={14} />
          90d Low: ${minPrice}
        </div>
      </div>

      {/* SVG CHART */}
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          <defs>
            <linearGradient id="kairo-chart-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00f2fe" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#00f2fe" stopOpacity="0.0" />
            </linearGradient>
            <filter id="glow-node" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Area Fill */}
          <path d={areaD} fill="url(#kairo-chart-grad)" />

          {/* Line Curve */}
          <path
            d={pathD}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Data Nodes & Markers */}
          {points.map((pt, idx) => {
            const isLowest = pt.price === minPrice;
            const isHovered = hoveredNode === idx;

            return (
              <g
                key={idx}
                onMouseEnter={() => setHoveredNode(idx)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Node Outer Ring */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? 9 : isLowest ? 7 : 5}
                  fill={isLowest ? 'var(--success)' : isHovered ? 'var(--primary)' : '#0b0f19'}
                  stroke={isLowest ? '#34d399' : 'var(--primary)'}
                  strokeWidth="3"
                  filter={isHovered || isLowest ? 'url(#glow-node)' : 'none'}
                />

                {/* Price Label above point */}
                <text
                  x={pt.x}
                  y={pt.y - 12}
                  textAnchor="middle"
                  fill={isLowest ? 'var(--success)' : 'var(--text-secondary)'}
                  fontSize={isLowest ? '12' : '10'}
                  fontWeight={isLowest ? '800' : '600'}
                >
                  ${pt.price}
                </text>

                {/* X-Axis Month Label below point */}
                <text
                  x={pt.x}
                  y={svgHeight - 2}
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="10"
                  fontWeight="600"
                >
                  {pt.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* BENCHMARK FOOTER */}
      <div style={{
        display: 'flex',
        justify: 'space-between',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        marginTop: '10px',
        paddingTop: '8px',
        borderTop: '1px dashed var(--border-glass)'
      }}>
        <span>High Peak: ${maxPrice}</span>
        <span style={{ color: 'var(--success)', fontWeight: 700 }}>
          Current Fare is {Math.round(((maxPrice - points[points.length - 1].price) / maxPrice) * 100)}% below peak
        </span>
        <span>Low Benchmark: ${minPrice}</span>
      </div>
    </div>
  );
}
