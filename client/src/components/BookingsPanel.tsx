import { useEffect, useRef, useState } from 'react';
import {
  cancelCustomerReservation, fetchCustomerReservations, fetchServerClock,
  fetchStaffReservations, updateReservationStatus,
  type AccountSession, type ReservationStatus, type ServerClock, type StaffReservation,
} from '../api.ts';
import { friendlyError, isExpired } from '../errors.ts';
import CustomerBookings from './CustomerBookings.tsx';
import ErrorBanner from './ErrorBanner.tsx';
import StaffDashboard from './StaffDashboard.tsx';

export default function BookingsPanel({ session, clock, onExpired }: {
  session: AccountSession;
  clock: ServerClock;
  onExpired: () => void;
}) {
  const customer = session.user.role === 'customer';
  const [date, setDate] = useState(clock.today);
  const [timeZone, setTimeZone] = useState(clock.timezone);
  const [reservations, setReservations] = useState<StaffReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingReference, setPendingReference] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [jumpToToday, setJumpToToday] = useState(false);
  const alive = useRef(true);
  const pending = useRef(false);
  const requestVersion = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; requestVersion.current += 1; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setLoading(true);
    setReservations([]);
    if (!customer && !date && !jumpToToday) { setLoading(false); return; }
    void (async () => {
      try {
        if (customer) {
          const result = await fetchCustomerReservations(session.token, controller.signal);
          if (cancelled || version !== requestVersion.current) return;
          setReservations(result.reservations);
          setTimeZone(result.timezone);
        } else {
          // Refresh Today from the restaurant clock, including across midnight.
          const target = jumpToToday ? (await fetchServerClock(controller.signal)).today : date;
          if (cancelled || version !== requestVersion.current) return;
          const result = await fetchStaffReservations(session.token, target, controller.signal);
          if (cancelled || version !== requestVersion.current) return;
          if (jumpToToday) { setDate(target); setJumpToToday(false); }
          setReservations(result.reservations);
          setTimeZone(result.timezone);
        }
      } catch (cause: unknown) {
        if (cancelled || version !== requestVersion.current) return;
        if (isExpired(cause)) { onExpired(); return; }
        setError(friendlyError(cause));
      } finally {
        if (!cancelled && version === requestVersion.current) setLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [customer, session.token, date, refresh, jumpToToday, onExpired]);

  const changeStatus = async (reference: string, status: ReservationStatus) => {
    if (pending.current) return;
    pending.current = true;
    const version = ++requestVersion.current;
    setPendingReference(reference);
    setError(null);
    try {
      const updated = customer
        ? await cancelCustomerReservation(session.token, reference)
        : await updateReservationStatus(session.token, reference, status);
      if (!alive.current || version !== requestVersion.current) return;
      setReservations((items) => items.map((item) => item.reference === reference ? updated : item));
    } catch (cause: unknown) {
      if (!alive.current || version !== requestVersion.current) return;
      if (isExpired(cause)) { onExpired(); return; }
      setError(friendlyError(cause));
      // A concurrent change can make an action illegal; reload the real state.
      setRefresh((value) => value + 1);
    } finally {
      pending.current = false;
      if (alive.current) setPendingReference(null);
    }
  };

  const reload = () => { setError(null); setRefresh((value) => value + 1); };
  return (
    <>
      {error !== null && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {customer ? <CustomerBookings reservations={reservations} timeZone={timeZone} loading={loading}
        pendingReference={pendingReference} onRefresh={reload}
        onCancel={(reference) => { void changeStatus(reference, 'CANCELLED'); }} /> : (
        <StaffDashboard date={date} minDate={null} timeZone={timeZone} reservations={reservations}
          loading={loading} pendingReference={pendingReference}
          onDateChange={(nextDate) => {
            requestVersion.current += 1;
            setDate(nextDate); setReservations([]); setLoading(Boolean(nextDate)); setError(null);
          }}
          onToday={() => { setError(null); setJumpToToday(true); setRefresh((value) => value + 1); }}
          onRefresh={reload} onStatusChange={(reference, status) => { void changeStatus(reference, status); }} />
      )}
    </>
  );
}
