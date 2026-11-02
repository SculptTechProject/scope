import { useCallback, useEffect, useState } from 'react';
import { Check, Clock3, Filter, LoaderCircle, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { messageOf } from '../form-utils';
import type { AuditEvent } from '../types';
import { InlineError, WorkspaceHeading } from './WorkbenchUi';

const labelOf = (value: string) =>
  value.replace(/[_.-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
export function ActivityWorkspace({ native }: { native: boolean }) {
  const [events, setEvents] = useState<AuditEvent[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [action, setAction] = useState('all'),
    [limit, setLimit] = useState(200),
    [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const load = useCallback(
    async (quiet = false) => {
      if (!native) return;
      if (!quiet) setBusy(true);
      try {
        setEvents(await api.list_audit(limit));
        setLastUpdated(Date.now());
        setError('');
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setBusy(false);
      }
    },
    [native, limit],
  );
  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 5000);
    return () => clearInterval(interval);
  }, [load]);
  const actions = [...new Set(events.map((e) => e.action))].sort();
  const filtered = events.filter(
    (e) =>
      (action === 'all' || action === e.action) &&
      `${e.action} ${e.targetId || ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="workbench-page activity-page">
      <WorkspaceHeading
        icon={<Clock3 size={24} />}
        title="Activity trail"
        subtitle="A local record of changes to your debugging workspace."
        actions={
          <button className="button" onClick={() => void load()} disabled={!native || busy}>
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> Refresh
          </button>
        }
      />
      <InlineError message={error} />
      <div className="activity-privacy">
        <ShieldCheck size={17} />
        <p>
          Metadata only. Request bodies, headers, credentials and response contents are not included
          in the activity trail.
        </p>
        <span>
          {lastUpdated
            ? `Updated ${new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'Local engine'}
        </span>
      </div>
      <div className="workbench-surface activity-surface">
        <div className="activity-toolbar">
          <label className="search-field">
            <Search size={15} />
            <input
              aria-label="Search activity"
              placeholder="Find an action or resource…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <Filter size={13} />
          <select
            className="status-select"
            aria-label="Filter activity action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="all">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {labelOf(a)}
              </option>
            ))}
          </select>
        </div>
        <table className="audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Event</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((event) => (
              <tr key={event.id}>
                <td>
                  <strong>
                    {new Date(event.createdAt).toLocaleTimeString([], { hour12: false })}
                  </strong>
                  <small>
                    {new Date(event.createdAt).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </small>
                </td>
                <td>
                  <span className="audit-action">
                    <Check size={12} />
                    {labelOf(event.action)}
                  </span>
                </td>
                <td>
                  <code>{event.targetId || 'Workspace'}</code>
                </td>
                <td>
                  <code className="muted-code">{event.id.slice(0, 8)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="operation-empty">
            {busy ? <LoaderCircle size={24} className="spin" /> : <Clock3 size={28} />}
            <h3>
              {query || action !== 'all'
                ? 'No matching activity'
                : 'Your workspace history starts here.'}
            </h3>
            <p>
              {native
                ? 'Session changes, rule updates and other actions appear after they occur.'
                : 'Open the native desktop app to read its activity trail.'}
            </p>
          </div>
        )}
        {events.length >= limit && (
          <button
            className="load-more"
            onClick={() => setLimit((n) => Math.min(2000, n + 200))}
            disabled={limit >= 2000 || busy}
          >
            Load older events
          </button>
        )}
        <footer className="activity-footer">
          <Clock3 size={12} />
          {filtered.length} events shown<span>Stored on this computer</span>
        </footer>
      </div>
    </section>
  );
}
