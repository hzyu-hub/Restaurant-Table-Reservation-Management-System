import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchServerClock, type AccountSession, type ServerClock } from './api.ts';
import AccountAccess from './components/AccountAccess.tsx';
import BookingPanel from './components/BookingPanel.tsx';
import BookingsPanel from './components/BookingsPanel.tsx';
import ErrorBanner from './components/ErrorBanner.tsx';
import { friendlyError, isExpired } from './errors.ts';

type View = 'reservation' | 'bookings';

function AccountWorkspace({ session, onSignOut }: {
  session: AccountSession;
  onSignOut: (expired?: boolean) => void;
}) {
  const customer = session.user.role === 'customer';
  const [view, setView] = useState<View>(customer ? 'reservation' : 'bookings');
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState<ServerClock | null>(null);
  const [clockError, setClockError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const expire = useCallback(() => onSignOut(true), [onSignOut]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setClockError(null);
    void fetchServerClock(controller.signal).then((result) => {
      if (!cancelled) setClock(result);
    }).catch((error: unknown) => {
      if (cancelled) return;
      if (isExpired(error)) { expire(); return; }
      setClockError(friendlyError(error));
    });
    return () => { cancelled = true; controller.abort(); };
  }, [retry, expire]);

  useEffect(() => {
    // Memory-only sessions also expire while the page is idle.
    const timer = window.setTimeout(expire, session.expiresInSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [session, expire]);

  const reservationLabel = customer ? 'Table Reservation' : 'New Reservation';
  const bookingsLabel = customer ? 'My Bookings' : 'Bookings';
  const items: View[] = ['reservation', 'bookings'];

  return (
    <div className="account-app" onKeyDown={(event) => {
      if (event.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    }}>
      <a className="skip-link" href="#account-content">Skip to content</a>
      <header className="topbar">
        <span className="topbar__brand">Table Reservations</span>
        <span className="topbar__greeting">Hello, {session.user.name || session.user.username}</span>
        <button ref={menuButton} type="button" className="ghost-button menu-toggle"
          aria-expanded={menuOpen} aria-controls="account-navigation"
          onClick={() => setMenuOpen((open) => !open)}>Menu</button>
      </header>
      <div className="account-layout">
        <nav id="account-navigation" aria-label="Main navigation"
          className={`sidebar${menuOpen ? ' sidebar--open' : ''}`}>
          <div className="sidebar__links">
            {items.map((item) => (
              <button type="button" key={item} className="nav-item"
                aria-current={view === item ? 'page' : undefined}
                onClick={() => {
                  setView(item);
                  setMenuOpen(false);
                  heading.current?.focus();
                }}>{item === 'reservation' ? reservationLabel : bookingsLabel}</button>
            ))}
          </div>
          <button type="button" className="nav-item sidebar__signout" onClick={() => onSignOut()}>Sign Out</button>
        </nav>
        <main className="account-content" id="account-content" tabIndex={-1}>
          <div className="card card--wide">
            <header className="page-header">
              <h1 ref={heading} tabIndex={-1} className="brand">{view === 'reservation' ? reservationLabel : bookingsLabel}</h1>
              {clock !== null && <p className="subtitle">All times in {clock.timezone.replaceAll('_', ' ')}.</p>}
            </header>
            {clockError !== null ? <>
              <ErrorBanner message={clockError} onDismiss={() => setRetry((value) => value + 1)} />
              <button type="button" className="ghost-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
            </> : clock === null ? <p role="status">Getting ready… This may take a moment.</p> : view === 'reservation' ? (
              <BookingPanel session={session} clock={clock} onExpired={expire} />
            ) : (
              <BookingsPanel session={session} clock={clock} onExpired={expire} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [expired, setExpired] = useState(false);
  const handleSignOut = useCallback((wasExpired = false) => {
    setSession(null);
    setExpired(wasExpired);
  }, []);

  return session === null ? (
    <AccountAccess expired={expired} onSession={(nextSession) => {
      setExpired(false);
      setSession(nextSession);
    }} />
  ) : <AccountWorkspace session={session} onSignOut={handleSignOut} />;
}
