import { describe, it, expect, vi } from 'vitest';
import { Profiler } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import AirportAutocomplete from '../AirportAutocomplete.jsx';

/*
  The input label ("New York (JFK)") is a pure function of the `value` prop and whether the
  field is focused. It used to be stored in `query` state and written by an effect, which
  cost a second committed render on every mount and every `value` change -- the first render
  painted a stale/empty input, the effect then set state and React painted again.

  These tests pin both halves of the contract: the visible behaviour (label when blurred,
  free typing when focused) and the render economy (one commit, not two). See [KAI-001].
*/

function renderCounted(ui) {
  const commits = [];
  const result = render(
    <Profiler id="autocomplete" onRender={(_id, phase) => commits.push(phase)}>
      {ui}
    </Profiler>
  );
  return { ...result, commits };
}

describe('AirportAutocomplete', () => {
  it('shows the airport label for the current value on the first committed render', () => {
    const { commits } = renderCounted(
      <AirportAutocomplete id="from" label="From" value="JFK" onChange={vi.fn()} />
    );

    expect(screen.getByLabelText('From')).toHaveValue('New York (JFK)');
    // One mount commit. A setState-in-effect that rewrites the label adds a second.
    expect(commits).toEqual(['mount']);
  });

  it('does not re-commit when the value prop changes to another airport', () => {
    const { commits, rerender } = renderCounted(
      <AirportAutocomplete id="from" label="From" value="JFK" onChange={vi.fn()} />
    );
    commits.length = 0;

    rerender(
      <Profiler id="autocomplete" onRender={(_id, phase) => commits.push(phase)}>
        <AirportAutocomplete id="from" label="From" value="LHR" onChange={vi.fn()} />
      </Profiler>
    );

    expect(screen.getByLabelText('From')).toHaveValue('London (LHR)');
    expect(commits).toEqual(['update']);
  });

  it('clears the field on focus so the user can type immediately', () => {
    render(<AirportAutocomplete id="from" label="From" value="JFK" onChange={vi.fn()} />);
    const input = screen.getByLabelText('From');

    fireEvent.focus(input);

    expect(input).toHaveValue('');
  });

  it('keeps what the user typed visible while the field is focused', () => {
    render(<AirportAutocomplete id="from" label="From" value="JFK" onChange={vi.fn()} />);
    const input = screen.getByLabelText('From');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Par' } });

    expect(input).toHaveValue('Par');
  });

  it('restores the label from the value prop after blur', () => {
    vi.useFakeTimers();
    try {
      render(<AirportAutocomplete id="from" label="From" value="JFK" onChange={vi.fn()} />);
      const input = screen.getByLabelText('From');

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'nonsense' } });
      fireEvent.blur(input);
      // handleBlur defers un-focusing by 200ms so a suggestion click can land first.
      act(() => { vi.advanceTimersByTime(250); });

      expect(input).toHaveValue('New York (JFK)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the selected airport and shows its label', () => {
    const onChange = vi.fn();
    render(<AirportAutocomplete id="from" label="From" value="" onChange={onChange} />);
    const input = screen.getByLabelText('From');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'London' } });
    // Several London airports match; the code badge disambiguates Heathrow.
    fireEvent.mouseDown(screen.getByText('LHR'));

    expect(onChange).toHaveBeenCalledWith('LHR');
    expect(input).toHaveValue('London (LHR)');
  });

  it('commits a typed three-letter code without needing the suggestion list', () => {
    const onChange = vi.fn();
    render(<AirportAutocomplete id="from" label="From" value="" onChange={onChange} />);
    const input = screen.getByLabelText('From');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'cdg' } });

    expect(onChange).toHaveBeenCalledWith('CDG');
  });
});
