import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrafficSearchHelp } from './TrafficSearchHelp';

describe('Traffic search help', () => {
  it('lets a user apply a working combined filter from the help', () => {
    const select = vi.fn();
    render(<TrafficSearchHelp error="" onSelect={select} />);
    fireEvent.click(screen.getByText('Search syntax'));
    fireEvent.click(screen.getByRole('button', { name: /^Failed POST requests:/ }));
    expect(select).toHaveBeenCalledExactlyOnceWith('filter: method=POST status>=400');
    expect(screen.getByText(/All conditions must match/)).toBeInTheDocument();
    expect(screen.getByText(/text:filter:/)).toBeInTheDocument();
  });

  it('shows invalid-query feedback outside the collapsed help and clears it on recovery', () => {
    const { rerender } = render(
      <TrafficSearchHelp error="Invalid traffic filter operator" onSelect={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid traffic filter operator');
    rerender(<TrafficSearchHelp error="" onSelect={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
