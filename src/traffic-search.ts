import { api } from './api';
import type { Exchange } from './types';

// Keep invalid-query feedback local to the search and discard stale result rows.
// Capture actions refresh session revisions; only the guarded search effect loads rows.
export async function queryTraffic(
  sessionId: string,
  query: string,
  limit: number,
): Promise<{ rows: Exchange[]; error: string }> {
  try {
    return { rows: await api.list_exchanges(sessionId, query, limit), error: '' };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  }
}
