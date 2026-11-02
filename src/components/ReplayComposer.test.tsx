import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReplayComposer } from './ReplayComposer';
import type { Exchange } from '../types';
const exchange: Exchange = {
  id: 'request-1',
  sessionId: 'session-1',
  method: 'GET',
  url: 'https://api.example.com/products',
  requestHeaders: [{ name: 'x-trace', value: 'original' }],
  responseHeaders: [],
  requestBody: '',
  responseBody: '{}',
  requestBodyBase64: false,
  responseBodyBase64: false,
  status: 200,
  startedAt: 0,
  durationMs: 10,
  requestBytes: 0,
  responseBytes: 2,
  error: null,
  edited: false,
  completed: true,
};
describe('Replay composer', () => {
  it('sends edited method, URL, headers and body only after explicit Send', async () => {
    const send = vi.fn(),
      close = vi.fn();
    const user = userEvent.setup();
    render(<ReplayComposer exchange={exchange} onSend={send} onClose={close} />);
    expect(screen.getByText(/Manual proxy breakpoints do not pause replay/)).toBeVisible();
    await user.clear(screen.getByLabelText('Method'));
    await user.type(screen.getByLabelText('Method'), 'POST');
    await user.clear(screen.getByLabelText('Request URL'));
    await user.type(screen.getByLabelText('Request URL'), 'https://api.example.com/cart');
    await user.clear(screen.getByLabelText('Header 1 value'));
    await user.type(screen.getByLabelText('Header 1 value'), 'edited');
    await user.click(screen.getByRole('button', { name: 'Body' }));
    await user.click(screen.getByLabelText('Request body'));
    await user.paste('{"sku":"demo"}');
    expect(send).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(send).toHaveBeenCalledWith({
      action: 'continue',
      method: 'POST',
      url: 'https://api.example.com/cart',
      headers: [{ name: 'x-trace', value: 'edited' }],
      body: '{"sku":"demo"}',
      bodyBase64: false,
    });
    expect(exchange.requestHeaders[0].value).toBe('original');
    expect(exchange.method).toBe('GET');
  });
  it('rejects non-HTTP destinations and sends nothing on cancel', async () => {
    const send = vi.fn(),
      close = vi.fn();
    const user = userEvent.setup();
    render(<ReplayComposer exchange={exchange} onSend={send} onClose={close} />);
    await user.clear(screen.getByLabelText('Request URL'));
    await user.type(screen.getByLabelText('Request URL'), 'file:///private');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only HTTP and HTTPS');
    expect(send).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });
});
