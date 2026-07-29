import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { getPriceConfidenceInsight } from '../utils/priceConfidenceEngine';
import { buildVerdictEvidence, summariseEvidence } from '../utils/verdictEvidence';

/**
 * The page's headline answer: buy now, or wait.
 *
 * This used to be the fifth of six stacked sections inside FlightDetails, below a spec
 * sheet — on a page literally named "Should I Book?". It now leads the view full width.
 * The supporting rationale is collapsed by default so the verdict itself stays legible.
 */
export default function BuyVerdict({ activeFlight, activeRoundtrip, selectedDate }) {
  const [showRationale, setShowRationale] = useState(false);

  const insight = getPriceConfidenceInsight(activeFlight, activeFlight.price);
  const isBuy = insight.recommendation === 'BUY_NOW';

  const evidence = buildVerdictEvidence({
    flight: activeFlight,
    insight,
    departureDate: selectedDate
  });
  const { forBuy, forWait } = summariseEvidence(evidence);

  const accent = isBuy ? 'var(--success)' : 'var(--warning)';
  const accentGlow = isBuy ? 'var(--success-glow)' : 'var(--warning-glow)';

  // The server payload has no expectedDropDays, so fall back to a plain phrasing rather
  // than rendering "waiting undefined" if the local override is ever bypassed.
  const waitWindow = insight.expectedDropDays || 'a few more days';

  const roundtripTotal = activeRoundtrip?.outbound && activeRoundtrip?.return
    ? activeRoundtrip.outbound.passengerCosts.total + activeRoundtrip.return.passengerCosts.total
    : null;

  return (
    <div className="glass-panel verdict" style={{ borderLeft: `4px solid ${accent}` }}>
      <div className="verdict-main">
        <div className="verdict-label">
          <Sparkles size={14} style={{ color: 'var(--primary)' }} />
          {activeFlight.origin} → {activeFlight.destination}
        </div>

        <div className="verdict-headline" style={{ color: accent }}>
          {isBuy ? <TrendingDown size={26} /> : <TrendingUp size={26} />}
          {/* Lead with the outcome, not the feature: what this decision is worth. */}
          {isBuy
            ? 'Book now — this is the price'
            : `Save ~$${insight.expectedSavings} by waiting ${waitWindow}`}
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
          Why — {forBuy} reason{forBuy === 1 ? '' : 's'} to book, {forWait} to wait
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
                marginBottom: '12px'
              }}
            >
              {insight.personalityBadge}
            </div>

            <div className="evidence-list">
              {evidence.map((item) => (
                <div key={item.id} className={`evidence evidence-${item.direction}`}>
                  <span className="evidence-icon" aria-hidden="true">
                    {item.direction === 'buy' ? (
                      <TrendingDown size={14} />
                    ) : item.direction === 'wait' ? (
                      <TrendingUp size={14} />
                    ) : (
                      <Minus size={14} />
                    )}
                  </span>
                  <div>
                    <div className="evidence-headline">{item.headline}</div>
                    <div className="evidence-detail">{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            <p className="evidence-footnote">
              Signals are weighed together — a single reason pointing the other way doesn't
              overturn the recommendation.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
