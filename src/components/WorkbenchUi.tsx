import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Copy, Plus, Trash2, X } from 'lucide-react';
import type { Header } from '../types';

export function WorkspaceHeading({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="workbench-heading">
      <div className="workbench-heading-icon">{icon}</div>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="workbench-actions">{actions}</div>
    </header>
  );
}
export function InlineError({ message }: { message: string }) {
  return message ? (
    <div className="inline-form-error" role="alert">
      <AlertCircle size={15} />
      <span>{message}</span>
    </div>
  ) : null;
}
export function HeaderEditor({
  value,
  onChange,
  disabled = false,
  label = 'Headers',
}: {
  value: Header[];
  onChange: (headers: Header[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const update = (index: number, key: 'name' | 'value', text: string) =>
    onChange(value.map((h, i) => (i === index ? { ...h, [key]: text } : h)));
  return (
    <div className="header-editor">
      <div className="editor-field-heading">
        <span>{label}</span>
        <button
          className="text-button"
          type="button"
          disabled={disabled}
          onClick={() => onChange([...value, { name: '', value: '' }])}
        >
          <Plus size={13} /> Add header
        </button>
      </div>
      {value.length ? (
        <div className="editable-header-list">
          {value.map((header, index) => (
            <div className="editable-header-row" key={index}>
              <input
                className="text-input"
                aria-label={`Header ${index + 1} name`}
                placeholder="Header name"
                value={header.name}
                onChange={(e) => update(index, 'name', e.target.value)}
                disabled={disabled}
              />
              <input
                className="text-input"
                aria-label={`Header ${index + 1} value`}
                placeholder="Value"
                value={header.value}
                onChange={(e) => update(index, 'value', e.target.value)}
                disabled={disabled}
              />
              <button
                className="icon-button"
                title="Remove header"
                aria-label={`Remove header ${index + 1}`}
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="field-help">No headers. Repeated names are preserved in order.</p>
      )}
    </div>
  );
}
export function ModalFrame({
  children,
  title,
  subtitle,
  icon,
  onClose,
  className = '',
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const frame = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const field = frame.current?.querySelector<HTMLElement>(
      'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])',
    );
    if (field && !frame.current?.contains(document.activeElement)) field.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        frame.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ) || [],
      );
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={frame}
        className={`modal workbench-modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-heading">
          {icon || <span />}
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
        {children}
      </section>
    </div>
  );
}
export function CopyCommand({ command }: { command: string }) {
  return (
    <div className="diagnostic-command">
      <pre>{command}</pre>
      <button
        className="icon-button"
        aria-label="Copy setup command"
        onClick={() => void navigator.clipboard.writeText(command)}
      >
        <Copy size={14} />
      </button>
    </div>
  );
}
