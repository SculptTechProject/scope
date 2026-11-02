import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExchangeStatus } from './ExchangeStatus';
import { isExchangeError } from '../exchange-utils';
describe('Exchange lifecycle status', () => {
  it('does not label an unfinished capture as a network error', () => {
    const capture = { completed: false, error: 'upstream is still running', status: null };
    const { rerender } = render(
      <ExchangeStatus code={capture.status} error={capture.error} completed={capture.completed} />,
    );
    expect(screen.getByText('In flight')).toBeVisible();
    expect(screen.queryByText('ERR')).not.toBeInTheDocument();
    expect(isExchangeError(capture)).toBe(false);
    rerender(<ExchangeStatus code={200} error={null} completed />);
    expect(screen.getByText('200')).toBeVisible();
    expect(screen.queryByText('In flight')).not.toBeInTheDocument();
  });
  it('retains an actual completed failure in the error filter', () => {
    const capture = { completed: true, error: 'connection refused', status: null };
    render(<ExchangeStatus code={capture.status} error={capture.error} completed />);
    expect(screen.getByText('ERR')).toBeVisible();
    expect(isExchangeError(capture)).toBe(true);
  });
});
