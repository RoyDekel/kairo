import { Play, Pause, RotateCcw, Radar, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Telemetry simulator controls.
 *
 * Lives beneath the map because that is the only thing it drives. It previously sat in
 * the right-hand column with equal weight to the booking decision, and duplicated the
 * phase/speed/altitude readouts the map already renders. Collapsed by default: it's a
 * demonstration of the route, not part of deciding whether to book.
 */
export default function SimulatorPanel({
  isOpen,
  onToggleOpen,
  activeFlight,
  isSimulating,
  setIsSimulating,
  simulationProgress,
  setSimulationProgress,
  simulationSpeed,
  setSimulationSpeed
}) {
  const progressPercent = Math.round(simulationProgress * 100);

  const playLabel = isSimulating
    ? 'Pause'
    : simulationProgress >= 1
    ? 'Replay'
    : simulationProgress > 0
    ? 'Resume'
    : 'Start';

  const handlePlayToggle = () => {
    if (isSimulating) {
      setIsSimulating(false);
      return;
    }
    // Already landed: replay from the gate rather than appearing to do nothing.
    if (simulationProgress >= 1) {
      setSimulationProgress(0);
    }
    setIsSimulating(true);
  };

  return (
    <div className="sim-panel">
      <button type="button" className="sim-panel-header" onClick={onToggleOpen} aria-expanded={isOpen}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Radar size={15} style={{ color: 'var(--primary)' }} />
          Simulate this flight
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {progressPercent > 0 && (
            <span className="num" style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
              {progressPercent}%
            </span>
          )}
          {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      {isOpen && (
        <div className="sim-panel-body animate-fade-in">
          <div className="sim-track-labels">
            <span>{activeFlight.origin}</span>
            <span className="num" style={{ color: 'var(--primary)', fontWeight: 600 }}>
              {progressPercent}% Complete
            </span>
            <span>{activeFlight.destination}</span>
          </div>

          <input
            type="range"
            min="0"
            max="1"
            step="0.005"
            value={simulationProgress}
            aria-label="Flight simulation progress"
            onChange={(e) => {
              setSimulationProgress(parseFloat(e.target.value));
              setIsSimulating(false);
            }}
            className="sim-slider"
          />

          <div className="sim-controls">
            <button onClick={handlePlayToggle} className="btn btn-primary sim-play">
              {isSimulating ? <Pause size={15} /> : <Play size={15} />}
              <span>{playLabel} Simulation</span>
            </button>

            <button
              onClick={() => {
                setSimulationProgress(0);
                setIsSimulating(false);
              }}
              className="btn btn-secondary"
              style={{ width: '38px', height: '38px', padding: 0 }}
              title="Reset flight simulation"
            >
              <RotateCcw size={15} />
            </button>

            <div className="sim-speeds">
              {[1, 5, 20].map((speed) => (
                <button
                  key={speed}
                  onClick={() => setSimulationSpeed(speed)}
                  className={`sim-speed ${simulationSpeed === speed ? 'is-active' : ''}`}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
