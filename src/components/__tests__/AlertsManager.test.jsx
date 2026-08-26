import { describe, it, expect, vi } from 'vitest';
import { Profiler } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AlertsManager from '../AlertsManager.jsx';

/*
  The alert delivery address ("channel target") is not a fact of its own: it is whichever of
  the two saved credentials -- Telegram chat ID or email address -- the currently selected
  channel points at. It used to be a fourth state slot kept in step with the other three by
  an effect, so every channel switch, and every mount that found a saved chat ID in
  localStorage, committed a second render to reach a value already derivable during the
  first.

  These tests pin the switching behaviour, the persistence behaviour, and the render economy.
  See [KAI-001].
*/

const activeFlight = { flightNumber: 'BA249', price: 640, route: 'LHR-TLV' };

const emailInput = () => screen.getByPlaceholderText('you@example.com');
const chatIdInput = () => screen.getByPlaceholderText('e.g. 1498739130');
const channelButton = (name) => screen.getByRole('button', { name });

function renderManager(commits) {
  const ui = (
    <AlertsManager
      alerts={[]}
      setAlerts={vi.fn()}
      notifications={[]}
      setNotifications={vi.fn()}
      activeFlight={activeFlight}
      // No token: the server-alerts effect returns early, so nothing hits the network.
      accessToken={null}
    />
  );
  if (!commits) return render(ui);
  return render(
    <Profiler id="alerts" onRender={(_id, phase) => commits.push(phase)}>
      {ui}
    </Profiler>
  );
}

describe('AlertsManager channel target', () => {
  it('settles a saved Telegram chat ID in a single committed render', () => {
    localStorage.setItem('kairo_telegram_chat_id', '1498739130');

    const commits = [];
    renderManager(commits);

    expect(screen.getByText('1498739130')).toBeInTheDocument();
    // One mount commit. Mirroring the credential into a separate slot from an effect adds a
    // second -- and here it is invisible work: the connected card reads the credential
    // directly, so the extra pass changes nothing on screen at all.
    expect(commits).toEqual(['mount']);
  });

  it('swaps to the saved email address in a single commit when the channel changes', () => {
    localStorage.setItem('kairo_telegram_chat_id', '1498739130');
    localStorage.setItem('kairo_email_address', 'roy@example.com');

    const commits = [];
    renderManager(commits);
    commits.length = 0;

    fireEvent.click(channelButton(/Email/));

    expect(emailInput()).toHaveValue('roy@example.com');
    expect(commits).toEqual(['update']);
  });

  it('carries a typed chat ID back and forth across a channel switch', () => {
    renderManager();

    fireEvent.change(chatIdInput(), { target: { value: '1498739130' } });
    expect(screen.getByText('1498739130')).toBeInTheDocument();

    fireEvent.click(channelButton(/Email/));
    expect(emailInput()).toHaveValue('');

    fireEvent.click(channelButton(/Telegram/));
    expect(screen.getByText('1498739130')).toBeInTheDocument();
  });

  it('keeps each channel\'s address independent', () => {
    renderManager();

    fireEvent.click(channelButton(/Email/));
    fireEvent.change(emailInput(), { target: { value: 'roy@example.com' } });

    fireEvent.click(channelButton(/Telegram/));
    fireEvent.change(chatIdInput(), { target: { value: '999' } });

    fireEvent.click(channelButton(/Email/));
    expect(emailInput()).toHaveValue('roy@example.com');
  });

  it('persists the typed address to localStorage under its own key', () => {
    renderManager();

    fireEvent.click(channelButton(/Email/));
    fireEvent.change(emailInput(), { target: { value: 'roy@example.com' } });

    expect(localStorage.getItem('kairo_email_address')).toBe('roy@example.com');
    expect(localStorage.getItem('kairo_telegram_chat_id')).toBeNull();
  });

  it('refuses a price-drop alert when the selected channel has no address', () => {
    const { container } = renderManager();

    fireEvent.click(channelButton(/Email/));
    // Submitted on the form rather than by clicking the button: jsdom will not run a
    // form's submit algorithm from a synthetic click on a submit control.
    fireEvent.submit(container.querySelector('form'));

    expect(
      screen.getByText(/Enter an email address so the alert can reach you/i)
    ).toBeInTheDocument();
  });
});
