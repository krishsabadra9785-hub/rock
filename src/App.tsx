import { APP_NAME } from './config/brand';
import { lazy, Suspense, useRef, type ReactNode } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { firebaseConfigured } from './firebase/app';
import { AppShell } from './layout/AppShell';
import { DataProvider } from './state/DataProvider';
import { SessionProvider, useSession } from './state/SessionProvider';
import { ToastProvider } from './state/ToastProvider';
import { UpdatePrompt } from './components/UpdatePrompt';
import { LoginPage } from './features/auth/LoginPage';
import { LockScreen } from './features/auth/LockScreen';
import { SetPinPage } from './features/auth/SetPinPage';
import { LoadingScreen, NotAuthorizedScreen, SetupRequiredScreen } from './features/auth/StatusScreens';
import { PARTY_LABELS } from './services/parties';
import { PARTY_TYPES } from './domain/types';
import { EmptyState, ButtonLink } from './components/ui';

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const CreateOrderPage = lazy(() => import('./features/orders/CreateOrderPage'));
const OrdersPage = lazy(() => import('./features/orders/OrdersPage'));
const OrderDetailPage = lazy(() => import('./features/orders/OrderDetailPage'));
const PartyListPage = lazy(() => import('./features/parties/PartyListPage'));
const PartyProfilePage = lazy(() => import('./features/parties/PartyProfilePage'));
const PaymentAgentPage = lazy(() => import('./features/paymentAgent/PaymentAgentPage'));
const PaymentsPage = lazy(() => import('./features/payments/PaymentsPage'));
const LedgerPage = lazy(() => import('./features/ledger/LedgerPage'));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'));
const SearchPage = lazy(() => import('./features/search/SearchPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));

function NotFound() {
  return <EmptyState title="Page not found" body={`That address doesn't exist in ${APP_NAME}.`} action={<ButtonLink to="/">Go to dashboard</ButtonLink>} />;
}

function AuthenticatedApp() {
  return (
    <DataProvider>
      <AppShell>
        <Suspense fallback={<LoadingScreen label="Loading…" />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/orders/new" element={<CreateOrderPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
            {PARTY_TYPES.map((t) => (
              <Route key={t} path={`/${PARTY_LABELS[t].path}`} element={<PartyListPage type={t} />} />
            ))}
            {PARTY_TYPES.map((t) => (
              <Route key={`${t}-id`} path={`/${PARTY_LABELS[t].path}/:id`} element={<PartyProfilePage type={t} />} />
            ))}
            <Route path="/payment-agent" element={<PaymentAgentPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/ledger/:kind" element={<LedgerPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AppShell>
    </DataProvider>
  );
}

function Gate(): ReactNode {
  const { status } = useSession();
  // Once unlocked in this page session, auto-lock overlays the app instead of
  // unmounting it, so a half-finished order isn't lost when the screen locks.
  const wasUnlocked = useRef(false);
  if (status === 'unlocked') wasUnlocked.current = true;
  if (status === 'signedOut' || status === 'loading') wasUnlocked.current = false;

  if (status === 'unlocked' || (status === 'locked' && wasUnlocked.current)) {
    const locked = status === 'locked';
    // Same element tree in both states so React keeps the app's state.
    return (
      <>
        <div className="app-root" inert={locked} aria-hidden={locked || undefined} style={locked ? { visibility: 'hidden' } : undefined}>
          <AuthenticatedApp />
        </div>
        {locked && (
          <div className="lock-overlay">
            <LockScreen />
          </div>
        )}
      </>
    );
  }

  switch (status) {
    case 'loading':
    case 'checking':
      return <LoadingScreen />;
    case 'signedOut':
      return <LoginPage />;
    case 'unauthorized':
      return <NotAuthorizedScreen />;
    case 'needsPin':
      return <SetPinPage />;
    case 'locked':
      return <LockScreen />;
  }
}

export function App() {
  if (!firebaseConfigured) return <SetupRequiredScreen />;
  return (
    // HashRouter: URLs look like /rock/#/orders, so GitHub Pages never 404s on refresh.
    <HashRouter>
      <ToastProvider>
        <SessionProvider>
          <Gate />
          <UpdatePrompt />
        </SessionProvider>
      </ToastProvider>
    </HashRouter>
  );
}
