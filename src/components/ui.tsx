import { useEffect, useId, useRef, type CSSProperties, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';

export function Button({
  variant = 'default',
  size,
  busy = false,
  icon,
  block,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'lg';
  busy?: boolean;
  icon?: IconName;
  block?: boolean;
}) {
  const cls = [
    'btn',
    variant !== 'default' ? `btn-${variant}` : '',
    size ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    !children ? 'icon-btn' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ to, icon, children, variant = 'default', size }: { to: string; icon?: IconName; children: ReactNode; variant?: Variant; size?: 'sm' | 'lg' }) {
  return (
    <Link to={to} className={['btn', variant !== 'default' ? `btn-${variant}` : '', size ? `btn-${size}` : ''].join(' ')}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className = '',
  htmlFor,
  extra,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  extra?: ReactNode;
}) {
  return (
    <div className={`field ${className}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
        {extra}
      </div>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function TextInput({ invalid, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={`input ${className}`} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`select ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} {...rest} />;
}

/** Decimal input with ₹ prefix and optional unit suffix. Keeps the raw string; parse with domain/money. */
export function AmountInput({
  value,
  onChange,
  prefix = '₹',
  suffix,
  invalid,
  id,
  placeholder = '0',
  disabled,
  className = '',
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  prefix?: string | null;
  suffix?: string;
  invalid?: boolean;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="affix">
      {prefix && <span>{prefix}</span>}
      <input
        id={id}
        className={`input ${className}`}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
      />
      {suffix && <span>{suffix}</span>}
    </div>
  );
}

export function Badge({ tone, children }: { tone?: 'ok' | 'warn' | 'danger' | 'info'; children: ReactNode }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function Skeleton({ height = 16, width = '100%', style }: { height?: number; width?: number | string; style?: CSSProperties }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: 18, display: 'grid', gap: 12 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={18} width={`${90 - (i % 3) * 15}%`} />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone, children, icon }: { tone?: 'warn' | 'danger' | 'ok' | 'info'; children: ReactNode; icon?: IconName }) {
  return (
    <div className={`notice ${tone ?? ''}`} role={tone === 'danger' ? 'alert' : undefined}>
      {icon && <Icon name={icon} size={18} style={{ flex: 'none', marginTop: 1 }} />}
      <div>{children}</div>
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Notice tone="danger" icon="alert">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{error}</span>
        {onRetry && (
          <Button size="sm" onClick={onRetry} icon="refresh">
            Try again
          </Button>
        )}
      </div>
    </Notice>
  );
}

export function PageHeader({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="page-head">
      <div>
        {back && (
          <Link to={back.to} className="back-link">
            <Icon name="back" size={14} /> {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="page-actions no-print">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, bodyless, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; bodyless?: boolean; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="page-actions no-print">{actions}</div>}
        </div>
      )}
      {bodyless ? children : <div className="panel-body">{children}</div>}
    </section>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  dismissable = true,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  dismissable?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose, dismissable]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {dismissable && <Button variant="ghost" icon="close" aria-label="Close" data-close onClick={onClose} />}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
  children,
  confirmDisabled,
}: {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  confirmDisabled?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={busy ? () => undefined : onCancel}
      dismissable={!busy}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Go back
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body && <div style={{ marginBottom: children ? 14 : 0 }}>{body}</div>}
      {children}
    </Modal>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" className="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Figure({ label, value, note, onClick, lead }: { label: string; value: ReactNode; note?: ReactNode; onClick?: () => void; lead?: boolean }) {
  const content = (
    <>
      <div className="figure-label">{label}</div>
      <div className="figure-value">{value}</div>
      {note && <div className="figure-note">{note}</div>}
    </>
  );
  return onClick ? (
    <button type="button" className={`figure ${lead ? 'lead' : ''}`} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={`figure ${lead ? 'lead' : ''}`}>{content}</div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
