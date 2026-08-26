import { describe, it, expect, vi } from 'vitest';
import { Profiler } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomDatePicker from '../CustomDatePicker.jsx';

/*
  The calendar's visible month is mostly a function of the `value` prop, with one exception:
  the user can page away from it with the arrows or the month/year dropdowns. That paging is
  real state, but it is only meaningful for the `value` it was started from -- as soon as the
  date changes underneath it, the calendar must snap back to the month the new date sits in.

  That used to be an effect calling setViewYear/setViewMonth, which cost a second committed
  render on every `value` change (the trip-dates row changes both dates at once, so it cost
  two). These tests pin the snap-back behaviour, the paging behaviour, and the render
  economy. See [KAI-001].
*/

const openCalendar = (labelText) => {
  fireEvent.click(screen.getByRole('button', { name: labelText }));
};

const monthSelect = () => screen.getAllByRole('combobox')[0];
const yearSelect = () => screen.getAllByRole('combobox')[1];

// The month arrows are icon-only and carry no accessible name. Giving them one would be a
// real improvement but an unrelated change, so they are located structurally instead: they
// are the only two buttons in the popover with no text content, prev first then next.
const chevrons = () =>
  screen.getAllByRole('button').filter((b) => b.textContent.trim() === '');
const prevMonth = () => chevrons()[0];
const nextMonth = () => chevrons()[1];

function withProfiler(ui, commits) {
  return (
    <Profiler id="datepicker" onRender={(_id, phase) => commits.push(phase)}>
      {ui}
    </Profiler>
  );
}

describe('CustomDatePicker', () => {
  it('opens on the month the selected date falls in', () => {
    render(
      <CustomDatePicker label="Departure" value="2026-09-14" onChange={vi.fn()} minDate="2026-01-01" />
    );
    openCalendar('Departure');

    expect(monthSelect()).toHaveValue('8'); // September, zero-indexed
    expect(yearSelect()).toHaveValue('2026');
  });

  it('snaps the visible month to a new value in a single committed render', () => {
    const commits = [];
    const { rerender } = render(
      withProfiler(
        <CustomDatePicker label="Departure" value="2026-09-14" onChange={vi.fn()} minDate="2026-01-01" />,
        commits
      )
    );
    openCalendar('Departure');
    commits.length = 0;

    rerender(
      withProfiler(
        <CustomDatePicker label="Departure" value="2026-11-02" onChange={vi.fn()} minDate="2026-01-01" />,
        commits
      )
    );

    expect(monthSelect()).toHaveValue('10'); // November
    // One commit. Syncing the view from an effect adds a second.
    expect(commits).toEqual(['update']);
  });

  it('lets the user page forward without changing the selected date', () => {
    const onChange = vi.fn();
    render(
      <CustomDatePicker label="Departure" value="2026-09-14" onChange={onChange} minDate="2026-01-01" />
    );
    openCalendar('Departure');

    fireEvent.change(monthSelect(), { target: { value: '11' } }); // December

    expect(monthSelect()).toHaveValue('11');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rolls the year back when paging past January', () => {
    render(
      <CustomDatePicker label="Departure" value="2027-01-10" onChange={vi.fn()} minDate="2026-01-01" />
    );
    openCalendar('Departure');

    fireEvent.click(prevMonth());

    expect(monthSelect()).toHaveValue('11'); // December
    expect(yearSelect()).toHaveValue('2026');
  });

  it('rolls the year forward when paging past December', () => {
    render(
      <CustomDatePicker label="Departure" value="2026-12-10" onChange={vi.fn()} minDate="2026-01-01" />
    );
    openCalendar('Departure');

    fireEvent.click(nextMonth());

    expect(monthSelect()).toHaveValue('0'); // January
    expect(yearSelect()).toHaveValue('2027');
  });

  it('discards a browsed month once the selected date changes', () => {
    const { rerender } = render(
      <CustomDatePicker label="Departure" value="2026-09-14" onChange={vi.fn()} minDate="2026-01-01" />
    );
    openCalendar('Departure');
    fireEvent.change(monthSelect(), { target: { value: '11' } }); // paged to December
    expect(monthSelect()).toHaveValue('11');

    rerender(
      <CustomDatePicker label="Departure" value="2026-10-05" onChange={vi.fn()} minDate="2026-01-01" />
    );

    // The browse position belonged to the old date; the new one wins.
    expect(monthSelect()).toHaveValue('9'); // October
  });

  it('reports the day the user clicks in the month they paged to', () => {
    const onChange = vi.fn();
    render(
      <CustomDatePicker label="Departure" value="2026-09-14" onChange={onChange} minDate="2026-01-01" />
    );
    openCalendar('Departure');
    fireEvent.change(monthSelect(), { target: { value: '10' } }); // November

    fireEvent.click(screen.getByRole('button', { name: '20' }));

    expect(onChange).toHaveBeenCalledWith('2026-11-20');
  });
});
