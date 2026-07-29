import React, { useState } from 'react';

export default function PriceHistoryGraph({ priceHistory = [] }) {
  const [hoveredNode, setHoveredNode] = useState(null);

  if (!priceHistory || priceHistory.length === 0) return null;

  // Graph Dimensions & Layout Padding
  const svgWidth = 600;
  const svgHeight = 180;
  
  const padLeft = 52;
  const padRight = 16;
  const padTop = 24;
  const padBottom = 32;

  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;

  const prices = priceHistory.map((d) => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const midPrice = Math.round((minPrice + maxPrice) / 2);
  const priceRange = maxPrice - minPrice || 1;

  const todayPrice = prices[prices.length - 1];
  const savingsBelowPeakPct = Math.round(((maxPrice - todayPrice) / maxPrice) * 100);

  // Map data points to SVG coordinates
  const points = priceHistory.map((item, index) => {
    const x = padLeft + (index / (priceHistory.length - 1)) * plotWidth;
    const y = (padTop + plotHeight) - ((item.price - minPrice) / priceRange) * plotHeight;
    return { ...item, x, y };
  });

  // Create SVG path string for smooth cubic curve
  const pathD = points.reduce((acc, pt, idx) => {
    if (idx === 0) return `M ${pt.x} ${pt.y}`;
    const prev = points[idx - 1];
    const cx = (prev.x + pt.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${pt.y}, ${pt.x} ${pt.y}`;
  }, '');

  // Fill area path under curve
  const areaD = `${pathD} L ${points[points.length - 1].x} ${padTop + plotHeight} L ${points[0].x} ${padTop + plotHeight} Z`;

  // Good price band: bottom 20% of price range
  const bandHeight = plotHeight * 0.20;
  const bandY = (padTop + plotHeight) - bandHeight;

  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid var(--border-glass)',
      borderRadius: 'var(--radius-md)',
      padding: '20px 20px 16px',
      boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)'
    }}>
      {/* HEADER SECTION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Price over the last 90 days
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Tel Aviv → Tokyo, roundtrip
          </div>
        </div>

        {/* LEGEND INDICATORS */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
            <span>90-day low</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }}></span>
            <span>Today</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '12px', height: '8px', borderRadius: '2px', background: 'rgba(16, 185, 129, 0.18)', display: 'inline-block' }}></span>
            <span>Good price</span>
          </div>
        </div>
      </div>

      {/* SVG CHART */}
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          <defs>
            <linearGradient id="kairo-chart-grad-light" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Good price band rect */}
          <rect
            x={padLeft}
            y={bandY}
            width={plotWidth}
            height={bandHeight}
            fill="rgba(16, 185, 129, 0.09)"
          />

          {/* Gridlines */}
          <line x1={padLeft} y1={padTop} x2={padLeft + plotWidth} y2={padTop} stroke="rgba(15, 23, 42, 0.08)" strokeDasharray="3 3" />
          <line x1={padLeft} y1={padTop + plotHeight / 2} x2={padLeft + plotWidth} y2={padTop + plotHeight / 2} stroke="rgba(15, 23, 42, 0.08)" strokeDasharray="3 3" />
          <line x1={padLeft} y1={padTop + plotHeight} x2={padLeft + plotWidth} y2={padTop + plotHeight} stroke="rgba(15, 23, 42, 0.08)" strokeDasharray="3 3" />

          {/* Y-Axis Price Labels */}
          <text className="num" x={padLeft - 8} y={padTop + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10" fontWeight="500">${maxPrice}</text>
          <text className="num" x={padLeft - 8} y={padTop + plotHeight / 2 + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10" fontWeight="500">${midPrice}</text>
          <text className="num" x={padLeft - 8} y={padTop + plotHeight + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10" fontWeight="500">${minPrice}</text>

          {/* Area Fill */}
          <path d={areaD} fill="url(#kairo-chart-grad-light)" />

          {/* Line Curve */}
          <path
            d={pathD}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Data Nodes & Value Callout Badges */}
          {points.map((pt, idx) => {
            const isLowest = pt.isLowest || pt.price === minPrice;
            const isToday = idx === points.length - 1;
            const isHovered = hoveredNode === idx;

            return (
              <g
                key={idx}
                onMouseEnter={() => setHoveredNode(idx)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Node Circle */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isLowest || isToday ? 6 : (isHovered ? 5 : 3.5)}
                  fill={isLowest ? '#10b981' : isToday ? '#f59e0b' : '#ffffff'}
                  stroke={isLowest ? '#10b981' : isToday ? '#f59e0b' : 'var(--primary)'}
                  strokeWidth="2.5"
                />

                {/* Callout Badge for Lowest Node ($718) */}
                {isLowest && (
                  <g>
                    <rect
                      x={pt.x - 22}
                      y={pt.y - 23}
                      width="44"
                      height="18"
                      rx="5"
                      fill="#ffffff"
                      stroke="#059669"
                      strokeWidth="1.5"
                    />
                    <text
                      className="num"
                      x={pt.x}
                      y={pt.y - 10}
                      textAnchor="middle"
                      fill="#059669"
                      fontSize="11"
                      fontWeight="600"
                    >
                      ${pt.price}
                    </text>
                  </g>
                )}

                {/* Callout Badge for Today Node ($814) */}
                {isToday && (
                  <g>
                    <rect
                      x={pt.x - 22}
                      y={pt.y - 23}
                      width="44"
                      height="18"
                      rx="5"
                      fill="#ffffff"
                      stroke="#b45309"
                      strokeWidth="1.5"
                    />
                    <text
                      className="num"
                      x={pt.x}
                      y={pt.y - 10}
                      textAnchor="middle"
                      fill="#b45309"
                      fontSize="11"
                      fontWeight="600"
                    >
                      ${pt.price}
                    </text>
                  </g>
                )}

                {/* X-Axis Date Label below node */}
                <text
                  x={pt.x}
                  y={172}
                  textAnchor="middle"
                  fill={isLowest || isToday ? 'var(--text-secondary)' : 'var(--text-muted)'}
                  fontSize="10"
                  fontWeight={isLowest || isToday ? '700' : '500'}
                >
                  {pt.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* FOOTER METRIC BREAKDOWN (3 COLUMNS) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px',
        marginTop: '16px',
        paddingTop: '14px',
        borderTop: '1px solid var(--border-glass)'
      }}>
        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Peak</div>
          <div className="num" style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>${maxPrice}</div>
        </div>

        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>90-Day Low</div>
          <div className="num" style={{ fontSize: '1rem', fontWeight: 600, color: '#059669', marginTop: '2px' }}>${minPrice}</div>
        </div>

        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', flexWrap: 'nowrap' }}>
            <span className="num" style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>${todayPrice}</span>
            <span className="num" style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '12px',
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              color: '#059669',
              whiteSpace: 'nowrap'
            }}>
              {savingsBelowPeakPct}% below peak
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
