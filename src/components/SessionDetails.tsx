import { useState } from 'react';
import { FolderArchive, LoaderCircle, Pin, Save, Trash2 } from 'lucide-react';
import { api } from '../api';
import { messageOf } from '../form-utils';
import type { Session } from '../types';
import { InlineError, ModalFrame } from './WorkbenchUi';

export function SessionDetails({
  session,
  active,
  onClose,
  onUpdated,
  onDeleted,
}: {
  session: Session;
  active: boolean;
  onClose: () => void;
  onUpdated: (session: Session) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(session.name),
    [notes, setNotes] = useState(session.notes || ''),
    [tags, setTags] = useState((session.tags || []).join(', ')),
    [pinned, setPinned] = useState(session.pinned || false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save() {
    setError('');
    if (!name.trim()) {
      setError('A session needs a name.');
      return;
    }
    setBusy(true);
    try {
      const updated = await api.update_session(session.id, {
        name: name.trim(),
        notes,
        tags: [
          ...new Set(
            tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        ],
        pinned,
      });
      onUpdated(updated);
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (active || confirmation !== session.name) return;
    setBusy(true);
    setError('');
    try {
      await api.delete_session(session.id);
      onDeleted(session.id);
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalFrame
      title="Session details"
      subtitle="Organize your saved investigation."
      icon={<FolderArchive size={22} />}
      onClose={onClose}
      className="session-details-modal"
    >
      <div className="session-metadata-strip">
        <span>{session.exchangeCount} exchanges</span>
        <span>{new Date(session.createdAt).toLocaleDateString()}</span>
        <span>{session.source}</span>
      </div>
      {confirmDelete ? (
        <div className="session-delete-confirm">
          <h3>Delete this session permanently?</h3>
          <p>
            Its captured requests, responses and notes will be removed. Export a copy first if you
            need to keep it.
          </p>
          <label className="field-label" htmlFor="confirm-session-delete">
            Type {session.name} to confirm
          </label>
          <input
            id="confirm-session-delete"
            className="text-input"
            autoFocus
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            disabled={busy}
          />
          <InlineError message={error} />
          <div className="modal-actions">
            <button className="button" disabled={busy} onClick={() => setConfirmDelete(false)}>
              Keep session
            </button>
            <button
              className="button danger"
              disabled={busy || confirmation !== session.name || active}
              onClick={() => void remove()}
            >
              <Trash2 size={14} /> Delete permanently
            </button>
          </div>
        </div>
      ) : (
        <>
          <label className="field-label" htmlFor="session-details-name">
            Name
          </label>
          <input
            id="session-details-name"
            className="text-input"
            autoFocus
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          <label className="field-label" htmlFor="session-notes">
            Investigation notes
          </label>
          <textarea
            id="session-notes"
            className="text-input session-notes"
            placeholder="What were you investigating? What did you find?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
          />
          <label className="field-label" htmlFor="session-tags">
            Tags
          </label>
          <input
            id="session-tags"
            className="text-input"
            placeholder="android, login, regression"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            disabled={busy}
          />
          <p className="field-help">Separate tags with commas.</p>
          <label className="session-pin">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              disabled={busy}
            />
            <Pin size={14} /> Pin in the session archive
          </label>
          <InlineError message={error} />
          <div className="session-details-footer">
            <div>
              <button
                className="text-button danger-text"
                disabled={busy || active}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} /> Delete session
              </button>
              {active && (
                <p className="field-help">Stop this session's capture before deleting it.</p>
              )}
            </div>
            <button className="button primary" disabled={busy} onClick={() => void save()}>
              {busy ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />} Save details
            </button>
          </div>
        </>
      )}
    </ModalFrame>
  );
}
