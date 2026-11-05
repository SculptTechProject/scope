import { describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { queryTraffic } from './traffic-search';

vi.mock('./api', () => ({ api: { list_exchanges: vi.fn() } }));

describe('Traffic query refresh', () => {
  it('returns invalid-filter feedback without rejecting a successful mutation refresh', async () => {
    vi.mocked(api.list_exchanges).mockRejectedValueOnce(new Error('Invalid search expression'));
    await expect(queryTraffic('session', 'filter:status>=', 250)).resolves.toEqual({
      rows: [],
      error: 'Invalid search expression',
    });
    expect(api.list_exchanges).toHaveBeenLastCalledWith('session', 'filter:status>=', 250);
  });

  it('clears feedback when a corrected query succeeds', async () => {
    vi.mocked(api.list_exchanges).mockResolvedValueOnce([]);
    await expect(queryTraffic('session', 'filter:status>=400', 1000)).resolves.toEqual({
      rows: [],
      error: '',
    });
  });

  it('also contains string-valued native bridge failures', async () => {
    vi.mocked(api.list_exchanges).mockRejectedValueOnce('Session not found');
    await expect(queryTraffic('missing', '', 250)).resolves.toEqual({
      rows: [],
      error: 'Session not found',
    });
  });
});
