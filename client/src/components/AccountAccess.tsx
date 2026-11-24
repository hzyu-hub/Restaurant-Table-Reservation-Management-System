import { useEffect, useRef, useState } from 'react';
import { ApiRequestError, loginAccount, registerAccount, type AccountSession } from '../api.ts';
import { friendlyError } from '../errors.ts';
import ErrorBanner from './ErrorBanner.tsx';
import StaffLogin from './StaffLogin.tsx';

export default function AccountAccess({ expired, onSession }: {
  expired: boolean;
  onSession: (session: AccountSession) => void;
}) {
  const [registering, setRegistering] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const authenticate = async (request: () => Promise<AccountSession>) => {
    if (pending.current) return;
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const session = await request();
      if (alive.current) onSession(session);
    } catch (cause: unknown) {
      if (alive.current) setError(cause instanceof ApiRequestError && cause.status === 401
        ? 'Sign-in failed. Check your username and password.' : friendlyError(cause));
    } finally {
      pending.current = false;
      if (alive.current) setSubmitting(false);
    }
  };

  return (
    <main className="page auth-page">
      <div className="card auth-card">
        <p className="auth-brand">Table Reservations</p>
        <header className="page-header">
          <h1 ref={heading} tabIndex={-1} className="brand">{registering ? 'Create your account' : 'Sign in'}</h1>
          <p className="subtitle">{registering ? 'Register to reserve a table and manage your bookings.' : 'Welcome back. Enter your username and password.'}</p>
        </header>
        {expired && <p role="status" className="session-notice">Your session has ended. Please sign in again.</p>}
        {error !== null && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        {registering ? (
          <form className="booking-form" onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const text = (key: string) => String(data.get(key) ?? '').trim();
            const email = text('email');
            void authenticate(() => registerAccount({
              username: text('username'), name: text('name'),
              password: String(data.get('password') ?? ''), phone: text('phone'),
              ...(email ? { email } : {}),
            }));
          }}>
            <label className="field"><span className="field__label">Username</span>
              <input name="username" autoComplete="username" required disabled={submitting} /></label>
            <label className="field"><span className="field__label">Full name</span>
              <input name="name" autoComplete="name" minLength={2} maxLength={80} required disabled={submitting} /></label>
            <label className="field"><span className="field__label">Password</span>
              <input name="password" type="password" autoComplete="new-password" required disabled={submitting} /></label>
            <label className="field"><span className="field__label">Phone</span>
              <input name="phone" type="tel" autoComplete="tel" required disabled={submitting} /></label>
            <label className="field"><span className="field__label">Email <span className="field__optional">(optional)</span></span>
              <input name="email" type="email" autoComplete="email" disabled={submitting} /></label>
            <button type="submit" className="primary-button" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</button>
          </form>
        ) : <StaffLogin submitting={submitting} onSubmit={(username, password) => {
          void authenticate(() => loginAccount(username.trim(), password));
        }} />}
        <div className="auth-switch">
          <span>{registering ? 'Already have an account?' : 'New customer?'}</span>
          <button type="button" className="text-button" disabled={submitting} onClick={() => {
            setRegistering((value) => !value);
            setError(null);
            heading.current?.focus();
          }}>{registering ? 'Sign in' : 'Create an account'}</button>
        </div>
      </div>
    </main>
  );
}
