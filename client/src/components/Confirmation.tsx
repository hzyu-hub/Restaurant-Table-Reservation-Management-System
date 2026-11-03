import type { ReservationResponse } from '../api.ts';

interface ConfirmationProps {
  reservation: ReservationResponse;
  timeZone: string;
  onBookAnother: () => void;
}

function formatLocalRange(
  startTime: string,
  endTime: string,
  timeZone: string,
): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  });
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  });

  return `${formatter.format(new Date(startTime))} – ${timeFormatter.format(
    new Date(endTime),
  )}`;
}

/** Success panel showing the booking reference. */
export default function Confirmation({
  reservation,
  timeZone,
  onBookAnother,
}: ConfirmationProps) {
  return (
    <section className="confirmation" aria-live="polite">
      <p className="confirmation__badge">Reservation confirmed</p>
      <h2>Thank you, {reservation.customerName}</h2>

      <dl className="confirmation__details">
        <div>
          <dt>Reference</dt>
          <dd className="confirmation__reference">{reservation.reference}</dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>
            {formatLocalRange(reservation.startTime, reservation.endTime, timeZone)}
          </dd>
        </div>
        <div>
          <dt>Party</dt>
          <dd>
            {reservation.partySize}{' '}
            {reservation.partySize === 1 ? 'guest' : 'guests'}
          </dd>
        </div>
        <div>
          <dt>Table</dt>
          <dd>
            {reservation.table.label} (seats {reservation.table.capacity})
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{reservation.status}</dd>
        </div>
      </dl>

      <p className="confirmation__note">
        Please keep this reference for your visit. Call the restaurant if you need
        to change or cancel.
      </p>

      <button type="button" className="primary-button" onClick={onBookAnother}>
        Book another table
      </button>
    </section>
  );
}
