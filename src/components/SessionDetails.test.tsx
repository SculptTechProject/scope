import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { SessionDetails } from './SessionDetails';
import type { Session } from '../types';
vi.mock('../api', () => ({ api: { update_session: vi.fn(), delete_session: vi.fn() } }));
const session: Session = {
  id: 'session-1',
  name: 'Disposable lab',
  source: 'desktop',
  createdAt: 0,
  exchangeCount: 2,
  notes: '',
  tags: [],
  pinned: false,
};
beforeEach(() => {
  vi.mocked(api.update_session).mockResolvedValue(session);
  vi.mocked(api.delete_session).mockResolvedValue(undefined);
});
describe('Session management', () => {
  it('persists name, notes, deduplicated tags and pin together', async () => {
    const updated = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionDetails
        session={session}
        active={false}
        onClose={vi.fn()}
        onUpdated={updated}
        onDeleted={vi.fn()}
      />,
    );
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Login regression');
    await user.type(screen.getByLabelText('Investigation notes'), 'Reproduced on a local fixture.');
    await user.type(screen.getByLabelText('Tags'), 'android, regression, android');
    await user.click(screen.getByLabelText('Pin in the session archive'));
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() =>
      expect(api.update_session).toHaveBeenCalledWith('session-1', {
        name: 'Login regression',
        notes: 'Reproduced on a local fixture.',
        tags: ['android', 'regression'],
        pinned: true,
      }),
    );
    expect(updated).toHaveBeenCalledWith(session);
  });
  it('requires the exact stored session name before irreversible deletion', async () => {
    const deleted = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionDetails
        session={session}
        active={false}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
        onDeleted={deleted}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Delete session' }));
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    await user.type(screen.getByLabelText('Type Disposable lab to confirm'), 'Disposable la');
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    await user.type(screen.getByLabelText('Type Disposable lab to confirm'), 'b');
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(api.delete_session).toHaveBeenCalledWith('session-1'));
    expect(deleted).toHaveBeenCalledWith('session-1');
  });
  it('does not offer deletion of the active capture', () => {
    render(
      <SessionDetails
        session={session}
        active
        onClose={vi.fn()}
        onUpdated={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete session' })).toBeDisabled();
    expect(api.delete_session).not.toHaveBeenCalled();
  });
});
