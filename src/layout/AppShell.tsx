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

const PRIMARY: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/orders', label: 'Orders', icon: 'orders' },
];
const PARTIES: NavItem[] = [
  { to: '/buyers', label: 'Buyers', icon: 'buyer' },
  { to: '/sellers', label: 'Sellers', icon: 'seller' },
  { to: '/commission-agents', label: 'Commission agents', icon: 'agent' },
  { to: '/transporters', label: 'Transporters', icon: 'truck' },
  { to: '/payment-agent', label: 'Payment agent', icon: 'bank' },
];
const MONEY: NavItem[] = [
  { to: '/payments', label: 'Payments', icon: 'wallet' },
  { to: '/reports', label: 'Reports', icon: 'report' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <>
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onNavigate}>
          <Icon name={i.icon} /> {i.label}
        </NavLink>
      ))}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, settings, lock, signOut } = useSession();
  const online = useOnline();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => setMoreOpen(false), [location.pathname]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <BrandMark /> {APP_NAME}
        </div>
        <NavLink to="/orders/new" className="nav-link nav-cta">
          <Icon name="plus" /> Create order
        </NavLink>
        <nav>
          <div className="nav-group">
            <NavLinks items={PRIMARY} />
          </div>
          <div className="nav-group">
            <NavLinks items={PARTIES} />
          </div>
          <div className="nav-group">
            <NavLinks items={MONEY} />
          </div>
        </nav>
        <div className="sidebar-foot">
          {settings.businessName !== APP_NAME && <div style={{ color: '#dfe7e4' }}>{settings.businessName}</div>}
          {profile && (
            <div>
              {profile.displayName} ({ROLE_LABELS[profile.role]})
            </div>
          )}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="mobile-brand">
            <BrandMark size={22} /> {APP_NAME}
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
          <span className="topbar-user">{profile?.displayName}</span>
          <Button variant="ghost" icon="lock" aria-label="Lock app" title="Lock" onClick={lock} />
          <Button variant="ghost" icon="logout" aria-label="Sign out" title="Sign out" onClick={() => void signOut()} />
        </header>
        {!online && <div className="offline-banner" role="status">You are offline. Changes can't be saved until the connection returns.</div>}
        <main className="content" id="main">
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
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <Icon name="more" size={20} /> More
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="sheet" role="dialog" aria-label="More" onClick={(e) => e.stopPropagation()}>
            <NavLinks items={[...PARTIES, { to: '/reports', label: 'Reports', icon: 'report' }, { to: '/settings', label: 'Settings', icon: 'settings' }]} onNavigate={() => setMoreOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
