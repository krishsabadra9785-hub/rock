import { APP_NAME } from '../config/brand';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark, Icon, type IconName } from '../components/Icon';
import { Button } from '../components/ui';
import { ROLE_LABELS } from '../domain/permissions';
import { useOnline } from '../hooks/useOnline';
import { useSession } from '../state/SessionProvider';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const GROUPS: { label: string; items: NavItem[] }[] = [
  { label: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: 'dashboard' }] },
  {
    label: 'Operations',
    items: [
      { to: '/orders', label: 'Orders', icon: 'orders' },
      { to: '/buyers', label: 'Buyers', icon: 'buyer' },
      { to: '/sellers', label: 'Sellers', icon: 'seller' },
      { to: '/commission-agents', label: 'Commission agents', icon: 'agent' },
      { to: '/transporters', label: 'Transporters', icon: 'truck' },
      { to: '/payment-agent', label: 'Payment agent', icon: 'bank' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/payments', label: 'Payments', icon: 'wallet' },
      { to: '/reports', label: 'Reports', icon: 'report' },
    ],
  },
  { label: 'Administration', items: [{ to: '/settings', label: 'Settings', icon: 'settings' }] },
];

/** Destinations the mobile tab bar already shows are left out of the More sheet. */
const IN_TAB_BAR = new Set(['/', '/orders', '/payments']);

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <>
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onNavigate}>
          <Icon name={i.icon} size={16} /> {i.label}
        </NavLink>
      ))}
    </>
  );
}

function initials(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, settings, lock, signOut } = useSession();
  const online = useOnline();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <BrandMark size={26} /> {APP_NAME}
        </div>
        <NavLink to="/orders/new" className="nav-link nav-cta">
          <Icon name="plus" size={16} /> Create order
        </NavLink>
        <nav>
          {GROUPS.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-group-label">{g.label}</div>
              <NavLinks items={g.items} />
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          {settings.businessName !== APP_NAME && <div className="side-business">{settings.businessName}</div>}
          <div className="user-card">
            <span className="user-avatar" aria-hidden="true">{initials(profile?.displayName)}</span>
            <div className="user-meta">
              <strong title={profile?.displayName}>{profile?.displayName}</strong>
              {profile && <span>{ROLE_LABELS[profile.role]}</span>}
            </div>
            <Button variant="ghost" icon="lock" aria-label="Lock app" title="Lock" onClick={lock} />
            <Button variant="ghost" icon="logout" aria-label="Sign out" title="Sign out" onClick={() => void signOut()} />
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="mobile-brand" title={APP_NAME}>
            <BrandMark size={26} tone="light" />
            <span className="sr-only">{APP_NAME}</span>
          </div>
          <form className="topbar-search" role="search" onSubmit={onSearch}>
            <Icon name="search" size={16} />
            <input
              className="input"
              type="search"
              placeholder="Search orders, vehicles, drivers, parties…"
              aria-label="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
          <div className="topbar-spacer" />
          <div className="topbar-actions">
            <Button variant="ghost" icon="lock" aria-label="Lock app" title="Lock" onClick={lock} />
            <Button variant="ghost" icon="logout" aria-label="Sign out" title="Sign out" onClick={() => void signOut()} />
          </div>
        </header>
        {!online && <div className="offline-banner" role="status">You are offline. Changes can't be saved until the connection returns.</div>}
        <main className="content" id="main" tabIndex={-1} style={{ outline: 'none' }}>
          {children}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="dashboard" size={20} /> Home
        </NavLink>
        <NavLink to="/orders" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="orders" size={20} /> Orders
        </NavLink>
        <NavLink to="/orders/new" className="mobile-cta" aria-label="Create order">
          <Icon name="plus" size={20} />
        </NavLink>
        <NavLink to="/payments" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="wallet" size={20} /> Payments
        </NavLink>
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
          <Icon name="more" size={20} /> More
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="More" onClick={(e) => e.stopPropagation()}>
            {GROUPS.map((g) => {
              const items = g.items.filter((i) => !IN_TAB_BAR.has(i.to));
              if (items.length === 0) return null;
              return (
                <div className="nav-group" key={g.label}>
                  <div className="nav-group-label">{g.label}</div>
                  <NavLinks items={items} onNavigate={() => setMoreOpen(false)} />
                </div>
              );
            })}
            {profile && (
              <p className="small muted" style={{ padding: '12px 12px 0' }}>
                Signed in as {profile.displayName} ({ROLE_LABELS[profile.role]})
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
