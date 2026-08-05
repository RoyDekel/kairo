import React, { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { getTodayDateString } from '../utils/searchDefaults';

/** Formats ISO 'YYYY-MM-DD' date string into readable format, e.g. "Fri, 31 Jul 2026" */
function formatDisplayDate(dateStr) {
  if (!dateStr) return 'Select date';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CustomDatePicker({
  label,
  value,
  onChange,
  minDate = getTodayDateString(),
  relatedDate = null,
  isReturnDate = false,
  placeholder = 'Select date'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Initial view year and month based on value or today
  const initialDate = value ? new Date(value + 'T00:00:00') : new Date();
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth()); // 0 - 11

  // Synchronize view year/month when value changes externally
  useEffect(() => {
    if (value) {
      const parts = value.split('-');
      if (parts.length === 3) {
        setViewYear(Number(parts[0]));
        setViewMonth(Number(parts[1]) - 1);
      }
    }
  }, [value]);

  // Close popover when clicking outside or pressing Escape
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear + i);

  const handlePrevMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((prev) => prev - 1);
    } else {
      setViewMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((prev) => prev + 1);
    } else {
      setViewMonth((prev) => prev + 1);
    }
  };

  const handleSelectDay = (dayNum) => {
    const monthStr = String(viewMonth + 1).padStart(2, '0');
    const dayStr = String(dayNum).padStart(2, '0');
    const selectedDateStr = `${viewYear}-${monthStr}-${dayStr}`;
    onChange(selectedDateStr);
    setIsOpen(false);
  };

  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayStr = getTodayDateString();

  return (
    <div ref={containerRef} className="input-group" style={{ position: 'relative', width: '100%' }}>
      {label && <label className="input-label">{label}</label>}

      {/* TRIGGER BUTTON */}
      <button
        type="button"
        aria-label={label || placeholder}
        placeholder={placeholder}
        onClick={() => setIsOpen(!isOpen)}
        className="input-field"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          cursor: 'pointer',
          padding: '0 14px',
          background: 'var(--bg-tertiary, rgba(255, 255, 255, 0.04))',
          border: isOpen ? '1px solid var(--primary)' : '1px solid var(--border-glass-bright)',
          borderRadius: 'var(--radius-sm, 8px)',
          boxShadow: isOpen ? '0 0 12px var(--primary-glow-weak)' : 'none',
          transition: 'all 0.2s ease',
          textAlign: 'left',
          width: '100%',
          boxSizing: 'border-box',
          height: '46px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          <Calendar size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <span style={{
            fontSize: '0.9rem',
            fontWeight: value ? 700 : 500,
            color: value ? 'var(--text-primary)' : 'var(--text-muted)',
            whiteSpace: 'nowrap'
          }}>
            {value ? formatDisplayDate(value) : placeholder}
          </span>
        </div>
      </button>

      {/* CALENDAR POPOVER MODAL */}
      {isOpen && (
        <>
          <div
            className="mobile-only-backdrop"
            onClick={() => setIsOpen(false)}
          />
          <div
            className="animate-fade-in date-picker-popover"
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: isReturnDate ? 'auto' : 0,
              right: isReturnDate ? 0 : 'auto',
              zIndex: 'var(--z-popover)',
              width: '310px',
              maxWidth: 'calc(100vw - 32px)',
              background: 'var(--bg-secondary, #1e293b)',
              border: '1px solid var(--border-glass-bright, rgba(255, 255, 255, 0.25))',
              borderRadius: '16px',
              boxShadow: 'var(--shadow-lg, 0 20px 40px rgba(0, 0, 0, 0.4))',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
          {/* HEADER: MONTH & YEAR SELECTORS + PREV/NEXT BUTTONS */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <button
              type="button"
              onClick={handlePrevMonth}
              title="Previous month"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-glass)',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                flexShrink: 0
              }}
            >
              <ChevronLeft size={18} />
            </button>

            {/* MONTH & YEAR DROPDOWNS */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(Number(e.target.value))}
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  padding: '4px 6px',
                  cursor: 'pointer'
                }}
              >
                {monthNames.map((mName, idx) => (
                  <option key={mName} value={idx} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                    {mName}
                  </option>
                ))}
              </select>

              <select
                value={viewYear}
                onChange={(e) => setViewYear(Number(e.target.value))}
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  padding: '4px 6px',
                  cursor: 'pointer'
                }}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              title="Next month"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-glass)',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                flexShrink: 0
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* DAY NAMES HEADER */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', gap: '2px' }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <span key={day} style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', padding: '4px 0' }}>
                {day}
              </span>
            ))}
          </div>

          {/* CALENDAR DAYS GRID */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
            {/* Empty slots before day 1 */}
            {Array.from({ length: firstDayOfMonth }).map((_, idx) => (
              <div key={`empty-${idx}`} />
            ))}

            {/* Days 1..N */}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const dayNum = idx + 1;
              const monthStr = String(viewMonth + 1).padStart(2, '0');
              const dayStr = String(dayNum).padStart(2, '0');
              const dateStr = `${viewYear}-${monthStr}-${dayStr}`;

              const isPast = minDate && dateStr < minDate;
              const isSelected = value === dateStr;
              const isToday = dateStr === todayStr;

              // Check range highlight
              let isInRange = false;
              if (relatedDate && value) {
                const start = isReturnDate ? relatedDate : value;
                const end = isReturnDate ? value : relatedDate;
                if (start && end && dateStr > start && dateStr < end) {
                  isInRange = true;
                }
              }

              return (
                <button
                  key={`day-${dayNum}`}
                  type="button"
                  disabled={isPast}
                  onClick={() => handleSelectDay(dayNum)}
                  style={{
                    height: '34px',
                    borderRadius: '8px',
                    border: isToday && !isSelected ? '1.5px solid var(--primary)' : 'none',
                    background: isSelected
                      ? 'linear-gradient(135deg, var(--primary), var(--secondary))'
                      : isInRange
                      ? 'var(--primary-glow-weak)'
                      : 'var(--bg-tertiary, rgba(255, 255, 255, 0.04))',
                    color: isSelected
                      ? '#ffffff'
                      : isPast
                      ? 'var(--text-muted)'
                      : 'var(--text-primary)',
                    fontWeight: isSelected || isToday ? 800 : 600,
                    fontSize: '0.85rem',
                    opacity: isPast ? 0.3 : 1,
                    cursor: isPast ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: isSelected ? '0 2px 8px var(--primary-glow-weak)' : 'none'
                  }}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
