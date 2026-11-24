import { useEffect, useRef, useState } from 'react';
import type { StaffReservation } from '../api.ts';
import { formatRestaurantTime } from '../staff.ts';

export default function CustomerBookings({ reservations, timeZone, loading, pendingReference, onRefresh, onCancel }: {
  reservations: StaffReservation[];
  timeZone: string;
  loading: boolean;
  pendingReference: string | null;
  onRefresh: () => void;
  onCancel: (reference: string) => void;
}) {
  const [past, setPast] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelButtons = useRef(new Map<string, HTMLButtonElement>());
  const bookingRows = useRef(new Map<string, HTMLLIElement>());
  const restoreFocus = useRef<string | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (confirming !== null) {
      confirmButton.current?.focus();
    } else if (pendingReference === null && restoreFocus.current !== null) {
      const reference = restoreFocus.current;
      (cancelButtons.current.get(reference) ?? bookingRows.current.get(reference))?.focus();
      restoreFocus.current = null;
    }
  }, [confirming, pendingReference, reservations]);
  useEffect(() => { if (loading) setConfirming(null); }, [loading]);
  const visible = reservations.filter((item) => past
    ? new Date(item.startTime).getTime() <= now
    : new Date(item.startTime).getTime() > now)
    .sort((a, b) => (past ? -1 : 1) * (Date.parse(a.startTime) - Date.parse(b.startTime)));
  const dateLabel = (instant: string) => new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone,
  }).format(new Date(instant));
  const dismissConfirmation = (reference: string) => {
    restoreFocus.current = reference;
    setConfirming(null);
  };

  return (
    <section aria-label="Your bookings" aria-busy={loading}>
      <div className="dashboard__bar">
        <div className="toolbar-actions" role="group" aria-label="Booking period">
          <button type="button" className="ghost-button" aria-pressed={!past} disabled={pendingReference !== null}
            onClick={() => { setPast(false); setConfirming(null); }}>Upcoming</button>
          <button type="button" className="ghost-button" aria-pressed={past} disabled={pendingReference !== null}
            onClick={() => { setPast(true); setConfirming(null); }}>Past</button>
        </div>
        <button type="button" className="ghost-button" disabled={loading || pendingReference !== null} onClick={onRefresh}>Refresh</button>
      </div>
      {loading ? <p role="status" className="slots-empty">Loading your bookings… This may take a moment.</p>
        : visible.length === 0 ? <p className="slots-empty">{past ? 'No past bookings.' : 'No upcoming bookings.'}</p>
        : <ul className="reservation-list">{visible.map((item) => {
          const canCancel = item.status === 'CONFIRMED' && Date.parse(item.startTime) > now;
          return (
            <li className="reservation" key={item.reference} tabIndex={-1}
              ref={(element) => {
                if (element) bookingRows.current.set(item.reference, element);
                else bookingRows.current.delete(item.reference);
              }}>
              <div className="reservation__main">
                <p className="reservation__time">{dateLabel(item.startTime)}
                  <span className={`status status--${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span></p>
                <p className="reservation__who">{formatRestaurantTime(item.startTime, timeZone)} – {formatRestaurantTime(item.endTime, timeZone)}</p>
                <p className="reservation__contact">{item.partySize} {item.partySize === 1 ? 'guest' : 'guests'} · Table {item.table.label}</p>
                <p className="reservation__contact">Reference: <span className="reservation__reference">{item.reference}</span></p>
              </div>
              {canCancel && <div className="customer-cancel">
                {confirming === item.reference ? <div className="cancel-confirmation" role="group"
                  aria-label={`Cancel booking ${item.reference}?`}
                  onKeyDown={(event) => { if (event.key === 'Escape') dismissConfirmation(item.reference); }}>
                  <p>Cancel this reservation?</p>
                  <div className="toolbar-actions">
                    <button ref={confirmButton} type="button" className="ghost-button ghost-button--danger"
                      disabled={pendingReference !== null} onClick={() => {
                        restoreFocus.current = item.reference;
                        setConfirming(null); onCancel(item.reference);
                      }}>Yes, cancel</button>
                    <button type="button" className="ghost-button" disabled={pendingReference !== null}
                      onClick={() => dismissConfirmation(item.reference)}>Keep booking</button>
                  </div>
                </div> : <button type="button" className="ghost-button ghost-button--danger"
                  ref={(element) => {
                    if (element) cancelButtons.current.set(item.reference, element);
                    else cancelButtons.current.delete(item.reference);
                  }}
                  disabled={pendingReference !== null} aria-label={`Cancel booking ${item.reference}`}
                  onClick={() => setConfirming(item.reference)}>{pendingReference === item.reference ? 'Cancelling…' : 'Cancel booking'}</button>}
              </div>}
            </li>
          );
        })}</ul>}
    </section>
  );
}
