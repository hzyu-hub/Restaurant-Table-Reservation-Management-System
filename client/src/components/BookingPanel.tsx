import { useEffect, useRef, useState } from 'react';
import {
  ApiRequestError, createReservation, fetchAvailability,
  type AccountSession, type AvailabilitySlot, type ReservationResponse, type ServerClock,
} from '../api.ts';
import { friendlyError, isExpired } from '../errors.ts';
import { formatRestaurantTime } from '../staff.ts';
import BookingForm, { type CustomerFormValues } from './BookingForm.tsx';
import Confirmation from './Confirmation.tsx';
import ErrorBanner from './ErrorBanner.tsx';
import SlotPicker from './SlotPicker.tsx';

export default function BookingPanel({ session, clock, onExpired }: {
  session: AccountSession;
  clock: ServerClock;
  onExpired: () => void;
}) {
  const [date, setDate] = useState(clock.today);
  const [today, setToday] = useState(clock.today);
  const [timeZone, setTimeZone] = useState(clock.timezone);
  const [partySize, setPartySize] = useState(2);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [duration, setDuration] = useState(90);
  const [selected, setSelected] = useState<AvailabilitySlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reservation, setReservation] = useState<ReservationResponse | null>(null);
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setSlots([]);
    setSelected(null);
    if (!date || reservation !== null) {
      setLoading(false);
      return;
    }
    void fetchAvailability(date, partySize, controller.signal).then((result) => {
      if (cancelled) return;
      setSlots(result.slots);
      setToday(result.today);
      setTimeZone(result.timezone);
      setDuration(result.durationMinutes);
    }).catch((cause: unknown) => {
      if (cancelled) return;
      if (isExpired(cause)) { onExpired(); return; }
      setError(friendlyError(cause));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [date, partySize, refresh, reservation, onExpired]);

  const submit = async (values: CustomerFormValues) => {
    if (pending.current || selected === null || !date || loading) return;
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const time = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
      }).format(new Date(selected.startTime));
      const created = await createReservation(session.token, {
        ...values, customerEmail: values.customerEmail || undefined, partySize, date, time,
      });
      if (alive.current) setReservation(created);
    } catch (cause: unknown) {
      if (!alive.current) return;
      if (isExpired(cause)) { onExpired(); return; }
      setError(friendlyError(cause));
      if (cause instanceof ApiRequestError && cause.status === 409) {
        setSelected(null);
        setRefresh((value) => value + 1);
      }
    } finally {
      pending.current = false;
      if (alive.current) setSubmitting(false);
    }
  };

  if (reservation !== null) return <Confirmation reservation={reservation} timeZone={timeZone}
    onBookAnother={() => {
      setReservation(null);
      setSelected(null);
      setError(null);
    }} />;

  const profile = session.user;
  return (
    <>
      <p className="booking-hours">Open daily 11:00 AM – 10:00 PM. Bookings last {duration} minutes.</p>
      {error !== null && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <section className="controls" aria-label="Reservation date and party size">
        <label className="field"><span className="field__label">Date</span>
          <input type="date" name="date" value={date} min={today} required disabled={submitting}
            onChange={(event) => {
              setDate(event.target.value); setSelected(null); setLoading(true); setError(null);
            }} /></label>
        <label className="field"><span className="field__label">Party size</span>
          <select name="partySize" value={partySize} disabled={submitting} onChange={(event) => {
            setPartySize(Number(event.target.value)); setSelected(null); setLoading(true); setError(null);
          }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((size) => (
              <option key={size} value={size}>{size} {size === 1 ? 'guest' : 'guests'}</option>
            ))}
          </select></label>
      </section>
      <section className="availability" aria-labelledby="availability-title" aria-busy={loading}>
        <h2 id="availability-title">Pick a time</h2>
        {loading ? <p className="slots-empty" role="status">Finding available times… This may take a moment.</p>
          : !date ? <p className="slots-empty">Choose a date to see available times.</p>
          : <SlotPicker slots={slots} timeZone={timeZone} selectedStartTime={selected?.startTime ?? null}
            disabled={submitting} onSelect={(slot) => { setSelected(slot); setError(null); }} />}
        {!loading && error !== null && <button type="button" className="ghost-button"
          onClick={() => { setError(null); setRefresh((value) => value + 1); }}>Try again</button>}
      </section>
      <BookingForm selectedTimeLabel={selected === null ? null : formatRestaurantTime(selected.startTime, timeZone)}
        partySize={partySize} submitting={submitting}
        initialValues={profile.role === 'customer' ? {
          customerName: profile.name, customerPhone: profile.phone, customerEmail: profile.email ?? '',
        } : undefined}
        onSubmit={(values) => { void submit(values); }} />
    </>
  );
}
