import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RuleEditor } from './RulesWorkspace';
import type { TrafficRule } from '../types';
const draft: TrafficRule = {
  id: '',
  name: '',
  enabled: true,
  priority: 10,
  matcher: {},
  action: { type: 'rewriteResponse' },
};
describe('Rule editor actions', () => {
  it('requires explicit matcher scope before enabling a traffic-changing rule', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RuleEditor rule={draft} disabled={false} onSave={save} />);
    expect(screen.getByLabelText('All traffic')).not.toBeChecked();
    await user.type(screen.getByLabelText('Rule name'), 'Scoped maintenance');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add at least one matcher');
    expect(save).not.toHaveBeenCalled();
  });
  it('saves an enabled scoped mock with its status, duplicate-preserving headers and body', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RuleEditor rule={draft} disabled={false} onSave={save} />);
    await user.type(screen.getByLabelText('Rule name'), 'Product maintenance');
    await user.selectOptions(screen.getByLabelText('Method'), 'GET');
    await user.type(screen.getByLabelText('Host'), 'api.example.com');
    await user.type(screen.getByLabelText('Path starts with'), '/api/products');
    await user.click(screen.getByRole('button', { name: 'Mock response' }));
    await user.clear(screen.getByLabelText('Response status'));
    await user.type(screen.getByLabelText('Response status'), '503');
    await user.click(screen.getByRole('button', { name: 'Add header' }));
    await user.type(screen.getByLabelText('Header 1 name'), 'content-type');
    await user.type(screen.getByLabelText('Header 1 value'), 'application/json');
    await user.click(screen.getByRole('button', { name: 'Add header' }));
    await user.type(screen.getByLabelText('Header 2 name'), 'x-test');
    await user.type(screen.getByLabelText('Header 2 value'), 'one');
    await user.click(screen.getByRole('button', { name: 'Add header' }));
    await user.type(screen.getByLabelText('Header 3 name'), 'x-test');
    await user.type(screen.getByLabelText('Header 3 value'), 'two');
    await user.click(screen.getByLabelText('Body', { exact: true }));
    await user.paste('{"error":"maintenance"}');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      id: '',
      name: 'Product maintenance',
      priority: 10,
      enabled: true,
      matcher: { method: 'GET', host: 'api.example.com', pathPrefix: '/api/products' },
      action: {
        type: 'mockResponse',
        status: 503,
        headers: [
          { name: 'content-type', value: 'application/json' },
          { name: 'x-test', value: 'one' },
          { name: 'x-test', value: 'two' },
        ],
        body: '{"error":"maintenance"}',
        bodyBase64: false,
      },
    });
  });
  it('leaves headers and body absent when only a response status is rewritten', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <RuleEditor
        rule={{ ...draft, name: 'Status only', matcher: { pathPrefix: '/api' } }}
        disabled={false}
        onSave={save}
      />,
    );
    await user.type(screen.getByLabelText('Response status'), '429');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].action).toEqual({ type: 'rewriteResponse', status: 429 });
  });
});
