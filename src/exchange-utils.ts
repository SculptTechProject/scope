import type { Exchange } from './types';
export function isExchangeError(
  exchange: Pick<Exchange, 'completed' | 'error' | 'status'>,
): boolean {
  return exchange.completed !== false && (!!exchange.error || (exchange.status ?? 0) >= 400);
}
export function exchangeState(
  exchange: Pick<Exchange, 'completed' | 'error' | 'status'>,
): 'pending' | 'error' | 'complete' {
  if (exchange.completed === false) return 'pending';
  return isExchangeError(exchange) ? 'error' : 'complete';
}
