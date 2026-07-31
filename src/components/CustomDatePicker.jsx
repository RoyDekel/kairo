import React, { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Zap } from 'lucide-react';
import { formatDateToYYYYMMDD, getTodayDateString, getTomorrowDateString } from '../utils/searchDefaults';

/** Formats ISO 'YYYY-MM-DD' date string into readable format, e.g. "Fri, 31 Jul" */
function formatDisplayDate(dateStr) {
  if (!dateStr) return 'Select date';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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

  // Parse current value into a Date object or fallback to today
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

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

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
    const selectedDateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    onChange(selectedDateStr);
    setIsOpen(false);
  };

  // Preset Shortcut Handlers
  const handleShortcut = (type) => {
    const today = new Date();
    let target = new Date();

    if (type === 'today') {
      target = today;
    } else if (type === 'tomorrow') {
      target.setDate(today.getDate() + 1);
    } else if (type === 'weekend') {
      // Find next Saturday
      const day = today.getDay();
      const diff = (6 - day + 7) % 7 || 7;
      target.setDate(today.getDate() + diff);
    } else if (type === '7days') {
      target.setDate(today.getDate() + 7);
    } else if (type === '14days') {
      target.setDate(today.getDate() + 14);
    }

    const dateStr = formatDateToYYYYMMDD(target);
    onChange(dateStr);
    setIsOpen(false);
  };

  // Generate calendar days for current view month
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayStr = getTodayDateString();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

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
          gap: '8px',
          cursor: 'pointer',
          padding: '10px 14px',
          background: 'var(--bg-tertiary, rgba(255, 255, 255, 0.04))',
          border: isOpen ? '1px solid var(--primary)' : '1px solid var(--border-glass-bright)',
          borderRadius: 'var(--radius-sm, 8px)',
          boxShadow: isOpen ? '0 0 12px var(--primary-glow-weak)' : 'none',
          transition: 'all 0.2s ease',
          textAlign: 'left'
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

      {/* POPOVER CALENDAR */}
      {isOpen && (
        <div
          className="animate-fade-in"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 900,
            width: '300px',
            background: 'var(--bg-secondary, #1e293b)',
            border: '1px solid var(--border-glass-bright, rgba(255, 255, 255, 0.15))',
            borderRadius: 'var(--radius-md, 16px)',
            boxShadow: 'var(--shadow-lg, 0 16px 32px rgba(0,0,0,0.35))',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          {/* MONTH HEADER */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              type="button"
              onClick={handlePrevMonth}
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-glass)',
                borderRadius: '50%',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              <ChevronLeft size={16} />
            </button>

            <span style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
              {monthNames[viewMonth]} {viewYear}
            </span>

            <button
              type="button"
              onClick={handleNextMonth}
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-glass)',
                borderRadius: '50%',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* QUICK PRESET SHORCUT CHIPS */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handleShortcut('today')}
              style={{
                padding: '3px 8px',
                fontSize: '0.72rem',
                fontWeight: 600,
                borderRadius: '12px',
                border: '1px solid var(--border-glass)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handleShortcut('tomorrow')}
              style={{
                padding: '3px 8px',
                fontSize: '0.72rem',
                fontWeight: 600,
                borderRadius: '12px',
                border: '1px solid var(--border-glass)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              Tomorrow
            </button>
            <button
              type="button"
              onClick={() => handleShortcut('weekend')}
              style={{
                padding: '3px 8px',
                fontSize: '0.72rem',
                fontWeight: 600,
                borderRadius: '12px',
                border: '1px solid var(--border-glass)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              Weekend
            </button>
            <button
              type="button"
              onClick={() => handleShortcut('7days')}
              style={{
                padding: '3px 8px',
                fontSize: '0.72rem',
                fontWeight: 600,
                borderRadius: '12px',
                border: '1px solid var(--border-glass)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              +7 Days
            </button>
          </div>

          {/* DAY NAMES HEADER */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', gap: '2px' }}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
              <span key={day} style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', padding: '2px 0' }}>
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
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

              const isPast = minDate && dateStr < minDate;
              const isSelected = value === dateStr;
              const isToday = dateStr === todayStr;

              // Check if inside departure-return range
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
                    height: '32px',
                    borderRadius: '8px',
                    border: isToday && !isSelected ? '1px solid var(--primary)' : 'none',
                    background: isSelected
                      ? 'linear-gradient(135deg, var(--primary), var(--secondary))'
                      : isInRange
                      ? 'var(--primary-glow-weak)'
                      : 'transparent',
                    color: isSelected
                      ? '#ffffff'
                      : isPast
                      ? 'var(--text-muted)'
                      : 'var(--text-primary)',
                    fontWeight: isSelected || isToday ? 800 : 500,
                    fontSize: '0.82rem',
                    opacity: isPast ? 0.35 : 1,
                    cursor: isPast ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
