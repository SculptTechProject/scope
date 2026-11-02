import { useState } from 'react';
import { ArrowRight, Info, Send } from 'lucide-react';
import { messageOf, validateHeaders, validateMethod, validateUrl } from '../form-utils';
import type { EditMessage, Exchange, Header } from '../types';
import { HeaderEditor, InlineError, ModalFrame } from './WorkbenchUi';

export function ReplayComposer({
  exchange,
  onClose,
  onSend,
  disabled = false,
}: {
  exchange: Exchange;
  onClose: () => void;
  onSend: (edit: EditMessage) => void;
  disabled?: boolean;
}) {
  const [method, setMethod] = useState(exchange.method),
    [url, setUrl] = useState(exchange.url),
    [headers, setHeaders] = useState<Header[]>(exchange.requestHeaders.map((h) => ({ ...h }))),
    [body, setBody] = useState(exchange.requestBody),
    [base64, setBase64] = useState(exchange.requestBodyBase64),
    [tab, setTab] = useState<'headers' | 'body'>('headers'),
    [error, setError] = useState('');
  function send() {
    setError('');
    try {
      validateMethod(method.trim());
      validateUrl(url.trim());
      validateHeaders(headers);
      onSend({
        action: 'continue',
        method: method.trim().toUpperCase(),
        url: url.trim(),
        headers,
        body,
        bodyBase64: base64,
      });
    } catch (e) {
      setError(messageOf(e));
    }
  }
  return (
    <ModalFrame
      title="Replay composer"
      subtitle="Edit this request before sending it again."
      icon={<Send size={22} />}
      onClose={onClose}
      className="replay-composer"
    >
      <div className="composer-destination">
        <div>
          <label className="field-label" htmlFor="replay-method">
            Method
          </label>
          <input
            id="replay-method"
            className="text-input"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="replay-url">
            Request URL
          </label>
          <input
            id="replay-url"
            className="text-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="info-callout composer-semantics">
        <Info size={16} />
        <p>
          Sends a new outbound request using the current traffic rules. Manual proxy breakpoints do
          not pause replay. The original captured request stays in your session.
        </p>
      </div>
      <div className="composer-tabs">
        <button
          type="button"
          className={tab === 'headers' ? 'selected' : ''}
          onClick={() => setTab('headers')}
        >
          Headers <span>{headers.length}</span>
        </button>
        <button
          type="button"
          className={tab === 'body' ? 'selected' : ''}
          onClick={() => setTab('body')}
        >
          Body
        </button>
      </div>
      <div className="composer-editor">
        {tab === 'headers' ? (
          <>
            <HeaderEditor value={headers} onChange={setHeaders} disabled={disabled} />
            <p className="field-help">
              Repeated headers are preserved. Host, content length and hop-by-hop transport headers
              are normalized when sending.
            </p>
          </>
        ) : (
          <>
            <div className="editor-field-heading">
              <label htmlFor="replay-body">Request body</label>
              <label className="field-check compact">
                <input
                  type="checkbox"
                  checked={base64}
                  onChange={(e) => setBase64(e.target.checked)}
                  disabled={disabled}
                />{' '}
                Binary as base64
              </label>
            </div>
            <textarea
              id="replay-body"
              className="code-editor"
              value={body}
              spellCheck={false}
              onChange={(e) => setBody(e.target.value)}
              disabled={disabled}
            />
          </>
        )}
      </div>
      <InlineError message={error} />
      <footer className="modal-actions composer-actions">
        <span>
          New exchange <ArrowRight size={12} /> Same session
        </span>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="button primary" onClick={send} disabled={disabled}>
          <Send size={14} /> Send request
        </button>
      </footer>
    </ModalFrame>
  );
}
