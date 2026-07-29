import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, TrendingDown, TrendingUp } from 'lucide-react';
import { getPriceConfidenceInsight } from '../utils/priceConfidenceEngine';

/**
 * The page's headline answer: buy now, or wait.
 *
 * This used to be the fifth of six stacked sections inside FlightDetails, below a spec
 * sheet — on a page literally named "Should I Book?". It now leads the view full width.
 * The supporting rationale is collapsed by default so the verdict itself stays legible.
 */
export default function BuyVerdict({ activeFlight, activeRoundtrip }) {
  const [showRationale, setShowRationale] = useState(false);

  const insight = getPriceConfidenceInsight(activeFlight, activeFlight.price);
  const isBuy = insight.recommendation === 'BUY_NOW';

  const accent = isBuy ? 'var(--success)' : 'var(--warning)';
  const accentGlow = isBuy ? 'var(--success-glow)' : 'var(--warning-glow)';

  const roundtripTotal = activeRoundtrip?.outbound && activeRoundtrip?.return
    ? activeRoundtrip.outbound.passengerCosts.total + activeRoundtrip.return.passengerCosts.total
    : null;

  return (
    <div className="glass-panel verdict" style={{ borderLeft: `4px solid ${accent}` }}>
      <div className="verdict-main">
        <div className="verdict-label">
          <Sparkles size={14} style={{ color: 'var(--primary)' }} />
          KAIRO buy timing
        </div>

        <div className="verdict-headline" style={{ color: accent }}>
          {isBuy ? <TrendingDown size={26} /> : <TrendingUp size={26} />}
          {insight.actionHeadline}
        </div>

        <p className="verdict-summary">{insight.summary}</p>
      </div>

      <div className="verdict-stats">
        <div className="verdict-stat">
          <div className="verdict-stat-label">This fare</div>
          <div className="verdict-stat-value num" style={{ color: 'var(--primary)' }}>
            ${activeFlight.price}
          </div>
          <div className="verdict-stat-note">per adult</div>
        </div>

        {roundtripTotal !== null && (
          <div className="verdict-stat">
            <div className="verdict-stat-label">Roundtrip total</div>
            <div className="verdict-stat-value num">${roundtripTotal}</div>
            <div className="verdict-stat-note">all passengers</div>
          </div>
        )}

        <div className="verdict-stat">
          <div className="verdict-stat-label">90-day range</div>
          <div className="verdict-stat-value num" style={{ fontSize: '1.1rem' }}>
            ${insight.low90Day} – ${insight.high90Day}
          </div>
          <div className="verdict-stat-note">
            {insight.confidenceStars} {insight.confidenceScore}% confidence
          </div>
        </div>
      </div>

      <div className="verdict-rationale">
        <button
          type="button"
          onClick={() => setShowRationale((prev) => !prev)}
          className="verdict-rationale-toggle"
          aria-expanded={showRationale}
        >
          Why KAIRO thinks this
          {showRationale ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showRationale && (
          <div className="verdict-rationale-body animate-fade-in">
            <div
              style={{
                fontSize: '0.82rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                background: accentGlow,
                marginBottom: '10px'
              }}
            >
              {insight.personalityBadge}
            </div>
            <div className="verdict-pillars">
              {insight.rationalePillars.map((pillar) => (
                <div key={pillar} className="verdict-pillar">
                  <span style={{ color: 'var(--success)' }}>✓</span> {pillar}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
